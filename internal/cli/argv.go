package cli

import "github.com/kanchingyg/iam-tap/internal/policy"

type ParsedArgv struct {
	MCP        bool
	Format     policy.Format
	AllowWrite bool
	DryRun     bool
	Help       bool
	Cmd        []string
}

func ParseArgv(argv []string) ParsedArgv {
	out := ParsedArgv{
		Format: policy.FormatJSON,
		DryRun: true,
	}
	i := 0
	for i < len(argv) {
		a := argv[i]
		switch a {
		case "--mcp":
			out.MCP = true
			i++
		case "--allow-write":
			out.AllowWrite = true
			out.DryRun = false
			i++
		case "--dry-run":
			out.DryRun = true
			i++
		case "--format":
			if i+1 < len(argv) {
				out.Format = policy.Format(argv[i+1])
				i += 2
				continue
			}
			i++
		case "--help", "-h":
			out.Help = true
			i++
		case "--":
			out.Cmd = argv[i+1:]
			return out
		default:
			out.Cmd = argv[i:]
			return out
		}
	}
	return out
}
