import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reducto, toFile } from 'reductoai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SchemaService } from '../schema/schema.service';
import {
    ReductoUploadResponse,
    ReductoParseResponse,
    ReductoExtractResponse,
} from '../types/reducto.types';

type EventCallback = (type: string, data: Record<string, any>) => void;

interface ExtractionResult {
    file: string;
    status: 'success' | 'error';
    data?: any;
    error?: string;
}

interface FieldData {
    value: any;
    confidence: number | null;
    page: number | null;
    source_text: string | null;
    bbox: any | null;
    is_array?: boolean;
    source_file?: string;
}

@Injectable()
export class ExtractService {
    private readonly logger = new Logger(ExtractService.name);
    private readonly outputFolder: string;

    // Configurable fund charges file patterns (Issue #2)
    private readonly fundChargesPatterns: string[];

    constructor(
        private readonly configService: ConfigService,
        private readonly schemaService: SchemaService,
    ) {
        this.outputFolder = path.join(process.cwd(), 'output');

        // Load configurable patterns from environment (Issue #2)
        const patterns = this.configService.get<string>(
            'FUND_CHARGES_FILE_PATTERNS',
        );
        this.fundChargesPatterns = patterns
            ? patterns.split(',').map((p) => p.trim())
            : ['Fund charges'];
    }

