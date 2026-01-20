import { Controller, Get, Query, Res, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { ExportService } from './export.service';

@Controller('api/export')
export class ExportController {
    constructor(private readonly exportService: ExportService) { }

    /**
     * Export contribution history as CSV
     * GET /api/export/contributions?schema=ess
     */
    @Get('contributions')
    async exportContributions(
        @Query('schema') schemaName: string,
        @Res() res: Response,
    ): Promise<void> {
        if (!schemaName) {
            throw new BadRequestException('Schema name is required');
        }

        const output = await this.exportService.getLatestOutput(schemaName);
        const extractedData = output.extracted_data || {};

        // Look for contribution_history in the extracted data
        const contributionHistory = extractedData.contribution_history?.contribution_history?.value || [];

        const csv = this.exportService.contributionHistoryToCSV(contributionHistory);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${schemaName}_contribution_history.csv"`
        );
        res.send(csv);
    }

    /**
     * Export invested funds as CSV
     * GET /api/export/funds?schema=ess
     */
    @Get('funds')
    async exportFunds(
        @Query('schema') schemaName: string,
        @Res() res: Response,
    ): Promise<void> {
        if (!schemaName) {
            throw new BadRequestException('Schema name is required');
        }

        const output = await this.exportService.getLatestOutput(schemaName);
        const extractedData = output.extracted_data || {};

        // Look for fund_holdings in the extracted data (primary source for invested funds)
        const fundHoldings = extractedData.fund_holdings?.fund_holdings?.value || [];

        const csv = this.exportService.investedFundsToCSV(fundHoldings);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${schemaName}_fund_holdings.csv"`
        );
        res.send(csv);
    }
}
