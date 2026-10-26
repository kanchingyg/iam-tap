---
name: iam-tap
description: Wrap AWS SDK/CLI commands to capture CSM UDP traces and emit least-privilege IAM policies.
---

# iam-tap

```bash
npx iam-tap -- npm test
npx iam-tap --mcp
```

Tools: `trace_aws_calls`, `generate_iam_policy`, `refine_resource_arns`. Read-only unless `--allow-write`.
