import { describe, it, expect, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createTrace,
  simulateCsmMessage,
  startCsmListener,
  listTraceActionNames,
  wrapCsmMessageForTest,
  createEphemeralCsmToken,
} from "../src/csm-udp-listener.js";
import { renderPolicy, buildIamPolicyDocument } from "../src/policy-codegen.js";
import { apiToAction, redactSecrets } from "../src/action-mapper.js";
import { assertPathContainedUnderCwd } from "../src/path-guard.js";
import {
  hijackStdoutForMcp,
  jsonRpcFrameLog,
  dispatchMcpMessage,
  setGuards,
  resetLoopBreaker,
  checkLoopBreaker,
  guardMutatingTool,
  headTailTruncate,
  applyReasoningContentPolicy,
  createReasoningState,
  parseDirtyToolCall,
  StreamToolJsonAbort,
  sanitizeRequestBody,
  normalizeToolChoice,
  detectProvider,
  normalizeEmbedBatch,
  floatArrayToBase64,
  base64ToFloatArray,
  mrlSlice,
  assertDimensionFingerprint,
  writeEmbedLock,
  readEmbedLock,
  windowsToWsl,
  wslToWindows,
} from "../src/bridge.js";
import { createMcpHandlers, iamTapTools, parseArgv, traceCommand } from "../src/cli.js";

describe("CSM UDP listener", () => {
  it("maps S3.GetObject, DynamoDB.PutItem, and STS 403 decode", async () => {
    const trace = createTrace({ cmd: "npm test" });
    const token = createEphemeralCsmToken();
    const listener = await startCsmListener(trace.id, { token });

    await new Promise<void>((resolve) => {
      const client = createSocket("udp4");
      const send = (obj: object) =>
        client.send(wrapCsmMessageForTest(obj as never, token), listener.port, listener.host, () => {});
      send({
        Version: 1,
        Type: "ApiCall",
        Service: "S3",
        Api: "GetObject",
        Region: "us-east-1",
      });
      send({
        Version: 1,
        Type: "ApiCall",
        Service: "DynamoDB",
        Api: "PutItem",
        Region: "us-east-1",
      });
      send({
        Version: 1,
        Type: "ApiCallAttempt",
        Service: "STS",
        Api: "DecodeAuthorizationMessage",
        HttpStatusCode: 403,
        DecodedActions: ["s3:ListBucket"],
      });
      setTimeout(() => {
        client.close();
        resolve();
      }, 80);
    });

    await listener.close();
    const actions = listTraceActionNames(trace.id);
    expect(actions).toContain("s3:GetObject");
    expect(actions).toContain("dynamodb:PutItem");
    expect(actions).toContain("s3:ListBucket");
  });

  it("ignores UDP packets without CSM token", async () => {
    const trace = createTrace({});
    const token = createEphemeralCsmToken();
    const listener = await startCsmListener(trace.id, { token });
    await new Promise<void>((resolve) => {
      const client = createSocket("udp4");
      client.send(
        JSON.stringify({ Version: 1, Type: "ApiCall", Service: "S3", Api: "GetObject" }),
        listener.port,
        listener.host,
        () => {
          client.close();
          resolve();
        },
      );
    });
    await new Promise((r) => setTimeout(r, 40));
    await listener.close();
    expect(listTraceActionNames(trace.id)).toEqual([]);
  });

  it("emits exact JSON IAM and Terraform HCL", () => {
    const trace = createTrace({});
    simulateCsmMessage(trace.id, {
      Version: 1,
      Type: "ApiCall",
      Service: "S3",
      Api: "GetObject",
    });
    simulateCsmMessage(trace.id, {
      Version: 1,
      Type: "ApiCall",
      Service: "DynamoDB",
      Api: "PutItem",
    });
    const actions = listTraceActionNames(trace.id);
    const json = buildIamPolicyDocument({ actions, resources: ["*"] });
    expect(json).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "IamTapLeastPrivilege",
          Effect: "Allow",
          Action: ["dynamodb:PutItem", "s3:GetObject"],
          Resource: ["*"],
        },
      ],
    });
    const tf = renderPolicy({ actions, resources: ["*"] }, "terraform");
    expect(tf).toBe(`data "aws_iam_policy_document" "iam_tap" {
  statement {
    sid       = "IamTapLeastPrivilege"
    effect    = "Allow"
    actions   = ["dynamodb:PutItem", "s3:GetObject"]
    resources = ["*"]
  }
}
`);
  });
});

describe("spawn and path guards", () => {
  it("traceCommand uses shell:false spawn", async () => {
    const calls: { file: string; args: string[]; shell?: boolean }[] = [];
    const spawnImpl = (file: string, args: string[], opts: { shell?: boolean }) => {
      calls.push({ file, args, shell: opts.shell });
      const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
      return child;
    };
    await traceCommand([process.execPath, "-e", "0"], undefined, spawnImpl);
    expect(calls[0]?.shell).toBe(false);
    expect(calls[0]?.file).toBe(process.execPath);
  });

  it("rejects write paths outside cwd", () => {
    expect(() => assertPathContainedUnderCwd("../outside.json", process.cwd())).toThrow(
      /escapes working directory/,
    );
  });
});

