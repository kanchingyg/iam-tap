package action

import (
	"strings"
	"testing"
)

func TestApiToAction(t *testing.T) {
	if ApiToAction("S3", "GetObject") != "s3:GetObject" {
		t.Fatalf("unexpected action")
	}
}

func TestMapCsmStsDecode(t *testing.T) {
	msg := CsmMessage{
		Version:        1,
		Type:           "ApiCallAttempt",
		Service:        "STS",
		Api:            "DecodeAuthorizationMessage",
		HttpStatusCode: 403,
		DecodedActions: []string{"s3:ListBucket"},
	}
	recs := MapCsmMessage(msg)
	if len(recs) != 1 || recs[0].Action != "s3:ListBucket" {
		t.Fatalf("got %v", recs)
	}
}

func TestRedactSecrets(t *testing.T) {
	out := RedactSecrets("key=AKIAIOSFODNN7EXAMPLE")
	if !strings.Contains(out, "[REDACTED]") || strings.Contains(out, "AKIAIOSFODNN7EXAMPLE") {
		t.Fatalf("redact failed: %s", out)
	}
}
