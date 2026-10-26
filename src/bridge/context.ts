import { jsonRecord, type ChatOrRawOptions, type FetchLike, type ToolSig } from "./types.js";

/** Constant `DEFAULT_N_CTX` defining default n ctx. */
export const DEFAULT_N_CTX = 4096;
/** Constant `TRUNCATION_MARKER` defining truncation marker. */
export const TRUNCATION_MARKER = "[...TRUNCATED BY IAM-TAP CONTEXT GUARD...]";
const IM_END = "<|" + "redacted_im_end" + "|>";
/** Constant `MULTI_FAMILY_STOP_SEQUENCES` defining multi family stop sequences. */
export const MULTI_FAMILY_STOP_SEQUENCES: string[] = [
    "</tool_call>",
    "</tool_calls>",
    IM_END,
    "<|eot_id|>",
    "<|end|>",
    "<|observation|>",
    "<|tool_calls_section_end|>",
    "<｜tool▁calls▁end｜>",
    "\n✿RESULT✿",
    "\nOBS:",
    "\nObservation:",
    "\nUSER:",
    "\nHuman:",
];
/** Executes `probeNCtx` to probe nctx in `iam-tap`. */
export async function probeNCtx(baseUrl: string, fetchImpl: FetchLike = fetch): Promise<{ nCtx: number; source: string }> {
    const base = baseUrl.replace(/\/$/, "");
    try {
        const props = await fetchImpl(`${base}/props`);
        if (props.ok) {
            const j = jsonRecord(await props.json());
            if (j) {
                const settings = jsonRecord(j.default_generation_settings);
                const n = j.n_ctx ?? settings?.n_ctx;
                if (typeof n === "number" && n > 0) {
                    return { nCtx: n, source: "llama.cpp" };
                }
            }
        }
    }
    catch {
        /* empty */
    }
    try {
        const show = await fetchImpl(`${base}/api/show`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "dummy" }),
        });
        if (show.ok) {
            const j = jsonRecord(await show.json());
            const info = jsonRecord(j?.model_info) ?? {};
            for (const [k, v] of Object.entries(info)) {
                if (k.includes("context_length") && typeof v === "number" && v > 0) {
                    return { nCtx: v, source: "ollama" };
                }
            }
        }
    }
    catch {
        /* empty */
    }
    try {
        const models = await fetchImpl(`${base}/v1/models`);
        if (models.ok) {
            const j = jsonRecord(await models.json());
            const data = Array.isArray(j?.data) ? j.data : [];
            const first = jsonRecord(data[0]);
            const maxLen = first?.max_model_len;
            if (typeof maxLen === "number" && maxLen > 0) {
                return { nCtx: maxLen, source: "vllm" };
            }
        }
    }
    catch {
        /* empty */
    }
    return { nCtx: DEFAULT_N_CTX, source: "fallback" };
}
/** Executes `headTailTruncate` to head tail truncate in `iam-tap`. */
export function headTailTruncate(text: string, maxChars: number): string {
    if (text.length <= maxChars)
        return text;
    const headLen = Math.floor(maxChars * 0.6);
    const tailLen = Math.floor(maxChars * 0.4) - TRUNCATION_MARKER.length;
    if (tailLen < 0)
        return text.slice(0, maxChars);
    return text.slice(0, headLen) + TRUNCATION_MARKER + text.slice(-tailLen);
}
/** Executes `toolOutputBudgetChars` to tool output budget chars in `iam-tap`. */
export function toolOutputBudgetChars(nCtx: number, charsPerToken: number = 4): number {
    return Math.floor(nCtx * charsPerToken * 0.3);
}
/** Executes `truncateToolOutput` to truncate tool output in `iam-tap`. */
export function truncateToolOutput(text: string, nCtx: number): string {
    return headTailTruncate(text, toolOutputBudgetChars(nCtx));
}
/** Executes `buildRecencyAnchor` to build recency anchor in `iam-tap`. */
export function buildRecencyAnchor(sigs: ToolSig[]): string {
    const lines = sigs.map((s) => `- ${s.name}: ${s.summary}`);
    return [
        "[AVAILABLE TOOLS — ANCHORED FOR RECENCY]",
        ...lines,
        'To call a tool, output ONLY: <tool_call>{"name": "TOOL_NAME", "arguments": {...}}</tool_call>',
    ].join("\n");
}
/** Executes `anchorPromptTail` to anchor prompt tail in `iam-tap`. */
export function anchorPromptTail(prompt: string, anchor: string): string {
    const marker = "\nASSISTANT:";
    const idx = prompt.lastIndexOf(marker);
    if (idx === -1) {
        return `${prompt}\n\n${anchor}\n${marker}`;
    }
    const before = prompt.slice(0, idx);
    const after = prompt.slice(idx);
    return `${before}\n\n${anchor}\n${after}`;
}
/** Executes `pickRawCompletionEndpoint` to pick raw completion endpoint in `iam-tap`. */
export function pickRawCompletionEndpoint(baseUrl: string, prefer: string | undefined): string {
    if (prefer)
        return prefer;
    if (baseUrl.includes("11434") || baseUrl.includes("ollama")) {
        return "/v1/completions";
    }
    return "/v1/completions";
}
/** Executes `chatOrRawFallback` to chat or raw fallback in `iam-tap`. */
export async function chatOrRawFallback(
    baseUrl: string,
    chatPath: string,
    rawPath: string,
    options: ChatOrRawOptions,
): Promise<{ mode: string; path: string }> {
    if (options.forceRaw) {
        return { mode: "raw", path: rawPath };
    }
    const fetchImpl = options.fetchImpl ?? fetch;
    try {
        const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${chatPath}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "probe", messages: [] }),
        });
        if (res.status === 400 || res.status === 404 || res.status === 501) {
            return { mode: "raw", path: rawPath };
        }
    }
    catch {
        return { mode: "raw", path: rawPath };
    }
    return { mode: "chat", path: chatPath };
}
/** Executes `injectStopSequences` to inject stop sequences in `iam-tap`. */
export function injectStopSequences(body: Record<string, unknown>): Record<string, unknown> {
    const existing = Array.isArray(body.stop) ? body.stop : [];
    const merged = [...new Set([...existing, ...MULTI_FAMILY_STOP_SEQUENCES])];
    return { ...body, stop: merged };
}
