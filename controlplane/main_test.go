package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testLogger() *log.Logger {
	return log.New(io.Discard, "", 0)
}

func TestHealthIndependentOfBackend(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("frontend"), 0o644); err != nil {
		t.Fatal(err)
	}

	backend, _ := url.Parse("http://127.0.0.1:1")
	handler, err := newHandler(config{AdminPort: 81, FrontendRoot: root, BackendURL: backend}, testLogger())
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/__npm_improved/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"component":"control-plane"`) {
		t.Fatalf("unexpected health body: %s", rec.Body.String())
	}

	var health healthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &health); err != nil {
		t.Fatalf("health response is not valid JSON: %v", err)
	}
	if health.Checks["controlPlane"].Status != "ok" {
		t.Fatalf("control plane must report itself healthy: %#v", health.Checks["controlPlane"])
	}
	if health.Checks["backend"].Status == "ok" {
		t.Fatalf("unreachable backend must not report healthy: %#v", health.Checks["backend"])
	}
}

func TestAPIProxyStripsAPIPrefix(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tokens" {
			t.Errorf("expected backend path /tokens, got %q", r.URL.Path)
		}
		if r.URL.RawQuery != "x=1" {
			t.Errorf("expected query x=1, got %q", r.URL.RawQuery)
		}
		if r.Header.Get("X-Forwarded-Proto") != "http" {
			t.Errorf("expected X-Forwarded-Proto=http, got %q", r.Header.Get("X-Forwarded-Proto"))
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("proxied"))
	}))
	defer backend.Close()

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("frontend"), 0o644); err != nil {
		t.Fatal(err)
	}
	backendURL, _ := url.Parse(backend.URL)
	handler, err := newHandler(config{AdminPort: 81, FrontendRoot: root, BackendURL: backendURL}, testLogger())
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/tokens?x=1", strings.NewReader("body"))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != "proxied" {
		t.Fatalf("unexpected body %q", rec.Body.String())
	}
}

func TestSPAStaticAndFallback(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("SPA INDEX"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "app.js"), []byte("console.log('ok')"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "legacy.html"), []byte("LEGACY"), 0o644); err != nil {
		t.Fatal(err)
	}

	backend, _ := url.Parse("http://127.0.0.1:1")
	handler, err := newHandler(config{AdminPort: 81, FrontendRoot: root, BackendURL: backend}, testLogger())
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		path string
		want string
	}{
		{"/app.js", "console.log('ok')"},
		{"/legacy", "LEGACY"},
		{"/settings/advanced", "SPA INDEX"},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d", rec.Code)
			}
			if rec.Body.String() != tc.want {
				t.Fatalf("expected %q, got %q", tc.want, rec.Body.String())
			}
		})
	}
}

func TestBackendFailureDoesNotTakeDownControlPlane(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("frontend"), 0o644); err != nil {
		t.Fatal(err)
	}

	backend, _ := url.Parse("http://127.0.0.1:1")
	handler, err := newHandler(config{AdminPort: 81, FrontendRoot: root, BackendURL: backend}, testLogger())
	if err != nil {
		t.Fatal(err)
	}

	apiRec := httptest.NewRecorder()
	handler.ServeHTTP(apiRec, httptest.NewRequest(http.MethodGet, "/api/users", nil))
	if apiRec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", apiRec.Code)
	}

	uiRec := httptest.NewRecorder()
	handler.ServeHTTP(uiRec, httptest.NewRequest(http.MethodGet, "/", nil))
	if uiRec.Code != http.StatusOK || uiRec.Body.String() != "frontend" {
		t.Fatalf("control plane UI should remain available, code=%d body=%q", uiRec.Code, uiRec.Body.String())
	}
}

func TestLoadConfigRejectsNonHTTPBackend(t *testing.T) {
	t.Setenv("NPM_BACKEND_URL", "file:///tmp/backend")
	_, err := loadConfig(testLogger())
	if err == nil {
		t.Fatal("expected invalid backend URL to fail")
	}
}
