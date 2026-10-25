package csm

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/kanchingyg/iam-tap/internal/action"
)

const TokenEnv = "IAM_TAP_CSM_TOKEN"
const ClientIDEnv = "AWS_CSM_CLIENT_ID"
const DefaultHost = "127.0.0.1"

type TraceRecord struct {
	ID        string
	Actions   []action.IamActionRecord
	StartedAt int64
	EndedAt   int64
	Cwd       string
	Cmd       string
}

var (
	tracesMu sync.RWMutex
	traces   = map[string]*TraceRecord{}
)

func CreateTrace(meta struct{ Cwd, Cmd string }) *TraceRecord {
	id := newUUID()
	rec := &TraceRecord{
		ID:        id,
		Actions:   nil,
		StartedAt: time.Now().UnixMilli(),
		Cwd:       meta.Cwd,
		Cmd:       meta.Cmd,
	}
	tracesMu.Lock()
	traces[id] = rec
	tracesMu.Unlock()
	return rec
}

func GetTrace(traceID string) *TraceRecord {
	tracesMu.RLock()
	t := traces[traceID]
	tracesMu.RUnlock()
	return t
}

func ListTraceActionNames(traceID string) []string {
	tracesMu.RLock()
	t := traces[traceID]
	tracesMu.RUnlock()
	if t == nil {
		return nil
	}
	return action.DedupeActions(t.Actions)
}

func FinishTrace(traceID string) {
	tracesMu.Lock()
	if t := traces[traceID]; t != nil {
		t.EndedAt = time.Now().UnixMilli()
	}
	tracesMu.Unlock()
}

func RequireCsmToken() (string, error) {
	token := os.Getenv(TokenEnv)
	if token == "" || len(stringsTrim(token)) == 0 {
		return "", fmt.Errorf("%s is required for CSM UDP ingestion", TokenEnv)
	}
	return stringsTrim(token), nil
}

func stringsTrim(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}

func CsmEnvForChild(token string) map[string]string {
	return map[string]string{
		TokenEnv:    token,
		ClientIDEnv: token,
	}
}

func packetAuthorized(raw string, token string) bool {
	var msg map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &msg); err != nil {
		return false
	}
	if clientID, ok := msg["ClientId"].(string); ok && clientID == token {
		return true
	}
	if hmacVal, ok := msg["IamTapHmac"].(string); ok && hmacVal != "" {
		body, _ := msg["IamTapHmacBody"].(string)
		if body == "" {
			body = raw
		}
		mac := hmac.New(sha256.New, []byte(token))
		mac.Write([]byte(body))
		expected := hex.EncodeToString(mac.Sum(nil))
		return hmacVal == expected
	}
	return false
}

func IngestCsmPayload(traceID, raw, token string) []action.IamActionRecord {
	if !packetAuthorized(raw, token) {
		return nil
	}
	var msg action.CsmMessage
	if err := json.Unmarshal([]byte(raw), &msg); err != nil {
		return nil
	}
	mapped := action.MapCsmMessage(msg)
	tracesMu.Lock()
	if trace := traces[traceID]; trace != nil && len(mapped) > 0 {
		trace.Actions = append(trace.Actions, mapped...)
	}
	tracesMu.Unlock()
	return mapped
}

func CreateEphemeralCsmToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func WrapCsmMessageForTest(msg action.CsmMessage, token string) string {
	var m map[string]interface{}
	b, _ := json.Marshal(msg)
	_ = json.Unmarshal(b, &m)
	m["ClientId"] = token
	out, _ := json.Marshal(m)
	return string(out)
}

func SimulateCsmMessage(traceID string, msg action.CsmMessage, token string) []action.IamActionRecord {
	if token == "" {
		token = os.Getenv(TokenEnv)
		if token == "" {
			token = "test-token"
		}
	}
	return IngestCsmPayload(traceID, WrapCsmMessageForTest(msg, token), token)
}

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ResetTraces clears in-memory traces (tests only).
func ResetTraces() {
	tracesMu.Lock()
	traces = map[string]*TraceRecord{}
	tracesMu.Unlock()
}
