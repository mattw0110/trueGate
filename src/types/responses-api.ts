// OpenAI Responses API (newer endpoint used by Codex CLI).
// Reference: POST /v1/responses
// We only model the fields trueGate needs to read or modify.

export interface ResponsesInputContentPart {
  type: 'input_text' | 'input_image' | 'output_text' | 'refusal' | string;
  text?: string;
  [k: string]: unknown;
}

export interface ResponsesInputMessage {
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: string | ResponsesInputContentPart[];
}

export interface ResponsesRequest {
  model: string;
  input?: string | ResponsesInputMessage[];
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  stream?: boolean;
  [key: string]: unknown;
}

export interface ResponsesOutputContent {
  type: 'output_text' | string;
  text?: string;
  [k: string]: unknown;
}

export interface ResponsesOutputItem {
  type: 'message' | string;
  role?: 'assistant' | string;
  content?: ResponsesOutputContent[];
  [k: string]: unknown;
}

export interface ResponsesResponse {
  id: string;
  object: 'response';
  created_at: number;
  model: string;
  output: ResponsesOutputItem[];
  output_text?: string;
  status?: string;
  [k: string]: unknown;
}
