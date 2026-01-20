import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as FormData from 'form-data';
import { SchemaService } from '../schema/schema.service';
import { OutputTransformer, ExtractionResult as TransformerExtractionResult } from './output-transformer';

export interface DataLabProgress {
    stage: 'submitting' | 'processing' | 'complete' | 'failed';
    message: string;
    elapsedSeconds?: number;
}

export interface DataLabResult {
    success: boolean;
    data?: any;
    error?: string;
}

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
    // Track all sources when same field is extracted from multiple documents
    all_sources?: Array<{
        value: any;
        confidence: number | null;
        source_file: string;
        page: number | null;
    }>;
}

@Injectable()
export class DataLabExtractService {
    private readonly logger = new Logger(DataLabExtractService.name);
    private readonly baseUrl = 'https://www.datalab.to/api/v1/marker';
    private readonly pollInterval = 2000;
    private readonly maxPollTime = 600000; // 10 minutes
    private readonly outputFolder: string;
    private readonly debugEnabled: boolean;

    constructor(
        private readonly configService: ConfigService,
        private readonly schemaService: SchemaService,
    ) {
        this.outputFolder = path.join(process.cwd(), 'output');
        this.debugEnabled = this.configService.get<boolean>('DEBUG_EXTRACTION', false);
        this.ensureOutputFolder(this.outputFolder);
    }

    private async ensureOutputFolder(dirPath: string): Promise<void> {
        try {
            await fs.promises.mkdir(dirPath, { recursive: true });
        } catch (error) {
            // Folder exists
        }
    }

