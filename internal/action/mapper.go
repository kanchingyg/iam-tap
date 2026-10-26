package action

import (
	"regexp"
	"strings"
)

var akiaRe = regexp.MustCompile(`AKIA[0-9A-Z]{16}`)
var asiaRe = regexp.MustCompile(`ASIA[0-9A-Z]{16}`)

type CsmMessage struct {
	Version        int      `json:"Version"`
	Type           string   `json:"Type"`
	Service        string   `json:"Service"`
	Api            string   `json:"Api"`
	Region         string   `json:"Region"`
	HttpStatusCode int      `json:"HttpStatusCode"`
	DecodedActions []string `json:"DecodedActions"`
}

type IamActionRecord struct {
	Action  string
	Service string
	Api     string
	Region  string
	Source  string
}

var serviceAliases = map[string]string{
	"S3":       "s3",
	"DynamoDB": "dynamodb",
	"STS":      "sts",
	"Bedrock":  "bedrock",
	"IAM":      "iam",
}

func ServiceToPrefix(service string) string {
	trimmed := strings.TrimSpace(service)
	if p, ok := serviceAliases[trimmed]; ok {
		return p
	}
	return strings.ToLower(trimmed)
}

func ApiToAction(service, api string) string {
	return ServiceToPrefix(service) + ":" + api
}

func MapCsmMessage(msg CsmMessage) []IamActionRecord {
	typ := msg.Type
	service := msg.Service
	api := msg.Api
	if service == "" || api == "" {
		return nil
	}

	if typ == "ApiCallAttempt" && service == "STS" && api == "DecodeAuthorizationMessage" && msg.HttpStatusCode == 403 {
		if len(msg.DecodedActions) > 0 {
			out := make([]IamActionRecord, 0, len(msg.DecodedActions))
			for _, action := range msg.DecodedActions {
				parts := strings.SplitN(action, ":", 2)
				svc := "sts"
				apiName := api
				if len(parts) > 0 && parts[0] != "" {
					svc = parts[0]
				}
				if len(parts) > 1 {
					apiName = parts[1]
				}
				out = append(out, IamActionRecord{
					Action:  action,
					Service: svc,
					Api:     apiName,
					Region:  msg.Region,
					Source:  "sts-decode",
				})
			}
			return out
		}
		return []IamActionRecord{{
			Action:  "sts:DecodeAuthorizationMessage",
			Service: "sts",
			Api:     api,
			Region:  msg.Region,
			Source:  "sts-decode",
		}}
	}

	if typ == "ApiCall" || typ == "ApiCallAttempt" {
		return []IamActionRecord{{
			Action:  ApiToAction(service, api),
			Service: ServiceToPrefix(service),
			Api:     api,
			Region:  msg.Region,
			Source:  "csm",
		}}
	}
	return nil
}

func DedupeActions(records []IamActionRecord) []string {
	seen := make(map[string]bool)
	var out []string
	for _, r := range records {
		if !seen[r.Action] {
			seen[r.Action] = true
			out = append(out, r.Action)
		}
	}
	sortStrings(out)
	return out
}

func sortStrings(s []string) {
	for i := 0; i < len(s); i++ {
		for j := i + 1; j < len(s); j++ {
			if s[j] < s[i] {
				s[i], s[j] = s[j], s[i]
			}
		}
	}
}

var arnRules = map[string]func(region string) string{
	"s3:GetObject":                     func(_ string) string { return "arn:aws:s3:::*/*" },
	"s3:PutObject":                     func(_ string) string { return "arn:aws:s3:::*/*" },
	"dynamodb:PutItem":                 func(region string) string { return "arn:aws:dynamodb:" + orStar(region) + ":*:table/*" },
	"sts:DecodeAuthorizationMessage":   func(_ string) string { return "*" },
	"bedrock:InvokeModel":              func(region string) string { return "arn:aws:bedrock:" + orStar(region) + "::foundation-model/*" },
	"bedrock:InvokeModelWithResponseStream": func(region string) string {
		return "arn:aws:bedrock:" + orStar(region) + "::foundation-model/*"
	},
}

func orStar(region string) string {
	if region == "" {
		return "*"
	}
	return region
}

func RefineResourceArnsStatic(actions []string, region string) []string {
	arns := make(map[string]bool)
	for _, action := range actions {
		rule, ok := arnRules[action]
		if ok {
			arns[rule(region)] = true
		} else {
			arns["*"] = true
		}
	}
	out := make([]string, 0, len(arns))
	for a := range arns {
		out = append(out, a)
	}
	sortStrings(out)
	return out
}

func RedactSecrets(text string) string {
	out := akiaRe.ReplaceAllString(text, "[REDACTED]")
	out = asiaRe.ReplaceAllString(out, "[REDACTED]")
	return out
}
