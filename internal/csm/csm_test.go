package csm

import (
	"net"
	"testing"
	"time"

	"github.com/kanchingyg/iam-tap/internal/action"
)

func TestUdpListenerMapsActions(t *testing.T) {
	ResetTraces()
	trace := CreateTrace(struct{ Cwd, Cmd string }{Cmd: "npm test"})
	token := CreateEphemeralCsmToken()
	listener, err := StartCsmListener(trace.ID, &ListenerOptions{Token: token})
	if err != nil {
		t.Fatal(err)
	}

	client, err := net.Dial("udp", listener.Addr())
	if err != nil {
		t.Fatal(err)
	}
	send := func(msg action.CsmMessage) {
		_, _ = client.Write([]byte(WrapCsmMessageForTest(msg, token)))
	}
	send(action.CsmMessage{Version: 1, Type: "ApiCall", Service: "S3", Api: "GetObject", Region: "us-east-1"})
	send(action.CsmMessage{Version: 1, Type: "ApiCall", Service: "DynamoDB", Api: "PutItem", Region: "us-east-1"})
	send(action.CsmMessage{
		Version: 1, Type: "ApiCallAttempt", Service: "STS", Api: "DecodeAuthorizationMessage",
		HttpStatusCode: 403, DecodedActions: []string{"s3:ListBucket"},
	})
	time.Sleep(80 * time.Millisecond)
	_ = client.Close()
	_ = listener.Close()

	actions := ListTraceActionNames(trace.ID)
	if !contains(actions, "s3:GetObject") || !contains(actions, "dynamodb:PutItem") || !contains(actions, "s3:ListBucket") {
		t.Fatalf("actions %v", actions)
	}
}

func TestIgnoresUnauthorizedPackets(t *testing.T) {
	ResetTraces()
	trace := CreateTrace(struct{ Cwd, Cmd string }{})
	token := CreateEphemeralCsmToken()
	listener, err := StartCsmListener(trace.ID, &ListenerOptions{Token: token})
	if err != nil {
		t.Fatal(err)
	}
	client, err := net.Dial("udp", listener.Addr())
	if err != nil {
		t.Fatal(err)
	}
	_, _ = client.Write([]byte(`{"Version":1,"Type":"ApiCall","Service":"S3","Api":"GetObject"}`))
	_ = client.Close()
	time.Sleep(40 * time.Millisecond)
	_ = listener.Close()
	if len(ListTraceActionNames(trace.ID)) != 0 {
		t.Fatal("expected no actions")
	}
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}
