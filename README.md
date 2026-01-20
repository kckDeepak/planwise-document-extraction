# Planwise Document Extraction

A NestJS-based document extraction tool that uses AI-powered APIs (Reducto AI & DataLab) to extract structured data from financial documents like PDFs, Word docs, Excel files, and images.

## Features

- 🔍 **AI-Powered Extraction** - Uses Reducto AI and DataLab APIs for intelligent document parsing
- 📋 **Schema-Based Extraction** - Define what to extract using JSON schemas (CFR, Ceding, ESS, etc.)
- ✏️ **Custom Schema Builder** - Add your own custom fields to extend existing schemas
- 📤 **Multi-File Upload** - Upload multiple documents with drag-and-drop support
- ⚡ **Real-Time Progress** - Server-Sent Events (SSE) for live extraction updates
- 📄 **PDF Generation** - Generate ceding note PDFs from extracted data
- 📊 **CSV Export** - Export contributions and fund data to CSV
- 🎨 **Modern UI** - Dark theme with glassmorphism styling

---

## Project Structure

```
├── src/                          # Backend source code (NestJS)
│   ├── main.ts                   # Application entry point
│   ├── app.module.ts             # Root module - imports all feature modules
│   │
│   ├── extract/                  # Core extraction module
│   │   ├── extract.module.ts     # Module definition
│   │   ├── extract.controller.ts # POST /api/extract endpoint (SSE)
│   │   ├── extract.service.ts    # Reducto AI extraction service
│   │   ├── datalab-extract.service.ts  # DataLab extraction service
│   │   ├── file-processor.service.ts   # File preprocessing (MSG→HTML)
│   │   ├── output-transformer.ts # Transforms results to production format
│   │   └── dto/
│   │       └── extract.dto.ts    # Request validation & allowed schemas
│   │
│   ├── schema/                   # Schema management module
│   │   ├── schema.module.ts      # Module definition
│   │   ├── schema.controller.ts  # Schema API endpoints
│   │   └── schema.service.ts     # Load/save schemas, custom schema builder
│   │
│   ├── export/                   # CSV export module
│   │   ├── export.module.ts      # Module definition
│   │   ├── export.controller.ts  # GET /api/export/* endpoints
│   │   └── export.service.ts     # CSV generation logic
│   │
│   ├── pdf/                      # PDF generation module
│   │   ├── pdf.module.ts         # Module definition
│   │   ├── pdf.controller.ts     # POST /api/pdf/* endpoints
│   │   ├── ceding-pdf-generator.service.ts  # PDF creation with pdf-lib
│   │   └── ceding-pdf-mapper.service.ts     # Map extraction to PDF format
│   │
│   ├── filters/                  # Exception filters
│   │   └── file-size-exception.filter.ts    # Handle file size errors
│   │
│   └── types/                    # TypeScript type definitions
│       └── reducto.types.ts      # Reducto API response types
│
├── schemas/                      # JSON extraction schemas
│   ├── cfr.json                  # Client Financial Review schema
│   ├── cfr.prompt.md             # CFR-specific AI prompt
│   ├── ceding.json               # Ceding scheme information schema
│   ├── ceding.prompt.md          # Ceding-specific AI prompt
│   ├── ess.json                  # Employer-Sponsored Scheme schema
│   ├── cyc.json                  # CYC extraction schema
│   ├── illustration.json         # Financial illustration schema
│   └── custom_ceding.json        # User-created custom schema (auto-generated)
│
├── public/                       # Frontend static files
│   ├── index.html                # Main HTML page
│   ├── css/
│   │   └── styles.css            # All CSS styling (dark theme, glassmorphism)
│   └── js/
│       └── app.js                # Frontend JavaScript (file upload, SSE, custom schema)
│
├── output/                       # Extraction output files (auto-created)
│   └── [schema]/                 # Organized by schema type
│       └── [timestamp].json      # Timestamped extraction results
│
├── .env                          # Environment variables (API keys, port)
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript configuration
└── nest-cli.json                 # NestJS CLI configuration
```

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file in the project root:

```env
# API Keys
REDUCTO_API_KEY=your_reducto_api_key
DATALAB_API_KEY=your_datalab_api_key

# Server
PORT=3000
NODE_ENV=development

# Optional: CORS origins for production
ALLOWED_ORIGINS=https://yourdomain.com
```

### 3. Run Development Server

```bash
npm run start:dev
```

### 4. Open in Browser

Navigate to `http://localhost:3000`

---

## API Endpoints

### Extraction

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/extract?model=datalab` | Extract data from uploaded files (SSE) |

**Request:**
- Content-Type: `multipart/form-data`
- Body: `files` (multiple), `schema` (cfr/ceding/ess/custom_ceding)
- Query: `model` (reducto/datalab)

### Schemas

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/schemas` | List available schemas |
| `GET` | `/api/schemas/ceding/fields` | Get all ceding schema fields |
| `GET` | `/api/schemas/custom-ceding/fields` | Get custom schema fields |
| `POST` | `/api/schemas/custom-ceding` | Save custom ceding schema |

### Export

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/export/contributions?schema=ess` | Export contributions as CSV |
| `GET` | `/api/export/funds?schema=ess` | Export fund holdings as CSV |

### PDF Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/pdf/generate` | Generate PDF from extraction JSON |
| `GET` | `/api/pdf/generate-from-file/:filename` | Generate PDF from saved output |
| `GET` | `/api/pdf/list-files` | List available ceding output files |

---

## Supported File Types

| Type | Extensions |
|------|------------|
| PDF | `.pdf` |
| Word | `.docx`, `.doc` |
| Excel | `.xlsx`, `.xlsm`, `.xls` |
| CSV | `.csv` |
| HTML | `.html`, `.htm` |
| Images | `.jpeg`, `.jpg`, `.png`, `.gif`, `.tiff` |
| Outlook | `.msg` (converted to HTML) |

---

## Custom Schema Feature

The custom schema builder allows you to extend the ceding schema with your own fields:

1. Select **"Custom Ceding Schema"** from the dropdown
2. Add custom fields with:
   - **Field Name** - Unique identifier (e.g., `special_bonus`)
   - **Type** - Text, Number, Table, or Yes/No
   - **Description** - What to extract (used as AI prompt)
3. Click **"Save Custom Schema"**
4. Upload documents and extract

Custom fields appear in the output under `custom_fields` section.

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build the application |
| `npm run start` | Start in production mode |
| `npm run start:dev` | Start with hot reload (development) |
| `npm run start:debug` | Start in debug mode |
| `npm run lint` | Run ESLint |

---

## Technology Stack

- **Backend**: NestJS 10.x with TypeScript
- **File Upload**: Multer (memory storage)
- **AI Extraction**: Reducto AI SDK, DataLab API
- **PDF Generation**: pdf-lib
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Styling**: Custom CSS with CSS variables, glassmorphism effects

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `REDUCTO_API_KEY` | Yes* | Reducto AI API key |
| `DATALAB_API_KEY` | Yes* | DataLab API key |
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Environment (development/production) |
| `ALLOWED_ORIGINS` | No | CORS origins for production |
| `FUND_CHARGES_FILE_PATTERNS` | No | Comma-separated patterns for fund charge files |

*At least one API key is required depending on which model you use.

---

## License

Private
