import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class SchemaService {
    private readonly schemasFolder: string;

    constructor() {
        this.schemasFolder = path.join(process.cwd(), 'schemas');
    }

    async getSchema(schemaName: string): Promise<any | null> {
        const schemaPath = path.join(this.schemasFolder, `${schemaName}.json`);

        try {
            const schemaContent = await fs.readFile(schemaPath, 'utf-8');
            return JSON.parse(schemaContent);
        } catch (error) {
            console.error(`Failed to load schema ${schemaName}:`, error);
            return null;
        }
    }

    async listSchemas(): Promise<string[]> {
        try {
            const files = await fs.readdir(this.schemasFolder);
            return files
                .filter((file) => file.endsWith('.json'))
                .map((file) => path.basename(file, '.json'));
        } catch (error) {
            console.error('Failed to list schemas:', error);
            return [];
        }
    }

    async getSystemPrompt(schemaName: string): Promise<string> {
        const promptPath = path.join(this.schemasFolder, `${schemaName}.prompt.md`);

        try {
            return await fs.readFile(promptPath, 'utf-8');
        } catch (error) {
            // Return default prompt if schema-specific one doesn't exist
            return this.getDefaultPrompt();
        }
    }

    private getDefaultPrompt(): string {
        return `Extract data accurately from the documents.

EXTRACTION RULES:
- Extract exact values as they appear in the document
- For Yes/No fields, return "Yes" or "No" based on document content
- Include currency symbols for monetary values (e.g., £10,000)
- Extract dates in DD/MM/YYYY format
- Return null for fields not found in the document
- Extract ALL items from tables and arrays - do not truncate`;
    }

    /**
     * Get flattened ceding schema fields for frontend display
     */
    async getCedingFields(): Promise<{ sections: Array<{ name: string; fields: Array<{ name: string; type: string; description: string }> }> }> {
        const cedingSchema = await this.getSchema('ceding');
        if (!cedingSchema || !cedingSchema.properties) {
            return { sections: [] };
        }

        const sections: Array<{ name: string; fields: Array<{ name: string; type: string; description: string }> }> = [];

        for (const [sectionName, sectionValue] of Object.entries(cedingSchema.properties)) {
            const section = sectionValue as any;
            
            if (section.type === 'object' && section.properties) {
                const fields: Array<{ name: string; type: string; description: string }> = [];
                
                for (const [fieldName, fieldValue] of Object.entries(section.properties)) {
                    const field = fieldValue as any;
                    fields.push({
                        name: fieldName,
                        type: field.type || 'string',
                        description: field.description || fieldName,
                    });
                }
                
                sections.push({
                    name: sectionName,
                    fields,
                });
            } else if (section.type === 'array') {
                sections.push({
                    name: sectionName,
                    fields: [{
                        name: sectionName,
                        type: 'array',
                        description: section.description || sectionName,
                    }],
                });
            } else if (section.type === 'string') {
                sections.push({
                    name: sectionName,
                    fields: [{
                        name: sectionName,
                        type: 'string',
                        description: section.description || sectionName,
                    }],
                });
            }
        }

        return { sections };
    }

    /**
     * Save custom ceding schema with additional fields
     */
    async saveCustomCedingSchema(customFields: Array<{ 
        name: string; 
        type: string; 
        description: string; 
        section?: string;
        columns?: Array<{ name: string; type: string; description: string }>;
    }>): Promise<{ success: boolean; schemaName: string }> {
        // Load base ceding schema
        const cedingSchema = await this.getSchema('ceding');
        if (!cedingSchema) {
            throw new Error('Base ceding schema not found');
        }

        // Create a deep copy
        const customSchema = JSON.parse(JSON.stringify(cedingSchema));
        
        // Update description
        customSchema.description = 'Custom Ceding pension data extraction schema with additional user-defined fields. ' + 
            (customSchema.description || '');

        // Add custom_fields section if it doesn't exist
        if (!customSchema.properties.custom_fields) {
            customSchema.properties.custom_fields = {
                type: 'object',
                description: 'User-defined custom extraction fields',
                properties: {},
            };
        }

        // Add each custom field
        for (const field of customFields) {
            const fieldDef: any = {
                description: field.description,
            };

            if (field.type === 'table' || field.type === 'array') {
                fieldDef.type = 'array';
                
                // Build column properties from user-defined columns
                const columnProperties: Record<string, { type: string; description: string }> = {};
                
                if (field.columns && field.columns.length > 0) {
                    // User-defined columns
                    for (const col of field.columns) {
                        columnProperties[col.name] = {
                            type: col.type || 'string',
                            description: col.description || col.name,
                        };
                    }
                } else {
                    // Default fallback column
                    columnProperties['value'] = {
                        type: 'string',
                        description: 'Table row value',
                    };
                }
                
                fieldDef.items = {
                    type: 'object',
                    properties: columnProperties,
                };
            } else {
                fieldDef.type = field.type || 'string';
            }

            // Add to custom_fields section or to a specified section
            if (field.section && customSchema.properties[field.section]) {
                if (customSchema.properties[field.section].properties) {
                    customSchema.properties[field.section].properties[field.name] = fieldDef;
                }
            } else {
                customSchema.properties.custom_fields.properties[field.name] = fieldDef;
            }
        }

        // Save the custom schema
        const customSchemaPath = path.join(this.schemasFolder, 'custom_ceding.json');
        await fs.writeFile(customSchemaPath, JSON.stringify(customSchema, null, 4), 'utf-8');

        return { success: true, schemaName: 'custom_ceding' };
    }

    /**
     * Check if custom ceding schema exists
     */
    async hasCustomCedingSchema(): Promise<boolean> {
        try {
            const customSchemaPath = path.join(this.schemasFolder, 'custom_ceding.json');
            await fs.access(customSchemaPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get custom fields from custom_ceding schema (if exists)
     * Compares with base ceding schema to find added fields
     */
    /**
     * Get a map of field paths to their types from the schema
     * Used for adding field type information to extraction output
     */
    async getFieldTypeMap(schemaName: string): Promise<Record<string, string>> {
        const schema = await this.getSchema(schemaName);
        if (!schema || !schema.properties) {
            return {};
        }

        const typeMap: Record<string, string> = {};

        const processProperties = (properties: Record<string, any>, parentPath: string = '') => {
            for (const [fieldName, fieldValue] of Object.entries(properties)) {
                const field = fieldValue as any;
                const fieldPath = parentPath ? `${parentPath}.${fieldName}` : fieldName;
                
                if (field.type === 'object' && field.properties) {
                    // Recurse into nested objects
                    processProperties(field.properties, fieldPath);
                } else if (field.type === 'array') {
                    // Mark arrays as 'table' type for display
                    typeMap[fieldPath] = 'table';
                } else if (field.type === 'boolean') {
                    typeMap[fieldPath] = 'boolean';
                } else {
                    // Default to 'text' for strings and other types
                    typeMap[fieldPath] = field.type || 'text';
                }
            }
        };

        processProperties(schema.properties);
        return typeMap;
    }

    async getCustomCedingFields(): Promise<Array<{ 
        name: string; 
        type: string; 
        description: string; 
        section: string;
        columns?: Array<{ name: string; type: string; description: string }>;
    }>> {
        const customSchema = await this.getSchema('custom_ceding');
        const baseSchema = await this.getSchema('ceding');
        
        if (!customSchema || !customSchema.properties) {
            return [];
        }

        const fields: Array<{ 
            name: string; 
            type: string; 
            description: string; 
            section: string;
            columns?: Array<{ name: string; type: string; description: string }>;
        }> = [];
        
        // Get base schema field names for comparison
        const baseFields: Record<string, Set<string>> = {};
        if (baseSchema?.properties) {
            for (const [sectionName, sectionValue] of Object.entries(baseSchema.properties)) {
                const section = sectionValue as any;
                baseFields[sectionName] = new Set();
                if (section.properties) {
                    for (const fieldName of Object.keys(section.properties)) {
                        baseFields[sectionName].add(fieldName);
                    }
                }
            }
        }

        // Scan all sections in custom schema for added fields
        for (const [sectionName, sectionValue] of Object.entries(customSchema.properties)) {
            const section = sectionValue as any;
            
            if (section.type === 'object' && section.properties) {
                for (const [fieldName, fieldValue] of Object.entries(section.properties)) {
                    // Check if this field exists in base schema
                    const isCustomField = !baseFields[sectionName]?.has(fieldName);
                    
                    if (isCustomField) {
                        const field = fieldValue as any;
                        const fieldEntry: {
                            name: string;
                            type: string;
                            description: string;
                            section: string;
                            columns?: Array<{ name: string; type: string; description: string }>;
                        } = {
                            name: fieldName,
                            type: field.type === 'array' ? 'table' : (field.type || 'string'),
                            description: field.description || fieldName,
                            section: sectionName,
                        };
                        
                        // Extract column definitions for table/array types
                        if (field.type === 'array' && field.items?.properties) {
                            fieldEntry.columns = Object.entries(field.items.properties).map(
                                ([colName, colDef]: [string, any]) => ({
                                    name: colName,
                                    type: colDef.type || 'string',
                                    description: colDef.description || colName,
                                })
                            );
                        }
                        
                        fields.push(fieldEntry);
                    }
                }
            }
        }

        return fields;
    }
}


