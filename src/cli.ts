#!/usr/bin/env node
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createEphemeralCsmToken,
  createTrace,
  csmEnvForChild,
  finishTrace,
  getTrace,
  listTraceActionNames,
  startCsmListener,
} from "./csm-udp-listener.js";
import { renderPolicy, type PolicyFormat } from "./policy-codegen.js";
import { refineResourceArnsStatic, redactSecrets } from "./action-mapper.js";
import { assertPathContainedUnderCwd } from "./path-guard.js";
import {
  hijackStdoutForMcp,
  setGuards,
  startMcpServer,
  type McpToolDef,
} from "./bridge.js";

const VERSION = "0.1.0";

/** Executes `parseArgv` to parse argv in `iam-tap`. */
export function parseArgv(argv: string[]): {
  mcp: boolean;
  format: PolicyFormat;
  allowWrite: boolean;
  dryRun: boolean;
  help: boolean;
  cmd: string[];
} {
  const out = {
    mcp: false,
    format: "json" as PolicyFormat,
    allowWrite: false,
    dryRun: true,
    help: false,
    cmd: [] as string[],
  };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--mcp") {
      out.mcp = true;
      i++;
      continue;
    }
    if (a === "--allow-write") {
      out.allowWrite = true;
      out.dryRun = false;
      i++;
      continue;
    }
    if (a === "--dry-run") {
      out.dryRun = true;
      i++;
      continue;
    }
    if (a === "--format" && argv[i + 1]) {
      out.format = argv[i + 1] as PolicyFormat;
      i += 2;
      continue;
    }
    if (a === "--help" || a === "-h") {
      out.help = true;
      i++;
      continue;
    }
    if (a === "--") {
      out.cmd = argv.slice(i + 1);
      break;
    }
    out.cmd = argv.slice(i);
    break;
  }
  return out;
}

