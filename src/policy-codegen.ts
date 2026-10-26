/** Configuration and data shape for `PolicyFormat` (policy format). */
export type PolicyFormat = "json" | "terraform" | "cdk";

export type PolicyInput = {
  actions: string[];
  resources?: string[];
};

const DEFAULT_RESOURCES = ["*"];

export function buildIamPolicyDocument(input: PolicyInput): Record<string, unknown> {
  const actions = [...new Set(input.actions)].sort();
  const resources = input.resources?.length ? input.resources : DEFAULT_RESOURCES;
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "IamTapLeastPrivilege",
        Effect: "Allow",
        Action: actions,
        Resource: resources,
      },
    ],
  };
}

export function renderPolicy(input: PolicyInput, format: PolicyFormat): string {
  switch (format) {
    case "json":
      return JSON.stringify(buildIamPolicyDocument(input), null, 2);
    case "terraform":
      return renderTerraform(input);
    case "cdk":
      return renderCdk(input);
    default: {
      const _exhaustive: never = format;
      return _exhaustive;
    }
  }
}

export function renderTerraform(input: PolicyInput): string {
  const actions = [...new Set(input.actions)].sort();
  const resources = input.resources?.length ? input.resources : DEFAULT_RESOURCES;
  const actionList = actions.map((a) => `"${a}"`).join(", ");
  const resourceList = resources.map((r) => `"${r}"`).join(", ");
  return `data "aws_iam_policy_document" "iam_tap" {
  statement {
    sid       = "IamTapLeastPrivilege"
    effect    = "Allow"
    actions   = [${actionList}]
    resources = [${resourceList}]
  }
}
`;
}

export function renderCdk(input: PolicyInput): string {
  const doc = buildIamPolicyDocument(input);
  const stmt = (doc.Statement as Array<{ Action: string[]; Resource: string[] }>)[0];
  return `import * as iam from "aws-cdk-lib/aws-iam";

export const iamTapPolicy = new iam.PolicyDocument({
  statements: [
    new iam.PolicyStatement({
      sid: "IamTapLeastPrivilege",
      effect: iam.Effect.ALLOW,
      actions: ${JSON.stringify(stmt.Action)},
      resources: ${JSON.stringify(stmt.Resource)},
    }),
  ],
});
`;
}
