import { Injectable } from '@nestjs/common';

/**
 * Type definitions matching the PDF template's expected input
 * (AdditionalCedingSchemeFileNote from test-ceding-note-pdf)
 */
export interface CedingNotePdfInput {
    contactInfo: {
        nameOfContact: string;
        phoneNo: string;
        nameOfCaller: string;
        dateOfCall: string;
        nameOfClient: string;
        timeOfCall: string;
    };
    planDetails: {
        planNumber: string;
        startDate: string;
        selectedRetirementAge: string;
        fundsAvailableAndLimit: string;
        flexibleAccessDrawdown: string;
        earmarkingOrAttachment: string;
        additionalLifeCover: string;
        waiverOfContributions: string;
    };
    policyDetails: {
        allocationRate: string;
        bidOfferSpread: string;
        adviserCharge: string;
        initialChargesSingleContributions: string;
        initialCharges: string;
        changeToIndexation: string;
        planWrapperCharge: string;
        policyFee: string;
        earlyWithdrawalExitCharge: string;
        fundDiscountsRebates: string;
        loyaltyBonus: string;
        reinvestmentOfCharges: string;
    };
    additionalQuestions: {
        chargingStructureIfContributionsCease: string;
        partialTransferPossible: string;
        lifestylingStrategy: string;
        protectedTaxFreeCash: string;
        guaranteedBenefits: string;
    };
    pensionInputPeriods: {
        pip1: string;
        pip2: string;
        pip3: string;
    };
    transferFunds: {
        funds: Array<{
            fundName: string;
            currentFundValue: string;
            amcTer: string;
        }>;
    };
    regularContributions: {
        totalRegularContribution: string;
        dateLastContribution: string;
        allocation: Array<{
            fundName: string;
            amountInvested: string;
            amcTer: string;
        }>;
    };
    notes: string;
}

@Injectable()
export class CedingPdfMapperService {
    /**
     * Helper to safely extract a value from nested object paths
     * Handles the nest-reducto extraction output structure: { value, confidence, source_file, ... }
     */
    private getValue(obj: any, path: string, defaultValue: string = ''): string {
        const keys = path.split('.');
        let value = obj;

        for (const key of keys) {
            if (value === null || value === undefined) return defaultValue;
            value = value[key];
        }

        // Handle the extraction output format: { value: "actual value", confidence: 0.95, ... }
        if (value && typeof value === 'object') {
            if ('value' in value) {
                // Handle nested value structures
                if (typeof value.value === 'object' && value.value !== null && 'value' in value.value) {
                    return String(value.value.value ?? defaultValue);
                }
                return value.value !== null && value.value !== undefined ? String(value.value) : defaultValue;
            }
        }

        return value !== null && value !== undefined ? String(value) : defaultValue;
    }