    async processFiles(
        files: Express.Multer.File[],
        schemaName: string,
        sendEvent: EventCallback,
    ): Promise<void> {
        const startTime = Date.now();
        const totalFiles = files.length;
        const apiKey = this.configService.get<string>('DATALAB_API_KEY');

        if (!apiKey) {
            sendEvent('error', { message: 'DATALAB_API_KEY not configured' });
            return;
        }

        this.logger.log(`Processing ${files.length} files with DataLab API`);

        // Match Reducto's start event format
        sendEvent('start', {
            totalFiles,
            message: `Starting DataLab extraction of ${totalFiles} file(s)...`,
        });

        // Load schema
        const schema = await this.schemaService.getSchema(schemaName);
        if (!schema) {
            sendEvent('error', { message: `Schema not found: ${schemaName}` });
            return;
        }

        // Convert schema to DataLab format
        const schemaJson = this.convertSchemaForDataLab(schema);

        const results: ExtractionResult[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileName = file.originalname;
            const fileIndex = i + 1;

            this.logger.log(`Processing file ${fileIndex}/${totalFiles}: ${fileName}`);

            // Match Reducto's progress event format - uploading stage
            sendEvent('progress', {
                fileIndex,
                totalFiles,
                fileName,
                stage: 'uploading',
                message: `Uploading ${fileName} to DataLab...`,
                percent: Math.round((i / totalFiles) * 100),
            });

            try {
                // Save file temporarily
                const tempPath = path.join(this.outputFolder, `temp_${Date.now()}_${fileName}`);
                await fs.promises.writeFile(tempPath, file.buffer);

                // Submitting stage
                sendEvent('progress', {
                    fileIndex,
                    totalFiles,
                    fileName,
                    stage: 'parsing',
                    message: `Submitting ${fileName} to DataLab API...`,
                    percent: Math.round(((i + 0.2) / totalFiles) * 100),
                });

                // Extract with DataLab
                const result = await this.extractWithDataLab(
                    tempPath,
                    schemaJson,
                    apiKey,
                    fileName,
                    fileIndex,
                    totalFiles,
                    sendEvent,
                );

                // Clean up temp file
                await fs.promises.unlink(tempPath).catch(() => { });

                if (result.success && result.data) {
                    const processedData = this.processExtractedData(result.data, fileName);
                    results.push({
                        file: fileName,
                        status: 'success',
                        data: processedData,
                    });

                    // Match Reducto's file_complete event format
                    sendEvent('file_complete', {
                        fileIndex,
                        totalFiles,
                        fileName,
                        status: 'success',
                        message: `✓ ${fileName} completed`,
                        percent: Math.round(((i + 1) / totalFiles) * 100),
                    });
                } else {
                    results.push({
                        file: fileName,
                        status: 'error',
                        error: result.error || 'Unknown error',
                    });

                    sendEvent('file_complete', {
                        fileIndex,
                        totalFiles,
                        fileName,
                        status: 'error',
                        message: `✗ ${fileName} failed: ${result.error}`,
                        percent: Math.round(((i + 1) / totalFiles) * 100),
                    });
                }
            } catch (error: any) {
                this.logger.error(`Error processing ${fileName}: ${error.message}`);
                results.push({
                    file: fileName,
                    status: 'error',
                    error: error.message,
                });

                sendEvent('file_complete', {
                    fileIndex,
                    totalFiles,
                    fileName,
                    status: 'error',
                    message: `✗ ${fileName} failed: ${error.message}`,
                    percent: Math.round(((i + 1) / totalFiles) * 100),
                });
            }
        }

        // Merging stage - match Reducto format
        sendEvent('progress', {
            stage: 'merging',
            message: 'Merging extraction results...',
            percent: 95,
        });

        // Create OutputTransformer for production API format
        const transformer = new OutputTransformer(schema, schemaName, 'datalab');

        // Save individual file outputs first (before merging) - ONLY if multiple files
        if (results.length > 1) {
            for (const result of results) {
                if (result.status === 'success' && result.data) {
                    const singleMerged = this.mergeExtractions([result]);
                    const singleTransformerResults: TransformerExtractionResult[] = [{
                        file: result.file,
                        status: result.status,
                        data: result.data,
                        error: result.error,
                    }];
                    const singleOutput = transformer.transformToProductionFormat(singleMerged, singleTransformerResults);
                    const fileBaseName = path.basename(result.file, path.extname(result.file));
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const singleFilename = `${schemaName}_datalab_${fileBaseName}_${timestamp}.json`;
                    // Individual files also go to the specific folder
                    const serviceOutputFolder = path.join(this.outputFolder, 'datalab', schemaName);
                    await this.ensureOutputFolder(serviceOutputFolder);
                    const singlePath = path.join(serviceOutputFolder, singleFilename);
                    await fs.promises.writeFile(singlePath, JSON.stringify(singleOutput, null, 2));
                    this.logger.log(`Saved individual extraction: ${singleFilename}`);
                }
            }
        }

        // Merge results
        const mergedFields = this.mergeExtractions(results);

        // Convert results to transformer format
        const transformerResults: TransformerExtractionResult[] = results.map(r => ({
            file: r.file,
            status: r.status,
            data: r.data,
            error: r.error,
        }));

        const output = transformer.transformToProductionFormat(mergedFields, transformerResults);

        // Save merged output
        const serviceOutputFolder = path.join(this.outputFolder, 'datalab', schemaName);
        await this.ensureOutputFolder(serviceOutputFolder);

        const outputFilename = `${schemaName}_datalab_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        const outputPath = path.join(serviceOutputFolder, outputFilename);
        await fs.promises.writeFile(outputPath, JSON.stringify(output, null, 2));

        // Also save latest (merged) with static name
        const latestPath = path.join(serviceOutputFolder, `${schemaName}_datalab_latest.json`);
        await fs.promises.writeFile(latestPath, JSON.stringify(output, null, 2));

        const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

        // Match Reducto's complete event format exactly
        sendEvent('complete', {
            message: `Extraction complete in ${elapsedSeconds}s!`,
            percent: 100,
            results: results.map(r => ({
                file: r.file,
                status: r.status,
                data: r.data,
                error: r.error,
            })),
            output,
        });
    }

    private async extractWithDataLab(
        filePath: string,
        schemaJson: string,
        apiKey: string,
        fileName: string,
        fileIndex: number,
        totalFiles: number,
        sendEvent: EventCallback,
    ): Promise<DataLabResult> {
        try {
            this.logger.log('Creating FormData for submission...');

            // Submit file
            const formData = new FormData();
            formData.append('file', fs.createReadStream(filePath), {
                filename: path.basename(filePath),
                contentType: 'application/pdf',
            });
            formData.append('output_format', 'json');
            formData.append('page_schema', schemaJson);
            // CRITICAL: Must use 'accurate' mode - 'fast' mode returns null for extraction_schema_json
            // Evidence: debug_raw_response_1767716520056.json (accurate) has full data,
            //           debug_raw_response_1768220880388.json (fast) has extraction_schema_json: null
            formData.append('mode', 'accurate');
            // OPTIMIZATION 2: Enable LLM for enhanced table and form extraction
            formData.append('use_llm', 'true');
            // OPTIMIZATION 3: Force OCR for scanned documents
            formData.append('force_ocr', 'false');
            // OPTIMIZATION 4: Remove disable_image_extraction to allow image processing
            // formData.append('disable_image_extraction', 'true');  // REMOVED for better accuracy

            const submitResponse = await axios.post(this.baseUrl, formData, {
                headers: {
                    'X-API-Key': apiKey,
                    ...formData.getHeaders(),
                },
                timeout: 60000,
            });

            if (!submitResponse.data.success) {
                throw new Error(submitResponse.data.error || 'API submission failed');
            }

            const checkUrl = submitResponse.data.request_check_url;
            this.logger.log(`Submitted. Check URL: ${checkUrl}`);

            // Poll for result
            const startTime = Date.now();

            while (Date.now() - startTime < this.maxPollTime) {
                await this.sleep(this.pollInterval);
                const elapsed = Math.floor((Date.now() - startTime) / 1000);

                // Send progress event matching Reducto format
                sendEvent('progress', {
                    fileIndex,
                    totalFiles,
                    fileName,
                    stage: 'extracting',
                    message: `Extracting from ${fileName}... ${elapsed}s elapsed`,
                    percent: Math.round(((fileIndex - 1 + 0.5) / totalFiles) * 100),
                });

                const pollResponse = await axios.get(checkUrl, {
                    headers: { 'X-API-Key': apiKey },
                    timeout: 30000,
                });

                const status = pollResponse.data.status;

                if (status === 'complete') {
                    this.logger.log('Extraction complete!');

                    // DEBUG: Save raw API response for analysis (only if DEBUG_EXTRACTION=true)
                    if (this.debugEnabled) {
                        const debugPath = path.join(this.outputFolder, `debug_raw_response_${Date.now()}.json`);
                        await fs.promises.writeFile(debugPath, JSON.stringify(pollResponse.data, null, 2));
                        this.logger.log(`DEBUG: Raw API response saved to ${debugPath}`);
                        this.logger.log(`DEBUG: Response keys: ${Object.keys(pollResponse.data).join(', ')}`);

                        // Check if extraction_schema_json exists
                        if (pollResponse.data.extraction_schema_json) {
                            const parsed = JSON.parse(pollResponse.data.extraction_schema_json);
                            this.logger.log(`DEBUG: extraction_schema_json keys: ${Object.keys(parsed).join(', ')}`);
                        } else {
                            this.logger.warn(`DEBUG: No extraction_schema_json in response!`);
                        }
                    }

                    return { success: true, data: pollResponse.data };
                } else if (status === 'failed') {
                    throw new Error(pollResponse.data.error || 'Extraction failed');
                }
            }

            throw new Error('Extraction timed out');
        } catch (error: any) {
            this.logger.error(`DataLab extraction error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    private convertSchemaForDataLab(schema: any): string {
        // The schema is already in JSON Schema format with type/properties
        // DataLab expects the same format, so we can pass it directly
        // Just ensure it has the required structure

        if (schema.properties) {
            // Already in correct format, just stringify
            return JSON.stringify(schema);
        }

        // Fallback: Convert if it uses a different format (e.g., fields array)
        if (schema.fields && Array.isArray(schema.fields)) {
            const dataLabSchema: any = {
                type: 'object',
                properties: {},
            };

            for (const field of schema.fields) {
                const fieldName = field.name || field.key;
                if (!fieldName) continue;

                if (field.type === 'array' && field.fields) {
                    dataLabSchema.properties[fieldName] = {
                        type: 'array',
                        description: field.description || fieldName,
                        items: {
                            type: 'object',
                            properties: this.convertNestedFields(field.fields),
                        },
                    };
                } else if (field.fields) {
                    dataLabSchema.properties[fieldName] = {
                        type: 'object',
                        description: field.description || fieldName,
                        properties: this.convertNestedFields(field.fields),
                    };
                } else {
                    dataLabSchema.properties[fieldName] = {
                        type: this.mapFieldType(field.type),
                        description: field.description || fieldName,
                    };
                }
            }

            return JSON.stringify(dataLabSchema);
        }

        // If neither format, return as-is
        return JSON.stringify(schema);
    }

    private convertNestedFields(fields: any[]): Record<string, any> {
        const props: Record<string, any> = {};
        for (const field of fields) {
            const name = field.name || field.key;
            if (!name) continue;
            props[name] = {
                type: this.mapFieldType(field.type),
                description: field.description || name,
            };
        }
        return props;
    }

    private mapFieldType(type: string): string {
        switch (type?.toLowerCase()) {
            case 'number':
            case 'integer':
            case 'int':
                return 'integer';
            case 'float':
            case 'decimal':
                return 'number';
            case 'boolean':
            case 'bool':
                return 'boolean';
            default:
                return 'string';
        }
    }

    private processExtractedData(rawData: any, sourceFile: string): any {
        let data: any;

        this.logger.log(`Processing extracted data for ${sourceFile}`);
        this.logger.log(`Raw data keys: ${Object.keys(rawData || {}).join(', ')}`);

        // DataLab returns schema extraction in 'extraction_schema_json' field
        if (rawData.extraction_schema_json) {
            try {
                data = JSON.parse(rawData.extraction_schema_json);
                this.logger.log(`Parsed extraction_schema_json, keys: ${Object.keys(data || {}).join(', ')}`);
            } catch (e) {
                this.logger.warn(`Failed to parse extraction_schema_json: ${e}`);
                data = rawData;
            }
        } else if (rawData.result) {
            // Sometimes result is nested
            data = rawData.result;
            this.logger.log(`Using rawData.result, keys: ${Object.keys(data || {}).join(', ')}`);
        } else {
            // Fallback to raw data - remove internal fields
            const { request_id, status, request_check_url, ...extractedData } = rawData;
            data = extractedData;
            this.logger.log(`Using raw data (excluding internal fields), keys: ${Object.keys(data || {}).join(', ')}`);
        }

        return this.addSourceInfo(data, sourceFile);
    }

    private addSourceInfo(obj: any, sourceFile: string): any {
        if (Array.isArray(obj)) {
            return obj.map(item => this.addSourceInfo(item, sourceFile));
        }

        if (obj && typeof obj === 'object') {
            const result: any = {};
            for (const [key, value] of Object.entries(obj)) {
                if (key.endsWith('_citations')) continue;

                const citationKey = `${key}_citations`;
                if (obj[citationKey] && Array.isArray(obj[citationKey])) {
                    const pages: number[] = [];
                    for (const citation of obj[citationKey]) {
                        if (typeof citation === 'string' && citation.startsWith('/page/')) {
                            const pageNum = parseInt(citation.split('/')[2]) + 1;
                            if (!isNaN(pageNum) && !pages.includes(pageNum)) {
                                pages.push(pageNum);
                            }
                        }
                    }

                    result[key] = {
                        value: this.addSourceInfo(value, sourceFile),
                        page: pages.length === 1 ? pages[0] : pages.length > 0 ? pages : null,
                        confidence: null,
                        source_text: null,
                        bbox: null,
                        source_file: sourceFile,
                    };
                    continue;
                }

                result[key] = this.addSourceInfo(value, sourceFile);
            }
            return result;
        }

        return obj;
    }

    // Configurable fund charges file patterns (matches Reducto)
    private readonly fundChargesPatterns = ['Fund charges', 'fund_charges', 'FundCharges'];

    private isFundChargesFile(fileName: string): boolean {
        return this.fundChargesPatterns.some(pattern =>
            fileName.toLowerCase().includes(pattern.toLowerCase()),
        );
    }

    private mergeExtractions(results: ExtractionResult[]): Record<string, FieldData> {
        const mergedFields: Record<string, FieldData> = {};
        // Temporary storage to collect all values for each field from all documents
        const fieldCollector: Record<string, Array<{
            value: any;
            confidence: number | null;
            source_file: string;
            page: number | null;
            source_text: string | null;
            bbox: any | null;
            is_array?: boolean;
        }>> = {};

        // Single pass: collect all fields from all documents (including fund_charges)
        for (const doc of results) {
            if (doc.status !== 'success' || !doc.data) continue;

            const flattened = this.flattenExtraction(doc.data);
            for (const [fieldPath, fieldData] of Object.entries(flattened)) {
                // Skip completely null/undefined values, but keep "Not Stated" as it's intentional
                if (fieldData.value === null || fieldData.value === undefined) continue;

                // Skip empty strings, but keep "Not Stated" and other values
                if (typeof fieldData.value === 'string' && fieldData.value.trim() === '') continue;

                // Initialize collector for this field if needed
                if (!fieldCollector[fieldPath]) {
                    fieldCollector[fieldPath] = [];
                }

                // Add this document's value to the collection
                fieldCollector[fieldPath].push({
                    value: fieldData.value,
                    confidence: fieldData.confidence,
                    source_file: doc.file,
                    page: fieldData.page,
                    source_text: fieldData.source_text,
                    bbox: fieldData.bbox,
                    is_array: fieldData.is_array,
                });
            }
        }

        // Now process collected fields - pick best value and keep all sources
        for (const [fieldPath, sources] of Object.entries(fieldCollector)) {
            if (sources.length === 0) continue;

            // Sort sources by quality:
            // 1. Prefer values that are NOT "Not Stated" or "Not Applicable"
            // 2. Then by confidence (higher is better)
            // 3. Then by specificity (longer strings often have more detail)
            const sortedSources = [...sources].sort((a, b) => {
                const aIsNotStated = typeof a.value === 'string' &&
                    (a.value.toLowerCase().includes('not stated') || a.value.toLowerCase().includes('not applicable'));
                const bIsNotStated = typeof b.value === 'string' &&
                    (b.value.toLowerCase().includes('not stated') || b.value.toLowerCase().includes('not applicable'));

                // Prefer actual values over "Not Stated"
                if (aIsNotStated && !bIsNotStated) return 1;
                if (!aIsNotStated && bIsNotStated) return -1;

                // Then by confidence
                const confA = a.confidence ?? 0;
                const confB = b.confidence ?? 0;
                if (confB !== confA) return confB - confA;

                // Then by string length (more detail)
                if (typeof a.value === 'string' && typeof b.value === 'string') {
                    return b.value.length - a.value.length;
                }

                return 0;
            });

            // Use the best source as the primary value
            const best = sortedSources[0];

            // Build all_sources array if there are multiple sources
            const allSources = sources.length > 1 ? sources.map(s => ({
                value: s.value,
                confidence: s.confidence,
                source_file: s.source_file,
                page: s.page,
            })) : undefined;

            mergedFields[fieldPath] = {
                value: best.value,
                confidence: best.confidence,
                page: best.page,
                source_text: best.source_text,
                bbox: best.bbox,
                source_file: best.source_file,
                is_array: best.is_array,
                all_sources: allSources,
            };
        }

        return mergedFields;
    }

    private flattenExtraction(data: any, prefix = ''): Record<string, FieldData> {
        const result: Record<string, FieldData> = {};
        if (!data || typeof data !== 'object') return result;

        for (const [key, value] of Object.entries(data)) {
            // Skip citation keys (handled with main field)
            if (key.endsWith('_citations')) continue;

            const fullKey = prefix ? `${prefix}.${key}` : key;

            // Check if this is a field with value/page/confidence structure
            if (this.isFieldData(value)) {
                const fieldData = value as FieldData;
                if (fieldData.value !== null && fieldData.value !== undefined) {
                    result[fullKey] = fieldData;
                }
            }
            // Handle arrays - process each item
            else if (Array.isArray(value)) {
                if (value.length > 0) {
                    // Process array items to extract nested values
                    const processedItems = value.map((item: any) => {
                        if (typeof item === 'object' && item !== null) {
                            return this.processArrayItem(item);
                        }
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
            }
            // Handle nested objects - recurse
            else if (value && typeof value === 'object') {
                const nested = this.flattenExtraction(value, fullKey);
                Object.assign(result, nested);
            }
            // Handle primitive values
            else if (value !== null && value !== undefined) {
                result[fullKey] = {
                    value: value,
                    confidence: null,
                    page: null,
                    source_text: null,
                    bbox: null,
                };
            }
        }

        return result;
    }

    // Process array items to extract value from DataLab's structure
    private processArrayItem(item: any): any {
        const processed: Record<string, any> = {};
        if (!item || typeof item !== 'object') return item;

        for (const [fieldName, fieldValue] of Object.entries(item)) {
            // Skip citation keys
            if (fieldName.endsWith('_citations')) continue;

            // If it has a value property, extract it
            if (fieldValue && typeof fieldValue === 'object' && 'value' in (fieldValue as any)) {
                processed[fieldName] = {
                    value: (fieldValue as any).value,
                    page: (fieldValue as any).page || null,
                };
            } else {
                processed[fieldName] = { value: fieldValue };
            }
        }
        return processed;
    }

    private isFieldData(obj: any): boolean {
        return obj && typeof obj === 'object' && 'value' in obj && !Array.isArray(obj);
    }

    private isEmpty(value: any): boolean {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string' && value.trim() === '') return true;
        if (Array.isArray(value) && value.length === 0) return true;
        return false;
    }

    private createOutput(mergedFields: Record<string, FieldData>, results: ExtractionResult[]): any {
        const successful = results.filter(r => r.status === 'success');
        const confidences = Object.values(mergedFields)
            .map(f => f.confidence)
            .filter((c): c is number => c !== null && c !== undefined);

        const avgConfidence = confidences.length > 0
            ? confidences.reduce((a, b) => a + b, 0) / confidences.length
            : 0.0;

        // Match Reducto's output format
        const summary = {
            extraction_model: 'datalab',
            total_documents: results.length,
            successful_documents: successful.length,
            failed_documents: results.length - successful.length,
            total_fields_extracted: Object.keys(mergedFields).length,
            overall_confidence: Number(avgConfidence.toFixed(3)),
            processed_files: successful.map(r => r.file),
            failed_files: results
                .filter(r => r.status !== 'success')
                .map(r => ({ file: r.file, error: r.error })),
        };

        const extractedData: Record<string, Record<string, any>> = {};
        const sortedKeys = Object.keys(mergedFields).sort();

        for (const fieldPath of sortedKeys) {
            const fieldData = mergedFields[fieldPath];
            const parts = fieldPath.split('.');
            const section = parts.length > 1 ? parts[0] : 'general';
            const fieldName = parts[parts.length - 1];

            if (!extractedData[section]) extractedData[section] = {};

            if (fieldData.is_array) {
                extractedData[section][fieldName] = {
                    value: fieldData.value,
                    source_file: fieldData.source_file,
                    is_array: true,
                    ...(fieldData.all_sources && { all_sources: fieldData.all_sources }),
                };
            } else {
                extractedData[section][fieldName] = {
                    value: fieldData.value,
                    confidence: fieldData.confidence,
                    page: fieldData.page,
                    source_file: fieldData.source_file,
                    source_text: fieldData.source_text,
                    bbox: fieldData.bbox,
                    ...(fieldData.all_sources && { all_sources: fieldData.all_sources }),
                };
            }
        }

        return { extraction_summary: summary, extracted_data: extractedData };
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
