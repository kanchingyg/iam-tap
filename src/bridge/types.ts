export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  annotations?: McpToolAnnotations;
  mutates?: boolean;
};
export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}
export type JsonRecord = Record<string, unknown>;
export type McpHandler = (args: Record<string, unknown>) => Promise<unknown>;
export type McpServerOpts = {
  repoRoot?: string;
  tools?: McpToolDef[];
  handlers?: Record<string, McpHandler>;
  pathToWsl?: boolean;
  nCtx?: number;
};
export type JsonSchemaProp = { type?: string };
export type JsonSchemaLike = { properties?: Record<string, JsonSchemaProp> };
export type FetchLike = typeof fetch;
export type ToolSig = { name: string; summary: string };
export type ChatOrRawOptions = { forceRaw?: boolean; fetchImpl?: FetchLike };
export type ChatMessage = {
  role: string;
  content?: string;
  reasoning_content?: string;
  tool_calls?: unknown[];
};
export type ReasoningState = { inToolLoop: boolean; lastUserTurnIndex: number };
export type ParsedToolCall = { name: string; arguments: Record<string, unknown> };
export type FinalizeMcpOpts = { nCtx?: number; toWsl?: boolean };
export type EmbedLock = { provider: string; model: string; dimension: number };
export type EmbedUpstream = {
  name: string;
  maxBatch: number;
  embed: (input: string[], model: string, dimensions?: number) => Promise<number[][]>;
};
export type NormalizeEmbedBatchOptions = {
  dimensions?: number;
  upstream: EmbedUpstream;
  model: string;
  lock?: EmbedLock | null;
};
export type EmbedServerOpts = {
  repoRoot: string;
  upstream: EmbedUpstream;
  defaultModel: string;
  port: number;
};
export type DashScopeUpstreamOpts = { apiKey?: string };
export type LlmProvider =
  | "deepseek"
  | "dashscope"
  | "moonshot"
  | "zhipu"
  | "minimax"
  | "siliconflow"
  | "doubao"
  | "stepfun"
  | "yi"
  | "ollama"
  | "anthropic"
  | "openai"
  | "generic";
export type ToolChoice =
  | string
  | { type?: string; function?: { name?: string } }
  | null
  | undefined;
export type ReadableStreamLike = {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
  };
};

export function jsonRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}
