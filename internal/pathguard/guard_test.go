package pathguard

import (
	"strings"
	"testing"
)

func TestRejectsOutsideCwd(t *testing.T) {
	_, err := AssertPathContainedUnderCwd("../outside.json", WorkingDir())
	if err == nil || !strings.Contains(err.Error(), "escapes working directory") {
		t.Fatalf("expected escape error, got %v", err)
	}
}
