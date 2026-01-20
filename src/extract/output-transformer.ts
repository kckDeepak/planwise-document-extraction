import { v4 as uuidv4 } from 'uuid';

/**
 * Shared interfaces for production API output format
 */
export interface ExtractionFieldOutput {
    value: any;
    page_number: number | null;
    sequence: number;
    found: boolean;
    confidence: number;
    source: string;
    status: 'found' | 'not_found';
    description: string;
    citation: string[];
    other_cited_pages: Array<{ file: string; page: number }>;
}

export interface DocumentMetadata {
    id: string;
    fileName: string;
    originalName: string;
    fileSize: string;
    mimeType: string;
    createdAt: string;
    updatedAt: string;
}

export interface ExtractionOutput {
    id: string;
    documentId: string;
    templateType: string;
    status: 'completed' | 'failed';
    version: number;
    extractedData: any;
    createdAt: string;
    updatedAt: string;
}

export interface ProductionApiOutput {
    status: boolean;
    message: string;
    data: {
        documentId: string;
        document: DocumentMetadata;
        extractions: ExtractionOutput[];
        totalExtractions: number;
    };
}

export interface FieldData {
    value: any;
    confidence: number | null;
    page: number | null;
    source_text: string | null;
    bbox: any | null;
    is_array?: boolean;
    source_file?: string;
    all_sources?: Array<{
        value: any;
        confidence: number | null;
        source_file: string;
        page: number | null;
    }>;
}

export interface ExtractionResult {
    file: string;
    status: 'success' | 'error';
    data?: any;
    error?: string;
    fileSize?: number;
}

/**
 * Output transformer for converting extraction results to production API format
 * Handles flat field paths from extraction and maps to nested schema hierarchy
 */
export class OutputTransformer {
    private schema: any;
    private schemaName: string;
    private extractionModel: 'reducto' | 'datalab';
    private flatToNestedMap: Map<string, string>; // Maps flat field name to nested schema path
    private fieldDescriptions: Map<string, string>; // Maps field path to description

    constructor(schema: any, schemaName: string, extractionModel: 'reducto' | 'datalab' = 'reducto') {
        this.schema = schema;
        this.schemaName = schemaName;
        this.extractionModel = extractionModel;
        this.flatToNestedMap = new Map();
        this.fieldDescriptions = new Map();
        this.buildFieldMappings();
    }

    /**
     * Build mappings from flat field names to nested schema paths
     * e.g., "client_1.forenames" -> "client_1.personal_information.forenames"
     */
    private buildFieldMappings(): void {
        const schemaProps = this.schema?.properties || {};
        this.traverseSchema(schemaProps, '');
    }

    private traverseSchema(props: any, parentPath: string): void {
        for (const [key, value] of Object.entries(props)) {
            const propSchema = value as any;
            const currentPath = parentPath ? `${parentPath}.${key}` : key;

            if (propSchema.type === 'object' && propSchema.properties) {
                // Recurse into nested objects
                this.traverseSchema(propSchema.properties, currentPath);
            } else if (propSchema.type === 'array') {
                // Mark array fields
                this.fieldDescriptions.set(currentPath, propSchema.description || key);
            } else {
                // Leaf field - create mapping
                // Extract the last part of the path to create flat key
                const pathParts = currentPath.split('.');
                const fieldName = pathParts[pathParts.length - 1];
                const clientPrefix = pathParts[0]; // e.g., "client_1" or "client_2"

                // Map flat path (client_1.fieldName) to full nested path
                const flatKey = `${clientPrefix}.${fieldName}`;
                this.flatToNestedMap.set(flatKey, currentPath);
                this.fieldDescriptions.set(currentPath, propSchema.description || fieldName);
            }
        }
    }

