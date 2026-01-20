import { Controller, Get, Post, Body, BadRequestException } from '@nestjs/common';
import { SchemaService } from './schema.service';

interface CustomField {
    name: string;
    type: string;
    description: string;
    section?: string;
}

@Controller('api/schemas')
export class SchemaController {
    constructor(private readonly schemaService: SchemaService) { }

    @Get()
    async listSchemas(): Promise<{ schemas: string[] }> {
        const schemas = await this.schemaService.listSchemas();
        return { schemas };
    }

    /**
     * Get all ceding schema fields organized by section
     * GET /api/schemas/ceding/fields
     */
    @Get('ceding/fields')
    async getCedingFields() {
        return await this.schemaService.getCedingFields();
    }

    /**
     * Get existing custom fields (if custom_ceding schema exists)
     * GET /api/schemas/custom-ceding/fields
     */
    @Get('custom-ceding/fields')
    async getCustomCedingFields() {
        const fields = await this.schemaService.getCustomCedingFields();
        const exists = await this.schemaService.hasCustomCedingSchema();
        return { exists, fields };
    }

    /**
     * Save custom ceding schema with additional fields
     * POST /api/schemas/custom-ceding
     * Body: { customFields: [{ name, type, description, section? }] }
     */
    @Post('custom-ceding')
    async saveCustomCedingSchema(@Body() body: { customFields: CustomField[] }) {
        if (!body.customFields || !Array.isArray(body.customFields)) {
            throw new BadRequestException('customFields array is required');
        }

        // Validate each field
        for (const field of body.customFields) {
            if (!field.name || !field.name.trim()) {
                throw new BadRequestException('Each custom field must have a name');
            }
            if (!field.type) {
                field.type = 'string';
            }
            if (!field.description) {
                field.description = field.name;
            }
            // Sanitize field name (remove spaces, special chars)
            field.name = field.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
        }

        try {
            const result = await this.schemaService.saveCustomCedingSchema(body.customFields);
            return {
                success: true,
                message: 'Custom ceding schema saved successfully',
                schemaName: result.schemaName,
                fieldsAdded: body.customFields.length,
            };
        } catch (error) {
            throw new BadRequestException(
                error instanceof Error ? error.message : 'Failed to save custom schema'
            );
        }
    }
}

