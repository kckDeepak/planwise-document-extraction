/**
 * Compare ESS extraction outputs between Reducto and DataLab
 * Run: node compare-ess.js
 */

const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, '../output');
const reductoFile = path.join(outputDir, 'ess_latest.json');
const datalabFile = path.join(outputDir, 'ess_datalab_latest.json');

// Read files
const reductoData = JSON.parse(fs.readFileSync(reductoFile, 'utf-8'));
const datalabData = JSON.parse(fs.readFileSync(datalabFile, 'utf-8'));

// Extract field keys
function getFieldKeys(data, prefix = '') {
    const keys = [];

    if (data && data.extracted_data) {
        for (const [section, fields] of Object.entries(data.extracted_data)) {
            if (typeof fields === 'object' && fields !== null) {
                for (const [fieldName, fieldData] of Object.entries(fields)) {
                    const fullKey = `${section}.${fieldName}`;
                    keys.push(fullKey);
                }
            }
        }
    }

    return keys;
}

// Get non-null values
function getNonNullFields(data) {
    const nonNull = [];

    if (data && data.extracted_data) {
        for (const [section, fields] of Object.entries(data.extracted_data)) {
            if (typeof fields === 'object' && fields !== null) {
                for (const [fieldName, fieldData] of Object.entries(fields)) {
                    const value = fieldData?.value;
                    if (value !== null && value !== undefined && value !== '') {
                        nonNull.push(`${section}.${fieldName}`);
                    }
                }
            }
        }
    }

    return nonNull;
}

const reductoFields = getFieldKeys(reductoData);
const datalabFields = getFieldKeys(datalabData);

const reductoNonNull = getNonNullFields(reductoData);
const datalabNonNull = getNonNullFields(datalabData);

// Find differences
const onlyInReducto = reductoFields.filter(f => !datalabFields.includes(f));
const onlyInDatalab = datalabFields.filter(f => !reductoFields.includes(f));
const inBoth = reductoFields.filter(f => datalabFields.includes(f));

const reductoHasValue = reductoNonNull.filter(f => !datalabNonNull.includes(f));
const datalabHasValue = datalabNonNull.filter(f => !reductoNonNull.includes(f));

console.log('='.repeat(70));
console.log('ESS EXTRACTION COMPARISON: Reducto vs DataLab');
console.log('='.repeat(70));

console.log('\n📊 SUMMARY:');
console.log(`  Reducto total fields: ${reductoFields.length}`);
console.log(`  DataLab total fields: ${datalabFields.length}`);
console.log(`  Reducto non-null values: ${reductoNonNull.length}`);
console.log(`  DataLab non-null values: ${datalabNonNull.length}`);
console.log(`  Fields in both: ${inBoth.length}`);

console.log('\n⚠️ FIELDS ONLY IN REDUCTO (missing from DataLab):');
if (onlyInReducto.length === 0) {
    console.log('  None - DataLab has all Reducto fields!');
} else {
    onlyInReducto.forEach(f => console.log(`  - ${f}`));
}

console.log('\n✅ FIELDS ONLY IN DATALAB:');
if (onlyInDatalab.length === 0) {
    console.log('  None');
} else {
    onlyInDatalab.forEach(f => console.log(`  + ${f}`));
}

console.log('\n🔍 REDUCTO HAS VALUE, DATALAB IS NULL/EMPTY:');
if (reductoHasValue.length === 0) {
    console.log('  None - DataLab extracted values for all fields!');
} else {
    reductoHasValue.slice(0, 20).forEach(f => console.log(`  - ${f}`));
    if (reductoHasValue.length > 20) {
        console.log(`  ... and ${reductoHasValue.length - 20} more`);
    }
}

console.log('\n' + '='.repeat(70));
console.log('File sizes:');
console.log(`  Reducto: ${(fs.statSync(reductoFile).size / 1024).toFixed(1)} KB`);
console.log(`  DataLab: ${(fs.statSync(datalabFile).size / 1024).toFixed(1)} KB`);
console.log('='.repeat(70));
