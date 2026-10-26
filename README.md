# iam-tap

[![ci](https://github.com/kanchingyg/iam-tap/actions/workflows/ci.yml/badge.svg)](https://github.com/kanchingyg/iam-tap/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/iam-tap/latest?label=npm)](https://www.npmjs.com/package/iam-tap)
[![JSR](https://jsr.io/badges/@kanchingyg/iam-tap)](https://jsr.io/@kanchingyg/iam-tap)
[![JSR Score](https://jsr.io/badges/@kanchingyg/iam-tap/score)](https://jsr.io/@kanchingyg/iam-tap/score)
[![Go](https://img.shields.io/badge/engine-Go_%2B_TypeScript-00ADD8)](https://github.com/kanchingyg/iam-tap)
[![license](https://img.shields.io/github/license/kanchingyg/iam-tap)](https://github.com/kanchingyg/iam-tap/blob/HEAD/LICENSE)

**One line:** `npx iam-tap -- npm test` (or `bunx iam-tap -- bun test`) produces a least-privilege IAM policy from real AWS SDK calls via Client-Side Monitoring (CSM UDP `:31000`).

## Install

[Bun](https://bun.sh) / [npm](https://www.npmjs.com/package/iam-tap):

```bash
bunx iam-tap -- npm test
npx iam-tap -- npm test

# or install in your project / globally
bun add -d iam-tap
npm i -D iam-tap
```

[JSR](https://jsr.io/@kanchingyg/iam-tap):

```bash
bunx jsr add @kanchingyg/iam-tap
npx jsr add @kanchingyg/iam-tap
```

[Go (native binary)](https://github.com/kanchingyg/iam-tap):

```bash
go install github.com/kanchingyg/iam-tap@latest
```

The core engine is **Go** (`main.go`, `internal/`): CSM UDP listener with token auth, argv-only child spawn (no shell), IAM policy emission, and `--mcp` JSON-RPC on stdio. TypeScript under `src/*.ts` is included for `npx` / `bunx` / JSR usage and MCP bridge helpers when no native binary is present.

## Quick start

```bash
npx iam-tap -- npm test
bunx iam-tap -- bun test
npx iam-tap --format terraform -- vitest run
npx iam-tap --mcp
iam-tap --help   # after go install
```

Dry-run is the default: mutating MCP tools (`write_policy_file`) are blocked until you pass `--allow-write` (which disables dry-run). Policy writes are path-contained under the working directory.

## MCP Tools Reference

| Tool | Mutates | Description |
| --- | --- | --- |
| `trace_aws_calls` | `false` | Spawn a child command (`shell: false`) with AWS Client-Side Monitoring enabled on ephemeral UDP loopback and record SDK actions. |
| `generate_iam_policy` | `false` | Render a least-privilege IAM policy from a recorded trace ID in `json`, `terraform`, or `cdk` format. |
| `refine_resource_arns` | `false` | Tighten wildcard Resource ARNs using static service templates and captured region metadata. |
| `write_policy_file` | `true` | Write the generated IAM policy to a path contained inside the current working directory (requires `--allow-write`). |

## Editor and Agent Integration

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "iam-tap": {
      "command": "npx",
      "args": ["-y", "iam-tap", "--mcp"]
    }
  }
}
```

### Claude Code CLI

```bash
claude mcp add iam-tap -- npx -y iam-tap --mcp
```

### Programmatic Usage (JSR / TypeScript)

```ts
import * as bridge from "jsr:@kanchingyg/iam-tap/bridge";
```

## Runtime Safety and Guardrails

- **Stdio frame isolation**: When `--mcp` is active, `hijackStdoutForMcp()` redirects accidental `console.log` calls to `stderr` so JSON-RPC 2.0 frames on `stdout` never corrupt.
- **Read-only by default**: Mutating tools (`mutates: true`) are blocked in `--dry-run` mode and require explicit `--allow-write` authorization.
- **Loop breaker**: Repeated identical `(toolName, args)` invocations are hashed with SHA-256 and halted after 3 consecutive repeats to prevent runaway agent loops.
- **Context budget truncation**: Tool outputs are middle-truncated (`60%` head / `40%` tail) scaled to the probed local model `n_ctx` (Ollama `/api/show`, llama.cpp `/props`, vLLM `/v1/models`).
- **Secret redaction and path normalization**: AWS keys (`AKIA*`, `ASIA*`), bearer tokens, and `sk-*` keys are scrubbed before returning tool output, and Windows drive paths (`C:\...`) translate cleanly to `/mnt/c/...` when WSL mode is enabled.

## License

[MIT](./LICENSE)
