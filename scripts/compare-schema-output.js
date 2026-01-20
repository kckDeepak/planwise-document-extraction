const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '../schemas/cfr.json');
const outputPath = path.join(__dirname, '../output/reducto/cfr/cfr_latest_2026-01-16T06-35-01-690Z.json');

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

// Extract data from the output structure (it's wrapped in extracted_data)
const data = output.extracted_data || output;

function getLeafPaths(obj, prefix = '') {
    let paths = [];

    // Handle schema properties
    const props = obj.properties || {};

    for (const [key, value] of Object.entries(props)) {
        const currentPath = prefix ? `${prefix}.${key}` : key;

        if (value.type === 'object' && value.properties) {
            paths = paths.concat(getLeafPaths(value, currentPath));
        } else if (value.type === 'array' && value.items && value.items.properties) {
            // For arrays, we just want to check if the array key exists in output
            // checking individual array items is dynamic and depends on content
            paths.push(currentPath);
            // Also optionally check sub-properties if needed, but presence of array is the main schema check
            // paths = paths.concat(getLeafPaths(value.items, currentPath));
        } else {
            paths.push(currentPath);
        }
    }

    return paths;
}

function checkPath(obj, pathStr) {
    const parts = pathStr.split('.');
    let current = obj;

    for (const part of parts) {
        if (current === undefined || current === null) return false;

        // Handle array access in data if path implies it, but here we compare schema paths 
        // which are abstract. 
        // In the specific extracted output format: 
        // Simple fields are objects { value: ..., ... }
        // Arrays are arrays of objects

        // If current is the "wrapper" object { value: ... }, we need to check inside it?
        // Actually, the structure in output matches the schema structure directly, where leaf nodes are objects.

        if (current[part] === undefined) return false;
        current = current[part];
    }

    return true;
}

// 1. Get all expected paths from Schema
// We focus on client_1 for now as client_2 is optional mirror
const allPaths = getLeafPaths(schema.properties.client_1, 'client_1');

console.log(`Total schema paths to check: ${allPaths.length}`);

// 2. Check existence in Output
const missing = [];
const empty = [];

for (const p of allPaths) {
    // Check if path exists
    // The output structure matches schema: client_1.personal_details.forenames
    // But leaf nodes in output are { value: "Adam", ... } or null

    const parts = p.split('.');
    let current = data;
    let exists = true;

    for (const part of parts) {
        if (!current || current[part] === undefined) {
            exists = false;
            break;
        }
        current = current[part];
    }

    if (!exists) {
        missing.push(p);
    } else {
        // Check if value is logically empty (null, empty string, or empty array)
        let val = current;
        if (val && typeof val === 'object' && 'value' in val) {
            val = val.value;
        }

        if (val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) {
            empty.push(p);
        }
    }
}

console.log('\n--- MISSING FIELDS (Not in JSON at all) ---');
missing.forEach(p => console.log(p));

console.log('\n--- EMPTY FIELDS (In JSON but null/empty) ---');
empty.forEach(p => console.log(p));