/** Executes `iamTapTools` to iam tap tools in `iam-tap`. */
export function iamTapTools(): McpToolDef[] {
  return [
    {
      name: "trace_aws_calls",
      description: "Run a command with AWS CSM tracing enabled.",
      inputSchema: {
        type: "object",
        properties: {
          argv: {
            type: "array",
            items: { type: "string" },
            description: "Executable and arguments (no shell)",
          },
          cwd: { type: "string", description: "Working directory" },
        },
        required: ["argv"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "generate_iam_policy",
      description: "Generate least-privilege IAM policy from a trace.",
      inputSchema: {
        type: "object",
        properties: {
          traceId: { type: "string" },
          format: { type: "string", enum: ["json", "terraform", "cdk"] },
        },
        required: ["traceId", "format"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "refine_resource_arns",
      description: "Tighten wildcard ARNs using static rules or local LLM.",
      inputSchema: {
        type: "object",
        properties: {
          traceId: { type: "string" },
          model: { type: "string" },
        },
        required: ["traceId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "write_policy_file",
      description: "Write generated policy to disk (requires allow-write).",
      inputSchema: {
        type: "object",
        properties: {
          traceId: { type: "string" },
          format: { type: "string", enum: ["json", "terraform", "cdk"] },
          path: { type: "string" },
        },
        required: ["traceId", "format", "path"],
        additionalProperties: false,
      },
      mutates: true,
      annotations: { destructiveHint: true },
    },
  ];
}

function argvFromMcpArgs(args: Record<string, unknown>): string[] {
  if (Array.isArray(args.argv)) {
    return args.argv.map((a) => String(a));
  }
  throw new Error("trace_aws_calls requires argv: string[]");
}

/** Configuration and data shape for `SpawnFn` (spawn fn). */
export type SpawnFn = (
  file: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

/** Executes `traceCommand` to trace command in `iam-tap`. */
export async function traceCommand(
  argv: string[],
  cwd?: string,
  spawnImpl: SpawnFn = spawn,
): Promise<{ traceId: string; actions: string[] }> {
  if (!argv.length) throw new Error("trace_aws_calls argv must not be empty");
  const workdir = cwd ? resolve(cwd) : process.cwd();
  const cmdLabel = redactSecrets(argv.join(" "));
  const trace = createTrace({ cmd: cmdLabel, cwd: workdir });
  const token = createEphemeralCsmToken();
  const listener = await startCsmListener(trace.id, { token });
  const env = {
    ...process.env,
    ...csmEnvForChild(listener.token),
    AWS_CSM_ENABLED: "true",
    AWS_CSM_HOST: listener.host,
    AWS_CSM_PORT: String(listener.port),
  };
  const [file, ...spawnArgs] = argv;
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawnImpl(file, spawnArgs, {
      shell: false,
      cwd: workdir,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", () => resolvePromise());
  });
  await listener.close();
  finishTrace(trace.id);
  return { traceId: trace.id, actions: listTraceActionNames(trace.id) };
}

function resourcesForTrace(traceId: string): string[] {
  const trace = getTrace(traceId);
  const actions = listTraceActionNames(traceId);
  const region = trace?.actions.find((a) => a.region)?.region;
  return refineResourceArnsStatic(actions, region);
}

function policyFromTrace(traceId: string, format: PolicyFormat): string {
  const actions = listTraceActionNames(traceId);
  if (!actions.length) throw new Error(`No actions recorded for trace ${traceId}`);
  return renderPolicy({ actions, resources: resourcesForTrace(traceId) }, format);
}

/** Executes `createMcpHandlers` to create mcp handlers in `iam-tap`. */
export function createMcpHandlers(cwd: string = process.cwd()): Record<
  string,
  (args: Record<string, unknown>) => Promise<unknown>
> {
  return {
    trace_aws_calls: async (args) => {
      const argv = argvFromMcpArgs(args);
      const workdir = args.cwd ? String(args.cwd) : undefined;
      return traceCommand(argv, workdir);
    },
    generate_iam_policy: async (args) => {
      const traceId = String(args.traceId);
      const format = (args.format ?? "json") as PolicyFormat;
      return { policy: policyFromTrace(traceId, format) };
    },
    refine_resource_arns: async (args) => {
      const traceId = String(args.traceId);
      void args.model;
      return { resources: resourcesForTrace(traceId) };
    },
    write_policy_file: async (args) => {
      const traceId = String(args.traceId);
      const format = (args.format ?? "json") as PolicyFormat;
      const relPath = String(args.path);
      const target = assertPathContainedUnderCwd(relPath, cwd);
      const body = policyFromTrace(traceId, format);
      writeFileSync(target, body, "utf8");
      return { written: target, bytes: body.length };
    },
  };
}

/** Executes `runCli` to run cli in `iam-tap`. */
export async function runCli(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv);
  if (parsed.help) {
    process.stderr.write(
      `iam-tap ${VERSION}\n  npx iam-tap -- <cmd>\n  npx iam-tap --format terraform -- <cmd>\n  npx iam-tap --mcp\n`,
    );
    return 0;
  }
  if (parsed.mcp) {
    hijackStdoutForMcp();
    setGuards({ allowWrite: parsed.allowWrite, dryRun: parsed.dryRun });
    startMcpServer({
      tools: iamTapTools(),
      handlers: createMcpHandlers(),
    });
    return 0;
  }
  if (!parsed.cmd.length) {
    process.stderr.write("iam-tap: pass a command after -- or use --mcp\n");
    return 2;
  }
  const { traceId, actions } = await traceCommand(parsed.cmd);
  const policy = renderPolicy(
    { actions, resources: resourcesForTrace(traceId) },
    parsed.format,
  );
  process.stdout.write(policy);
  if (!policy.endsWith("\n")) process.stdout.write("\n");
  return 0;
}

const isMain = process.argv[1]?.includes("cli");
if (isMain) {
  runCli(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) process.exitCode = code;
    })
    .catch((e) => {
      process.stderr.write(String(e) + "\n");
      process.exitCode = 1;
    });
}

export type { PolicyFormat } from "./policy-codegen.js";
