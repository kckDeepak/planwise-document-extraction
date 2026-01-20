// ============================================
// DOM Elements
// ============================================
const elements = {
    form: document.getElementById('extractForm'),
    fileInput: document.getElementById('fileInput'),
    folderInput: document.getElementById('folderInput'),
    selectFilesBtn: document.getElementById('selectFilesBtn'),
    selectFolderBtn: document.getElementById('selectFolderBtn'),
    dropZone: document.getElementById('dropZone'),
    fileCount: document.getElementById('fileCount'),
    modelSelect: document.getElementById('modelSelect'),
    schemaSelect: document.getElementById('schemaSelect'),
    submitBtn: document.getElementById('submitBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    progressSection: document.getElementById('progressSection'),
    progressIcon: document.getElementById('progressIcon'),
    progressTitle: document.getElementById('progressTitle'),
    currentTask: document.getElementById('currentTask'),
    progressPercent: document.getElementById('progressPercent'),
    progressFill: document.getElementById('progressFill'),
    progressLog: document.getElementById('progressLog'),
    errorSection: document.getElementById('errorSection'),
    errorMessage: document.getElementById('errorMessage'),
    resultsSection: document.getElementById('resultsSection'),
    timeTaken: document.getElementById('timeTaken'),
    tableViewBtn: document.getElementById('tableViewBtn'),
    jsonViewBtn: document.getElementById('jsonViewBtn'),
    tableView: document.getElementById('tableView'),
    jsonView: document.getElementById('jsonView'),
    jsonContent: document.getElementById('jsonContent'),
    generatePdfBtn: document.getElementById('generatePdfBtn'),
};

// ============================================
// State
// ============================================
let abortController = null;
let selectedFiles = [];
let startTime = null;
let lastExtractionOutput = null;  // Store for PDF generation

// ============================================
// Event Listeners
// ============================================
elements.fileInput.addEventListener('change', handleFileSelect);

// Folder input handler
if (elements.folderInput) {
    elements.folderInput.addEventListener('change', handleFolderSelect);
}

// Button click handlers
if (elements.selectFilesBtn) {
    elements.selectFilesBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        elements.fileInput.click();
    });
}

if (elements.selectFolderBtn) {
    elements.selectFolderBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (elements.folderInput) {
            elements.folderInput.click();
        } else {
            console.error('Folder input not found');
        }
    });
}

elements.dropZone.addEventListener('dragover', handleDragOver);
elements.dropZone.addEventListener('dragleave', handleDragLeave);
elements.dropZone.addEventListener('drop', handleDrop);
elements.form.addEventListener('submit', handleSubmit);
elements.cancelBtn.addEventListener('click', handleCancel);
elements.tableViewBtn.addEventListener('click', () => toggleView('table'));
elements.jsonViewBtn.addEventListener('click', () => toggleView('json'));
if (elements.generatePdfBtn) {
    elements.generatePdfBtn.addEventListener('click', generatePdf);
}

// ============================================
// File Handling
// ============================================
const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.xlsx', '.xlsm', '.xls', '.csv', '.html', '.htm', '.jpeg', '.jpg', '.png', '.gif', '.tiff', '.msg'];

function handleFileSelect(e) {
    const files = Array.from(e.target.files).filter(file => {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        return SUPPORTED_EXTENSIONS.includes(ext);
    });
    selectedFiles = files;
    updateFileCount();
}

// Handle folder selection - recursively gets all supported files from nested folders
function handleFolderSelect(e) {
    const files = Array.from(e.target.files).filter(file => {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        return SUPPORTED_EXTENSIONS.includes(ext);
    });
    selectedFiles = files;
    updateFileCount();

    if (files.length > 0) {
        // Show folder path info
        const folderPaths = [...new Set(files.map(f => f.webkitRelativePath?.split('/')[0] || 'Folder'))];
        console.log(`Loaded ${files.length} files from: ${folderPaths.join(', ')}`);
    }
}

