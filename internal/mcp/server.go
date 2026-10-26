package mcp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"github.com/kanchingyg/iam-tap/internal/cli"
	"github.com/kanchingyg/iam-tap/internal/pathguard"
	"github.com/kanchingyg/iam-tap/internal/policy"
)

const Version = "0.1.1"

var (
	allowWrite bool
	dryRun     bool = true
	guardsMu   sync.RWMutex
)

func SetGuards(allow bool, dry bool) {
	guardsMu.Lock()
	allowWrite = allow
	dryRun = dry
	guardsMu.Unlock()
}

type ToolDef struct {
	Name        string
	Description string
	InputSchema map[string]interface{}
	Mutates     bool
}

func IamTapTools() []ToolDef {
	return []ToolDef{
		{
			Name:        "trace_aws_calls",
			Description: "Run a command with AWS CSM tracing enabled.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"argv": map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}},
					"cwd":  map[string]interface{}{"type": "string"},
				},
				"required":             []interface{}{"argv"},
				"additionalProperties": false,
			},
		},
		{
			Name:        "generate_iam_policy",
			Description: "Generate least-privilege IAM policy from a trace.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"traceId": map[string]interface{}{"type": "string"},
					"format":  map[string]interface{}{"type": "string", "enum": []interface{}{"json", "terraform", "cdk"}},
				},
				"required":             []interface{}{"traceId", "format"},
				"additionalProperties": false,
			},
		},
		{
			Name:        "refine_resource_arns",
			Description: "Tighten wildcard ARNs using static rules or local LLM.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"traceId": map[string]interface{}{"type": "string"},
					"model":   map[string]interface{}{"type": "string"},
				},
				"required":             []interface{}{"traceId"},
				"additionalProperties": false,
			},
		},
		{
			Name:        "write_policy_file",
			Description: "Write generated policy to disk (requires allow-write).",
			Mutates:     true,
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"traceId": map[string]interface{}{"type": "string"},
					"format":  map[string]interface{}{"type": "string", "enum": []interface{}{"json", "terraform", "cdk"}},
					"path":    map[string]interface{}{"type": "string"},
				},
				"required":             []interface{}{"traceId", "format", "path"},
				"additionalProperties": false,
			},
		},
	}
}

func guardMutating(tool ToolDef) (blocked bool, reason string) {
	if !tool.Mutates {
		return false, ""
	}
	guardsMu.RLock()
	dr := dryRun
	aw := allowWrite
	guardsMu.RUnlock()
	if dr {
		return true, fmt.Sprintf("[dry-run] Mutating tool %s blocked. Omit --dry-run and pass --allow-write to enable writes.", tool.Name)
	}
	if !aw {
		return true, "Read-only mode: pass --allow-write to enable mutating tools."
	}
	return false, ""
}

func RunMCPServer(cwd string) error {
	if cwd == "" {
		cwd = pathguard.WorkingDir()
	}
	tools := IamTapTools()
	scanner := bufio.NewScanner(os.Stdin)
	var buffer string
	for {
		if !scanner.Scan() {
			return nil
		}
		buffer += scanner.Text() + "\n"
		for {
			idx := indexNewline(buffer)
			if idx < 0 {
				break
			}
			line := trimLine(buffer[:idx])
			buffer = buffer[idx+1:]
			if line == "" {
				continue
			}
			var msg map[string]interface{}
			if err := json.Unmarshal([]byte(line), &msg); err != nil {
				continue
			}
			dispatchMessage(msg, tools, cwd)
		}
	}
}

func indexNewline(s string) int {
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			return i
		}
	}
	return -1
}

func trimLine(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}

