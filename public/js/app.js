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
let lastExtractionOutput = null; // Store for PDF generation

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
const SUPPORTED_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.doc',
  '.xlsx',
  '.xlsm',
  '.xls',
  '.csv',
  '.html',
  '.htm',
  '.jpeg',
  '.jpg',
  '.png',
  '.gif',
  '.tiff',
  '.msg',
];

function handleFileSelect(e) {
  const files = Array.from(e.target.files).filter((file) => {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(ext);
  });
  selectedFiles = files;
  updateFileCount();
}

// Handle folder selection - recursively gets all supported files from nested folders
function handleFolderSelect(e) {
  const files = Array.from(e.target.files).filter((file) => {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(ext);
  });
  selectedFiles = files;
  updateFileCount();

  if (files.length > 0) {
    // Show folder path info
    const folderPaths = [
      ...new Set(
        files.map((f) => f.webkitRelativePath?.split('/')[0] || 'Folder'),
      ),
    ];
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

  const files = Array.from(e.dataTransfer.files).filter((file) => {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(ext);
  });

  if (files.length > 0) {
    selectedFiles = files;

    // Proper file assignment using DataTransfer (Issue #10)
    try {
      const dataTransfer = new DataTransfer();
      files.forEach((file) => dataTransfer.items.add(file));
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
    const text =
      selectedFiles.length === 1
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
  selectedFiles.forEach((file) => formData.append('files', file));
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
      addLogEntry(
        data.status === 'success' ? 'success' : 'error',
        data.message,
      );
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
      if (
        (schemaValue === 'ceding' || schemaValue === 'custom_ceding') &&
        elements.generatePdfBtn
      ) {
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
  const lastEntry = elements.progressLog.querySelector(
    '.log-entry.progress:last-of-type',
  );
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

  // Check for merged data in the new production API format: output.data.extractions[0].extractedData
  // Also fallback to legacy output.extracted_data for backwards compatibility
  const extractedData = getExtractedData(output);

  if (extractedData) {
    // Show the merged, organized extraction results
    tableHTML += buildExtractedDataTable(output, extractedData);
  } else {
    // Fallback to showing raw results per file
    results.forEach((result) => {
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

/**
 * Get the extracted data from the output object.
 * Handles both new production API format and legacy format.
 */
function getExtractedData(output) {
  if (!output) return null;

  // New production API format: output.data.extractions[0].extractedData
  if (
    output.data &&
    output.data.extractions &&
    output.data.extractions.length > 0 &&
    output.data.extractions[0].extractedData
  ) {
    return output.data.extractions[0].extractedData;
  }

  // Legacy format: output.extracted_data
  if (output.extracted_data) {
    return output.extracted_data;
  }

  return null;
}

// Build table for merged extracted data
function buildExtractedDataTable(output, extractedData) {
  // Handle summary info from both new and legacy format
  let totalFieldsExtracted = 0;
  let successfulDocuments = 0;

  // New production API format
  if (output.data && output.data.document) {
    // Count fields in extracted data
    totalFieldsExtracted = countFields(extractedData);
    successfulDocuments = output.data.totalExtractions || 1;
  }
  // Legacy format
  else if (output.extraction_summary) {
    const summary = output.extraction_summary;
    totalFieldsExtracted = summary.total_fields_extracted || 0;
    successfulDocuments = summary.successful_documents || 0;
  }
  // Fallback: count fields
  else {
    totalFieldsExtracted = countFields(extractedData);
    successfulDocuments = 1;
  }

  let html = `
    <div class="result-table-wrapper">
      <div class="result-table-header">
        📊 Merged Extraction Results (${totalFieldsExtracted} fields from ${successfulDocuments} document(s))
        <span class="export-links">
          <a href="/api/export/funds?schema=${elements.schemaSelect?.value || 'ess'}" class="export-link" target="_blank">📥 Funds CSV</a>
        </span>
      </div>
      <table class="result-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
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
          <td colspan="4">${escapeHtml(formattedSection)}</td>
        </tr>
      `;

    // Render fields in this section
    html += renderSectionFields(sectionData);
  }

  html += `
        </tbody>
      </table>
    </div>
  `;

  return html;
}

/**
 * Count total fields in extracted data (recursive)
 */
function countFields(data, count = 0) {
  if (!data || typeof data !== 'object') return count;

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      count += value.length;
    } else if (value && typeof value === 'object') {
      // Check if it's a field object (has 'value' property)
      if ('value' in value) {
        count++;
      } else {
        // Recurse into nested objects
        count = countFields(value, count);
      }
    }
  }
  return count;
}

/**
 * Render fields in a section (handles nested objects)
 */
function renderSectionFields(sectionData, depth = 1) {
  if (!sectionData || typeof sectionData !== 'object') return '';

  // Internal metadata keys to exclude from field display
  const metadataKeys = new Set([
    'page_number',
    'sequence',
    'found',
    'confidence',
    'source',
    'status',
    'description',
    'citation',
    'other_cited_pages',
    'field_type',
    'bbox',
    'citations',
    'granular_confidence',
    'image_url',
    'chart_data',
    'extra',
    'parentBlock',
    'type',
  ]);

  let html = '';
  const paddingLeft = depth * 20 + 16;

  for (const [fieldName, fieldData] of Object.entries(sectionData)) {
    // Skip internal metadata fields
    if (metadataKeys.has(fieldName)) {
      continue;
    }

    const formattedField = formatFieldName(fieldName);

    // Handle arrays (like fund_charges, income, etc.) or objects with items property (table type)
    if (Array.isArray(fieldData)) {
      html += `
            <tr class="section-row" style="padding-left: ${paddingLeft}px;">
              <td colspan="4" style="padding-left: ${paddingLeft}px;">${escapeHtml(formattedField)} (${fieldData.length} items)</td>
            </tr>
          `;
      // Render array as table
      if (fieldData.length > 0) {
        html += `
                <tr>
                  <td colspan="4" style="padding-left: ${paddingLeft + 20}px;">
                    ${renderArrayAsTable(fieldData)}
                  </td>
                </tr>
              `;
      }
    }
    // Handle objects with 'items' property (table type from backend)
    else if (
      fieldData &&
      typeof fieldData === 'object' &&
      'items' in fieldData &&
      Array.isArray(fieldData.items)
    ) {
      const fieldType = fieldData.field_type || 'table';
      html += `
            <tr class="section-row" style="padding-left: ${paddingLeft}px;">
              <td style="padding-left: ${paddingLeft}px;">${escapeHtml(formattedField)} (${fieldData.items.length} items)</td>
              <td>${renderFieldTypeBadge(fieldType)}</td>
              <td colspan="2"></td>
            </tr>
          `;
      // Render array as table
      if (fieldData.items.length > 0) {
        html += `
                <tr>
                  <td colspan="4" style="padding-left: ${paddingLeft + 20}px;">
                    ${renderArrayAsTable(fieldData.items)}
                  </td>
                </tr>
              `;
      }
    }
    // Handle field objects with 'value' property (production format)
    else if (
      fieldData &&
      typeof fieldData === 'object' &&
      'value' in fieldData
    ) {
      const value = fieldData.value;
      const confidence =
        fieldData.confidence ?? (fieldData.found ? 0.99 : null);
      const fieldType = fieldData.field_type || 'text';

      html += `
            <tr>
              <td class="field-name" style="padding-left: ${paddingLeft}px;">${escapeHtml(formattedField)}</td>
              <td>${renderFieldTypeBadge(fieldType)}</td>
              <td class="field-value">${renderValue(value)}</td>
              <td>${renderConfidence(confidence)}</td>
            </tr>
          `;
    }
    // Handle nested objects (like personal_information, etc.)
    else if (fieldData && typeof fieldData === 'object') {
      html += `
            <tr class="section-row">
              <td colspan="4" style="padding-left: ${paddingLeft}px;">${escapeHtml(formattedField)}</td>
            </tr>
          `;
      html += renderSectionFields(fieldData, depth + 1);
    }
    // Handle primitive values
    else {
      html += `
            <tr>
              <td class="field-name" style="padding-left: ${paddingLeft}px;">${escapeHtml(formattedField)}</td>
              <td>${renderFieldTypeBadge('text')}</td>
              <td class="field-value">${renderValue(fieldData)}</td>
              <td>${renderConfidence(null)}</td>
            </tr>
          `;
    }
  }

  return html;
}

// Format section names nicely
function formatSectionName(name) {
  return name
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
    .toUpperCase();
}

// Format field names nicely
function formatFieldName(name) {
  return name
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
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
    return value.map((item) => escapeHtml(String(item))).join(', ');
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

  // Internal metadata keys to exclude from table display
  // Note: 'type' is NOT excluded here because it's valid data in tables like contribution_history (Employee/Employer/Transfer)
  const metadataKeys = new Set([
    'page_number',
    'sequence',
    'found',
    'confidence',
    'source',
    'status',
    'description',
    'citation',
    'other_cited_pages',
    'field_type',
    'bbox',
    'citations',
    'granular_confidence',
    'image_url',
    'chart_data',
    'extra',
    'parentBlock',
  ]);

  // Get all unique keys from all objects, excluding metadata keys
  const keys = new Set();
  array.forEach((item) => {
    if (item && typeof item === 'object') {
      Object.keys(item).forEach((key) => {
        if (!metadataKeys.has(key)) {
          keys.add(key);
        }
      });
    }
  });

  const headers = Array.from(keys);
  if (headers.length === 0) return '—';

  // Format header names nicely
  const formatHeader = (key) => {
    return key
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  };

  let html = '<table class="nested-table">';
  html += '<thead><tr>';
  headers.forEach((header) => {
    html += `<th>${escapeHtml(formatHeader(header))}</th>`;
  });
  html += '</tr></thead>';

  html += '<tbody>';
  array.forEach((item) => {
    html += '<tr>';
    headers.forEach((header) => {
      let cellValue = item[header];
      // Extract value from citation objects
      if (cellValue && typeof cellValue === 'object' && 'value' in cellValue) {
        cellValue = cellValue.value;
      }
      const displayValue =
        cellValue !== null && cellValue !== undefined
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

  // Internal metadata keys to exclude from display
  // Note: 'type' is NOT excluded here because it's valid data in some contexts (e.g., contribution type)
  const metadataKeys = new Set([
    'page_number',
    'sequence',
    'found',
    'confidence',
    'source',
    'status',
    'description',
    'citation',
    'other_cited_pages',
    'field_type',
    'bbox',
    'citations',
    'granular_confidence',
    'image_url',
    'chart_data',
    'extra',
    'parentBlock',
  ]);

  const formatKey = (key) => {
    return key
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  };

  let html = '<div class="nested-details">';
  for (const [key, val] of Object.entries(obj)) {
    // Skip internal metadata fields
    if (metadataKeys.has(key)) continue;

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

  // Handle both 0-1 scale and 0-99 scale
  // If confidence > 1, it's already in 0-99 scale
  let percent;
  if (confidence > 1) {
    percent = Math.round(confidence);
  } else {
    percent = Math.round(confidence * 100);
  }

  let label, cssClass;

  if (percent >= 80) {
    label = 'High';
    cssClass = 'confidence-high';
  } else if (percent >= 50) {
    label = 'Medium';
    cssClass = 'confidence-medium';
  } else {
    label = 'Low';
    cssClass = 'confidence-low';
  }

  return `<span class="confidence-badge ${cssClass}">${label} (${percent}%)</span>`;
}

/**
 * Render field type as a styled badge
 */
function renderFieldTypeBadge(fieldType) {
  if (!fieldType) fieldType = 'text';

  const typeConfig = {
    text: { label: 'Text', icon: '📝', cssClass: 'type-text' },
    string: { label: 'Text', icon: '📝', cssClass: 'type-text' },
    table: { label: 'Table', icon: '📊', cssClass: 'type-table' },
    array: { label: 'Table', icon: '📊', cssClass: 'type-table' },
    boolean: { label: 'Boolean', icon: '✓', cssClass: 'type-boolean' },
    number: { label: 'Number', icon: '#', cssClass: 'type-number' },
  };

  const config = typeConfig[fieldType.toLowerCase()] || {
    label: fieldType,
    icon: '•',
    cssClass: 'type-text',
  };

  return `<span class="field-type-badge ${config.cssClass}">${config.icon} ${config.label}</span>`;
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
    elements.submitBtn.innerHTML =
      '<span class="btn-icon">⏳</span> Extracting...';
    elements.cancelBtn.style.display = 'flex';
  } else {
    elements.submitBtn.disabled = selectedFiles.length === 0;
    elements.submitBtn.innerHTML =
      '<span class="btn-icon">🔍</span> Extract Data';
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
      cfr: 'Client Financial Review (CFR)',
      ceding: 'Ceding Scheme Information',
      custom_ceding: 'Custom Ceding Schema',
      ess: 'Employer-Sponsored Scheme (ESS)',
      cyc: 'CYC',
      illustration: 'Illustration',
    };

    // Ensure custom_ceding is always available (even if file doesn't exist yet)
    const allSchemas = schemas.includes('custom_ceding')
      ? schemas
      : [...schemas];

    // Build options with custom_ceding after ceding
    let options = '';
    const orderedSchemas = [
      'cfr',
      'ceding',
      'custom_ceding',
      'ess',
      'cyc',
      'illustration',
    ];

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
  const endpoint =
    type === 'contributions'
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
  previewContainer: document.getElementById('schemaPreviewContainer'),
  totalSectionsCount: document.getElementById('totalSectionsCount'),
  totalFieldsCount: document.getElementById('totalFieldsCount'),
  customFieldsBadge: document.getElementById('customFieldsBadge'),
  successNotice: document.getElementById('schemaSuccessNotice'),
  readyIndicator: document.getElementById('schemaReadyIndicator'),
  targetSection: document.getElementById('targetSection'),
  newFieldName: document.getElementById('newFieldName'),
  newFieldType: document.getElementById('newFieldType'),
  newFieldDescription: document.getElementById('newFieldDescription'),
  addFieldBtn: document.getElementById('addFieldBtn'),
  saveSchemaBtn: document.getElementById('saveCustomSchemaBtn'),
  statusSpan: document.getElementById('customSchemaStatus'),
  step1: document.getElementById('step1'),
  step2: document.getElementById('step2'),
  step3: document.getElementById('step3'),
  // Table columns builder elements
  tableColumnsBuilder: document.getElementById('tableColumnsBuilder'),
  tableColumnsContainer: document.getElementById('tableColumnsContainer'),
  addColumnBtn: document.getElementById('addColumnBtn'),
};

// Store custom fields and schema sections
let customFields = [];
let cedingSchemaSections = [];
let schemaSaved = false;

// Toggle custom ceding section visibility based on schema selection
elements.schemaSelect.addEventListener('change', (e) => {
  const isCustomCeding = e.target.value === 'custom_ceding';

  if (customCedingElements.section) {
    customCedingElements.section.style.display = isCustomCeding
      ? 'block'
      : 'none';
  }

  // Load schema sections and existing custom fields if switching to custom_ceding
  if (isCustomCeding) {
    loadCedingSchemaSections();
    loadExistingCustomFields();
  }

  // Show/hide PDF button based on schema
  if (elements.generatePdfBtn) {
    const showPdf =
      (e.target.value === 'ceding' || e.target.value === 'custom_ceding') &&
      lastExtractionOutput;
    elements.generatePdfBtn.style.display = showPdf ? 'flex' : 'none';
  }
});

// Add field button handler
if (customCedingElements.addFieldBtn) {
  customCedingElements.addFieldBtn.addEventListener('click', addCustomField);
}

// Save schema button handler
if (customCedingElements.saveSchemaBtn) {
  customCedingElements.saveSchemaBtn.addEventListener(
    'click',
    saveCustomSchema,
  );
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

// Table columns state
let tableColumns = [];

// Toggle table columns builder based on field type selection
if (customCedingElements.newFieldType) {
  customCedingElements.newFieldType.addEventListener('change', (e) => {
    const isTable = e.target.value === 'table';
    if (customCedingElements.tableColumnsBuilder) {
      customCedingElements.tableColumnsBuilder.style.display = isTable
        ? 'block'
        : 'none';
    }
    // Initialize with one empty column when switching to table type
    if (isTable && tableColumns.length === 0) {
      addTableColumn();
    }
  });
}

// Add column button handler
if (customCedingElements.addColumnBtn) {
  customCedingElements.addColumnBtn.addEventListener('click', addTableColumn);
}

/**
 * Add a new table column row
 */
function addTableColumn() {
  const columnId = 'col_' + Date.now();
  tableColumns.push({
    id: columnId,
    name: '',
    type: 'string',
    description: '',
  });
  renderTableColumns();
}
window.addTableColumn = addTableColumn;

/**
 * Remove a table column row
 */
function removeTableColumn(columnId) {
  tableColumns = tableColumns.filter((col) => col.id !== columnId);
  renderTableColumns();
}
window.removeTableColumn = removeTableColumn;

/**
 * Render table columns UI
 */
function renderTableColumns() {
  if (!customCedingElements.tableColumnsContainer) return;

  if (tableColumns.length === 0) {
    customCedingElements.tableColumnsContainer.innerHTML = `
            <div class="columns-empty">No columns defined. Add at least one column for the table.</div>
        `;
    return;
  }

  customCedingElements.tableColumnsContainer.innerHTML = tableColumns
    .map(
      (col, index) => `
        <div class="column-row" data-column-id="${col.id}">
            <div class="input-group column-name">
                <label class="input-label">Column ${index + 1} Name</label>
                <input type="text" class="form-input column-name-input" 
                       value="${col.name}" 
                       placeholder="e.g., fundName" 
                       onchange="updateTableColumn('${col.id}', 'name', this.value)">
            </div>
            <div class="input-group">
                <label class="input-label">Type</label>
                <select class="form-select" onchange="updateTableColumn('${col.id}', 'type', this.value)">
                    <option value="string" ${col.type === 'string' ? 'selected' : ''}>Text</option>
                </select>
            </div>
            <div class="input-group column-desc">
                <label class="input-label">Description</label>
                <input type="text" class="form-input column-desc-input" 
                       value="${col.description}" 
                       placeholder="e.g., Name of the fund" 
                       onchange="updateTableColumn('${col.id}', 'description', this.value)">
            </div>
            <button type="button" class="column-remove-btn" onclick="removeTableColumn('${col.id}')" title="Remove column">✕</button>
        </div>
    `,
    )
    .join('');
}

/**
 * Update a table column value
 */
function updateTableColumn(columnId, field, value) {
  const col = tableColumns.find((c) => c.id === columnId);
  if (col) {
    col[field] = value;
  }
}
window.updateTableColumn = updateTableColumn;

/**
 * Clear table columns (called after adding a field)
 */
function clearTableColumns() {
  tableColumns = [];
  renderTableColumns();
  if (customCedingElements.tableColumnsBuilder) {
    customCedingElements.tableColumnsBuilder.style.display = 'none';
  }
  if (customCedingElements.newFieldType) {
    customCedingElements.newFieldType.value = 'string';
  }
}

/**
 * Load ceding schema sections from API
 */
async function loadCedingSchemaSections() {
  try {
    const response = await fetch('/api/schemas/ceding/fields');
    const data = await response.json();

    if (data.sections && data.sections.length > 0) {
      cedingSchemaSections = data.sections;
      renderSchemaPreview();
      populateSectionDropdown();
      updateWorkflowStep(1);
    } else {
      if (customCedingElements.previewContainer) {
        customCedingElements.previewContainer.innerHTML = `
                    <div class="empty-fields-message">
                        <span class="empty-icon">⚠️</span>
                        Failed to load schema sections
                    </div>
                `;
      }
    }
  } catch (err) {
    console.error('Failed to load ceding schema sections:', err);
    if (customCedingElements.previewContainer) {
      customCedingElements.previewContainer.innerHTML = `
                <div class="empty-fields-message">
                    <span class="empty-icon">❌</span>
                    Error loading schema
                </div>
            `;
    }
  }
}

/**
 * Render schema preview with custom fields highlighted
 */
function renderSchemaPreview() {
  if (!customCedingElements.previewContainer) return;

  const formatSectionName = (name) => {
    return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // Calculate totals
  let totalBaseFields = cedingSchemaSections.reduce(
    (sum, s) => sum + s.fields.length,
    0,
  );
  let totalCustomFields = customFields.length;

  // Update badges
  if (customCedingElements.totalSectionsCount) {
    customCedingElements.totalSectionsCount.textContent = `${cedingSchemaSections.length} sections`;
  }
  if (customCedingElements.totalFieldsCount) {
    customCedingElements.totalFieldsCount.textContent = `${totalBaseFields + totalCustomFields} fields`;
  }
  if (customCedingElements.customFieldsBadge) {
    if (totalCustomFields > 0) {
      customCedingElements.customFieldsBadge.textContent = `+${totalCustomFields} custom`;
      customCedingElements.customFieldsBadge.style.display = 'inline-block';
    } else {
      customCedingElements.customFieldsBadge.style.display = 'none';
    }
  }

  // Build HTML for each section
  customCedingElements.previewContainer.innerHTML = cedingSchemaSections
    .map((section, sIndex) => {
      // Get custom fields for this section
      const sectionCustomFields = customFields.filter(
        (f) => f.section === section.name,
      );
      const hasCustom = sectionCustomFields.length > 0;

      return `
            <div class="preview-section ${hasCustom ? 'has-custom' : ''}" data-section="${section.name}">
                <div class="preview-section-header" onclick="togglePreviewSection(${sIndex})">
                    <span class="section-toggle">▶</span>
                    <span class="section-name">${formatSectionName(section.name)}</span>
                    <div class="section-badges">
                        <span class="section-field-count">${section.fields.length + sectionCustomFields.length} fields</span>
                        ${hasCustom ? `<span class="section-custom-count">+${sectionCustomFields.length} new</span>` : ''}
                    </div>
                </div>
                <div class="section-fields" id="preview-fields-${sIndex}">
                    ${section.fields
                      .map(
                        (field) => `
                        <div class="preview-field">
                            <span class="field-icon">•</span>
                            <span class="field-label">${field.name}</span>
                            <span class="field-type">${field.type}</span>
                        </div>
                    `,
                      )
                      .join('')}
                    ${sectionCustomFields
                      .map((field, fIndex) => {
                        const columnsInfo =
                          field.columns && field.columns.length > 0
                            ? `<span class="field-columns">(${field.columns.length} cols: ${field.columns.map((c) => c.displayName || c.name).join(', ')})</span>`
                            : '';
                        return `
                        <div class="preview-field custom-field">
                            <span class="field-icon">★</span>
                            <span class="field-label">${field.displayName || field.name}</span>
                            <span class="field-type">${field.type}</span>
                            ${columnsInfo}
                            <span class="new-badge">NEW</span>
                            <button type="button" class="remove-btn" onclick="removeCustomFieldFromPreview('${field.name}', '${section.name}')" title="Remove field">✕</button>
                        </div>
                        `;
                      })
                      .join('')}
                </div>
            </div>
        `;
    })
    .join('');
}

/**
 * Toggle preview section expansion
 */
function togglePreviewSection(index) {
  const sections = document.querySelectorAll('.preview-section');
  if (sections[index]) {
    const header = sections[index].querySelector('.preview-section-header');
    const fields = sections[index].querySelector('.section-fields');

    if (header && fields) {
      header.classList.toggle('expanded');
      fields.classList.toggle('expanded');
    }
  }
}
window.togglePreviewSection = togglePreviewSection;

/**
 * Remove custom field from preview
 */
function removeCustomFieldFromPreview(fieldName, sectionName) {
  const index = customFields.findIndex(
    (f) => f.name === fieldName && f.section === sectionName,
  );
  if (index !== -1) {
    const removed = customFields.splice(index, 1)[0];
    renderSchemaPreview();
    updateSaveButtonState();
    updateWorkflowStep(customFields.length > 0 ? 1 : 1);
    hideSchemaSavedState();
    setSchemaStatus('', `Removed "${removed.displayName || removed.name}"`);
  }
}
window.removeCustomFieldFromPreview = removeCustomFieldFromPreview;

/**
 * Populate section dropdown for target selection
 */
function populateSectionDropdown() {
  if (!customCedingElements.targetSection) return;

  const formatSectionName = (name) => {
    return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  customCedingElements.targetSection.innerHTML = `
        <option value="">-- Select Section --</option>
        ${cedingSchemaSections
          .map(
            (section) => `
            <option value="${section.name}">${formatSectionName(section.name)} (${section.fields.length} fields)</option>
        `,
          )
          .join('')}
    `;
}

/**
 * Add a custom field
 */
function addCustomField() {
  const section = customCedingElements.targetSection?.value;
  const name = customCedingElements.newFieldName?.value.trim();
  const type = customCedingElements.newFieldType?.value || 'string';
  const description = customCedingElements.newFieldDescription?.value.trim();

  // Validation
  if (!section) {
    setSchemaStatus('error', 'Please select a target section');
    customCedingElements.targetSection?.focus();
    return;
  }

  if (!name) {
    setSchemaStatus('error', 'Please enter a field name');
    customCedingElements.newFieldName?.focus();
    return;
  }

  // For table type, validate columns
  if (type === 'table') {
    // Collect current column values from DOM (in case user hasn't triggered onchange)
    const columnRows = document.querySelectorAll('.column-row');
    columnRows.forEach((row) => {
      const colId = row.dataset.columnId;
      const col = tableColumns.find((c) => c.id === colId);
      if (col) {
        const nameInput = row.querySelector('.column-name-input');
        const descInput = row.querySelector('.column-desc-input');
        if (nameInput) col.name = nameInput.value.trim();
        if (descInput) col.description = descInput.value.trim();
      }
    });

    // Filter out empty columns
    const validColumns = tableColumns.filter((col) => col.name.trim() !== '');

    if (validColumns.length === 0) {
      setSchemaStatus(
        'error',
        'Please define at least one column for the table',
      );
      return;
    }

    // Validate column names
    for (const col of validColumns) {
      if (!col.name || col.name.trim() === '') {
        setSchemaStatus('error', 'Each column must have a name');
        return;
      }
    }

    // Update tableColumns to only include valid ones
    tableColumns = validColumns;
  }

  // Sanitize name
  const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');

  // Check for duplicate
  if (
    customFields.some((f) => f.name === sanitizedName && f.section === section)
  ) {
    setSchemaStatus('error', `Field "${name}" already exists in this section`);
    return;
  }

  // Build field object
  const fieldObj = {
    name: sanitizedName,
    type,
    description: description || name,
    displayName: name,
    section,
  };

  // Add columns for table type
  if (type === 'table') {
    fieldObj.columns = tableColumns.map((col) => ({
      name: col.name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      displayName: col.name,
      type: col.type || 'string',
      description: col.description || col.name,
    }));
  }

  // Add to array
  customFields.push(fieldObj);

  // Clear inputs
  customCedingElements.newFieldName.value = '';
  customCedingElements.newFieldDescription.value = '';
  customCedingElements.newFieldName.focus();

  // Clear table columns if it was a table type
  if (type === 'table') {
    clearTableColumns();
  }

  // Re-render and update UI
  renderSchemaPreview();
  updateSaveButtonState();
  updateWorkflowStep(1);
  hideSchemaSavedState();

  // Auto-expand the section where field was added
  const sectionIndex = cedingSchemaSections.findIndex(
    (s) => s.name === section,
  );
  if (sectionIndex !== -1) {
    const sectionEl = document.querySelector(
      `.preview-section[data-section="${section}"]`,
    );
    if (sectionEl) {
      const header = sectionEl.querySelector('.preview-section-header');
      const fields = sectionEl.querySelector('.section-fields');
      if (header && fields && !fields.classList.contains('expanded')) {
        header.classList.add('expanded');
        fields.classList.add('expanded');
      }
    }
  }

  const sectionName = section.replace(/_/g, ' ');
  const columnCount = fieldObj.columns
    ? ` (${fieldObj.columns.length} columns)`
    : '';
  setSchemaStatus(
    'success',
    `✓ Added "${name}"${columnCount} to ${sectionName}`,
  );
}

/**
 * Update workflow step indicators
 */
function updateWorkflowStep(step) {
  const steps = [
    customCedingElements.step1,
    customCedingElements.step2,
    customCedingElements.step3,
  ];

  steps.forEach((stepEl, index) => {
    if (stepEl) {
      stepEl.classList.remove('active', 'completed');

      if (index + 1 < step) {
        stepEl.classList.add('completed');
      } else if (index + 1 === step) {
        stepEl.classList.add('active');
      }
    }
  });
}

/**
 * Hide schema saved state (when making changes after save)
 */
function hideSchemaSavedState() {
  schemaSaved = false;
  if (customCedingElements.successNotice) {
    customCedingElements.successNotice.style.display = 'none';
  }
  if (customCedingElements.readyIndicator) {
    customCedingElements.readyIndicator.style.display = 'none';
  }
}

/**
 * Update save button state
 */
function updateSaveButtonState() {
  if (customCedingElements.saveSchemaBtn) {
    customCedingElements.saveSchemaBtn.disabled = customFields.length === 0;
  }
}

/**
 * Save custom schema to backend
 */
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
        customFields: customFields.map((f) => ({
          name: f.name,
          type: f.type,
          description: f.description,
          section: f.section,
          columns: f.columns || undefined, // Include columns for table types
        })),
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || 'Failed to save schema');
    }

    // Show success state
    schemaSaved = true;
    updateWorkflowStep(3);

    // Show success notice
    if (customCedingElements.successNotice) {
      customCedingElements.successNotice.style.display = 'flex';
    }

    // Show ready indicator
    if (customCedingElements.readyIndicator) {
      customCedingElements.readyIndicator.style.display = 'block';
    }

    setSchemaStatus(
      'success',
      `✓ Schema saved with ${result.fieldsAdded} custom field(s)`,
    );
  } catch (err) {
    console.error('Save schema error:', err);
    setSchemaStatus('error', `✕ ${err.message}`);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = customFields.length === 0;
  }
}

/**
 * Load existing custom fields from backend
 */
async function loadExistingCustomFields() {
  try {
    const response = await fetch('/api/schemas/custom-ceding/fields');
    const data = await response.json();

    if (data.exists && data.fields && data.fields.length > 0) {
      customFields = data.fields.map((f) => ({
        name: f.name,
        type: f.type,
        description: f.description,
        displayName: f.name.replace(/_/g, ' '),
        section: f.section || 'custom_fields',
        columns: f.columns || undefined, // Preserve column definitions for table types
      }));
      renderSchemaPreview();
      updateSaveButtonState();

      // If existing fields were loaded, show as saved state
      schemaSaved = true;
      updateWorkflowStep(3);
      if (customCedingElements.successNotice) {
        customCedingElements.successNotice.style.display = 'flex';
      }
      if (customCedingElements.readyIndicator) {
        customCedingElements.readyIndicator.style.display = 'block';
      }

      setSchemaStatus(
        '',
        `Loaded ${customFields.length} existing custom field(s)`,
      );
    } else {
      customFields = [];
      renderSchemaPreview();
      updateSaveButtonState();
    }
  } catch (err) {
    console.error('Failed to load custom fields:', err);
    customFields = [];
    renderSchemaPreview();
    updateSaveButtonState();
  }
}

/**
 * Set schema status message
 */
function setSchemaStatus(type, message) {
  if (customCedingElements.statusSpan) {
    customCedingElements.statusSpan.textContent = message;
    customCedingElements.statusSpan.className =
      'schema-status' + (type ? ` ${type}` : '');

    // Auto-clear success messages after 3 seconds
    if (type === 'success' || !type) {
      setTimeout(() => {
        if (customCedingElements.statusSpan.textContent === message) {
          customCedingElements.statusSpan.textContent = '';
        }
      }, 5000);
    }
  }
}

// ============================================
// Initialize
// ============================================
loadSchemas();
updateFileCount();
renderSchemaPreview();
