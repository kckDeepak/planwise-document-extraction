import { Module } from '@nestjs/common';
import { PdfController } from './pdf.controller';
import { CedingPdfGeneratorService } from './ceding-pdf-generator.service';
import { CedingPdfMapperService } from './ceding-pdf-mapper.service';

@Module({
    controllers: [PdfController],
    providers: [CedingPdfGeneratorService, CedingPdfMapperService],
    exports: [CedingPdfGeneratorService, CedingPdfMapperService],
})
export class PdfModule { }
