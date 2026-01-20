import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { FileSizeExceptionFilter } from './filters/file-size-exception.filter';

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);

    // Enable global validation pipe (Issue #3)
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );

    // Enable global exception filter for file size errors (Issue #6)
    app.useGlobalFilters(new FileSizeExceptionFilter());

    // Environment-aware CORS configuration (Issue #12)
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
        'http://localhost:3000',
    ];
    const isProduction = process.env.NODE_ENV === 'production';

    app.enableCors({
        origin: isProduction ? allowedOrigins : true,
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
        credentials: true,
        maxAge: 86400, // Cache preflight for 24 hours
    });

    // Serve static files from public directory
    app.useStaticAssets(join(__dirname, '..', 'public'));

    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`🚀 Application is running on: http://localhost:${port}`);
}
bootstrap();