describe("CLI & MCP", () => {
  it("parses argv", () => {
    expect(parseArgv(["--mcp"]).mcp).toBe(true);
    expect(parseArgv(["--format", "terraform", "--", "npm", "test"]).format).toBe("terraform");
  });

  it("MCP initialize and tools/list", () => {
    jsonRpcFrameLog.length = 0;
    hijackStdoutForMcp();
    const tools = iamTapTools();
    dispatchMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { tools, handlers: {} },
    );
    dispatchMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, {
      tools,
      handlers: {},
    });
    const listFrame = JSON.parse(jsonRpcFrameLog[jsonRpcFrameLog.length - 1].trim());
    expect(listFrame.result.tools.map((t: { name: string }) => t.name)).toContain(
      "trace_aws_calls",
    );
  });

  it("dry-run allows trace_aws_calls but blocks write_policy_file", async () => {
    jsonRpcFrameLog.length = 0;
    hijackStdoutForMcp();
    resetLoopBreaker();
    setGuards({ allowWrite: false, dryRun: true });
    const tools = iamTapTools();
    const handlers = createMcpHandlers();
    const trace = createTrace({ cmd: "x" });
    simulateCsmMessage(trace.id, {
      Version: 1,
      Type: "ApiCall",
      Service: "S3",
      Api: "GetObject",
    });

    dispatchMcpMessage(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "generate_iam_policy",
          arguments: { traceId: trace.id, format: "json" },
        },
      },
      { tools, handlers },
    );
    await new Promise((r) => setTimeout(r, 20));
    const genFrame = JSON.parse(jsonRpcFrameLog[jsonRpcFrameLog.length - 1].trim());
    expect(genFrame.result.isError).toBeFalsy();
    expect(genFrame.result.content[0].text).toContain("s3:GetObject");

    dispatchMcpMessage(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "write_policy_file",
          arguments: { traceId: trace.id, format: "json", path: "policy.json" },
        },
      },
      { tools, handlers },
    );
    const writeFrame = JSON.parse(jsonRpcFrameLog[jsonRpcFrameLog.length - 1].trim());
    expect(writeFrame.result.content[0].text).toMatch(/dry-run|allow-write/i);
  });
});

describe("bridge blindajes", () => {
  beforeEach(() => {
    resetLoopBreaker();
    setGuards({ allowWrite: false, dryRun: false });
  });

  it("redacts secrets in trace cmd", () => {
    const out = redactSecrets("key=AKIAIOSFODNN7EXAMPLE");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    const asia = redactSecrets("ASIAIOSFODNN7EXAMPLE");
    expect(asia).not.toContain("ASIAIOSFODNN7EXAMPLE");
  });

  it("loop breaker and mutating guard", () => {
    expect(checkLoopBreaker("t", { a: 1 })).toBeNull();
    expect(checkLoopBreaker("t", { a: 1 })).toBeNull();
    expect(checkLoopBreaker("t", { a: 1 })).toMatch(/LOOP_BREAKER/);
    setGuards({ allowWrite: false, dryRun: true });
    expect(
      guardMutatingTool({
        name: "w",
        description: "d",
        inputSchema: { type: "object", properties: {} },
        mutates: true,
      }).blocked,
    ).toBe(true);
  });

  it("head+tail truncation uses IAM-TAP marker", () => {
    const long = "H".repeat(200) + "T".repeat(200);
    const out = headTailTruncate(long, 200);
    expect(out).toContain("IAM-TAP");
  });

  it("reasoning and dirty parser + embed batch", async () => {
    let state = createReasoningState();
    const msgs = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok", reasoning_content: "think", tool_calls: [{}] },
      { role: "tool", content: "{}" },
    ];
    const r1 = applyReasoningContentPolicy(msgs, state);
    expect(r1.messages[1].reasoning_content).toBe("think");
    state = r1.state;
    const qwen = "✿FUNCTION✿: run_check\n✿ARGS✿: {'target': 'z'}\n";
    expect(parseDirtyToolCall(qwen)?.name).toBe("run_check");
    const guard = new StreamToolJsonAbort();
    expect(guard.feed('<tool_call>{"name":"t","arguments":{')).toBe(false);
    expect(guard.feed("}}")).toBe(true);
    const body = sanitizeRequestBody(
      { temperature: 0.2, model: "deepseek-reasoner" },
      "deepseek-reasoner",
    );
    expect(body.temperature).toBeUndefined();
    expect(normalizeToolChoice("required", detectProvider("https://dashscope.aliyuncs.com"))).toBe(
      "auto",
    );
    const calls: number[] = [];
    await normalizeEmbedBatch(Array.from({ length: 60 }, (_, i) => `t-${i}`), {
      upstream: {
        name: "dashscope",
        maxBatch: 10,
        embed: async (input) => {
          calls.push(input.length);
          return input.map(() => [1, 0, 0]);
        },
      },
      model: "text-embedding-v3",
      dimensions: 3,
    });
    expect(calls.length).toBe(6);
    const vec = [3, 4];
    expect(base64ToFloatArray(floatArrayToBase64(vec))[0]).toBeCloseTo(3);
    expect(Math.hypot(...mrlSlice([3, 4, 0], 2))).toBeCloseTo(1);
    expect(() =>
      assertDimensionFingerprint({ provider: "x", model: "m", dimension: 1024 }, 768),
    ).toThrow();
    const dir = mkdtempSync(join(tmpdir(), "iam-tap-"));
    writeEmbedLock(dir, { provider: "p", model: "m", dimension: 1024 });
    expect(readEmbedLock(dir)?.dimension).toBe(1024);
    rmSync(dir, { recursive: true });
  });

  it("normalizes windows and wsl paths", () => {
    expect(windowsToWsl("D:\\proj\\foo.ts")).toBe("/mnt/d/proj/foo.ts");
    expect(wslToWindows("/mnt/d/proj/foo.ts")).toBe("D:\\proj\\foo.ts");
  });
});

describe("action mapper", () => {
  it("builds standard IAM action ids", () => {
    expect(apiToAction("S3", "GetObject")).toBe("s3:GetObject");
  });
});
