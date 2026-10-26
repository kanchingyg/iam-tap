package policy

import (
	"reflect"
	"testing"
)

func TestBuildIamPolicyDocument(t *testing.T) {
	doc := BuildIamPolicyDocument(Input{
		Actions:   []string{"s3:GetObject", "dynamodb:PutItem"},
		Resources: []string{"*"},
	})
	stmt := doc["Statement"].([]map[string]interface{})[0]
	actions := stmt["Action"].([]string)
	if !reflect.DeepEqual(actions, []string{"dynamodb:PutItem", "s3:GetObject"}) {
		t.Fatalf("actions %v", actions)
	}
}

func TestRenderTerraform(t *testing.T) {
	out, err := Render(Input{
		Actions:   []string{"s3:GetObject", "dynamodb:PutItem"},
		Resources: []string{"*"},
	}, FormatTerraform)
	if err != nil {
		t.Fatal(err)
	}
	if !contains(out, `actions   = ["dynamodb:PutItem", "s3:GetObject"]`) {
		t.Fatalf("terraform mismatch:\n%s", out)
	}
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && findSub(s, sub))
}

func findSub(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
