import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import { CedingNotePdfInput } from './ceding-pdf-mapper.service';

@Injectable()
export class CedingPdfGeneratorService {
    private readonly logger = new Logger(CedingPdfGeneratorService.name);

    /**
     * Generate Ceding Note PDF by filling the BA403 template
     */
    async generatePdf(data: CedingNotePdfInput): Promise<Buffer> {
        this.logger.log('📄 Starting Ceding Note PDF generation (Template Fill)...');

        try {
            // Path to the blank template
            const templatePath = path.join(process.cwd(), 'public', 'templates', 'Ceding File Note.pdf');

            if (!fs.existsSync(templatePath)) {
                this.logger.error(`Template not found at: ${templatePath}`);
                throw new Error(`PDF Template not found at: ${templatePath}`);
            }

            // Load the template
            const templateBytes = fs.readFileSync(templatePath);
            const pdfDoc = await PDFDocument.load(templateBytes);
            const form = pdfDoc.getForm();

            // Helper to safely set text field value
            const setTextField = (fieldName: string, value: string) => {
                try {
                    // Check if field exists
                    const field = form.getTextField(fieldName);
                    if (field) {
                        field.setText(value || '');
                        return true;
                    }
                } catch (error) {
                    // Field might not exist or be a different type
                    // Silent failure is often better than crashing for optional fields
                    // console.warn(`Field "${fieldName}" issue:`, error.message);
                }
                return false;
            };

            // Helper to format date from DD/MM/YYYY to DDMMYYYY
            const formatDateForPDF = (dateStr: string): string => {
                if (!dateStr) return '';
                return dateStr.replace(/[\/\-\.]/g, '');
            };

            // 1. Contact Information
            setTextField('Name of contact', data.contactInfo.nameOfContact);
            setTextField('Phone number', data.contactInfo.phoneNo);
            setTextField('Name of caller', data.contactInfo.nameOfCaller);
            setTextField('Date of call', formatDateForPDF(data.contactInfo.dateOfCall));
            setTextField('Name of client', data.contactInfo.nameOfClient);
            setTextField('Time of call', data.contactInfo.timeOfCall);

            // 2. Plan Details
            setTextField('Plan number', data.planDetails.planNumber);
            setTextField('Start date', formatDateForPDF(data.planDetails.startDate));
            setTextField('Selected retirement age', data.planDetails.selectedRetirementAge);
            setTextField('How many funds 1', data.planDetails.fundsAvailableAndLimit);
            setTextField('Flexible access 1', data.planDetails.flexibleAccessDrawdown);
            setTextField('Earmarking 1', data.planDetails.earmarkingOrAttachment);
            setTextField('Additional life cover 1', data.planDetails.additionalLifeCover);
            setTextField('Waiver of contributions 1', data.planDetails.waiverOfContributions);

            // 3. Policy Details
            setTextField('Allocation rate', data.policyDetails.allocationRate);
            setTextField('Bid offer spread', data.policyDetails.bidOfferSpread);
            setTextField('Adviser charge', data.policyDetails.adviserCharge);
            setTextField('Initial charges on single contributions', data.policyDetails.initialChargesSingleContributions);
            setTextField('Initial charges', data.policyDetails.initialCharges);
            setTextField('Change to indexation', data.policyDetails.changeToIndexation);
            setTextField('Plan / wrapper charge', data.policyDetails.planWrapperCharge);
            setTextField('Policy fee', data.policyDetails.policyFee);
            setTextField('Early withdrawal', data.policyDetails.earlyWithdrawalExitCharge);
            setTextField('Fund discounts', data.policyDetails.fundDiscountsRebates);
            setTextField('Loyalty bonus', data.policyDetails.loyaltyBonus);
            setTextField('Reinvestment of charges', data.policyDetails.reinvestmentOfCharges);

            // 4. Additional Questions
            setTextField('Charging structure 1', data.additionalQuestions.chargingStructureIfContributionsCease);
            setTextField('Partial transfer 1', data.additionalQuestions.partialTransferPossible);
            setTextField('Lifestyle strategy 1', data.additionalQuestions.lifestylingStrategy);
            setTextField('Protected tax free cash 1', data.additionalQuestions.protectedTaxFreeCash);
            setTextField('GAR, GMP, RST 1', data.additionalQuestions.guaranteedBenefits);

            // 5. Pension Input Periods
            setTextField('PIP 1', data.pensionInputPeriods.pip1);
            setTextField('PIP 2', data.pensionInputPeriods.pip2);
            setTextField('PIP 3', data.pensionInputPeriods.pip3);

            // 6. Transfer Funds
            data.transferFunds.funds.forEach((fund, index) => {
                const num = index + 1;
                if (num <= 15) {
                    setTextField(`Fund name ${num}`, fund.fundName);
                    setTextField(`Fund Value ${num}`, fund.currentFundValue);
                    setTextField(`AMC/TER ${num}`, fund.amcTer);
                }
            });

            // 7. Regular Contributions
            setTextField('Regular contribution', data.regularContributions.totalRegularContribution);
            setTextField('Date of Regular Contribution', formatDateForPDF(data.regularContributions.dateLastContribution));

            // Regular allocations (Fund name 17-23)
            data.regularContributions.allocation.forEach((alloc, index) => {
                const num = 17 + index;
                if (num <= 23) {
                    setTextField(`Fund name ${num}`, alloc.fundName);
                    setTextField(`Fund Value ${num}`, alloc.amountInvested);
                    setTextField(`AMC/TER ${num}`, alloc.amcTer);
                }
            });

            // 8. Notes
            setTextField('Text1', data.notes);

            // Save and return
            const pdfBytes = await pdfDoc.save();
            this.logger.log(`✅ PDF generated successfully, size: ${pdfBytes.length} bytes`);
            return Buffer.from(pdfBytes);

        } catch (error) {
            this.logger.error('Error generating PDF', error);
            throw error;
        }
    }
}
