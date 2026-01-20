import json
import sys

# Read the current CFR schema
with open('e:/f/Brdge AI-Projects/data lab/Data-Lab-Extraction/nest-reducto/schemas/cfr.json', 'r', encoding='utf-8') as f:
    schema = json.load(f)

# Define which sections are client-specific (to be duplicated)
client_specific_sections = [
    'personal_information',
    'dependants',
    'address_details',
    'health_and_occupation',
    'totalMonthlyNetIncome',
    'income',
    'expenditure',
    'disposable_income',
    'future_circumstances',
    'tax_and_residence',
    'liabilities',
    'protection_policies',
    'pensions',
    'assets',
    'holdings',
    'vulnerability_assessment'
]

# Create new schema structure
new_schema = {
    "$schema": schema["$schema"],
    "type": "object",
    "description": schema["description"] + " - Supports two clients",
    "properties": {
        "has_client_2": {
            "type": "boolean",
            "description": "Indicates whether second client data is present"
        },
        "client_1": {
            "type": "object",
            "description": "Primary client information",
            "properties": {}
        },
        "client_2": {
            "type": "object",
            "description": "Secondary client information (if has_client_2 is true). Structure mirrors client_1 exactly",
            "properties": {}
        }
    }
}

# Move client-specific sections to client_1 and client_2
for section in client_specific_sections:
    if section in schema['properties']:
        new_schema['properties']['client_1']['properties'][section] = schema['properties'][section]
        # Duplicate for client_2
        new_schema['properties']['client_2']['properties'][section] = schema['properties'][section]

# Add shared sections (not duplicated) to root level
for section, value in schema['properties'].items():
    if section not in client_specific_sections:
        new_schema['properties'][section] = value

# Write the new schema
with open('e:/f/Brdge AI-Projects/data lab/Data-Lab-Extraction/nest-reducto/schemas/cfr.json', 'w', encoding='utf-8') as f:
    json.dump(new_schema, f, indent=2, ensure_ascii=False)

print("CFR schema restructured successfully!")
print(f"Client-specific sections moved: {len(client_specific_sections)}")
print(f"Shared sections: {len(schema['properties']) - len(client_specific_sections)}")
