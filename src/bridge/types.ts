/** Configuration and data shape for `McpToolDef` (mcp tool def). */
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
/** Configuration and data shape for `McpToolAnnotations` (mcp tool annotations). */
export interface McpToolAnnotations {
  /** Exported member in `iam-tap`. */
  readOnlyHint?: boolean;
  /** Exported member in `iam-tap`. */
  destructiveHint?: boolean;
  /** Exported member in `iam-tap`. */
  idempotentHint?: boolean;
  /** Exported member in `iam-tap`. */
  openWorldHint?: boolean;
}
/** Configuration and data shape for `JsonRecord` (json record). */
export type JsonRecord = Record<string, unknown>;
/** Configuration and data shape for `McpHandler` (mcp handler). */
export type McpHandler = (args: Record<string, unknown>) => Promise<unknown>;
/** Configuration and data shape for `McpServerOpts` (mcp server opts). */
export type McpServerOpts = {
  repoRoot?: string;
  tools?: McpToolDef[];
  handlers?: Record<string, McpHandler>;
  pathToWsl?: boolean;
  nCtx?: number;
};
/** Configuration and data shape for `JsonSchemaProp` (json schema prop). */
export type JsonSchemaProp = { type?: string };
/** Configuration and data shape for `JsonSchemaLike` (json schema like). */
export type JsonSchemaLike = { properties?: Record<string, JsonSchemaProp> };
/** Configuration and data shape for `FetchLike` (fetch like). */
export type FetchLike = typeof fetch;
/** Configuration and data shape for `ToolSig` (tool sig). */
export type ToolSig = { name: string; summary: string };
/** Configuration and data shape for `ChatOrRawOptions` (chat or raw options). */
export type ChatOrRawOptions = { forceRaw?: boolean; fetchImpl?: FetchLike };
/** Configuration and data shape for `ChatMessage` (chat message). */
export type ChatMessage = {
  role: string;
  content?: string;
  reasoning_content?: string;
  tool_calls?: unknown[];
};
/** Configuration and data shape for `ReasoningState` (reasoning state). */
export type ReasoningState = { inToolLoop: boolean; lastUserTurnIndex: number };
/** Configuration and data shape for `ParsedToolCall` (parsed tool call). */
export type ParsedToolCall = { name: string; arguments: Record<string, unknown> };
/** Configuration and data shape for `FinalizeMcpOpts` (finalize mcp opts). */
export type FinalizeMcpOpts = { nCtx?: number; toWsl?: boolean };
/** Configuration and data shape for `EmbedLock` (embed lock). */
export type EmbedLock = { provider: string; model: string; dimension: number };
/** Configuration and data shape for `EmbedUpstream` (embed upstream). */
export type EmbedUpstream = {
  name: string;
  maxBatch: number;
  embed: (input: string[], model: string, dimensions?: number) => Promise<number[][]>;
};
/** Configuration and data shape for `NormalizeEmbedBatchOptions` (normalize embed batch options). */
export type NormalizeEmbedBatchOptions = {
  dimensions?: number;
  upstream: EmbedUpstream;
  model: string;
  lock?: EmbedLock | null;
};
/** Configuration and data shape for `EmbedServerOpts` (embed server opts). */
export type EmbedServerOpts = {
  repoRoot: string;
  upstream: EmbedUpstream;
  defaultModel: string;
  port: number;
};
/** Configuration and data shape for `DashScopeUpstreamOpts` (dash scope upstream opts). */
export type DashScopeUpstreamOpts = { apiKey?: string };
/** Configuration and data shape for `LlmProvider` (llm provider). */
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
/** Configuration and data shape for `ToolChoice` (tool choice). */
export type ToolChoice =
  | string
  | { type?: string; function?: { name?: string } }
  | null
  | undefined;
/** Configuration and data shape for `ReadableStreamLike` (readable stream like). */
export type ReadableStreamLike = {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
  };
};

/** Executes `jsonRecord` to json record in `iam-tap`. */
export function jsonRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}
