import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  jsonRecord,
  type DashScopeUpstreamOpts,
  type EmbedLock,
  type EmbedServerOpts,
  type FetchLike,
  type NormalizeEmbedBatchOptions,
} from "./types.js";

export const EMBED_LOCK = ".iam-tap-embed-lock.json";
export const KNOWN_DIMENSIONS = [384, 768, 1024, 1536, 2560, 3072, 4096];
export function readEmbedLock(repoRoot: string): EmbedLock | null {
    const p = join(repoRoot, EMBED_LOCK);
    if (!existsSync(p))
        return null;
    return JSON.parse(readFileSync(p, "utf8")) as EmbedLock;
}
export function writeEmbedLock(repoRoot: string, lock: EmbedLock) {
    writeFileSync(join(repoRoot, EMBED_LOCK), JSON.stringify(lock, null, 2));
}
export function assertDimensionFingerprint(lock: EmbedLock | null | undefined, dim: number) {
    if (!lock)
        return;
    if (lock.dimension !== dim) {
        throw new Error(`Dimension fingerprint mismatch: lock expects ${lock.dimension}, got ${dim}`);
    }
}
export function l2Normalize(vec: number[]) {
    let sum = 0;
    for (const v of vec)
        sum += v * v;
    const norm = Math.sqrt(sum) || 1;
    return vec.map((v: number) => v / norm);
}
export function mrlSlice(vec: number[], dimensions: number) {
    const sliced = vec.slice(0, dimensions);
    return l2Normalize(sliced);
}
export function floatArrayToBase64(vec: number[]) {
    const buf = Buffer.alloc(vec.length * 4);
    for (let i = 0; i < vec.length; i++)
        buf.writeFloatLE(vec[i], i * 4);
    return buf.toString("base64");
}
export function base64ToFloatArray(b64: string) {
    const buf = Buffer.from(b64, "base64");
    const out = [];
    for (let i = 0; i < buf.length; i += 4) {
        out.push(buf.readFloatLE(i));
    }
    return out;
}
export function chunkArray<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size));
    return out;
}
export async function normalizeEmbedBatch(inputs: string[], options: NormalizeEmbedBatchOptions) {
    const dimensions = options.dimensions;
    const indexed = inputs.map((text, i) => ({ text, i }));
    const nonEmpty = indexed.filter((x) => x.text.trim().length > 0);
    const batches = chunkArray(nonEmpty, options.upstream.maxBatch);
    const vectors = new Map<number, number[]>();
    for (const batch of batches) {
        const texts = batch.map((b) => b.text);
        const got = await options.upstream.embed(texts, options.model, dimensions);
        for (let j = 0; j < batch.length; j++) {
            let vec = got[j] ?? [];
            if (dimensions && vec.length > dimensions)
                vec = mrlSlice(vec, dimensions);
            else if (dimensions && vec.length === dimensions)
                vec = l2Normalize(vec);
            if (dimensions)
                assertDimensionFingerprint(options.lock ?? null, vec.length);
            vectors.set(batch[j].i, vec);
        }
    }
    const dim = dimensions ?? (vectors.values().next().value?.length ?? 0);
    const embeddings: number[][] = [];
    const indices: number[] = [];
    for (let i = 0; i < inputs.length; i++) {
        indices.push(i);
        embeddings.push(vectors.get(i) ?? new Array(dim).fill(0));
    }
    return { embeddings, indices };
}
export function createEmbedRequestHandler(opts: EmbedServerOpts) {
    return async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== "POST" || !req.url?.startsWith("/v1/embeddings")) {
            res.writeHead(404);
            res.end();
            return;
        }
        const body = await readBody(req);
        let parsed: Record<string, unknown>;
        try {
            const raw: unknown = JSON.parse(body);
            const rec = jsonRecord(raw);
            if (!rec) {
                res.writeHead(400);
                res.end("Invalid JSON");
                return;
            }
            parsed = rec;
        }
        catch {
            res.writeHead(400);
            res.end("Invalid JSON");
            return;
        }
        const rawInput = parsed.input;
        const input: string[] = Array.isArray(rawInput)
            ? rawInput.map((x) => String(x))
            : rawInput != null
                ? [String(rawInput)]
                : [];
        const lock = readEmbedLock(opts.repoRoot);
        try {
            const dimensions = typeof parsed.dimensions === "number" ? parsed.dimensions : undefined;
            const model = typeof parsed.model === "string" ? parsed.model : opts.defaultModel;
            const { embeddings } = await normalizeEmbedBatch(input, {
                dimensions,
                upstream: opts.upstream,
                model,
                lock,
            });
            if (dimensions && !lock) {
                writeEmbedLock(opts.repoRoot, {
                    provider: opts.upstream.name,
                    model,
                    dimension: dimensions,
                });
            }
            const data = embeddings.map((embedding, index) => {
                if (parsed.encoding_format === "base64") {
                    return { object: "embedding", index, embedding: floatArrayToBase64(embedding) };
                }
                return { object: "embedding", index, embedding };
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ object: "list", data, model: parsed.model, usage: {} }));
        }
        catch (e) {
            res.writeHead(400);
            res.end(String(e));
        }
    };
}
function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks).toString()));
        req.on("error", reject);
    });
}
export function startEmbedServer(opts: EmbedServerOpts) {
    const server = createServer(createEmbedRequestHandler(opts));
    server.listen(opts.port, "127.0.0.1");
    return server;
}
export function createDashScopeUpstream(fetchImpl: FetchLike = fetch, opts?: DashScopeUpstreamOpts) {
    return {
        name: "dashscope",
        maxBatch: 10,
        embed: async (input: string[], model: string, dimensions?: number) => {
            const key = opts?.apiKey ?? process.env.DASHSCOPE_API_KEY;
            if (!key) {
                throw new Error("DASHSCOPE_API_KEY is required for DashScope embed upstream");
            }
            const res = await fetchImpl("https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
                body: JSON.stringify({ model, input, dimensions }),
            });
            const j = jsonRecord(await res.json());
            const data = Array.isArray(j?.data) ? j.data : [];
            return data.map((d) => {
                const row = jsonRecord(d);
                const emb = row?.embedding;
                return Array.isArray(emb) ? emb.map((n) => Number(n)) : [];
            });
        },
    };
}
