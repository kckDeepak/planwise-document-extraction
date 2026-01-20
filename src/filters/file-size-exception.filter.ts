import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    PayloadTooLargeException,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(PayloadTooLargeException)
export class FileSizeExceptionFilter implements ExceptionFilter {
    catch(exception: PayloadTooLargeException, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();

        response.status(413).json({
            statusCode: 413,
            message: 'File too large. Maximum file size is 25MB.',
        });
    }
}