    /**
     * Maps extraction output JSON (from nest-reducto) to CedingNotePdfInput format
     * @param extractionData - The extraction output (full merged JSON structure)
     */
    mapExtractionToPdfInput(extractionData: any): CedingNotePdfInput {
        // Handle the structure from nest-reducto output
        const data = extractionData.extracted_data || extractionData;

        // Map contact information
        const contactInfo = {
            nameOfContact: this.getValue(data, 'contact_details.contact_name'),
            phoneNo: this.getValue(data, 'contact_details.phone_number') ||
                this.getValue(data, 'general_info.contactNumberAndEmail'),
            nameOfCaller: this.getValue(data, 'contact_details.caller_name'),
            dateOfCall: this.getValue(data, 'contact_details.date_of_call'),
            nameOfClient: this.getValue(data, 'contact_details.client_name'),
            timeOfCall: this.getValue(data, 'contact_details.time_of_call'),
        };

        // Map plan details
        const planDetails = {
            planNumber: this.getValue(data, 'general_info.planNumber'),
            startDate: this.getValue(data, 'general_info.startDate'),
            selectedRetirementAge: this.getValue(data, 'general_info.retirementDateAge') ||
                this.getValue(data, 'scheme_membership.normalRetirementAge'),
            fundsAvailableAndLimit: this.buildFundsAvailableString(data),
            flexibleAccessDrawdown: this.getValue(data, 'flexibility_and_withdrawals.flexiAccessDrawdown'),
            earmarkingOrAttachment: this.getValue(data, 'general_info.earmarking_attachment_orders') ||
                this.getValue(data, 'transfers_and_guarantees.bulkBlockTransfer') || 'Not Stated',
            additionalLifeCover: this.getValue(data, 'transfers_and_guarantees.lifeCover') ||
                this.getValue(data, 'benefits.lifeCover'),
            waiverOfContributions: this.getValue(data, 'contributions.waiverOfContribution') ||
                this.getValue(data, 'benefits.waiverOfContribution'),
        };

        // Map policy details (charges)
        const policyDetails = {
            allocationRate: this.getValue(data, 'charges.allocationRate'),
            bidOfferSpread: this.getValue(data, 'charges.bidOfferSpread'),
            adviserCharge: this.getValue(data, 'charges.adviserCharge'),
            initialChargesSingleContributions: this.getValue(data, 'charges.initial_charges_single'),
            initialCharges: this.getValue(data, 'charges.initialChargesPaidLast3Years'),
            changeToIndexation: this.getValue(data, 'contributions.indexationOnRegulars') ||
                this.getValue(data, 'contributions.annualRateOfIndexationIncrease'),
            planWrapperCharge: this.getValue(data, 'charges.platformCharge'),
            policyFee: this.getValue(data, 'charges.policyFee') ||
                this.getValue(data, 'charges.planChargePolicyFee'),
            earlyWithdrawalExitCharge: this.getValue(data, 'charges.exitCharge') ||
                this.getValue(data, 'flexibility_and_withdrawals.transferPenalty'),
            fundDiscountsRebates: this.getValue(data, 'charges.chargeDiscountsRebates'),
            loyaltyBonus: this.getValue(data, 'charges.loyaltyBonus'),
            reinvestmentOfCharges: this.getValue(data, 'charges.reinvestment_of_charges'),
        };

        // Map additional questions
        const additionalQuestions = {
            chargingStructureIfContributionsCease: this.getValue(data, 'projections.chargingStructureAlterIfContributionsCease'),
            partialTransferPossible: this.getValue(data, 'flexibility_and_withdrawals.partialTransferPossible') ||
                this.getValue(data, 'projections.partialTransferPossible'),
            lifestylingStrategy: this.getValue(data, 'projections.isLifestylingApplied') ||
                this.getValue(data, 'investment_options.lifestylingAvailable'),
            protectedTaxFreeCash: this.getValue(data, 'guarantees_and_protections.protectedTaxFreeCash'),
            guaranteedBenefits: this.buildGuaranteeString(data),
        };

        // Map pension input periods (contribution history)
        const pensionInputPeriods = this.buildPensionInputPeriods(data);

        // Map transfer funds (fund holdings)
        const transferFunds = this.mapFundHoldings(data);

        // Map regular contributions
        const regularContributions = this.mapRegularContributions(data);

        // Get notes
        const notes = this.getValue(data, 'notes');

        return {
            contactInfo,
            planDetails,
            policyDetails,
            additionalQuestions,
            pensionInputPeriods,
            transferFunds,
            regularContributions,
            notes,
        };
    }

    /**
     * Build "Funds Available" string from fund_info section
     */
    private buildFundsAvailableString(data: any): string {
        const numFunds = this.getValue(data, 'fund_info.numberOfFundsAvailable');
        const maxFunds = this.getValue(data, 'fund_info.maxFundsAtOneTime');

        if (numFunds || maxFunds) {
            const parts = [];
            if (numFunds) parts.push(`${numFunds} funds available`);
            if (maxFunds) parts.push(`max ${maxFunds} can be held at one time`);
            return parts.join(', ');
        }
        return '';
    }

    /**
     * Build guarantee benefits string
     */
    private buildGuaranteeString(data: any): string {
        const gar = this.getValue(data, 'guarantees_and_protections.guaranteedAnnuityRate');
        const gmp = this.getValue(data, 'guarantees_and_protections.guaranteedMinimumPension');
        const garGmp = this.getValue(data, 'transfers_and_guarantees.garGmpGuarantees');
        const other = this.getValue(data, 'guarantees_and_protections.otherGuarantees');

        const parts = [gar, gmp, garGmp, other].filter(v => v && v !== 'Not Stated' && v !== 'No');
        return parts.length > 0 ? parts.join('; ') : 'Not Stated';
    }

