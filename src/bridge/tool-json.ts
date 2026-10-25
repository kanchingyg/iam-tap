import {
  jsonRecord,
  type JsonSchemaLike,
  type JsonSchemaProp,
  type ParsedToolCall,
  type ReadableStreamLike,
} from "./types.js";

export class StreamToolJsonAbort {
    depth = 0;
    started = false;
    acc = "";
    feed(chunk: string) {
        this.acc += chunk;
        if (!this.started) {
            if (/<tool_call>/i.test(this.acc) ||
                /✿FUNCTION✿/i.test(this.acc) ||
                /<\|tool_call_argument_begin\|>/i.test(this.acc) ||
                /"name"\s*:\s*"/.test(this.acc)) {
                this.started = true;
            }
        }
        this.depth = countBraceFrom(this.acc);
        return this.started && this.depth === 0 && /\{[\s\S]*\}/.test(this.acc);
    }
    reset() {
        this.depth = 0;
        this.started = false;
        this.acc = "";
    }
}
function countBraceFrom(text: string) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (inString) {
            if (c === "\\")
                escape = true;
            else if (c === '"')
                inString = false;
            continue;
        }
        if (c === '"') {
            inString = true;
            continue;
        }
        if (c === "{")
            depth++;
        else if (c === "}")
            depth--;
    }
    return depth;
}
export async function readStreamUntilToolJsonDone(stream: ReadableStreamLike, onAbort: () => void) {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    const guard = new StreamToolJsonAbort();
    let out = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        const chunk = decoder.decode(value, { stream: true });
        out += chunk;
        if (guard.feed(chunk)) {
            onAbort();
            break;
        }
    }
    return out;
}
export function stripRedactedThinking(text: string) {
    return text.replace(/<think>[\s\S]*?(?:<\/redacted_thinking>|$)/gi, "");
}
function repairJson(raw: string) {
    let s = raw.trim();
    if (!s)
        return "{}";
    s = s.replace(/\/\/[^\n]*/g, "");
    s = s.replace(/\/\*[\s\S]*?\*\//g, "");
    s = s.replace(/,\s*([}\]])/g, "$1");
    s = s.replace(/'/g, '"');
    s = s.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');
    const open = (s.match(/\{/g) ?? []).length;
    const close = (s.match(/\}/g) ?? []).length;
    if (open > close) {
        s += "}".repeat(open - close);
    }
    return s;
}
function tryParseObject(raw: string): Record<string, unknown> | null {
    const attempts = [raw, repairJson(raw)];
    for (const a of attempts) {
        try {
            const v: unknown = JSON.parse(a);
            const rec = jsonRecord(v);
            if (rec) {
                return rec;
            }
        }
        catch {
            /* empty */
        }
    }
    return null;
}
function coerceValue(value: unknown, prop: JsonSchemaProp | undefined) {
    if (!prop?.type)
        return value;
    switch (prop.type) {
        case "integer":
            if (typeof value === "string" && /^-?\d+$/.test(value))
                return parseInt(value, 10);
            if (typeof value === "number")
                return Math.trunc(value);
            return value;
        case "number":
            if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value))
                return Number(value);
            return value;
        case "boolean":
            if (value === "true")
                return true;
            if (value === "false")
                return false;
            return value;
        case "array":
            if (typeof value === "string") {
                try {
                    return JSON.parse(value);
                }
                catch {
                    return value;
                }
            }
            return value;
        default:
            return value;
    }
}
export function coerceToSchema(args: Record<string, unknown>, schema: JsonSchemaLike | null | undefined) {
    if (!schema?.properties)
        return args;
    const out = { ...args };
    for (const [key, prop] of Object.entries(schema.properties)) {
        if (key in out)
            out[key] = coerceValue(out[key], prop);
    }
    return out;
}
export function countJsonBraceDepth(chunk: string, priorDepth: number) {
    let depth = priorDepth;
    let inString = false;
    let escape = false;
    for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (inString) {
            if (c === "\\")
                escape = true;
            else if (c === '"')
                inString = false;
            continue;
        }
        if (c === '"') {
            inString = true;
            continue;
        }
        if (c === "{")
            depth++;
        else if (c === "}")
            depth--;
    }
    return depth;
}
export function shouldAbortStreamOnToolJson(accumulated: string, started: boolean, depth: number) {
    if (!started)
        return false;
    return depth === 0 && /\{[\s\S]*\}/.test(accumulated);
}
export function parseDirtyToolCall(
    content: string,
    schema: JsonSchemaLike | null | undefined,
): ParsedToolCall | null {
    const text = stripRedactedThinking(content);
    const hermes = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
    if (hermes) {
        const obj = tryParseObject(hermes[1]);
        if (typeof obj?.name === "string") {
            const rawArgs = obj.arguments ?? obj.args;
            const args = jsonRecord(rawArgs) ?? {};
            return {
                name: obj.name,
                arguments: coerceToSchema(args, schema),
            };
        }
    }
    const minimax = text.match(/<tool_calls>\s*([\s\S]*?)\s*<\/tool_calls>/i);
    if (minimax) {
        const obj = tryParseObject(minimax[1]);
        if (typeof obj?.name === "string") {
            const args = jsonRecord(obj.arguments) ?? {};
            return {
                name: obj.name,
                arguments: coerceToSchema(args, schema),
            };
        }
    }
    const deepseek = text.match(/<\|redacted_tool_call_begin\|>[\s\S]*?```json\s*([\s\S]*?)```[\s\S]*?<\|redacted_tool_call_end\|>/i);
    if (deepseek) {
        const obj = tryParseObject(deepseek[1]);
        if (obj) {
            const name = obj.name ?? obj.function ?? obj.tool;
            if (name != null && name !== "") {
                return {
                    name: String(name),
                    arguments: coerceToSchema(obj, schema),
                };
            }
        }
    }
    const kimi = text.match(/functions\.([^:<\|]+):\d+<\|tool_call_argument_begin\|>([\s\S]*?)<\|tool_call_end\|>/i);
    if (kimi) {
        const obj = tryParseObject(kimi[2]);
        return {
            name: kimi[1].trim(),
            arguments: coerceToSchema(obj ?? {}, schema),
        };
    }
    const glm = text.match(/<\|tool_call_begin\|>([^<\|]+)<\|tool_call_sep\|>([\s\S]*?)<\|tool_call_end\|>/i);
    if (glm) {
        const obj = tryParseObject(glm[2]);
        return {
            name: glm[1].trim(),
            arguments: coerceToSchema(obj ?? {}, schema),
        };
    }
    const qwenFn = text.match(/✿FUNCTION✿:\s*([^\n]+)\s*✿ARGS✿:\s*([\s\S]*?)(?:✿RESULT✿|$)/i);
    if (qwenFn) {
        const obj = tryParseObject(qwenFn[2]);
        return {
            name: qwenFn[1].trim(),
            arguments: coerceToSchema(obj ?? {}, schema),
        };
    }
    const step3 = text.match(/<steptml:invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/steptml:invoke>/i);
    if (step3) {
        const args: Record<string, string> = {};
        const paramRe = /<steptml:parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/steptml:parameter>/gi;
        let m;
        while ((m = paramRe.exec(step3[2])) !== null) {
            args[m[1]] = m[2].trim();
        }
        return { name: step3[1], arguments: coerceToSchema(args, schema) };
    }
    const py = text.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*)\)\s*$/m);
    if (py) {
        const args: Record<string, string> = {};
        const inner = py[2].trim();
        if (inner) {
            for (const part of inner.split(",")) {
                const eq = part.indexOf("=");
                if (eq > 0) {
                    const k = part.slice(0, eq).trim();
                    let v = part.slice(eq + 1).trim();
                    if (typeof v === "string" && /^["']/.test(v)) {
                        v = v.slice(1, -1);
                    }
                    args[k] = v;
                }
            }
        }
        return { name: py[1], arguments: coerceToSchema(args, schema) };
    }
    const openAiBlock = text.match(/\{\s*"name"\s*:\s*"([^"]+)"[\s\S]*?"arguments"\s*:\s*(\{[\s\S]*\})/);
    if (openAiBlock) {
        const obj = tryParseObject(`{"name":"${openAiBlock[1]}","arguments":${openAiBlock[2]}}`);
        if (typeof obj?.name === "string") {
            const args = jsonRecord(obj.arguments) ?? {};
            return {
                name: obj.name,
                arguments: coerceToSchema(args, schema),
            };
        }
    }
    const iqBroken = text.match(/\{\s*['"]?cmd['"]?\s*:\s*['"]([^'"]+)['"]/);
    if (iqBroken) {
        return { name: "run_shell", arguments: { cmd: iqBroken[1] } };
    }
    return null;
}
