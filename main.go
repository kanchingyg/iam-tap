package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/kanchingyg/iam-tap/internal/cli"
	"github.com/kanchingyg/iam-tap/internal/mcp"
	"github.com/kanchingyg/iam-tap/internal/policy"
)

const version = "0.1.0"

func main() {
	code := run(os.Args[1:])
	os.Exit(code)
}

func run(argv []string) int {
	parsed := cli.ParseArgv(argv)
	if parsed.Help {
		_, _ = fmt.Fprintf(os.Stderr, "iam-tap %s\n  npx iam-tap -- <cmd>\n  npx iam-tap --format terraform -- <cmd>\n  npx iam-tap --mcp\n  go install github.com/kanchingyg/iam-tap@latest\n", version)
		return 0
	}
	mcp.SetGuards(parsed.AllowWrite, parsed.DryRun)
	if parsed.MCP {
		if err := mcp.RunMCPServer(""); err != nil {
			_, _ = fmt.Fprintf(os.Stderr, "%v\n", err)
			return 1
		}
		return 0
	}
	if len(parsed.Cmd) == 0 {
		_, _ = fmt.Fprintln(os.Stderr, "iam-tap: pass a command after -- or use --mcp")
		return 2
	}
	res, err := cli.TraceCommand(parsed.Cmd, "", nil)
	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "%v\n", err)
		return 1
	}
	pol, err := cli.PolicyFromTrace(res.TraceID, parsed.Format)
	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "%v\n", err)
		return 1
	}
	_, _ = os.Stdout.WriteString(pol)
	if !strings.HasSuffix(pol, "\n") {
		_, _ = os.Stdout.WriteString("\n")
	}
	return 0
}

// Ensure policy formats compile.
var _ = policy.FormatJSON
