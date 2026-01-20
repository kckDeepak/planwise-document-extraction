import { Injectable } from '@nestjs/common';

/**
 * Minimum confidence threshold for field values
 * Fields below this will be flagged with needs_review: true
 */
export const MIN_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Shared field data structure used across extraction services
 */
export interface FieldData {
    value: any;
    confidence: number | null;
    page: number | null;
    source_text: string | null;
    bbox: any | null;
    is_array?: boolean;
    source_file?: string;
    needs_review?: boolean;
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
 * Shared extraction utilities service
 * Eliminates code duplication between Reducto and DataLab extraction services
 */
@Injectable()
export class ExtractionUtilsService {
    /**
     * Flatten nested extraction data into dot-notation paths
     */
    flattenExtraction(data: any, prefix = ''): Record<string, FieldData> {
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

    /**
     * Process array items to extract value from extraction structures
     */
    processArrayItem(item: any): any {
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

    /**
     * Check if object is a FieldData structure
     */
    isFieldData(obj: any): boolean {
        return obj && typeof obj === 'object' && 'value' in obj && !Array.isArray(obj);
    }

    /**
     * Check if a value is empty
     */
    isEmpty(value: any): boolean {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string' && value.trim() === '') return true;
        if (Array.isArray(value) && value.length === 0) return true;
        return false;
    }

    /**
     * Merge extractions from multiple documents with intelligent priority
     */
    mergeExtractions(results: ExtractionResult[]): Record<string, FieldData> {
        const mergedFields: Record<string, FieldData> = {};
        const fieldCollector: Record<string, Array<{
            value: any;
            confidence: number | null;
            source_file: string;
            page: number | null;
            source_text: string | null;
            bbox: any | null;
            is_array?: boolean;
        }>> = {};

        // Collect all fields from all documents
        for (const doc of results) {
            if (doc.status !== 'success' || !doc.data) continue;

            const flattened = this.flattenExtraction(doc.data);
            for (const [fieldPath, fieldData] of Object.entries(flattened)) {
                // Skip completely null/undefined values
                if (fieldData.value === null || fieldData.value === undefined) continue;

                // Skip empty strings
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

        // Process collected fields - pick best value and keep all sources
        for (const [fieldPath, sources] of Object.entries(fieldCollector)) {
            if (sources.length === 0) continue;

            // Sort sources by quality
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

            const best = sortedSources[0];

            // Build all_sources array if there are multiple sources
            const allSources = sources.length > 1 ? sources.map(s => ({
                value: s.value,
                confidence: s.confidence,
                source_file: s.source_file,
                page: s.page,
            })) : undefined;

            // Flag low-confidence values for review
            const needsReview = best.confidence !== null && best.confidence < MIN_CONFIDENCE_THRESHOLD;

            mergedFields[fieldPath] = {
                value: best.value,
                confidence: best.confidence,
                page: best.page,
                source_text: best.source_text,
                bbox: best.bbox,
                source_file: best.source_file,
                is_array: best.is_array,
                all_sources: allSources,
                needs_review: needsReview || undefined,
            };
        }

        return mergedFields;
    }

    /**
     * Apply confidence threshold to extracted fields
     * Returns fields with needs_review flag set for low-confidence values
     */
    applyConfidenceThreshold(
        fields: Record<string, FieldData>,
        threshold: number = MIN_CONFIDENCE_THRESHOLD,
    ): Record<string, FieldData> {
        const result: Record<string, FieldData> = {};

        for (const [path, field] of Object.entries(fields)) {
            result[path] = {
                ...field,
                needs_review: field.confidence !== null && field.confidence < threshold ? true : undefined,
            };
        }

        return result;
    }

    /**
     * Build nested structure from flat field paths
     */
    buildNestedFromPath(obj: any, parts: string[], value: any): void {
        const key = parts[0];
        if (parts.length === 1) {
            obj[key] = value;
        } else {
            obj[key] = obj[key] || {};
            this.buildNestedFromPath(obj[key], parts.slice(1), value);
        }
    }
}
