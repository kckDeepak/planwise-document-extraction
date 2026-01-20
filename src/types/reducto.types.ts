// Reducto SDK Type Definitions
// Note: These types supplement the SDK's incomplete type definitions

export interface ReductoUploadResponse {
    file_id: string;
    presigned_url?: string;
}

export interface ReductoParseResponse {
    job_id: string;
    status: string;
}

export interface ReductoExtractResponse {
    result: any[];
    status: string;
}

export interface ReductoCitation {
    content?: string;
    bbox?: {
        page: number;
        x: number;
        y: number;
        width: number;
        height: number;
    };
    confidence?: string | number;
    granular_confidence?: {
        extract_confidence?: number;
        confidence?: number;
    };
}

export interface ReductoFieldWithCitation {
    value: any;
    citations?: ReductoCitation[];
}