function handleDragOver(e) {
    e.preventDefault();
    elements.dropZone.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    elements.dropZone.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    elements.dropZone.classList.remove('dragover');

    const files = Array.from(e.dataTransfer.files).filter(file => {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        return SUPPORTED_EXTENSIONS.includes(ext);
    });

    if (files.length > 0) {
        selectedFiles = files;

        // Proper file assignment using DataTransfer (Issue #10)
        try {
            const dataTransfer = new DataTransfer();
            files.forEach(file => dataTransfer.items.add(file));
            elements.fileInput.files = dataTransfer.files;
        } catch (err) {
            // Fallback for browsers that don't support DataTransfer
            console.warn('DataTransfer not supported, using selectedFiles array');
        }

        updateFileCount();
    }
}

function updateFileCount() {
    if (selectedFiles.length === 0) {
        elements.fileCount.textContent = 'No files selected';
        elements.fileCount.classList.remove('has-files');
        elements.submitBtn.disabled = true;
    } else {
        const text = selectedFiles.length === 1
            ? '1 file selected'
            : `${selectedFiles.length} files selected`;
        elements.fileCount.textContent = text;
        elements.fileCount.classList.add('has-files');
        elements.submitBtn.disabled = false;
    }
}

// ============================================
// Form Submission
// ============================================
async function handleSubmit(e) {
    e.preventDefault();

    if (selectedFiles.length === 0) {
        showError('Please select at least one file');
        return;
    }

    // Reset UI
    hideError();
    hideResults();
    showProgress();
    setLoading(true);

    startTime = Date.now();
    abortController = new AbortController();

    const formData = new FormData();
    selectedFiles.forEach(file => formData.append('files', file));
    formData.append('schema', elements.schemaSelect.value);

    try {
        const selectedModel = elements.modelSelect?.value || 'datalab';
        const response = await fetch(`/api/extract?model=${selectedModel}`, {
            method: 'POST',
            body: formData,
            signal: abortController.signal,
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Extraction failed');
        }

        // Read SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';

            for (const eventBlock of events) {
                // Parse SSE event block - find the data line within the block
                const lines = eventBlock.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            handleSSEEvent(data);
                        } catch (err) {
                            console.error('Failed to parse SSE data:', err);
                        }
                    }
                }
            }
        }

        // Calculate time taken
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        elements.timeTaken.innerHTML = `⏱️ Completed in <strong>${duration}s</strong>`;

    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Extraction error:', err);
            showError(err.message);
        }
    } finally {
        setLoading(false);
    }
}

function handleCancel() {
    if (abortController) {
        abortController.abort();
        addLogEntry('warning', 'Extraction cancelled by user');
        setLoading(false);
    }
}

// ============================================
// SSE Event Handling
// ============================================
function handleSSEEvent(data) {
    switch (data.type) {
        case 'start':
            addLogEntry('info', data.message);
            break;

        case 'progress':
            updateProgress(data.percent || 0, data.message || 'Processing...');
            if (data.message) {
                updateProgressLog(data.message);
            }
            break;

        case 'file_complete':
            updateProgress(data.percent || 0);
            addLogEntry(data.status === 'success' ? 'success' : 'error', data.message);
            break;

        case 'complete':
            updateProgress(100, 'Complete!');
            elements.progressIcon.textContent = '✅';
            elements.progressIcon.classList.add('done');
            elements.progressTitle.textContent = 'Processing Complete';
            addLogEntry('success', '✓ All files processed!');
            displayResults(data.results, data.output);
            // Store output and show PDF button for ceding/custom_ceding schema
            lastExtractionOutput = data.output;
            const schemaValue = elements.schemaSelect?.value;
            if ((schemaValue === 'ceding' || schemaValue === 'custom_ceding') && elements.generatePdfBtn) {
                elements.generatePdfBtn.style.display = 'flex';
            }
            break;

        case 'error':
            showError(data.message);
            addLogEntry('error', `Error: ${data.message}`);
            break;
    }
}

