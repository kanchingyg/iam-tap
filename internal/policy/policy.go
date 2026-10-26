package policy

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type Format string

const (
	FormatJSON       Format = "json"
	FormatTerraform  Format = "terraform"
	FormatCDK        Format = "cdk"
)

type Input struct {
	Actions   []string
	Resources []string
}

func BuildIamPolicyDocument(input Input) map[string]interface{} {
	actions := uniqueSorted(input.Actions)
	resources := input.Resources
	if len(resources) == 0 {
		resources = []string{"*"}
	}
	return map[string]interface{}{
		"Version": "2012-10-17",
		"Statement": []map[string]interface{}{
			{
				"Sid":      "IamTapLeastPrivilege",
				"Effect":   "Allow",
				"Action":   actions,
				"Resource": resources,
			},
		},
	}
}

func Render(input Input, format Format) (string, error) {
	switch format {
	case FormatJSON:
		doc := BuildIamPolicyDocument(input)
		b, err := json.MarshalIndent(doc, "", "  ")
		if err != nil {
			return "", err
		}
		return string(b), nil
	case FormatTerraform:
		return renderTerraform(input), nil
	case FormatCDK:
		return renderCDK(input), nil
	default:
		return "", fmt.Errorf("unknown format: %s", format)
	}
}

func renderTerraform(input Input) string {
	actions := uniqueSorted(input.Actions)
	resources := input.Resources
	if len(resources) == 0 {
		resources = []string{"*"}
	}
	actionList := quoteJoin(actions)
	resourceList := quoteJoin(resources)
	return fmt.Sprintf(`data "aws_iam_policy_document" "iam_tap" {
  statement {
    sid       = "IamTapLeastPrivilege"
    effect    = "Allow"
    actions   = [%s]
    resources = [%s]
  }
}
`, actionList, resourceList)
}

func renderCDK(input Input) string {
	doc := BuildIamPolicyDocument(input)
	stmtSlice, _ := doc["Statement"].([]map[string]interface{})
	stmt := stmtSlice[0]
	actionsJSON, _ := json.Marshal(stmt["Action"])
	resourcesJSON, _ := json.Marshal(stmt["Resource"])
	return fmt.Sprintf(`import * as iam from "aws-cdk-lib/aws-iam";

export const iamTapPolicy = new iam.PolicyDocument({
  statements: [
    new iam.PolicyStatement({
      sid: "IamTapLeastPrivilege",
      effect: iam.Effect.ALLOW,
      actions: %s,
      resources: %s,
    }),
  ],
});
`, string(actionsJSON), string(resourcesJSON))
}

func uniqueSorted(actions []string) []string {
	seen := make(map[string]bool)
	var out []string
	for _, a := range actions {
		if !seen[a] {
			seen[a] = true
			out = append(out, a)
		}
	}
	sort.Strings(out)
	return out
}

func quoteJoin(items []string) string {
	parts := make([]string, len(items))
	for i, item := range items {
		parts[i] = `"` + strings.ReplaceAll(item, `"`, `\"`) + `"`
	}
	return strings.Join(parts, ", ")
}