    /**
     * Build pension input periods from contribution history
     */
    private buildPensionInputPeriods(data: any): { pip1: string; pip2: string; pip3: string } {
        // First try the specific pension_input_periods object from schema
        const pips = data.contributions?.pension_input_periods?.value || data.contributions?.pension_input_periods;

        if (pips && (pips.pip1 || pips.pip2 || pips.pip3)) {
            return {
                pip1: this.getValue(pips, 'pip1'),
                pip2: this.getValue(pips, 'pip2'),
                pip3: this.getValue(pips, 'pip3'),
            };
        }

        // Check for contribution_history array in general section or at root
        let history = data.general?.contribution_history?.value || data.contribution_history || [];

        if (!Array.isArray(history)) {
            history = [];
        }

        // Extract last 3 contribution periods
        const recentContributions = history.slice(-3);

        return {
            pip1: recentContributions[0]?.amount?.value || recentContributions[0]?.amount || '',
            pip2: recentContributions[1]?.amount?.value || recentContributions[1]?.amount || '',
            pip3: recentContributions[2]?.amount?.value || recentContributions[2]?.amount || '',
        };
    }

    /**
     * Map fund holdings to transfer funds format
     */
    private mapFundHoldings(data: any): { funds: Array<{ fundName: string; currentFundValue: string; amcTer: string }> } {
        const funds: Array<{ fundName: string; currentFundValue: string; amcTer: string }> = [];

        // Try fund_holdings array - this may be nested
        let fundHoldings = data.fund_holdings?.value || data.fund_holdings || [];
        if (!Array.isArray(fundHoldings)) {
            fundHoldings = [];
        }

        for (const fund of fundHoldings) {
            const fundName = this.getValue(fund, 'fundName');
            const fundValue = this.getValue(fund, 'fundValue') || this.getValue(fund, 'value');

            if (fundName) {
                funds.push({
                    fundName,
                    currentFundValue: fundValue,
                    amcTer: '',
                });
            }
        }

        // Try to get AMC/TER from fund_charges if available
        let fundCharges = data.fund_charges?.value || data.fund_charges || [];
        if (!Array.isArray(fundCharges)) {
            fundCharges = [];
        }

        for (const fundEntry of funds) {
            const chargeInfo = fundCharges.find(
                (fc: any) => {
                    const fcName = this.getValue(fc, 'fundName');
                    return fcName && (fcName.includes(fundEntry.fundName) || fundEntry.fundName.includes(fcName));
                }
            );
            if (chargeInfo) {
                fundEntry.amcTer = this.getValue(chargeInfo, 'amc') || this.getValue(chargeInfo, 'totalCharge');
            }
        }

        return { funds };
    }

    /**
     * Map regular contributions
     */
    private mapRegularContributions(data: any): {
        totalRegularContribution: string;
        dateLastContribution: string;
        allocation: Array<{ fundName: string; amountInvested: string; amcTer: string }>;
    } {
        const contributions = data.contributions || {};

        return {
            totalRegularContribution: this.getValue(contributions, 'totalContribution') ||
                this.getValue(contributions, 'total_regular_contribution') ||
                this.getValue(contributions, 'currentRegularsOrDatePaidUp'),
            dateLastContribution: this.getValue(contributions, 'lastContributionDate') ||
                this.getValue(contributions, 'dateOfLastContribution') ||
                this.getValue(contributions, 'date_of_last_contribution'),
            allocation: this.mapContributionAllocation(contributions),
        };
    }

    /**
     * Map regular contribution allocation from percentOfContributionIntoEachFund
     */
    private mapContributionAllocation(contributions: any): Array<{ fundName: string; amountInvested: string; amcTer: string }> {
        const allocationList: Array<{ fundName: string; amountInvested: string; amcTer: string }> = [];

        // Check percentOfContributionIntoEachFund array
        let rawAllocations = contributions.percentOfContributionIntoEachFund?.value || contributions.percentOfContributionIntoEachFund;

        if (Array.isArray(rawAllocations)) {
            for (const item of rawAllocations) {
                const fundName = this.getValue(item, 'fundName');
                const percent = this.getValue(item, 'allocationPercentage');
                const amount = this.getValue(item, 'amount');

                // Use amount if available, otherwise percent
                const amountInvested = amount || percent;

                if (fundName) {
                    allocationList.push({
                        fundName,
                        amountInvested,
                        amcTer: '', // Usually not directly available in this specific list
                    });
                }
            }
        }

        return allocationList;
    }
}
