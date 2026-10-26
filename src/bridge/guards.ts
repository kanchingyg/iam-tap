import { createHash } from "node:crypto";
import { DEFAULT_N_CTX, truncateToolOutput } from "./context.js";
import type { FinalizeMcpOpts, McpToolDef } from "./types.js";

let allowWrite = false;
let dryRun = false;
/** Executes `setGuards` to set guards in `iam-tap`. */
export function setGuards(opts: { allowWrite?: boolean; dryRun?: boolean }): void {
    allowWrite = Boolean(opts.allowWrite);
    dryRun = Boolean(opts.dryRun);
}
/** Executes `canonicalizeJson` to canonicalize json in `iam-tap`. */
export function canonicalizeJson(value: unknown): string {
    if (value === null || value === undefined)
        return "null";
    if (typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map((v) => canonicalizeJson(v)).join(",")}]`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`).join(",")}}`;
}
/** Executes `loopBreakerHash` to loop breaker hash in `iam-tap`. */
export function loopBreakerHash(toolName: string, args: unknown): string {
    return createHash("sha256")
        .update(`${toolName}:${canonicalizeJson(args)}`)
        .digest("hex");
}
const loopState = { lastHash: "", repeatCount: 0 };
/** Executes `resetLoopBreaker` to reset loop breaker in `iam-tap`. */
export function resetLoopBreaker(): void {
    loopState.lastHash = "";
    loopState.repeatCount = 0;
}
/** Executes `checkLoopBreaker` to check loop breaker in `iam-tap`. */
export function checkLoopBreaker(toolName: string, args: unknown): string | null {
    const h = loopBreakerHash(toolName, args);
    if (h === loopState.lastHash) {
        loopState.repeatCount++;
    }
    else {
        loopState.lastHash = h;
        loopState.repeatCount = 1;
    }
    if (loopState.repeatCount >= 3) {
        return "LOOP_BREAKER: Identical tool call repeated 2 times consecutively. Stop calling tools and return your final synthesis.";
    }
    return null;
}
/** Executes `guardMutatingTool` to guard mutating tool in `iam-tap`. */
export function guardMutatingTool(tool: McpToolDef): { blocked: boolean; reason?: string } {
    if (!tool.mutates)
        return { blocked: false };
    if (dryRun) {
        return {
            blocked: true,
            reason: `[dry-run] Mutating tool ${tool.name} blocked. Omit --dry-run and pass --allow-write to enable writes.`,
        };
    }
    if (!allowWrite) {
        return {
            blocked: true,
            reason: "Read-only mode: pass --allow-write to enable mutating tools.",
        };
    }
    return { blocked: false };
}
const WIN_DRIVE_RE = /^([A-Za-z]):\\(.*)$/;
const WSL_RE = /^\/mnt\/([a-z])\/(.*)$/i;
/** Executes `windowsToWsl` to windows to wsl in `iam-tap`. */
export function windowsToWsl(p: string): string {
    const m = p.match(WIN_DRIVE_RE);
    if (!m)
        return p;
    const rest = m[2].replace(/\\/g, "/");
    return `/mnt/${m[1].toLowerCase()}/${rest}`;
}
/** Executes `wslToWindows` to wsl to windows in `iam-tap`. */
export function wslToWindows(p: string): string {
    const m = p.match(WSL_RE);
    if (!m)
        return p;
    const rest = m[2].replace(/\//g, "\\");
    return `${m[1].toUpperCase()}:\\${rest}`;
}
/** Executes `normalizePathsDeep` to normalize paths deep in `iam-tap`. */
export function normalizePathsDeep(value: unknown, toWsl: boolean): unknown {
    if (typeof value === "string") {
        if (toWsl && WIN_DRIVE_RE.test(value))
            return windowsToWsl(value);
        if (!toWsl && WSL_RE.test(value))
            return wslToWindows(value);
        if (value.startsWith("file:///")) {
            const raw = value.slice(8).replace(/\//g, "\\");
            return (toWsl ? windowsToWsl(raw) : raw);
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((v) => normalizePathsDeep(v, toWsl));
    }
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = normalizePathsDeep(v, toWsl);
        }
        return out;
    }
    return value;
}
/** Executes `redactSecrets` to redact secrets in `iam-tap`. */
export function redactSecrets(text: unknown): string {
    return String(text)
        .replace(/(AKIA[0-9A-Z]{16})/g, "[REDACTED]")
        .replace(/(ASIA[0-9A-Z]{16})/g, "[REDACTED]")
        .replace(/(api[_-]?key|token|password|secret)\s*[=:]\s*[^\s]+/gi, "$1=[REDACTED]")
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
        .replace(/sk-[A-Za-z0-9]{20,}/g, "[REDACTED]");
}
/** Executes `finalizeMcpToolText` to finalize mcp tool text in `iam-tap`. */
export function finalizeMcpToolText(text: unknown, opts?: FinalizeMcpOpts): unknown {
    const nCtx = opts?.nCtx ?? DEFAULT_N_CTX;
    const toWsl = opts?.toWsl ?? false;
    return normalizePathsDeep(redactSecrets(truncateToolOutput(String(text), nCtx)), !toWsl);
}