    /**
     * Transform merged fields to production API format
     */
    transformToProductionFormat(
        mergedFields: Record<string, FieldData>,
        results: ExtractionResult[],
    ): ProductionApiOutput {
        const successful = results.filter(r => r.status === 'success');
        const documentId = uuidv4();
        const now = new Date().toISOString();

        // Get primary file info
        const primaryFile = successful[0]?.file || 'unknown.pdf';
        const primaryFileSize = successful[0]?.fileSize || 0;

        const document: DocumentMetadata = {
            id: documentId,
            fileName: primaryFile,
            originalName: primaryFile,
            fileSize: String(primaryFileSize),
            mimeType: 'application/pdf',
            createdAt: now,
            updatedAt: now,
        };

        // Transform extracted data using flat-to-nested mapping
        const extractedData = this.buildExtractedData(mergedFields, primaryFile);

        const extraction: ExtractionOutput = {
            id: uuidv4(),
            documentId: documentId,
            templateType: this.schemaName,
            status: 'completed',
            version: 1,
            extractedData,
            createdAt: now,
            updatedAt: now,
        };

        return {
            status: true,
            message: 'Document extractions retrieved successfully',
            data: {
                documentId,
                document,
                extractions: [extraction],
                totalExtractions: 1,
            },
        };
    }

    /**
     * Build extracted data structure from flat merged fields
     */
    private buildExtractedData(
        mergedFields: Record<string, FieldData>,
        primarySource: string,
    ): any {
        const result: any = {};
        const schemaProps = this.schema?.properties || {};

        // Process each top-level property from schema (client_1, client_2, etc.)
        for (const [topKey, topValue] of Object.entries(schemaProps)) {
            const topSchema = topValue as any;

            if (topSchema.type === 'object' && topSchema.properties) {
                result[topKey] = this.buildNestedStructure(
                    topSchema.properties,
                    topKey,
                    mergedFields,
                    primarySource,
                );
            } else if (topSchema.type === 'array') {
                const fieldData = mergedFields[topKey];
                if (fieldData && Array.isArray(fieldData.value)) {
                    result[topKey] = this.transformArrayField(fieldData, topSchema, primarySource);
                } else {
                    result[topKey] = [];
                }
            } else {
                const fieldData = mergedFields[topKey];
                const description = topSchema.description || topKey;
                result[topKey] = this.transformField(
                    fieldData,
                    description,
                    0, // Sequence for root items
                    primarySource
                );
            }
        }

        return result;
    }

    /**
     * Build nested structure matching schema hierarchy
     */
    private buildNestedStructure(
        schemaProps: any,
        parentPath: string,
        mergedFields: Record<string, FieldData>,
        primarySource: string,
    ): any {
        const result: any = {};
        let sequence = 1;

        for (const [key, value] of Object.entries(schemaProps)) {
            const propSchema = value as any;
            const currentPath = `${parentPath}.${key}`;

            if (propSchema.type === 'object' && propSchema.properties) {
                // Recurse into nested object
                result[key] = this.buildNestedStructure(
                    propSchema.properties,
                    currentPath,
                    mergedFields,
                    primarySource,
                );
            } else if (propSchema.type === 'array') {
                // Handle array fields - look for flat path
                const clientPrefix = parentPath.split('.')[0];
                const flatPath = `${clientPrefix}.${key}`;
                const fieldData = mergedFields[flatPath] || mergedFields[currentPath];

                if (fieldData && Array.isArray(fieldData.value)) {
                    result[key] = this.transformArrayField(fieldData, propSchema, primarySource);
                } else {
                    result[key] = [];
                }
            } else {
                // Leaf field - look for flat path first, then full path
                const clientPrefix = parentPath.split('.')[0];
                const flatPath = `${clientPrefix}.${key}`;

                // Try flat path first (client_1.fieldName), then full nested path
                const fieldData = mergedFields[flatPath] || mergedFields[currentPath];
                const description = propSchema.description || key;

                result[key] = this.transformField(
                    fieldData,
                    description,
                    sequence++,
                    primarySource
                );
            }
        }

        return result;
    }