// ============================================
// Progress UI
// ============================================
function showProgress() {
    elements.progressSection.style.display = 'block';
    elements.progressLog.innerHTML = '';
    elements.progressIcon.textContent = '🔄';
    elements.progressIcon.classList.remove('done');
    elements.progressTitle.textContent = 'Processing...';
    updateProgress(0, 'Initializing...');
}

function updateProgress(percent, task) {
    elements.progressFill.style.width = `${percent}%`;
    elements.progressPercent.textContent = `${Math.round(percent)}%`;
    if (task) {
        elements.currentTask.textContent = task;
    }
}

function updateProgressLog(message) {
    // Update last progress entry or add new one
    const lastEntry = elements.progressLog.querySelector('.log-entry.progress:last-of-type');
    if (lastEntry) {
        lastEntry.innerHTML = `<span>⏳</span><span>${message}</span>`;
    } else {
        addLogEntry('progress', message);
    }
}

function addLogEntry(type, message) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        progress: '⏳',
        info: 'ℹ️',
    };

    entry.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
    elements.progressLog.appendChild(entry);
    elements.progressLog.scrollTop = elements.progressLog.scrollHeight;
}

// ============================================
// Error Handling
// ============================================
function showError(message) {
    elements.errorSection.style.display = 'block';
    elements.errorMessage.textContent = message;
}

function hideError() {
    elements.errorSection.style.display = 'none';
    elements.errorMessage.textContent = '';
}

// ============================================
// Results Display
// ============================================
function displayResults(results, output) {
    if ((!results || results.length === 0) && !output) return;

    elements.resultsSection.style.display = 'block';

    // Build table view - show merged extracted data if available
    let tableHTML = '';

    if (output && output.extracted_data) {
        // Show the merged, organized extraction results
        tableHTML += buildExtractedDataTable(output);
    } else {
        // Fallback to showing raw results per file
        results.forEach(result => {
            if (result.status === 'success' && result.data) {
                tableHTML += buildResultTable(result.file, result.data);
            } else {
                tableHTML += `
            <div class="result-table-wrapper glass-card" style="border-color: rgba(244, 92, 67, 0.3); background: rgba(244, 92, 67, 0.1);">
              <div class="result-table-header" style="background: var(--danger-gradient);">
                ${escapeHtml(result.file)}
              </div>
              <div style="padding: 1rem; color: #f45c43;">
                Error: ${escapeHtml(result.error || 'Unknown error')}
              </div>
            </div>
          `;
            }
        });
    }

    elements.tableView.innerHTML = tableHTML;

    // Build JSON view - show the full output
    elements.jsonContent.textContent = JSON.stringify(output || results, null, 2);
}

// Build table for merged extracted data (from output.extracted_data)
function buildExtractedDataTable(output) {
    const summary = output.extraction_summary || {};
    const extractedData = output.extracted_data || {};

    let html = `
    <div class="result-table-wrapper">
      <div class="result-table-header">
        📊 Extraction Results (${summary.total_fields_extracted || 0} fields from ${summary.successful_documents || 0} document(s))
        <span class="export-links">
          <a href="/api/export/funds?schema=${elements.schemaSelect?.value || 'ess'}" class="export-link" target="_blank">📥 Funds CSV</a>
        </span>
      </div>
      <table class="result-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Value</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
  `;

    // Render each section
    for (const [sectionName, sectionData] of Object.entries(extractedData)) {
        // Section header
        const formattedSection = formatSectionName(sectionName);
        html += `
        <tr class="section-row">
          <td colspan="3">${escapeHtml(formattedSection)}</td>
        </tr>
      `;

        // Render fields in this section
        if (sectionData && typeof sectionData === 'object') {
            for (const [fieldName, fieldData] of Object.entries(sectionData)) {
                const formattedField = formatFieldName(fieldName);

                if (fieldData && typeof fieldData === 'object') {
                    const value = fieldData.value;
                    const confidence = fieldData.confidence;
                    const isArray = fieldData.is_array;

                    html += `
                <tr>
                  <td class="field-name" style="padding-left: 36px;">${escapeHtml(formattedField)}</td>
                  <td class="field-value">${renderValue(isArray ? value : value)}</td>
                  <td>${renderConfidence(confidence)}</td>
                </tr>
              `;
                } else {
                    html += `
                <tr>
                  <td class="field-name" style="padding-left: 36px;">${escapeHtml(formattedField)}</td>
                  <td class="field-value">${renderValue(fieldData)}</td>
                  <td>${renderConfidence(null)}</td>
                </tr>
              `;
                }
            }
        }
    }

    html += `
        </tbody>
      </table>
    </div>
  `;

    return html;
}

