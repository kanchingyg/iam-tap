import { createSocket, type Socket } from "node:dgram";
import { createHmac, randomBytes, randomUUID } from "node:crypto";

import {
  type CsmMessage,
  type IamActionRecord,
  dedupeActions,
  mapCsmMessage,
} from "./action-mapper.js";

export const CSM_TOKEN_ENV = "IAM_TAP_CSM_TOKEN";
export const CSM_CLIENT_ID_ENV = "AWS_CSM_CLIENT_ID";

export const DEFAULT_CSM_HOST = "127.0.0.1";

export type TraceRecord = {
  id: string;
  actions: IamActionRecord[];
  startedAt: number;
  endedAt?: number;
  cwd?: string;
  cmd?: string;
};

const traces = new Map<string, TraceRecord>();

export function getTrace(traceId: string): TraceRecord | undefined {
  return traces.get(traceId);
}

export function listTraceActionNames(traceId: string): string[] {
  const t = traces.get(traceId);
  if (!t) return [];
  return dedupeActions(t.actions);
}

export function createTrace(meta: { cwd?: string; cmd?: string }): TraceRecord {
  const id = randomUUID();
  const rec: TraceRecord = {
    id,
    actions: [],
    startedAt: Date.now(),
    cwd: meta.cwd,
    cmd: meta.cmd,
  };
  traces.set(id, rec);
  return rec;
}

export function finishTrace(traceId: string): void {
  const t = traces.get(traceId);
  if (t) t.endedAt = Date.now();
}

export function requireCsmToken(): string {
  const token = process.env[CSM_TOKEN_ENV];
  if (!token || !token.trim()) {
    throw new Error(`${CSM_TOKEN_ENV} is required for CSM UDP ingestion`);
  }
  return token.trim();
}

export function csmEnvForChild(token: string): Record<string, string> {
  return {
    [CSM_TOKEN_ENV]: token,
    [CSM_CLIENT_ID_ENV]: token,
  };
}

function packetAuthorized(raw: string, token: string): boolean {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return false;
  }
  const clientId = msg.ClientId;
  if (typeof clientId === "string" && clientId === token) return true;
  const hmac = msg.IamTapHmac;
  if (typeof hmac === "string" && hmac.length > 0) {
    const body =
      typeof msg.IamTapHmacBody === "string" ? msg.IamTapHmacBody : raw;
    const expected = createHmac("sha256", token).update(body).digest("hex");
    return hmac === expected;
  }
  return false;
}

export function ingestCsmPayload(traceId: string, raw: string, token: string): IamActionRecord[] {
  if (!packetAuthorized(raw, token)) return [];
  let msg: CsmMessage;
  try {
    msg = JSON.parse(raw) as CsmMessage;
  } catch {
    return [];
  }
  const mapped = mapCsmMessage(msg);
  const trace = traces.get(traceId);
  if (trace && mapped.length) trace.actions.push(...mapped);
  return mapped;
}

export type ListenerHandle = {
  host: string;
  port: number;
  token: string;
  socket: Socket;
  close: () => Promise<void>;
};

export function startCsmListener(
  traceId: string,
  options?: { host?: string; token?: string },
): Promise<ListenerHandle> {
  const host = options?.host ?? DEFAULT_CSM_HOST;
  const token = options?.token ?? requireCsmToken();
  const socket = createSocket("udp4");

  socket.on("message", (buf) => {
    ingestCsmPayload(traceId, buf.toString("utf8"), token);
  });

  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, host, () => {
      const addr = socket.address();
      const port = typeof addr === "object" ? addr.port : 0;
      resolve({
        host,
        port,
        token,
        socket,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            socket.close(() => resolveClose());
            socket.once("error", rejectClose);
          }),
      });
    });
  });
}

export function createEphemeralCsmToken(): string {
  return randomBytes(24).toString("hex");
}

export function wrapCsmMessageForTest(msg: CsmMessage, token: string): string {
  return JSON.stringify({ ...msg, ClientId: token });
}

export function simulateCsmMessage(
  traceId: string,
  msg: CsmMessage,
  token?: string,
): IamActionRecord[] {
  const t = token ?? process.env[CSM_TOKEN_ENV] ?? "test-token";
  return ingestCsmPayload(traceId, wrapCsmMessageForTest(msg, t), t);
}
