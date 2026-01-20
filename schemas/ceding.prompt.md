# Ceding Note Extraction Guidelines

This is a **Ceding/Transfer** document for UK pension transfers.

## Document Context
- Contains pension plan details for transfer analysis
- May include multiple documents: statement, charges sheet, fund factsheets
- Critical for identifying guarantees, charges, and transfer values

## Key Sections to Locate
- **Plan Info**: Provider, plan number, start date (first page/header)
- **Fund Values**: Current value, transfer value, valuation date
- **Fund Holdings**: Individual fund names, values, allocations (fund table)
- **Charges**: AMC, TER, platform fees, exit charges (charges section)
- **Contributions**: Current regulars, history, employer/employee split
- **Guarantees**: GAR, GMP, PTFC, protected retirement age
- **Flexibility**: Drawdown options, UFPLS, partial transfers

## Extraction Rules
1. **Plan-specific**: Only extract data for the plan number shown - ignore other plans
2. **Values with dates**: Keep value and date together (e.g., "£308,181.58 as at 02/07/2025")
3. **Not Stated**: If a field isn't mentioned, return "Not Stated" not "No"
4. **Not Applicable**: Use when field doesn't apply to this plan type
5. **Document Provided – Value Not Stated**: Use when charges doc exists but specific charge isn't shown

## Special Handling
- **Contribution History**: Extract EVERY contribution from plan inception - very important
- **Fund Charges Table**: Extract ALL funds with AMC, further costs, total charge
- **Guarantees**: Only confirm if EXPLICITLY stated - never assume absence means "No"
- **Retirement Age**: Only extract if specific to THIS plan, not generic UK pension ages
