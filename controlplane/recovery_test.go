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

func recoveryTestConfig(t *testing.T) config {
	t.Helper()
	root := t.TempDir()
	frontend := filepath.Join(root, "frontend")
	data := filepath.Join(root, "data")
	le := filepath.Join(root, "letsencrypt")
	backups := filepath.Join(data, "backups")
	if err := os.MkdirAll(frontend, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(backups, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(le, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(data, "nginx", "proxy_host"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(frontend, "index.html"), []byte("frontend"), 0o644); err != nil {
		t.Fatal(err)
	}

	backend, _ := url.Parse("http://127.0.0.1:1")
	return config{
		AdminPort:         81,
		FrontendRoot:      frontend,
		BackendURL:        backend,
		RecoveryTokenFile: filepath.Join(data, "recovery-access.json"),
		BackupsDir:        backups,
		DataDir:           data,
		LetsEncryptDir:    le,
		NginxBinary:       "/bin/true",
		NginxPIDFile:      filepath.Join(root, "missing-nginx.pid"),
	}
}

func readRecoveryToken(t *testing.T, filename string) string {
	t.Helper()
	raw, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	var credential recoveryCredentialFile
	if err := json.Unmarshal(raw, &credential); err != nil {
		t.Fatal(err)
	}
	return credential.Token
}

func TestRecoveryTokenCreatedOnceWithPrivatePermissions(t *testing.T) {
	cfg := recoveryTestConfig(t)
	logger := log.New(io.Discard, "", 0)

	first, err := newRecoveryManager(cfg, logger)
	if err != nil {
		t.Fatal(err)
	}
	if first == nil || len(first.token) != 64 {
		t.Fatalf("expected 64-character recovery token, got %#v", first)
	}

	info, err := os.Stat(cfg.RecoveryTokenFile)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("expected recovery token mode 0600, got %04o", got)
	}

	second, err := newRecoveryManager(cfg, logger)
	if err != nil {
		t.Fatal(err)
	}
	if second.token != first.token {
		t.Fatal("recovery token changed between control-plane starts")
	}
}

func TestRecoveryConsoleAvailableWhenBackendIsDown(t *testing.T) {
	cfg := recoveryTestConfig(t)
	handler, err := newHandler(cfg, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatal(err)
	}

	page := httptest.NewRecorder()
	handler.ServeHTTP(page, httptest.NewRequest(http.MethodGet, "/recovery/", nil))
	if page.Code != http.StatusOK {
		t.Fatalf("expected recovery page 200, got %d", page.Code)
	}
	if !strings.Contains(page.Body.String(), "NPM Improved Recovery") {
		t.Fatalf("unexpected recovery page: %s", page.Body.String())
	}

	api := httptest.NewRecorder()
	handler.ServeHTTP(api, httptest.NewRequest(http.MethodGet, "/api/users", nil))
	if api.Code != http.StatusBadGateway {
		t.Fatalf("expected failed backend proxy to return 502, got %d", api.Code)
	}
}

func TestRecoveryStatusRequiresRecoveryAuthentication(t *testing.T) {
	cfg := recoveryTestConfig(t)
	handler, err := newHandler(cfg, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/__npm_improved/recovery/status", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestRecoveryLoginAndStatusWorkWithoutBackend(t *testing.T) {
	cfg := recoveryTestConfig(t)
	handler, err := newHandler(cfg, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatal(err)
	}
	token := readRecoveryToken(t, cfg.RecoveryTokenFile)

	loginReq := httptest.NewRequest(
		http.MethodPost,
		"/__npm_improved/recovery/login",
		strings.NewReader(`{"token":"`+token+`"}`),
	)
	loginReq.Header.Set("Content-Type", "application/json")
	loginRec := httptest.NewRecorder()
	handler.ServeHTTP(loginRec, loginReq)
	if loginRec.Code != http.StatusOK {
		t.Fatalf("expected login 200, got %d: %s", loginRec.Code, loginRec.Body.String())
	}
	cookies := loginRec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != recoveryCookieName || !cookies[0].HttpOnly {
		t.Fatalf("unexpected recovery cookie: %#v", cookies)
	}

	statusReq := httptest.NewRequest(http.MethodGet, "/__npm_improved/recovery/status", nil)
	statusReq.AddCookie(cookies[0])
	statusRec := httptest.NewRecorder()
	handler.ServeHTTP(statusRec, statusReq)
	if statusRec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", statusRec.Code, statusRec.Body.String())
	}

	var status recoveryStatus
	if err := json.Unmarshal(statusRec.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status.ControlPlane.Status != "healthy" {
		t.Fatalf("control plane should be healthy: %#v", status.ControlPlane)
	}
	if status.Backend.Status != "unavailable" {
		t.Fatalf("backend should be unavailable in test: %#v", status.Backend)
	}
}

func TestRecoveryListsFailedCandidatesAndBackups(t *testing.T) {
	cfg := recoveryTestConfig(t)
	if err := os.WriteFile(filepath.Join(cfg.BackupsDir, "pre-restore-test.npmibak"), []byte("encrypted"), 0o600); err != nil {
		t.Fatal(err)
	}
	failed := filepath.Join(cfg.DataDir, "nginx", "proxy_host", "42.conf.err")
	if err := os.WriteFile(failed, []byte("bad config"), 0o600); err != nil {
		t.Fatal(err)
	}

	handler, err := newHandler(cfg, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatal(err)
	}
	token := readRecoveryToken(t, cfg.RecoveryTokenFile)

	req := httptest.NewRequest(http.MethodGet, "/__npm_improved/recovery/status", nil)
	req.Header.Set("X-NPM-Recovery-Token", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var status recoveryStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if len(status.Backups) != 1 || status.Backups[0].Name != "pre-restore-test.npmibak" {
		t.Fatalf("unexpected backups: %#v", status.Backups)
	}
	if len(status.FailedCandidates) != 1 || status.FailedCandidates[0].Path != "proxy_host/42.conf.err" {
		t.Fatalf("unexpected failed candidates: %#v", status.FailedCandidates)
	}

	viewReq := httptest.NewRequest(
		http.MethodGet,
		"/__npm_improved/recovery/failed?path=proxy_host%2F42.conf.err",
		nil,
	)
	viewReq.Header.Set("X-NPM-Recovery-Token", token)
	viewRec := httptest.NewRecorder()
	handler.ServeHTTP(viewRec, viewReq)
	if viewRec.Code != http.StatusOK || viewRec.Body.String() != "bad config" {
		t.Fatalf("unexpected failed candidate view: code=%d body=%q", viewRec.Code, viewRec.Body.String())
	}

	traversalReq := httptest.NewRequest(
		http.MethodGet,
		"/__npm_improved/recovery/failed?path=..%2Frecovery-access.json.err",
		nil,
	)
	traversalReq.Header.Set("X-NPM-Recovery-Token", token)
	traversalRec := httptest.NewRecorder()
	handler.ServeHTTP(traversalRec, traversalReq)
	if traversalRec.Code != http.StatusNotFound {
		t.Fatalf("expected traversal request 404, got %d", traversalRec.Code)
	}

	downloadReq := httptest.NewRequest(
		http.MethodGet,
		"/__npm_improved/recovery/backups/pre-restore-test.npmibak",
		nil,
	)
	downloadReq.Header.Set("X-NPM-Recovery-Token", token)
	downloadRec := httptest.NewRecorder()
	handler.ServeHTTP(downloadRec, downloadReq)
	if downloadRec.Code != http.StatusOK || downloadRec.Body.String() != "encrypted" {
		t.Fatalf("unexpected backup download: code=%d body=%q", downloadRec.Code, downloadRec.Body.String())
	}
}

func TestRecoveryRejectsInvalidToken(t *testing.T) {
	cfg := recoveryTestConfig(t)
	handler, err := newHandler(cfg, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(
		http.MethodPost,
		"/__npm_improved/recovery/login",
		strings.NewReader(`{"token":"not-the-token"}`),
	)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected invalid login 401, got %d", rec.Code)
	}
}