func dispatchMessage(msg map[string]interface{}, tools []ToolDef, cwd string) {
	id := msg["id"]
	method, _ := msg["method"].(string)
	params, _ := msg["params"].(map[string]interface{})

	switch method {
	case "initialize":
		writeFrame(map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      id,
			"result": map[string]interface{}{
				"protocolVersion": "2024-11-05",
				"capabilities":    map[string]interface{}{"tools": map[string]interface{}{}},
				"serverInfo":      map[string]interface{}{"name": "iam-tap", "version": Version},
			},
		})
	case "notifications/initialized":
	case "tools/list":
		toolList := make([]map[string]interface{}, 0, len(tools))
		for _, t := range tools {
			toolList = append(toolList, map[string]interface{}{
				"name":        t.Name,
				"description": t.Description,
				"inputSchema": t.InputSchema,
			})
		}
		writeFrame(map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      id,
			"result":  map[string]interface{}{"tools": toolList},
		})
	case "tools/call":
		name, _ := params["name"].(string)
		args, _ := params["arguments"].(map[string]interface{})
		tool := findTool(tools, name)
		if tool != nil {
			blocked, reason := guardMutating(*tool)
			if blocked {
				writeFrame(map[string]interface{}{
					"jsonrpc": "2.0",
					"id":      id,
					"result": map[string]interface{}{
						"content": []map[string]interface{}{{"type": "text", "text": reason}},
						"isError": true,
					},
				})
				return
			}
		}
		text, isErr := handleToolCall(name, args, cwd)
		writeFrame(map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      id,
			"result": map[string]interface{}{
				"content": []map[string]interface{}{{"type": "text", "text": text}},
				"isError": isErr,
			},
		})
	default:
		if id != nil {
			writeFrame(map[string]interface{}{
				"jsonrpc": "2.0",
				"id":      id,
				"error":   map[string]interface{}{"code": -32601, "message": fmt.Sprintf("Method not found: %s", method)},
			})
		}
	}
}

func findTool(tools []ToolDef, name string) *ToolDef {
	for i := range tools {
		if tools[i].Name == name {
			return &tools[i]
		}
	}
	return nil
}

func handleToolCall(name string, args map[string]interface{}, cwd string) (string, bool) {
	switch name {
	case "trace_aws_calls":
		argvRaw, ok := args["argv"].([]interface{})
		if !ok {
			return "trace_aws_calls requires argv: string[]", true
		}
		argv := make([]string, len(argvRaw))
		for i, v := range argvRaw {
			argv[i] = fmt.Sprint(v)
		}
		workdir := cwd
		if c, ok := args["cwd"].(string); ok && c != "" {
			workdir = c
		}
		res, err := cli.TraceCommand(argv, workdir, nil)
		if err != nil {
			return err.Error(), true
		}
		b, _ := json.MarshalIndent(res, "", "  ")
		return string(b), false
	case "generate_iam_policy":
		traceID := fmt.Sprint(args["traceId"])
		format := policy.FormatJSON
		if f, ok := args["format"].(string); ok {
			format = policy.Format(f)
		}
		pol, err := cli.PolicyFromTrace(traceID, format)
		if err != nil {
			return err.Error(), true
		}
		b, _ := json.Marshal(map[string]string{"policy": pol})
		return string(b), false
	case "refine_resource_arns":
		traceID := fmt.Sprint(args["traceId"])
		resources := cli.ResourcesForTrace(traceID)
		b, _ := json.Marshal(map[string]interface{}{"resources": resources})
		return string(b), false
	case "write_policy_file":
		traceID := fmt.Sprint(args["traceId"])
		format := policy.FormatJSON
		if f, ok := args["format"].(string); ok {
			format = policy.Format(f)
		}
		relPath := fmt.Sprint(args["path"])
		target, err := pathguard.AssertPathContainedUnderCwd(relPath, cwd)
		if err != nil {
			return err.Error(), true
		}
		body, err := cli.PolicyFromTrace(traceID, format)
		if err != nil {
			return err.Error(), true
		}
		if err := os.WriteFile(target, []byte(body), 0o644); err != nil {
			return err.Error(), true
		}
		b, _ := json.Marshal(map[string]interface{}{"written": target, "bytes": len(body)})
		return string(b), false
	default:
		b, _ := json.Marshal(map[string]interface{}{"ok": true, "tool": name, "args": args})
		return string(b), false
	}
}

func writeFrame(obj map[string]interface{}) {
	line, _ := json.Marshal(obj)
	fmt.Fprintf(os.Stdout, "%s\n", line)
}

// DispatchMessageForTest exposes JSON-RPC handling for unit tests.
func DispatchMessageForTest(msg map[string]interface{}, cwd string) map[string]interface{} {
	capture := ""
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w
	dispatchMessage(msg, IamTapTools(), cwd)
	w.Close()
	os.Stdout = oldStdout
	scanner := bufio.NewScanner(r)
	if scanner.Scan() {
		capture = scanner.Text()
	}
	var out map[string]interface{}
	_ = json.Unmarshal([]byte(capture), &out)
	return out
}