    /**
     * Transform a single field to production format
     */
    private transformField(
        fieldData: FieldData | undefined,
        description: string,
        sequence: number,
        primarySource: string
    ): ExtractionFieldOutput {
        const hasValue: boolean = !!(fieldData &&
            fieldData.value !== null &&
            fieldData.value !== undefined &&
            fieldData.value !== '' &&
            fieldData.value !== 'N/A' &&
            fieldData.value !== 'Not Stated');

        const value = fieldData?.value ?? 'N/A';
        const page = fieldData?.page ?? null;
        const source = fieldData?.source_file || primarySource;

        // Convert confidence from 0-1 to 0-99 scale
        let confidence = 0;
        if (fieldData?.confidence !== null && fieldData?.confidence !== undefined) {
            if (fieldData.confidence <= 1) {
                confidence = Math.round(fieldData.confidence * 100);
            } else {
                confidence = Math.round(fieldData.confidence);
            }
        }
        confidence = hasValue ? (confidence > 0 ? confidence : 99) : 0;

        // Build citation array
        const citation = this.buildCitationArray(fieldData, page);

        // Build other_cited_pages
        const otherCitedPages = this.buildOtherCitedPages(fieldData, page, source);

        return {
            value,
            page_number: page,
            sequence,
            found: hasValue,
            confidence,
            source,
            status: hasValue ? 'found' : 'not_found',
            description,
            citation,
            other_cited_pages: otherCitedPages,
        };
    }

    /**
     * Build citation array in /page/N/Table/N format
     */
    private buildCitationArray(fieldData: FieldData | undefined, page: number | null): string[] {
        if (!page) return [];

        if (fieldData?.bbox) {
            return [`/page/${page}/Table/1`];
        }

        if (fieldData?.source_text) {
            return [`/page/${page}/Text/1`];
        }

        return [`/page/${page}/Table/1`];
    }

    /**
     * Build other_cited_pages array for multi-page citations
     */
    private buildOtherCitedPages(
        fieldData: FieldData | undefined,
        primaryPage: number | null,
        source: string
    ): Array<{ file: string; page: number }> {
        const otherPages: Array<{ file: string; page: number }> = [];

        if (fieldData?.all_sources && fieldData.all_sources.length > 1) {
            for (const src of fieldData.all_sources) {
                if (src.page && src.page !== primaryPage) {
                    otherPages.push({
                        file: src.source_file || source,
                        page: src.page,
                    });
                }
            }
        }

        return otherPages;
    }

    /**
     * Transform array field (like income, expenditure, pensions, etc.)
     */
    private transformArrayField(
        fieldData: FieldData,
        propSchema: any,
        primarySource: string
    ): any[] {
        if (!fieldData.value || !Array.isArray(fieldData.value)) {
            return [];
        }

        const itemSchema = propSchema.items?.properties || {};

        return fieldData.value.map((item: any, index: number) => {
            const transformedItem: any = {};
            let sequence = 1;

            // Use schema keys to ensure all defined fields are present in the output
            const itemKeys = Object.keys(itemSchema);

            for (const key of itemKeys) {
                const itemValue = item[key] as any;
                const description = itemSchema[key]?.description || key;

                // Handle items with value/page structure
                if (itemValue && typeof itemValue === 'object' && 'value' in itemValue) {
                    const hasVal = itemValue.value !== null && itemValue.value !== 'N/A';
                    transformedItem[key] = {
                        value: itemValue.value,
                        page_number: itemValue.page || null,
                        sequence: sequence++,
                        found: hasVal,
                        confidence: hasVal ? 99 : 0,
                        source: itemValue.source_file || primarySource,
                        status: hasVal ? 'found' : 'not_found',
                        description,
                        citation: itemValue.page ? [`/page/${itemValue.page}/Table/1`] : [],
                        other_cited_pages: [],
                    };
                } else {
                    const hasVal = itemValue !== undefined && itemValue !== null && itemValue !== 'N/A';
                    transformedItem[key] = {
                        value: itemValue ?? 'N/A',
                        page_number: null,
                        sequence: sequence++,
                        found: hasVal,
                        confidence: hasVal ? 99 : 0,
                        source: primarySource,
                        status: hasVal ? 'found' : 'not_found',
                        description,
                        citation: [],
                        other_cited_pages: [],
                    };
                }
            }

            return transformedItem;
        });
    }
}
