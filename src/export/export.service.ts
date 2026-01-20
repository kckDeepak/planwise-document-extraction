import { Injectable, BadRequestException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class ExportService {
    private readonly outputFolder: string;

    constructor() {
        this.outputFolder = path.join(process.cwd(), 'output');
    }

    /**
     * Convert contribution history array to CSV format
     */
    contributionHistoryToCSV(contributionHistory: any[]): string {
        if (!contributionHistory || contributionHistory.length === 0) {
            return 'Date,Amount,Type,Source,Tax Relief\n';
        }

        const headers = ['Date', 'Amount', 'Type', 'Source', 'Tax Relief'];
        const rows = contributionHistory.map(contribution => {
            const date = this.extractValue(contribution.date) || '';
            const amount = this.extractValue(contribution.amount) || '';
            const type = this.extractValue(contribution.type) || '';
            const source = this.extractValue(contribution.source) || '';
            const taxRelief = this.extractValue(contribution.taxRelief) || '';

            return [date, amount, type, source, taxRelief]
                .map(val => `"${String(val).replace(/"/g, '""')}"`)
                .join(',');
        });

        return [headers.join(','), ...rows].join('\n');
    }

    /**
     * Convert invested funds array to CSV format
     */
    investedFundsToCSV(investedFunds: any[]): string {
        if (!investedFunds || investedFunds.length === 0) {
            return 'Fund Name,Current Value,Units,Unit Price,AMC,Further Costs,Total Charge\n';
        }

        const headers = ['Fund Name', 'Current Value', 'Units', 'Unit Price', 'AMC', 'Further Costs', 'Total Charge'];
        const rows = investedFunds.map(fund => {
            const fundName = this.extractValue(fund.fundName) || '';
            const currentValue = this.extractValue(fund.currentValue) || '';
            const units = this.extractValue(fund.units) || '';
            const unitPrice = this.extractValue(fund.unitPrice) || '';
            const amc = this.extractValue(fund.amc) || '';
            const furtherCosts = this.extractValue(fund.furtherCosts) || '';
            const totalCharge = this.extractValue(fund.totalCharge) || '';

            return [fundName, currentValue, units, unitPrice, amc, furtherCosts, totalCharge]
                .map(val => `"${String(val).replace(/"/g, '""')}"`)
                .join(',');
        });

        return [headers.join(','), ...rows].join('\n');
    }

    /**
     * Get latest extraction output file for a schema
     */
    async getLatestOutput(schemaName: string): Promise<any> {
        const latestPath = path.join(this.outputFolder, `${schemaName}_latest.json`);

        try {
            const content = await fs.readFile(latestPath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            throw new BadRequestException(`No extraction found for schema: ${schemaName}`);
        }
    }

    /**
     * Extract value from citation object or return raw value
     */
    private extractValue(val: any): any {
        if (val && typeof val === 'object' && 'value' in val) {
            return val.value;
        }
        return val;
    }
}
