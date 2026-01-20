# CFR Extraction Guidelines

This is a **Client Financial Review (CFR)** document for UK financial planning.

## Document Metadata (Root Level)
Extract these fields from the FIRST 1-2 pages:
- `document_title`: Usually "Confidential Financial Review" or similar at the top
- `report_type`: "Client Financial Review"
- `provider_name`: "St. James's Place" (look for logo/header)
- `advisor_name`: Look for "Prepared By:" section
- `advisor_firm`: Usually same as provider_name
- `report_date`: Date on cover page or header (YYYY-MM-DD format)
- `regulatory_disclaimer_present`: true if regulatory text exists (e.g., "authorised and regulated by...")

## Key Sections to Locate

### Personal Details (pages 1-5)
- Names, DOB, NI number, contact info
- **Telephone/Mobile**: Numbers near "Telephone", "Mobile"
- **Addresses**: Previous, Business, Correspondence addresses
- **Dependants**: Table/list of children or `dependants_flag: "No"`

### Client Risk Profiling Section → `client_1.personal_details.risk_profile`
**CRITICAL**: Look for section titled "Client Risk Profiling" (usually page 28-30)

**Example source text:**
```
Client Risk Profiling
Capacity For Loss
Client 1
Capacity For Loss            Moderate
Capacity For Loss Reason     Your client has sufficient net disposable income...
Investment Knowledge &       Limited
Experience
Investment Knowledge &       Your client holds investments however they
Experience Reason            have not made any active decisions...
```

**Map to:**
```json
{
  "Capacity For Loss": "Moderate",
  "Capacity For Loss Reason": "Your client has sufficient net disposable income...",
  "Investment Knowledge & Experience": "Limited",
  "Investment Knowledge & Experience Reason": "Your client holds investments however they have not made any active decisions..."
}
```

### Assets & Holdings → `client_1.personal_details.assets`
**CRITICAL**: Extract `Valuation` as an object:
```json
{
  "Category": "Cash-based Investment",
  "Type of asset/holding": "Bank savings account",
  "Valuation": {
    "amount": 12000,
    "currency": "GBP"
  }
}
```
Source text like "£12,000.00" → `{ "amount": 12000, "currency": "GBP" }`

### St. James's Place Plans → `st_jamess_place_plans`
Extract ALL SJP products into this array. Each plan needs:
- `plan_name`, `plan_type`, `owner`, `current_value` (as object with amount/currency)

## Extraction Rules
1. **Money values**: Extract as numbers (12000 not "£12,000.00")
2. **Dates**: Use YYYY-MM-DD format
3. **Yes/No fields**: Use exactly "Yes" or "No"
4. **Dual-client documents**: Match "Client 1" text to client_1, "Client 2" to client_2
5. **Arrays**: Extract ALL items - do not truncate
6. **Valuation objects**: Always use `{ "amount": number, "currency": "GBP" }` format

## Special Handling
- **Pension tables**: May span multiple pages - extract every row
- **Risk Profile fields use EXACT source labels with spaces** (e.g., "Capacity For Loss" not "capacity_for_loss")
- **Page boundaries**: Important data may be split across pages

