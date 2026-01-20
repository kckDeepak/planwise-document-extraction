import { Controller, Post, Body, Res, Get, Param, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { CedingPdfGeneratorService } from './ceding-pdf-generator.service';
import { CedingPdfMapperService } from './ceding-pdf-mapper.service';

@Controller('api/pdf')
export class PdfController {
    constructor(
        private readonly pdfGeneratorService: CedingPdfGeneratorService,
        private readonly pdfMapperService: CedingPdfMapperService,
    ) { }

    /**
     * Generate PDF from extraction JSON body
     * POST /api/pdf/generate
     * Body: full extraction JSON output
     */
    @Post('generate')
    async generatePdf(@Body() extractionData: any, @Res() res: Response) {
        try {
            console.log('📥 POST /api/pdf/generate - Received extraction data');

            // Map extraction output to PDF input format
            const pdfInputData = this.pdfMapperService.mapExtractionToPdfInput(extractionData);
            console.log('🔄 Mapped extraction data to PDF format');

            // Generate PDF
            const pdfBuffer = await this.pdfGeneratorService.generatePdf(pdfInputData);

            // Get client name for filename
            const clientName = pdfInputData.contactInfo.nameOfClient || 'unknown';
            const safeClientName = clientName.replace(/[^a-zA-Z0-9]/g, '_');
            const filename = `ceding-note-${safeClientName}-${Date.now()}.pdf`;

            // Set response headers for PDF download
            res.set({
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': pdfBuffer.length,
            });

            res.status(HttpStatus.OK).send(pdfBuffer);
        } catch (error) {
            console.error('❌ Error generating PDF:', error);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            });
        }
    }

    /**
     * Generate PDF from a file in the output folder
     * GET /api/pdf/generate-from-file/:filename
     */
    @Get('generate-from-file/:filename')
    async generatePdfFromFile(@Param('filename') filename: string, @Res() res: Response) {
        try {
            console.log(`📥 GET /api/pdf/generate-from-file/${filename}`);

            // Read the extraction output file
            const outputDir = path.join(process.cwd(), 'output');
            const filePath = path.join(outputDir, filename);

            if (!fs.existsSync(filePath)) {
                return res.status(HttpStatus.NOT_FOUND).json({
                    success: false,
                    error: `File not found: ${filename}`,
                });
            }

            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const extractionData = JSON.parse(fileContent);

            // Map extraction output to PDF input format
            const pdfInputData = this.pdfMapperService.mapExtractionToPdfInput(extractionData);
            console.log('🔄 Mapped extraction data to PDF format');

            // Generate PDF
            const pdfBuffer = await this.pdfGeneratorService.generatePdf(pdfInputData);

            // Use the filename (without .json) for the PDF
            const pdfFilename = filename.replace('.json', '.pdf');

            res.set({
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${pdfFilename}"`,
                'Content-Length': pdfBuffer.length,
            });

            res.status(HttpStatus.OK).send(pdfBuffer);
        } catch (error) {
            console.error('❌ Error generating PDF from file:', error);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            });
        }
    }

    /**
     * Preview mapping result (for debugging)
     * POST /api/pdf/preview-mapping
     */
    @Post('preview-mapping')
    async previewMapping(@Body() extractionData: any, @Res() res: Response) {
        try {
            const pdfInputData = this.pdfMapperService.mapExtractionToPdfInput(extractionData);
            res.status(HttpStatus.OK).json({
                success: true,
                mappedData: pdfInputData,
            });
        } catch (error) {
            console.error('❌ Error mapping data:', error);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            });
        }
    }

    /**
     * List available extraction files
     * GET /api/pdf/list-files
     */
    @Get('list-files')
    async listFiles(@Res() res: Response) {
        try {
            const outputDir = path.join(process.cwd(), 'output');

            if (!fs.existsSync(outputDir)) {
                return res.status(HttpStatus.OK).json({ files: [] });
            }

            const files = fs.readdirSync(outputDir)
                .filter(f => f.endsWith('.json') && f.includes('ceding'))
                .map(f => ({
                    name: f,
                    path: path.join(outputDir, f),
                    size: fs.statSync(path.join(outputDir, f)).size,
                }));

            res.status(HttpStatus.OK).json({ files });
        } catch (error) {
            console.error('❌ Error listing files:', error);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            });
        }
    }
}
