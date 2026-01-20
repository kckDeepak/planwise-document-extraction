import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const ALLOWED_SCHEMAS = ['cfr', 'ceding', 'ess', 'cyc', 'illustration', 'custom_ceding'] as const;
export type SchemaType = (typeof ALLOWED_SCHEMAS)[number];

export const ALLOWED_MODELS = ['reducto', 'datalab'] as const;
export type ModelType = (typeof ALLOWED_MODELS)[number];

export class ExtractRequestDto {
    @IsString()
    @IsOptional()
    @IsIn(ALLOWED_SCHEMAS, { message: 'Schema must be one of: cfr, ceding, ess, cyc, illustration, custom_ceding' })
    schema?: SchemaType = 'cfr';

    @IsString()
    @IsOptional()
    @IsIn(ALLOWED_MODELS, { message: 'Model must be one of: reducto, datalab' })
    model?: ModelType = 'datalab';
}
