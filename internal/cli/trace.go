package cli

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/kanchingyg/iam-tap/internal/action"
	"github.com/kanchingyg/iam-tap/internal/csm"
	"github.com/kanchingyg/iam-tap/internal/policy"
)

type TraceResult struct {
	TraceID string
	Actions []string
}

type ExecFunc func(name string, args []string, env []string, dir string) error

func DefaultExec(name string, args []string, env []string, dir string) error {
	cmd := exec.Command(name, args...)
	cmd.Env = env
	cmd.Dir = dir
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func TraceCommand(argv []string, cwd string, execFn ExecFunc) (TraceResult, error) {
	if len(argv) == 0 {
		return TraceResult{}, fmt.Errorf("trace argv must not be empty")
	}
	workdir := cwd
	if workdir == "" {
		workdir, _ = os.Getwd()
	}
	workdir = filepath.Clean(workdir)
	cmdLabel := action.RedactSecrets(joinArgv(argv))
	trace := csm.CreateTrace(struct{ Cwd, Cmd string }{Cwd: workdir, Cmd: cmdLabel})
	token := csm.CreateEphemeralCsmToken()
	listener, err := csm.StartCsmListener(trace.ID, &csm.ListenerOptions{Token: token})
	if err != nil {
		return TraceResult{}, err
	}
	env := os.Environ()
	for k, v := range csm.CsmEnvForChild(token) {
		env = append(env, k+"="+v)
	}
	env = append(env,
		"AWS_CSM_ENABLED=true",
		"AWS_CSM_HOST="+listener.Host,
		"AWS_CSM_PORT="+fmt.Sprintf("%d", listener.Port),
	)
	file, spawnArgs := argv[0], argv[1:]
	if execFn == nil {
		execFn = DefaultExec
	}
	if err := execFn(file, spawnArgs, env, workdir); err != nil {
		_ = listener.Close()
		return TraceResult{}, err
	}
	_ = listener.Close()
	csm.FinishTrace(trace.ID)
	return TraceResult{TraceID: trace.ID, Actions: csm.ListTraceActionNames(trace.ID)}, nil
}

func joinArgv(argv []string) string {
	out := ""
	for i, a := range argv {
		if i > 0 {
			out += " "
		}
		out += a
	}
	return out
}

func ResourcesForTrace(traceID string) []string {
	trace := csm.GetTrace(traceID)
	region := ""
	if trace != nil {
		for _, a := range trace.Actions {
			if a.Region != "" {
				region = a.Region
				break
			}
		}
	}
	return action.RefineResourceArnsStatic(csm.ListTraceActionNames(traceID), region)
}

func PolicyFromTrace(traceID string, format policy.Format) (string, error) {
	actions := csm.ListTraceActionNames(traceID)
	if len(actions) == 0 {
		return "", fmt.Errorf("No actions recorded for trace %s", traceID)
	}
	return policy.Render(policy.Input{Actions: actions, Resources: ResourcesForTrace(traceID)}, format)
}