// Format section names nicely
function formatSectionName(name) {
    return name.replace(/_/g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase())
        .trim()
        .toUpperCase();
}

// Format field names nicely
function formatFieldName(name) {
    return name.replace(/_/g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase())
        .trim();
}

function buildResultTable(fileName, data) {
    let html = `
    <div class="result-table-wrapper">
      <div class="result-table-header">${escapeHtml(fileName)}</div>
      <table class="result-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Value</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
  `;

    html += renderFields(data);

    html += `
        </tbody>
      </table>
    </div>
  `;

    return html;
}

function renderFields(data, prefix = '', depth = 0) {
    let html = '';

    for (const [key, value] of Object.entries(data)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;

        if (isValueObject(value)) {
            const confidence = value.confidence;
            const actualValue = value.value;

            html += `
        <tr>
          <td class="field-name" style="padding-left: ${depth * 20 + 16}px;">${escapeHtml(key)}</td>
          <td class="field-value">${renderValue(actualValue)}</td>
          <td>${renderConfidence(confidence)}</td>
        </tr>
      `;
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            // Section header
            html += `
        <tr class="section-row">
          <td colspan="3" style="padding-left: ${depth * 20 + 16}px;">${escapeHtml(key)}</td>
        </tr>
      `;
            html += renderFields(value, fullKey, depth + 1);
        } else {
            html += `
        <tr>
          <td class="field-name" style="padding-left: ${depth * 20 + 16}px;">${escapeHtml(key)}</td>
          <td class="field-value">${renderValue(value)}</td>
          <td>${renderConfidence(null)}</td>
        </tr>
      `;
        }
    }

    return html;
}

function isValueObject(value) {
    return value && typeof value === 'object' && 'value' in value;
}

function renderValue(value) {
    if (value === null || value === undefined) return '—';

    // Handle arrays - render as mini tables
    if (Array.isArray(value)) {
        if (value.length === 0) return '—';

        // Check if array contains objects (like fund_charges)
        if (typeof value[0] === 'object' && value[0] !== null) {
            return renderArrayAsTable(value);
        }

        // Simple array of primitives
        return value.map(item => escapeHtml(String(item))).join(', ');
    }

    // Handle objects - render as formatted key-value pairs
    if (typeof value === 'object') {
        return renderObjectAsDetails(value);
    }

    return escapeHtml(String(value));
}

