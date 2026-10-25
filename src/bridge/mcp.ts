import { DEFAULT_N_CTX } from "./context.js";
import {
  checkLoopBreaker,
  finalizeMcpToolText,
  guardMutatingTool,
  normalizePathsDeep,
} from "./guards.js";
import type { JsonRecord, McpHandler, McpServerOpts, McpToolDef } from "./types.js";

let jsonRpcWrite: ((line: string) => void) | null = null;
let stdoutHijacked = false;
export function hijackStdoutForMcp() {
    if (stdoutHijacked)
        return;
    stdoutHijacked = true;
    const native = process.stdout.write.bind(process.stdout);
    jsonRpcWrite = (line) => {
        native(line);
    };
    process.stdout.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding, cb?: (err?: Error | null) => void) => {
        const str = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
        if (jsonRpcWrite && str.trim().startsWith("{") && str.includes('"jsonrpc"')) {
            return native(chunk, encoding, cb);
        }
        process.stderr.write(str);
        return true;
    }) as typeof process.stdout.write;
}
export const jsonRpcFrameLog: string[] = [];
export function writeJsonRpcFrame(obj: JsonRecord) {
    const line = JSON.stringify(obj) + "\n";
    jsonRpcFrameLog.push(line);
    if (jsonRpcWrite)
        jsonRpcWrite(line);
    else
        process.stdout.write(line);
}
export function startMcpServer(opts: McpServerOpts = {}) {
    hijackStdoutForMcp();
    const repoRoot = opts.repoRoot ?? process.cwd();
    const tools = opts.tools ?? [];
    const handlers = opts.handlers ?? {};
    const toWsl = opts.pathToWsl ?? process.env.REPOMCP_PATH_WSL === "1";
    const stdin = process.stdin;
    stdin.setEncoding("utf8");
    let buffer = "";
    stdin.on("data", (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line)
                continue;
            let msg;
            try {
                msg = JSON.parse(line);
            }
            catch {
                continue;
            }
            dispatchMcpMessage(msg, { repoRoot, tools, handlers, pathToWsl: toWsl, nCtx: opts.nCtx });
        }
    });
}
export function dispatchMcpMessage(msg: JsonRecord, opts: McpServerOpts = {}) {
    const repoRoot = opts.repoRoot ?? process.cwd();
    const tools = opts.tools ?? [];
    const handlers = opts.handlers ?? {};
    const toWsl = opts.pathToWsl ?? process.env.REPOMCP_PATH_WSL === "1";
    const nCtx = opts.nCtx ?? DEFAULT_N_CTX;
    handleMessage(msg, tools, handlers, toWsl, nCtx);
}
function handleMessage(msg: JsonRecord, tools: McpToolDef[], handlers: Record<string, McpHandler>, toWsl: boolean, nCtx: number) {
    const id = msg.id;
    const method = msg.method as string | undefined;
    const params = (msg.params ?? {}) as Record<string, unknown>;
    if (method === "initialize") {
        writeJsonRpcFrame({
            jsonrpc: "2.0",
            id,
            result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "iam-tap", version: "0.1.0" },
            },
        });
        return;
    }
    if (method === "notifications/initialized")
        return;
    if (method === "tools/list") {
        writeJsonRpcFrame({
            jsonrpc: "2.0",
            id,
            result: {
                tools: tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.inputSchema,
                    annotations: t.annotations,
                })),
            },
        });
        return;
    }
    if (method === "tools/call") {
        const name = String(params.name ?? "");
        const args = normalizePathsDeep(params.arguments ?? {}, toWsl) as Record<string, unknown>;
        const tool = tools.find((t) => t.name === name);
        const loopErr = checkLoopBreaker(name, args);
        if (loopErr) {
            writeJsonRpcFrame({
                jsonrpc: "2.0",
                id,
                result: { content: [{ type: "text", text: loopErr }], isError: true },
            });
            return;
        }
        if (tool) {
            const guard = guardMutatingTool(tool);
            if (guard.blocked) {
                writeJsonRpcFrame({
                    jsonrpc: "2.0",
                    id,
                    result: {
                        content: [{ type: "text", text: guard.reason ?? "blocked" }],
                        isError: true,
                    },
                });
                return;
            }
        }
        const handler = handlers[name];
        void (async () => {
            try {
                let result;
                if (handler) {
                    result = await handler(args);
                }
                else {
                    result = { ok: true, tool: name, args };
                }
                const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
                writeJsonRpcFrame({
                    jsonrpc: "2.0",
                    id,
                    result: {
                        content: [{ type: "text", text: finalizeMcpToolText(text, { nCtx, toWsl }) }],
                    },
                });
            }
            catch (e) {
                writeJsonRpcFrame({
                    jsonrpc: "2.0",
                    id,
                    result: {
                        content: [{ type: "text", text: finalizeMcpToolText(String(e), { nCtx, toWsl }) }],
                        isError: true,
                    },
                });
            }
        })();
        return;
    }
    if (id !== undefined) {
        writeJsonRpcFrame({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
        });
    }
}
