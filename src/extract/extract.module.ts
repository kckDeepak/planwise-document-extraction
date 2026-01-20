import { Module } from '@nestjs/common';
import { ExtractController } from './extract.controller';
import { ExtractService } from './extract.service';
import { DataLabExtractService } from './datalab-extract.service';
import { FileProcessorService } from './file-processor.service';
import { ExtractionUtilsService } from './extraction-utils.service';
import { SchemaModule } from '../schema/schema.module';

@Module({
    imports: [SchemaModule],
    controllers: [ExtractController],
    providers: [ExtractService, DataLabExtractService, FileProcessorService, ExtractionUtilsService],
    exports: [FileProcessorService, ExtractionUtilsService],
})
export class ExtractModule { }