// Render array of objects as a mini HTML table
function renderArrayAsTable(array) {
    if (!array || array.length === 0) return '—';

    // Get all unique keys from all objects
    const keys = new Set();
    array.forEach(item => {
        if (item && typeof item === 'object') {
            Object.keys(item).forEach(key => keys.add(key));
        }
    });

    const headers = Array.from(keys);
    if (headers.length === 0) return '—';

    // Format header names nicely
    const formatHeader = (key) => {
        return key.replace(/_/g, ' ')
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    };

    let html = '<table class="nested-table">';
    html += '<thead><tr>';
    headers.forEach(header => {
        html += `<th>${escapeHtml(formatHeader(header))}</th>`;
    });
    html += '</tr></thead>';

    html += '<tbody>';
    array.forEach(item => {
        html += '<tr>';
        headers.forEach(header => {
            let cellValue = item[header];
            // Extract value from citation objects
            if (cellValue && typeof cellValue === 'object' && 'value' in cellValue) {
                cellValue = cellValue.value;
            }
            const displayValue = cellValue !== null && cellValue !== undefined
                ? escapeHtml(String(cellValue))
                : '—';
            html += `<td>${displayValue}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table>';

    return html;
}

// Render object as formatted key-value details
function renderObjectAsDetails(obj) {
    if (!obj || Object.keys(obj).length === 0) return '—';

    const formatKey = (key) => {
        return key.replace(/_/g, ' ')
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    };

    let html = '<div class="nested-details">';
    for (const [key, val] of Object.entries(obj)) {
        // Skip internal fields like citations, bbox
        if (key === 'citations' || key === 'bbox') continue;

        let displayValue = val;
        // Extract value from citation objects
        if (val && typeof val === 'object' && 'value' in val) {
            displayValue = val.value;
        }

        if (displayValue === null || displayValue === undefined) {
            displayValue = '—';
        } else if (typeof displayValue === 'object') {
            displayValue = JSON.stringify(displayValue);
        }

        html += `<div class="detail-row"><strong>${escapeHtml(formatKey(key))}:</strong> ${escapeHtml(String(displayValue))}</div>`;
    }
    html += '</div>';

    return html;
}

function renderConfidence(confidence) {
    if (confidence === null || confidence === undefined) {
        return '<span class="confidence-badge confidence-na">N/A</span>';
    }

    let label, cssClass;

    if (confidence >= 0.8) {
        label = 'High';
        cssClass = 'confidence-high';
    } else if (confidence >= 0.5) {
        label = 'Medium';
        cssClass = 'confidence-medium';
    } else {
        label = 'Low';
        cssClass = 'confidence-low';
    }

    const percent = Math.round(confidence * 100);
    return `<span class="confidence-badge ${cssClass}">${label} (${percent}%)</span>`;
}

function hideResults() {
    elements.resultsSection.style.display = 'none';
    elements.tableView.innerHTML = '';
    elements.jsonContent.textContent = '';
    lastExtractionOutput = null;
    if (elements.generatePdfBtn) {
        elements.generatePdfBtn.style.display = 'none';
    }
}

function toggleView(view) {
    if (view === 'table') {
        elements.tableView.style.display = 'block';
        elements.jsonView.style.display = 'none';
        elements.tableViewBtn.classList.add('active');
        elements.jsonViewBtn.classList.remove('active');
    } else {
        elements.tableView.style.display = 'none';
        elements.jsonView.style.display = 'block';
        elements.tableViewBtn.classList.remove('active');
        elements.jsonViewBtn.classList.add('active');
    }
}

// ============================================
// Loading State
// ============================================
function setLoading(loading) {
    if (loading) {
        elements.submitBtn.disabled = true;
        elements.submitBtn.innerHTML = '<span class="btn-icon">⏳</span> Extracting...';
        elements.cancelBtn.style.display = 'flex';
    } else {
        elements.submitBtn.disabled = selectedFiles.length === 0;
        elements.submitBtn.innerHTML = '<span class="btn-icon">🔍</span> Extract Data';
        elements.cancelBtn.style.display = 'none';
    }
}

// ============================================
// Utilities
// ============================================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// Dynamic Schema Loading (Issue #9)
// ============================================
async function loadSchemas() {
    try {
        const response = await fetch('/api/schemas');
        const { schemas } = await response.json();

        const schemaNames = {
            'cfr': 'Client Financial Review (CFR)',
            'ceding': 'Ceding Scheme Information',
            'custom_ceding': 'Custom Ceding Schema',
            'ess': 'Employer-Sponsored Scheme (ESS)',
            'cyc': 'CYC',
            'illustration': 'Illustration'
        };

        // Ensure custom_ceding is always available (even if file doesn't exist yet)
        const allSchemas = schemas.includes('custom_ceding') ? schemas : [...schemas];
        
        // Build options with custom_ceding after ceding
        let options = '';
        const orderedSchemas = ['cfr', 'ceding', 'custom_ceding', 'ess', 'cyc', 'illustration'];
        
        // First add schemas in preferred order
        for (const schema of orderedSchemas) {
            if (allSchemas.includes(schema) || schema === 'custom_ceding') {
                options += `<option value="${schema}">${schemaNames[schema] || schema.toUpperCase()}</option>`;
            }
        }
        
        // Then add any other schemas not in the ordered list
        for (const schema of allSchemas) {
            if (!orderedSchemas.includes(schema)) {
                options += `<option value="${schema}">${schemaNames[schema] || schema.toUpperCase()}</option>`;
            }
        }
        
        elements.schemaSelect.innerHTML = options;
    } catch (err) {
        console.error('Failed to load schemas:', err);
        // Keep default options if API fails
    }
}

// ============================================
// CSV Export
// ============================================
function exportCSV(type) {
    const schema = elements.schemaSelect.value;
    const endpoint = type === 'contributions'
        ? `/api/export/contributions?schema=${schema}`
        : `/api/export/funds?schema=${schema}`;

    // Trigger download by opening in new window/tab
    window.open(endpoint, '_blank');
}

function showExportButtons(show) {
    if (elements.exportContributionsBtn) {
        elements.exportContributionsBtn.style.display = show ? 'flex' : 'none';
    }
    if (elements.exportFundsBtn) {
        elements.exportFundsBtn.style.display = show ? 'flex' : 'none';
    }
}

// ============================================
// PDF Generation
// ============================================
async function generatePdf() {
    if (!lastExtractionOutput) {
        console.error('No extraction data available for PDF generation');
        return;
    }

    const btn = elements.generatePdfBtn;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="btn-icon">⏳</span> Generating...';
    btn.disabled = true;

    try {
        const response = await fetch('/api/pdf/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(lastExtractionOutput),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'PDF generation failed');
        }

        // Get filename from Content-Disposition header if possible
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'ceding-file-note.pdf';
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
            if (filenameMatch && filenameMatch[1]) {
                filename = filenameMatch[1];
            }
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        addLogEntry('success', 'PDF generated and downloaded successfully');

    } catch (err) {
        console.error('PDF generation error:', err);
        showError(err.message);
        addLogEntry('error', `PDF Error: ${err.message}`);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ============================================
// Custom Ceding Schema Builder
// ============================================
const customCedingElements = {
    section: document.getElementById('customCedingSection'),
    fieldsList: document.getElementById('customFieldsList'),
    newFieldName: document.getElementById('newFieldName'),
    newFieldType: document.getElementById('newFieldType'),
    newFieldDescription: document.getElementById('newFieldDescription'),
    addFieldBtn: document.getElementById('addFieldBtn'),
    saveSchemaBtn: document.getElementById('saveCustomSchemaBtn'),
    statusSpan: document.getElementById('customSchemaStatus'),
};

// Store custom fields
let customFields = [];

// Toggle custom ceding section visibility based on schema selection
elements.schemaSelect.addEventListener('change', (e) => {
    const isCustomCeding = e.target.value === 'custom_ceding';
    
    if (customCedingElements.section) {
        customCedingElements.section.style.display = isCustomCeding ? 'block' : 'none';
    }
    
    // Load existing custom fields if switching to custom_ceding
    if (isCustomCeding) {
        loadExistingCustomFields();
    }
    
    // Show/hide PDF button based on schema
    if (elements.generatePdfBtn) {
        const showPdf = (e.target.value === 'ceding' || e.target.value === 'custom_ceding') && lastExtractionOutput;
        elements.generatePdfBtn.style.display = showPdf ? 'flex' : 'none';
    }
});

// Add field button handler
if (customCedingElements.addFieldBtn) {
    customCedingElements.addFieldBtn.addEventListener('click', addCustomField);
}

// Save schema button handler
if (customCedingElements.saveSchemaBtn) {
    customCedingElements.saveSchemaBtn.addEventListener('click', saveCustomSchema);
}

// Allow Enter key to add field
if (customCedingElements.newFieldDescription) {
    customCedingElements.newFieldDescription.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCustomField();
        }
    });
}

function addCustomField() {
    const name = customCedingElements.newFieldName.value.trim();
    const type = customCedingElements.newFieldType.value;
    const description = customCedingElements.newFieldDescription.value.trim();
    
    if (!name) {
        customCedingElements.newFieldName.focus();
        return;
    }
    
    // Check for duplicate
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (customFields.some(f => f.name === sanitizedName)) {
        setSchemaStatus('error', `Field "${name}" already exists`);
        return;
    }
    
    // Add to array
    customFields.push({
        name: sanitizedName,
        type,
        description: description || name,
        displayName: name,
    });
    
    // Clear inputs
    customCedingElements.newFieldName.value = '';
    customCedingElements.newFieldDescription.value = '';
    customCedingElements.newFieldName.focus();
    
    // Render list
    renderCustomFieldsList();
    updateSaveButtonState();
    setSchemaStatus('', '');
}

function removeCustomField(index) {
    customFields.splice(index, 1);
    renderCustomFieldsList();
    updateSaveButtonState();
}

function renderCustomFieldsList() {
    if (!customCedingElements.fieldsList) return;
    
    if (customFields.length === 0) {
        customCedingElements.fieldsList.innerHTML = `
            <div class="empty-fields-message">
                No custom fields added yet. Add fields above to extend the ceding schema.
            </div>
        `;
        return;
    }
    
    const typeLabels = {
        'string': 'Text',
        'number': 'Number',
        'table': 'Table',
        'boolean': 'Yes/No',
        'array': 'Table',
    };
    
    customCedingElements.fieldsList.innerHTML = customFields.map((field, index) => `
        <div class="custom-field-item">
            <div class="field-info">
                <span class="field-name">${escapeHtml(field.displayName || field.name)}</span>
                <div class="field-meta">
                    <span class="field-type-badge">${typeLabels[field.type] || field.type}</span>
                    <span>${escapeHtml(field.description)}</span>
                </div>
            </div>
            <button type="button" class="remove-field-btn" onclick="removeCustomField(${index})" title="Remove field">
                ✕
            </button>
        </div>
    `).join('');
}

function updateSaveButtonState() {
    if (customCedingElements.saveSchemaBtn) {
        customCedingElements.saveSchemaBtn.disabled = customFields.length === 0;
    }
}

async function saveCustomSchema() {
    if (customFields.length === 0) {
        setSchemaStatus('error', 'Add at least one custom field');
        return;
    }
    
    const btn = customCedingElements.saveSchemaBtn;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="btn-icon">⏳</span> Saving...';
    btn.disabled = true;
    
    try {
        const response = await fetch('/api/schemas/custom-ceding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customFields: customFields.map(f => ({
                    name: f.name,
                    type: f.type,
                    description: f.description,
                })),
            }),
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.message || 'Failed to save schema');
        }
        
        setSchemaStatus('success', `✓ Schema saved with ${result.fieldsAdded} custom field(s)`);
        
    } catch (err) {
        console.error('Save schema error:', err);
        setSchemaStatus('error', `✕ ${err.message}`);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = customFields.length === 0;
    }
}

async function loadExistingCustomFields() {
    try {
        const response = await fetch('/api/schemas/custom-ceding/fields');
        const data = await response.json();
        
        if (data.exists && data.fields && data.fields.length > 0) {
            customFields = data.fields.map(f => ({
                name: f.name,
                type: f.type,
                description: f.description,
                displayName: f.name.replace(/_/g, ' '),
            }));
            renderCustomFieldsList();
            updateSaveButtonState();
            setSchemaStatus('', `Loaded ${customFields.length} existing custom field(s)`);
        } else {
            customFields = [];
            renderCustomFieldsList();
            updateSaveButtonState();
        }
    } catch (err) {
        console.error('Failed to load custom fields:', err);
        customFields = [];
        renderCustomFieldsList();
        updateSaveButtonState();
    }
}

function setSchemaStatus(type, message) {
    if (customCedingElements.statusSpan) {
        customCedingElements.statusSpan.textContent = message;
        customCedingElements.statusSpan.className = 'schema-status' + (type ? ` ${type}` : '');
    }
}

// Make removeCustomField globally accessible for onclick
window.removeCustomField = removeCustomField;

// ============================================
// Initialize
// ============================================
loadSchemas();
updateFileCount();
renderCustomFieldsList();

