package cli

import (
	"testing"

	"github.com/kanchingyg/iam-tap/internal/policy"
)

func TestParseArgv(t *testing.T) {
	if !ParseArgv([]string{"--mcp"}).MCP {
		t.Fatal("mcp")
	}
	p := ParseArgv([]string{"--format", "terraform", "--", "npm", "test"})
	if p.Format != policy.FormatTerraform || len(p.Cmd) != 2 {
		t.Fatalf("%v", p)
	}
}
