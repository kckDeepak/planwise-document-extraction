import {
    Controller,
    Post,
    Query,
    UseInterceptors,
    UploadedFiles,
    Body,
    Res,
    BadRequestException,
    Header,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { ExtractService } from './extract.service';
import { DataLabExtractService } from './datalab-extract.service';
import { FileProcessorService } from './file-processor.service';
import { ALLOWED_SCHEMAS, ALLOWED_MODELS } from './dto/extract.dto';

@Controller('api')
export class ExtractController {
    private eventId = 0;

    constructor(
        private readonly extractService: ExtractService,
        private readonly dataLabExtractService: DataLabExtractService,
        private readonly fileProcessorService: FileProcessorService,
    ) { }

    @Post('extract')
    @Header('Content-Type', 'text/event-stream')
    @Header('Cache-Control', 'no-cache')
    @Header('Connection', 'keep-alive')
    @UseInterceptors(
        FilesInterceptor('files', undefined, {  // No limit on file count
            storage: memoryStorage(),
            fileFilter: (req, file, cb) => {
                // Supported MIME types for both APIs + MSG for preprocessing
                const allowedMimeTypes = [
                    'application/pdf',                                          // PDF
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
                    'application/msword',                                       // DOC
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
                    'application/vnd.ms-excel.sheet.macroEnabled.12',          // XLSM
                    'application/vnd.ms-excel',                                 // XLS
                    'text/csv',                                                 // CSV
                    'application/csv',                                          // CSV (alternate)
                    'text/html',                                                // HTML
                    'application/xhtml+xml',                                    // XHTML
                    'image/jpeg',                                               // JPEG
                    'image/jpg',                                                // JPG
                    'image/png',                                                // PNG
                    'image/gif',                                                // GIF
                    'image/tiff',                                               // TIFF
                    'application/vnd.ms-outlook',                               // MSG (Outlook)
                ];

                if (allowedMimeTypes.includes(file.mimetype)) {
                    cb(null, true);
                } else {
                    cb(
                        new BadRequestException(`Unsupported file type: ${file.mimetype}. Allowed: PDF, DOCX, XLSX, XLSM, CSV, HTML, JPEG, PNG, MSG`),
                        false,
                    );
                }
            },
        }),
    )
    async extract(
        @UploadedFiles() files: Express.Multer.File[],
        @Body('schema') schemaName: string,
        @Query('model') model: string = 'datalab',
        @Res() res: Response,
    ) {
        // Validate files before starting SSE stream
        if (!files || files.length === 0) {
            throw new BadRequestException('No files provided');
        }

        // Validate schema before starting SSE stream
        const schema = schemaName?.toLowerCase() || 'cfr';
        if (!ALLOWED_SCHEMAS.includes(schema as any)) {
            throw new BadRequestException(`Invalid schema. Allowed: ${ALLOWED_SCHEMAS.join(', ')}`);
        }

        // Validate model before starting SSE stream
        const selectedModel = (model || 'datalab').toLowerCase();
        if (!ALLOWED_MODELS.includes(selectedModel as any)) {
            throw new BadRequestException(`Invalid model. Allowed: ${ALLOWED_MODELS.join(', ')}`);
        }

        try {
            // Preprocess files (convert MSG to HTML, etc.)
            const processedFiles = await this.fileProcessorService.processFiles(files);

            // Route to appropriate extractor based on model
            if (selectedModel === 'reducto') {
                await this.extractService.processFiles(processedFiles, schema, (type, data) => {
                    this.sendEvent(res, type, data);
                });
            } else {
                // Default to DataLab
                await this.dataLabExtractService.processFiles(processedFiles, schema, (type, data) => {
                    this.sendEvent(res, type, data);
                });
            }
        } catch (error) {
            this.sendEvent(res, 'error', {
                message:
                    error instanceof Error ? error.message : 'Unknown error occurred',
            });
        } finally {
            res.end();
        }
    }

    // Updated to use proper SSE format with event field
    private sendEvent(res: Response, type: string, data: Record<string, any>) {
        const idLine = `id: ${++this.eventId}\n`;
        const eventLine = `event: ${type}\n`;
        const dataLine = `data: ${JSON.stringify({ type, ...data })}\n\n`;
        res.write(idLine + eventLine + dataLine);
    }
}
