package mcp

import (
	"strings"
	"testing"

	"github.com/kanchingyg/iam-tap/internal/action"
	"github.com/kanchingyg/iam-tap/internal/csm"
)

func TestToolsList(t *testing.T) {
	out := DispatchMessageForTest(map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "tools/list",
		"params":  map[string]interface{}{},
	}, ".")
	result, _ := out["result"].(map[string]interface{})
	tools, _ := result["tools"].([]interface{})
	found := false
	for _, tl := range tools {
		tm, _ := tl.(map[string]interface{})
		if tm["name"] == "trace_aws_calls" {
			found = true
		}
	}
	if !found {
		t.Fatal("missing trace_aws_calls")
	}
}

func TestDryRunBlocksWrite(t *testing.T) {
	csm.ResetTraces()
	SetGuards(false, true)
	trace := csm.CreateTrace(struct{ Cwd, Cmd string }{Cmd: "x"})
	csm.SimulateCsmMessage(trace.ID, action.CsmMessage{
		Version: 1, Type: "ApiCall", Service: "S3", Api: "GetObject",
	}, "")
	gen := DispatchMessageForTest(map[string]interface{}{
		"jsonrpc": "2.0", "id": 10, "method": "tools/call",
		"params": map[string]interface{}{
			"name": "generate_iam_policy",
			"arguments": map[string]interface{}{"traceId": trace.ID, "format": "json"},
		},
	}, ".")
	genRes, _ := gen["result"].(map[string]interface{})
	if genRes["isError"] == true {
		t.Fatalf("generate should work: %v", gen)
	}
	write := DispatchMessageForTest(map[string]interface{}{
		"jsonrpc": "2.0", "id": 11, "method": "tools/call",
		"params": map[string]interface{}{
			"name": "write_policy_file",
			"arguments": map[string]interface{}{"traceId": trace.ID, "format": "json", "path": "policy.json"},
		},
	}, ".")
	writeRes, _ := write["result"].(map[string]interface{})
	content, _ := writeRes["content"].([]interface{})
	first, _ := content[0].(map[string]interface{})
	text, _ := first["text"].(string)
	if !strings.Contains(strings.ToLower(text), "dry-run") && !strings.Contains(strings.ToLower(text), "allow-write") {
		t.Fatalf("expected block message, got %s", text)
	}
}
