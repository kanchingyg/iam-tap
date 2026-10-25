# iam-tap

[![ci](https://github.com/kanchingyg/iam-tap/actions/workflows/ci.yml/badge.svg)](https://github.com/kanchingyg/iam-tap/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/iam-tap)](https://www.npmjs.com/package/iam-tap)
[![JSR](https://jsr.io/badges/@kanchingyg/iam-tap)](https://jsr.io/@kanchingyg/iam-tap)
[![Go](https://img.shields.io/badge/engine-Go-00ADD8)](https://github.com/kanchingyg/iam-tap)
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

## MCP & local models

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

## License

[MIT](./LICENSE)
