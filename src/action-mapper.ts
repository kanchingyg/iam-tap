export type CsmMessage = {
  Version?: number;
  Type?: string;
  Service?: string;
  Api?: string;
  Region?: string;
  HttpStatusCode?: number;
  EncodedAuthorizationMessage?: string;
  DecodedActions?: string[];
};

export type IamActionRecord = {
  action: string;
  service: string;
  api: string;
  region?: string;
  source: "csm" | "sts-decode";
};

const SERVICE_ALIASES: Record<string, string> = {
  S3: "s3",
  DynamoDB: "dynamodb",
  STS: "sts",
  Bedrock: "bedrock",
  IAM: "iam",
};

export function serviceToPrefix(service: string): string {
  const trimmed = service.trim();
  if (SERVICE_ALIASES[trimmed]) return SERVICE_ALIASES[trimmed];
  return trimmed.replace(/([a-z])([A-Z])/g, "$1$2").toLowerCase();
}

export function apiToAction(service: string, api: string): string {
  return `${serviceToPrefix(service)}:${api}`;
}

export function mapCsmMessage(msg: CsmMessage): IamActionRecord[] {
  const type = msg.Type ?? "";
  const service = msg.Service ?? "";
  const api = msg.Api ?? "";
  if (!service || !api) return [];

  if (
    type === "ApiCallAttempt" &&
    service === "STS" &&
    api === "DecodeAuthorizationMessage" &&
    msg.HttpStatusCode === 403
  ) {
    if (msg.DecodedActions?.length) {
      return msg.DecodedActions.map((action) => ({
        action,
        service: action.split(":")[0] ?? "sts",
        api: action.split(":")[1] ?? api,
        region: msg.Region,
        source: "sts-decode",
      }));
    }
    return [
      {
        action: "sts:DecodeAuthorizationMessage",
        service: "sts",
        api,
        region: msg.Region,
        source: "sts-decode",
      },
    ];
  }

  if (type === "ApiCall" || type === "ApiCallAttempt") {
    return [
      {
        action: apiToAction(service, api),
        service: serviceToPrefix(service),
        api,
        region: msg.Region,
        source: "csm",
      },
    ];
  }
  return [];
}

export function dedupeActions(records: IamActionRecord[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of records) {
    if (!seen.has(r.action)) {
      seen.add(r.action);
      out.push(r.action);
    }
  }
  return out.sort();
}

const ARN_RULES: Record<string, (region?: string) => string> = {
  "s3:GetObject": () => "arn:aws:s3:::*/*",
  "s3:PutObject": () => "arn:aws:s3:::*/*",
  "dynamodb:PutItem": (region) => `arn:aws:dynamodb:${region ?? "*"}:*:table/*`,
  "sts:DecodeAuthorizationMessage": () => "*",
  "bedrock:InvokeModel": (region) => `arn:aws:bedrock:${region ?? "*"}::foundation-model/*`,
  "bedrock:InvokeModelWithResponseStream": (region) =>
    `arn:aws:bedrock:${region ?? "*"}::foundation-model/*`,
};

export function refineResourceArnsStatic(actions: string[], region?: string): string[] {
  const arns = new Set<string>();
  for (const action of actions) {
    const rule = ARN_RULES[action];
    arns.add(rule ? rule(region) : "*");
  }
  return [...arns];
}

export function redactSecrets(text: string): string {
  return text
    .replace(/(AKIA[0-9A-Z]{16})/g, "[REDACTED]")
    .replace(/(ASIA[0-9A-Z]{16})/g, "[REDACTED]")
    .replace(/(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g, "[REDACTED]")
    .replace(/(aws_secret_access_key\s*=\s*)[^\s]+/gi, "$1[REDACTED]");
}
