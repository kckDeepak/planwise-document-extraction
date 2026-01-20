import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ExtractModule } from './extract/extract.module';
import { SchemaModule } from './schema/schema.module';
import { ExportModule } from './export/export.module';
import { PdfModule } from './pdf/pdf.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        ExtractModule,
        SchemaModule,
        ExportModule,
        PdfModule,
    ],
})
export class AppModule { }

