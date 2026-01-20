import { Injectable } from '@nestjs/common';

/**
 * Service to preprocess files before sending to Reducto API
 * Handles MSG file conversion and other file type preprocessing
 */
@Injectable()
export class FileProcessorService {
    // Supported MIME types that Reducto can process directly
    private readonly reductoSupportedTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
        'application/msword', // DOC
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
        'application/vnd.ms-excel.sheet.macroEnabled.12', // XLSM
        'application/vnd.ms-excel', // XLS
        'text/csv',
        'application/csv',
        'text/html',
        'application/xhtml+xml',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/tiff',
    ];

    // MSG needs preprocessing
    private readonly msgMimeType = 'application/vnd.ms-outlook';

    /**
     * Check if file needs preprocessing before Reducto API
     */
    needsPreprocessing(file: Express.Multer.File): boolean {
        return file.mimetype === this.msgMimeType;
    }

    /**
     * Check if file is directly supported by Reducto
     */
    isDirectlySupported(file: Express.Multer.File): boolean {
        return this.reductoSupportedTypes.includes(file.mimetype);
    }

    /**
     * Convert MSG file to HTML for processing
     * Note: Full MSG parsing requires additional libraries like 'msg-reader'
     * This is a basic implementation - for production, use a proper MSG parser
     */
    async convertMsgToHtml(file: Express.Multer.File): Promise<Express.Multer.File> {
        try {
            // Basic MSG to HTML conversion
            // For production, install and use: npm install @pnp/msgraph or msg-reader
            const htmlContent = this.basicMsgToHtml(file.buffer);

            // Return as HTML file
            return {
                ...file,
                originalname: file.originalname.replace(/\.msg$/i, '.html'),
                mimetype: 'text/html',
                buffer: Buffer.from(htmlContent, 'utf-8'),
                size: htmlContent.length,
            };
        } catch (error) {
            console.error('MSG conversion failed:', error);
            // Return original file if conversion fails
            return file;
        }
    }

    /**
     * Basic MSG to HTML conversion
     * This is a simplified implementation - MSG files have complex structure
     */
    private basicMsgToHtml(buffer: Buffer): string {
        // MSG files are complex OLE compound documents
        // This basic implementation extracts readable text
        const content = buffer.toString('utf-8', 0, Math.min(buffer.length, 50000));

        // Extract any readable text
        const readableText = content.replace(/[^\x20-\x7E\n\r\t]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Email Content</title>
</head>
<body>
    <h1>Email Content (Extracted from MSG)</h1>
    <p><strong>Note:</strong> This is a basic extraction. For full MSG support, consider using a dedicated MSG parser library.</p>
    <hr>
    <pre style="white-space: pre-wrap; word-wrap: break-word;">${readableText}</pre>
</body>
</html>`;
    }

    /**
     * Process all files - convert MSG files, pass through others
     */
    async processFiles(files: Express.Multer.File[]): Promise<Express.Multer.File[]> {
        const processedFiles: Express.Multer.File[] = [];

        for (const file of files) {
            if (this.needsPreprocessing(file)) {
                const converted = await this.convertMsgToHtml(file);
                processedFiles.push(converted);
            } else {
                processedFiles.push(file);
            }
        }

        return processedFiles;
    }

    /**
     * Get file type category for logging/display
     */
    getFileCategory(mimetype: string): string {
        if (mimetype.includes('pdf')) return 'PDF';
        if (mimetype.includes('word') || mimetype.includes('msword')) return 'Word Document';
        if (mimetype.includes('excel') || mimetype.includes('spreadsheet')) return 'Excel Spreadsheet';
        if (mimetype.includes('csv')) return 'CSV';
        if (mimetype.includes('html')) return 'HTML';
        if (mimetype.includes('image')) return 'Image';
        if (mimetype.includes('outlook')) return 'Outlook Email';
        return 'Unknown';
    }
}
