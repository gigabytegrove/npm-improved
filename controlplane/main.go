package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	defaultAdminPort         = 81
	defaultFrontendRoot      = "/app/frontend"
	defaultBackendURL        = "http://127.0.0.1:3000"
	defaultRecoveryTokenFile = "/data/recovery-access.json"
	defaultBackupsDir        = "/data/backups"
	defaultDataDir           = "/data"
	defaultLetsEncryptDir    = "/etc/letsencrypt"
	defaultNginxBinary       = "/usr/sbin/nginx"
	defaultNginxPIDFile      = "/run/nginx/nginx.pid"
	defaultNodeBinary        = "/usr/local/bin/node"
	defaultRecoveryScript    = "/app/scripts/recovery-restore.js"
)

type config struct {
	AdminPort         int
	FrontendRoot      string
	BackendURL        *url.URL
	RecoveryTokenFile string
	BackupsDir        string
	DataDir           string
	LetsEncryptDir    string
	NginxBinary       string
	NginxPIDFile      string
	NodeBinary        string
	RecoveryScript    string
}

func main() {
	logger := log.New(os.Stdout, "control-plane: ", log.LstdFlags|log.LUTC)

	cfg, err := loadConfig(logger)
	if err != nil {
		logger.Fatalf("configuration error: %v", err)
	}

	handler, err := newHandler(cfg, logger)
	if err != nil {
		logger.Fatalf("startup error: %v", err)
	}

	server := &http.Server{
		Addr:              net.JoinHostPort("", strconv.Itoa(cfg.AdminPort)),
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       15 * time.Minute,
		WriteTimeout:      15 * time.Minute,
		IdleTimeout:       2 * time.Minute,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Printf("listening on port %d; frontend=%s; backend=%s", cfg.AdminPort, cfg.FrontendRoot, cfg.BackendURL.String())
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(sigCh)

	select {
	case sig := <-sigCh:
		logger.Printf("received %s; shutting down", sig)
	case err := <-errCh:
		if err != nil {
			logger.Fatalf("server failed: %v", err)
		}
		return
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Printf("graceful shutdown failed: %v", err)
		_ = server.Close()
	}
}

func loadConfig(logger *log.Logger) (config, error) {
	port := defaultAdminPort
	if raw := strings.TrimSpace(os.Getenv("NPM_ADMIN_PORT")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 65535 {
			logger.Printf("WARNING: NPM_ADMIN_PORT=%q is invalid; defaulting to %d", raw, defaultAdminPort)
		} else {
			port = parsed
		}
	}

	frontendRoot := strings.TrimSpace(os.Getenv("NPM_FRONTEND_ROOT"))
	if frontendRoot == "" {
		frontendRoot = defaultFrontendRoot
	}

	backendRaw := strings.TrimSpace(os.Getenv("NPM_BACKEND_URL"))
	if backendRaw == "" {
		backendRaw = defaultBackendURL
	}
	backendURL, err := url.Parse(backendRaw)
	if err != nil || backendURL.Scheme == "" || backendURL.Host == "" {
		return config{}, fmt.Errorf("NPM_BACKEND_URL must be an absolute HTTP(S) URL: %q", backendRaw)
	}
	if backendURL.Scheme != "http" && backendURL.Scheme != "https" {
		return config{}, fmt.Errorf("NPM_BACKEND_URL scheme must be http or https: %q", backendURL.Scheme)
	}

	return config{
		AdminPort:         port,
		FrontendRoot:      frontendRoot,
		BackendURL:        backendURL,
		RecoveryTokenFile: envOrDefault("NPM_RECOVERY_TOKEN_FILE", defaultRecoveryTokenFile),
		BackupsDir:        envOrDefault("NPM_BACKUPS_DIR", defaultBackupsDir),
		DataDir:           envOrDefault("NPM_DATA_DIR", defaultDataDir),
		LetsEncryptDir:    envOrDefault("NPM_LETSENCRYPT_DIR", defaultLetsEncryptDir),
		NginxBinary:       envOrDefault("NPM_NGINX_BINARY", defaultNginxBinary),
		NginxPIDFile:      envOrDefault("NPM_NGINX_PID_FILE", defaultNginxPIDFile),
		NodeBinary:        envOrDefault("NPM_NODE_BINARY", defaultNodeBinary),
		RecoveryScript:    envOrDefault("NPM_RECOVERY_RESTORE_SCRIPT", defaultRecoveryScript),
	}, nil
}

func newHandler(cfg config, logger *log.Logger) (http.Handler, error) {
	root, err := filepath.Abs(cfg.FrontendRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve frontend root: %w", err)
	}

	proxy := newAPIProxy(cfg.BackendURL, logger)
	spa := newSPAHandler(root)

	mux := http.NewServeMux()

	recovery, err := newRecoveryManager(cfg, logger)
	if err != nil {
		return nil, err
	}
	if recovery != nil {
		recovery.register(mux)
	}

	mux.HandleFunc("/__npm_improved/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok","component":"control-plane"}`))
	})
	mux.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
		target := "/api/"
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, target, http.StatusFound)
	})
	mux.Handle("/api/", http.StripPrefix("/api", proxy))
	mux.Handle("/", spa)

	return securityHeaders(mux), nil
}

func newAPIProxy(target *url.URL, logger *log.Logger) *httputil.ReverseProxy {
	proxy := httputil.NewSingleHostReverseProxy(target)

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext
	transport.MaxIdleConns = 100
	transport.IdleConnTimeout = 90 * time.Second
	transport.TLSHandshakeTimeout = 10 * time.Second
	transport.ExpectContinueTimeout = time.Second
	transport.ResponseHeaderTimeout = 15 * time.Minute
	proxy.Transport = transport

	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		if req.Header.Get("X-Forwarded-Proto") == "" {
			if req.TLS != nil {
				req.Header.Set("X-Forwarded-Proto", "https")
			} else {
				req.Header.Set("X-Forwarded-Proto", "http")
			}
		}
		req.Header.Set("X-Forwarded-Scheme", req.Header.Get("X-Forwarded-Proto"))
	}

	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		logger.Printf("management API unavailable for %s %s: %v", r.Method, r.URL.Path, err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"code":    http.StatusBadGateway,
				"message": "Management API unavailable",
			},
		})
	}

	return proxy
}

func newSPAHandler(root string) http.Handler {
	indexPath := filepath.Join(root, "index.html")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		cleaned := path.Clean("/" + r.URL.Path)
		rel := strings.TrimPrefix(cleaned, "/")
		candidate := filepath.Join(root, filepath.FromSlash(rel))

		if !isWithinRoot(root, candidate) {
			http.NotFound(w, r)
			return
		}

		if serveExistingFile(w, r, candidate) {
			return
		}
		if filepath.Ext(candidate) == "" && serveExistingFile(w, r, candidate+".html") {
			return
		}
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			if serveExistingFile(w, r, filepath.Join(candidate, "index.html")) {
				return
			}
		}

		if !serveExistingFile(w, r, indexPath) {
			http.Error(w, "admin frontend unavailable", http.StatusServiceUnavailable)
		}
	})
}

func serveExistingFile(w http.ResponseWriter, r *http.Request, filename string) bool {
	info, err := os.Stat(filename)
	if err != nil || info.IsDir() {
		return false
	}
	http.ServeFile(w, r, filename)
	return true
}

func isWithinRoot(root, candidate string) bool {
	rel, err := filepath.Rel(root, candidate)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", envOrDefault("X_FRAME_OPTIONS", "DENY"))
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Cache-Control", "no-cache, no-store, max-age=0, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		next.ServeHTTP(w, r)
	})
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
