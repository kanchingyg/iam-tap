package pathguard

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func AssertPathContainedUnderCwd(filePath, cwd string) (string, error) {
	base, err := filepath.Abs(cwd)
	if err != nil {
		return "", err
	}
	target, err := filepath.Abs(filepath.Join(base, filePath))
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(base, target)
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return "", fmt.Errorf("Path escapes working directory: %s", filePath)
	}
	return filepath.Clean(target), nil
}

func MustAssertPathContainedUnderCwd(filePath, cwd string) string {
	p, err := AssertPathContainedUnderCwd(filePath, cwd)
	if err != nil {
		panic(err)
	}
	return p
}

func WorkingDir() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}
