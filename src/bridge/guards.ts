import { createHash } from "node:crypto";
import { DEFAULT_N_CTX, truncateToolOutput } from "./context.js";
import type { FinalizeMcpOpts, McpToolDef } from "./types.js";

let allowWrite = false;
let dryRun = false;
export function setGuards(opts: { allowWrite?: boolean; dryRun?: boolean }) {
    allowWrite = Boolean(opts.allowWrite);
    dryRun = Boolean(opts.dryRun);
}
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
export function loopBreakerHash(toolName: string, args: unknown) {
    return createHash("sha256")
        .update(`${toolName}:${canonicalizeJson(args)}`)
        .digest("hex");
}
const loopState = { lastHash: "", repeatCount: 0 };
export function resetLoopBreaker() {
    loopState.lastHash = "";
    loopState.repeatCount = 0;
}
export function checkLoopBreaker(toolName: string, args: unknown) {
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
export function guardMutatingTool(tool: McpToolDef) {
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
export function windowsToWsl(p: string) {
    const m = p.match(WIN_DRIVE_RE);
    if (!m)
        return p;
    const rest = m[2].replace(/\\/g, "/");
    return `/mnt/${m[1].toLowerCase()}/${rest}`;
}
export function wslToWindows(p: string) {
    const m = p.match(WSL_RE);
    if (!m)
        return p;
    const rest = m[2].replace(/\//g, "\\");
    return `${m[1].toUpperCase()}:\\${rest}`;
}
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
export function redactSecrets(text: unknown) {
    return String(text)
        .replace(/(AKIA[0-9A-Z]{16})/g, "[REDACTED]")
        .replace(/(ASIA[0-9A-Z]{16})/g, "[REDACTED]")
        .replace(/(api[_-]?key|token|password|secret)\s*[=:]\s*[^\s]+/gi, "$1=[REDACTED]")
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
        .replace(/sk-[A-Za-z0-9]{20,}/g, "[REDACTED]");
}
export function finalizeMcpToolText(text: unknown, opts?: FinalizeMcpOpts) {
    const nCtx = opts?.nCtx ?? DEFAULT_N_CTX;
    const toWsl = opts?.toWsl ?? false;
    return normalizePathsDeep(redactSecrets(truncateToolOutput(String(text), nCtx)), !toWsl);
}