    // Retry with exponential backoff utility (Issue #4)
    private async retryWithBackoff<T>(
        operation: () => Promise<T>,
        maxRetries: number = 3,
        baseDelayMs: number = 500,
    ): Promise<T> {
        let lastError: Error;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;

                if (attempt < maxRetries - 1) {
                    const delay = baseDelayMs * Math.pow(2, attempt);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError!;
    }

    // Timeout wrapper utility (Issue #8)
    private async withTimeout<T>(
        promise: Promise<T>,
        timeoutMs: number,
        errorMessage: string = 'Operation timed out',
    ): Promise<T> {
        const timeout = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
        });
        return Promise.race([promise, timeout]);
    }

    // Generate timestamped output filename (Issue #5)
    private generateOutputFilename(schemaName: string, suffix?: string): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const baseName = suffix
            ? `${schemaName}_${suffix}_${timestamp}`
            : `${schemaName}_${timestamp}`;
        return `${baseName}_extracted.json`;
    }

    // Configurable fund charges file detection (Issue #2)
    private isFundChargesFile(fileName: string): boolean {
        return this.fundChargesPatterns.some((pattern) =>
            fileName.toLowerCase().includes(pattern.toLowerCase()),
        );
    }

    async processFiles(
        files: Express.Multer.File[],
        schemaName: string,
        sendEvent: EventCallback,
    ): Promise<void> {
        const totalFiles = files.length;
        sendEvent('start', {
            totalFiles,
            message: `Starting extraction of ${totalFiles} file(s)...`,
        });

        // Load schema
        const schema = await this.schemaService.getSchema(schemaName);
        if (!schema) {
            sendEvent('error', { message: `Schema ${schemaName} not found` });
            return;
        }

        // Load schema-specific system prompt
        const systemPrompt = await this.schemaService.getSystemPrompt(schemaName);

        const apiKey = this.configService.get<string>('REDUCTO_API_KEY');
        if (!apiKey) {
            sendEvent('error', { message: 'REDUCTO_API_KEY not configured' });
            return;
        }

        const client = new Reducto({ apiKey });
        const results: ExtractionResult[] = [];

        // Process each file
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileName = file.originalname;
            const fileIndex = i + 1;

            sendEvent('progress', {
                fileIndex,
                totalFiles,
                fileName,
                stage: 'uploading',
                message: `Uploading ${fileName}...`,
                percent: Math.round((i / totalFiles) * 100),
            });

            try {
                // Create file object for Reducto SDK
                const fileObj = await toFile(file.buffer, fileName);

                // Upload file
                const upload = await client.upload({
                    file: fileObj,
                    extension: path.extname(fileName),
                });

                if (!upload || !upload.file_id) {
                    throw new Error('Upload failed');
                }

                sendEvent('progress', {
                    fileIndex,
                    totalFiles,
                    fileName,
                    stage: 'parsing',
                    message: `Parsing ${fileName}...`,
                    percent: Math.round(((i + 0.33) / totalFiles) * 100),
                });

                // Parse document with retry logic (Issue #4) - no timeout
                const parse = await this.retryWithBackoff(
                    () =>
                        client.parse.run({
                            document_url: upload.file_id,
                        } as any),
                    3,
                    500,
                ) as ReductoParseResponse;

                if (!parse || !parse.job_id) {
                    throw new Error('Parse failed');
                }

                sendEvent('progress', {
                    fileIndex,
                    totalFiles,
                    fileName,
                    stage: 'extracting',
                    message: `Extracting data from ${fileName}...`,
                    percent: Math.round(((i + 0.66) / totalFiles) * 100),
                });

                // Extract data - no timeout constraint
                const extractResult = await client.extract.run({
                    input: `jobid://${parse.job_id}`,
                    instructions: {
                        schema,
                        system_prompt: systemPrompt,
                    },
                    settings: {
                        citations: {
                            enabled: true,
                            numerical_confidence: true,
                        },
                        array_extract: (schema as any).type === 'array',
                    },
                } as any);

                this.logger.debug(`Raw Reducto result for ${fileName}: ${JSON.stringify((extractResult as any).result, null, 2)}`);

                let data = (extractResult as any).result;
                if (Array.isArray(data) && data.length > 0) {
                    data = data[0];
                }

                results.push({
                    file: fileName,
                    status: 'success',
                    data,
                });

                sendEvent('file_complete', {
                    fileIndex,
                    totalFiles,
                    fileName,
                    status: 'success',
                    message: `✓ ${fileName} completed`,
                    percent: Math.round(((i + 1) / totalFiles) * 100),
                });
            } catch (error) {
                console.error(`Error processing ${fileName}:`, error);
                results.push({
                    file: fileName,
                    status: 'error',
                    error: error instanceof Error ? error.message : 'Unknown error',
                });

                sendEvent('file_complete', {
                    fileIndex,
                    totalFiles,
                    fileName,
                    status: 'error',
                    message: `✗ ${fileName} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    percent: Math.round(((i + 1) / totalFiles) * 100),
                });
            }
        }

        try {
            // Merge and finalize
            sendEvent('progress', {
                stage: 'merging',
                message: 'Merging extraction results...',
                percent: 95,
            });

            const mergedFields = this.mergeExtractions(results);
            const output = this.createOutput(mergedFields, results, schemaName);

            // Save output with timestamp (Issue #5)
            const serviceOutputFolder = path.join(this.outputFolder, 'reducto', schemaName);
            await this.ensureDirectory(serviceOutputFolder);

            const outputFilename = this.generateOutputFilename(schemaName);
            const outputPath = path.join(serviceOutputFolder, outputFilename);
            await fs.writeFile(
                outputPath,
                JSON.stringify(output, null, 2),
                'utf-8',
            );

            // Also create a "latest" copy (static name) for easy reference
            const latestPath = path.join(
                serviceOutputFolder,
                `${schemaName}_latest.json`,
            );
            await fs.writeFile(
                latestPath,
                JSON.stringify(output, null, 2),
                'utf-8',
            );

            // Save individual file outputs only if multiple files were processed
            if (results.length > 1) {
                for (const result of results) {
                    if (result.status === 'success') {
                        const singleMerged = this.mergeExtractions([result]);
                        const singleOutput = this.createOutput(singleMerged, [result], schemaName);
                        const fileBaseName = path.basename(
                            result.file,
                            path.extname(result.file),
                        );
                        const singleFilename = this.generateOutputFilename(
                            schemaName,
                            fileBaseName,
                        );
                        const singlePath = path.join(serviceOutputFolder, singleFilename);
                        await fs.writeFile(
                            singlePath,
                            JSON.stringify(singleOutput, null, 2),
                            'utf-8',
                        );
                    }
                }
            }

            // Send final results
            sendEvent('complete', {
                message: 'Extraction complete!',
                percent: 100,
                results: results.map((r) => ({
                    file: r.file,
                    status: r.status,
                    data: r.data,
                    error: r.error,
                })),
                output,
            });
        } finally {
            // Clear file buffer references to help GC (Issue #11)
            files.forEach((file) => {
                (file as any).buffer = null;
            });
        }
    }

    private async ensureDirectory(dirPath: string): Promise<void> {
        try {
            await fs.access(dirPath);
        } catch {
            await fs.mkdir(dirPath, { recursive: true });
        }
    }

    private extractValueFromCitation(fieldData: any): FieldData {
        if (!fieldData || typeof fieldData !== 'object') {
            return {
                value: fieldData,
                confidence: null,
                page: null,
                source_text: null,
                bbox: null,
            };
        }

        if ('value' in fieldData && 'citations' in fieldData) {
            const value = fieldData.value;
            const citations = fieldData.citations || [];
            let confidence: number | null = null;
            let page: number | null = null;
            let sourceText: string | null = null;
            let bbox: any = null;

            if (citations.length > 0) {
                const firstCitation = citations[0];
                sourceText = firstCitation.content;

                if (firstCitation.bbox) {
                    bbox = firstCitation.bbox;
                    page = bbox.page;
                }

                if (firstCitation.granular_confidence) {
                    const gc = firstCitation.granular_confidence;
                    confidence = gc.extract_confidence || gc.confidence;
                } else if (firstCitation.confidence) {
                    const conf = firstCitation.confidence;
                    if (conf === 'high') confidence = 0.9;
                    else if (conf === 'medium') confidence = 0.7;
                    else if (conf === 'low') confidence = 0.5;
                    else {
                        const parsed = parseFloat(conf);
                        confidence = isNaN(parsed) ? null : parsed;
                    }
                }
            }

            return { value, confidence, page, source_text: sourceText, bbox };
        }

        return {
            value: fieldData,
            confidence: null,
            page: null,
            source_text: null,
            bbox: null,
        };
    }

    private processArrayItem(item: any, sourceFile: string, sequenceStart: number = 1): any {
        const processed: Record<string, any> = {};
        if (!item || typeof item !== 'object') return item;

        let sequence = sequenceStart;
        for (const [fieldName, fieldValue] of Object.entries(item)) {
            if (fieldValue && typeof fieldValue === 'object' && 'value' in (fieldValue as any)) {
                const citations = (fieldValue as any).citations || [];
                const firstCitation = citations[0];
                const pageNumber = firstCitation?.bbox?.page || null;
                const hasValue = (fieldValue as any).value !== null && (fieldValue as any).value !== undefined;

                // Convert confidence to 0-99 scale
                let confidence = 99;
                if (firstCitation?.confidence === 'high') confidence = 99;
                else if (firstCitation?.confidence === 'medium') confidence = 70;
                else if (firstCitation?.confidence === 'low') confidence = 50;

                processed[fieldName] = {
                    value: (fieldValue as any).value,
                    page_number: pageNumber,
                    sequence: sequence++,
                    found: hasValue,
                    confidence,
                    source: sourceFile,
                    status: hasValue ? 'found' : 'not_found',
                    description: '',
                    citation: citations, // Keep bbox citations as-is
                    other_cited_pages: [],
                };
            } else {
                processed[fieldName] = {
                    value: fieldValue,
                    page_number: null,
                    sequence: sequence++,
                    found: fieldValue !== null && fieldValue !== undefined,
                    confidence: 99,
                    source: sourceFile,
                    status: fieldValue !== null ? 'found' : 'not_found',
                    description: '',
                    citation: [],
                    other_cited_pages: [],
                };
            }
        }
        return processed;
    }

    private flattenExtraction(data: any, sourceFile: string, prefix = ''): Record<string, FieldData> {
        const result: Record<string, FieldData> = {};
        if (!data || typeof data !== 'object') return result;

        for (const [key, value] of Object.entries(data)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;

            if (value && typeof value === 'object' && !Array.isArray(value)) {
                if ('value' in value && 'citations' in value) {
                    const innerValue = (value as any).value;

                    if (Array.isArray(innerValue)) {
                        const processedItems = innerValue.map((item: any) => {
                            if (typeof item === 'object') return this.processArrayItem(item, sourceFile);
                            return item;
                        });
                        result[fullKey] = {
                            value: processedItems,
                            confidence: null,
                            page: null,
                            source_text: null,
                            bbox: null,
                            is_array: true,
                        };
                    } else {
                        const extracted = this.extractValueFromCitation(value);
                        if (extracted.value !== null) result[fullKey] = extracted;
                    }
                } else {
                    const nested = this.flattenExtraction(value, sourceFile, fullKey);
                    Object.assign(result, nested);
                }
            } else if (Array.isArray(value)) {
                if (value.length > 0) {
                    const processedItems = value.map((item: any) => {
                        if (typeof item === 'object') return this.processArrayItem(item, sourceFile);
                        return item;
                    });
                    result[fullKey] = {
                        value: processedItems,
                        confidence: null,
                        page: null,
                        source_text: null,
                        bbox: null,
                        is_array: true,
                    };
                }
            } else if (value !== null) {
                result[fullKey] = {
                    value,
                    confidence: null,
                    page: null,
                    source_text: null,
                    bbox: null,
                };
            }
        }
        return result;
    }

    private mergeExtractions(results: ExtractionResult[]): Record<string, FieldData> {
        const mergedFields: Record<string, FieldData> = {};

        for (const doc of results) {
            if (doc.status !== 'success' || !doc.data) continue;

            const flattened = this.flattenExtraction(doc.data, doc.file);
            for (const [fieldPath, fieldData] of Object.entries(flattened)) {
                if (fieldData.value === null) continue;
                if (fieldPath.includes('fund_charges')) continue;

                fieldData.source_file = doc.file;

                if (!mergedFields[fieldPath]) {
                    mergedFields[fieldPath] = fieldData;
                } else {
                    const existingConf = mergedFields[fieldPath].confidence || 0;
                    const newConf = fieldData.confidence || 0;
                    if (newConf > existingConf) mergedFields[fieldPath] = fieldData;
                }
            }
        }

        // Process fund charges from specific files (Issue #2 - uses configurable patterns)
        for (const doc of results) {
            if (doc.status !== 'success' || !doc.data) continue;
            if (!this.isFundChargesFile(doc.file)) continue;

            const flattened = this.flattenExtraction(doc.data, doc.file);
            for (const [fieldPath, fieldData] of Object.entries(flattened)) {
                if (!fieldPath.includes('fund_charges')) continue;
                if (fieldData.value === null) continue;

                fieldData.source_file = doc.file;
                mergedFields[fieldPath] = fieldData;
            }
        }

        return mergedFields;
    }

    private createOutput(
        mergedFields: Record<string, FieldData>,
        results: ExtractionResult[],
        schemaName: string = 'cfr',
    ): any {
        const successful = results.filter((r) => r.status === 'success');
        const fileName = successful.length > 0 ? successful[0].file : null;

        const extractedData: Record<string, any> = {};
        const sortedKeys = Object.keys(mergedFields).sort();
        const sectionSequences: Record<string, number> = {};

        for (const fieldPath of sortedKeys) {
            const fieldData = mergedFields[fieldPath];
            const parts = fieldPath.split('.');

            // Build nested structure from path parts
            let current: any = extractedData;
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (!current[part]) {
                    current[part] = {};
                }
                current = current[part];
            }

            // Track sequence per section
            const sectionPath = parts.slice(0, -1).join('.');
            if (!sectionSequences[sectionPath]) {
                sectionSequences[sectionPath] = 1;
            }
            const sequence = sectionSequences[sectionPath]++;

            // Set the final field value in cfr_output.json format
            const fieldName = parts[parts.length - 1];
            if (fieldData.is_array) {
                // Arrays are already processed with the correct structure
                current[fieldName] = fieldData.value;
            } else {
                const hasValue = fieldData.value !== null && fieldData.value !== undefined;
                // Convert confidence to 0-99 scale, default to 99 if not provided
                let confidence = 99;
                if (fieldData.confidence !== null && fieldData.confidence !== undefined) {
                    confidence = Math.round(fieldData.confidence * 100);
                }

                current[fieldName] = {
                    value: fieldData.value,
                    page_number: fieldData.page,
                    sequence,
                    found: hasValue,
                    confidence,
                    source: fieldData.source_file || fileName,
                    status: hasValue ? 'found' : 'not_found',
                    description: '',
                    citation: fieldData.bbox ? [fieldData.bbox] : [],
                    other_cited_pages: [],
                };
            }
        }

        // Return in cfr_output.json wrapper format
        return {
            status: true,
            message: 'Document extractions retrieved successfully',
            data: {
                documentId: null,
                document: {
                    id: null,
                    fileName: fileName,
                    originalName: fileName,
                    filePath: null,
                    fileSize: null,
                    mimeType: 'application/pdf',
                },
                extractions: [
                    {
                        id: null,
                        documentId: null,
                        templateType: schemaName,
                        status: 'completed',
                        version: 1,
                        processorId: null,
                        processorVersionId: null,
                        extractedData,
                    },
                ],
            },
        };
    }
}
