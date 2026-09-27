package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const recoveryCookieName = "npm_improved_recovery"

type recoveryManager struct {
	token          string
	tokenFile      string
	backupsDir     string
	dataDir        string
	letsencryptDir string
	nginxBinary    string
	nginxPIDFile   string
	backendURL     *url.URL
	logger         *log.Logger
	client         *http.Client
}

type recoveryCredentialFile struct {
	Token     string `json:"token"`
	CreatedAt string `json:"created_at"`
}

type recoveryComponent struct {
	Status  string `json:"status"`
	Detail  string `json:"detail,omitempty"`
	Checked string `json:"checked_at"`
}

type recoveryBackup struct {
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	Modified string `json:"modified_at"`
}

type recoveryFailedCandidate struct {
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	Modified string `json:"modified_at"`
}

type recoveryStatus struct {
	ControlPlane     recoveryComponent         `json:"control_plane"`
	Backend          recoveryComponent         `json:"backend"`
	Nginx            recoveryComponent         `json:"nginx"`
	Data             recoveryComponent         `json:"data"`
	LetsEncrypt      recoveryComponent         `json:"letsencrypt"`
	Backups          []recoveryBackup          `json:"backups"`
	FailedCandidates []recoveryFailedCandidate `json:"failed_candidates"`
}

func newRecoveryManager(cfg config, logger *log.Logger) (*recoveryManager, error) {
	if strings.TrimSpace(cfg.RecoveryTokenFile) == "" {
		return nil, nil
	}

	token, created, err := loadOrCreateRecoveryToken(cfg.RecoveryTokenFile)
	if err != nil {
		return nil, fmt.Errorf("recovery credential: %w", err)
	}

	manager := &recoveryManager{
		token:          token,
		tokenFile:      cfg.RecoveryTokenFile,
		backupsDir:     cfg.BackupsDir,
		dataDir:        cfg.DataDir,
		letsencryptDir: cfg.LetsEncryptDir,
		nginxBinary:    cfg.NginxBinary,
		nginxPIDFile:   cfg.NginxPIDFile,
		backendURL:     cfg.BackendURL,
		logger:         logger,
		client:         &http.Client{Timeout: 3 * time.Second},
	}

	if created {
		logger.Printf("RECOVERY ACCESS TOKEN CREATED: %s", token)
		logger.Printf("recovery token is stored at %s with mode 0600", cfg.RecoveryTokenFile)
	}

	return manager, nil
}

func loadOrCreateRecoveryToken(filename string) (string, bool, error) {
	if raw, err := os.ReadFile(filename); err == nil {
		var existing recoveryCredentialFile
		if err := json.Unmarshal(raw, &existing); err != nil {
			return "", false, fmt.Errorf("parse %s: %w", filename, err)
		}
		if len(existing.Token) < 32 {
			return "", false, fmt.Errorf("%s contains an invalid recovery token", filename)
		}
		return existing.Token, false, nil
	} else if !os.IsNotExist(err) {
		return "", false, err
	}

	if err := os.MkdirAll(filepath.Dir(filename), 0o700); err != nil {
		return "", false, err
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return "", false, err
	}
	token := hex.EncodeToString(random)
	payload, err := json.MarshalIndent(recoveryCredentialFile{
		Token:     token,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}, "", "  ")
	if err != nil {
		return "", false, err
	}
	if err := os.WriteFile(filename, append(payload, '\n'), 0o600); err != nil {
		return "", false, err
	}
	if err := os.Chmod(filename, 0o600); err != nil {
		return "", false, err
	}
	return token, true, nil
}

func (m *recoveryManager) register(mux *http.ServeMux) {
	mux.HandleFunc("/recovery", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/recovery" {
			http.NotFound(w, r)
			return
		}
		http.Redirect(w, r, "/recovery/", http.StatusFound)
	})
	mux.HandleFunc("/recovery/", m.serveRecoveryPage)
	mux.HandleFunc("/__npm_improved/recovery/login", m.login)
	mux.HandleFunc("/__npm_improved/recovery/logout", m.logout)
	mux.Handle("/__npm_improved/recovery/status", m.requireAuth(http.HandlerFunc(m.status)))
	mux.Handle("/__npm_improved/recovery/nginx/test", m.requireAuth(http.HandlerFunc(m.testNginx)))
	mux.Handle("/__npm_improved/recovery/nginx/reload", m.requireAuth(http.HandlerFunc(m.reloadNginx)))
	mux.Handle("/__npm_improved/recovery/backups/", m.requireAuth(http.HandlerFunc(m.downloadBackup)))
}

func (m *recoveryManager) serveRecoveryPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write([]byte(recoveryPageHTML))
}

func (m *recoveryManager) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var body struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !m.tokenMatches(body.Token) {
		http.Error(w, "invalid recovery token", http.StatusUnauthorized)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     recoveryCookieName,
		Value:    m.token,
		Path:     "/",
		MaxAge:   1800,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   r.TLS != nil,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (m *recoveryManager) logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     recoveryCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   r.TLS != nil,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (m *recoveryManager) tokenMatches(candidate string) bool {
	if len(candidate) != len(m.token) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(m.token)) == 1
}

func (m *recoveryManager) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimSpace(r.Header.Get("X-NPM-Recovery-Token"))
		if token == "" {
			if cookie, err := r.Cookie(recoveryCookieName); err == nil {
				token = cookie.Value
			}
		}
		if !m.tokenMatches(token) {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "recovery authentication required"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (m *recoveryManager) status(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	result := recoveryStatus{
		ControlPlane:     recoveryComponent{Status: "healthy", Detail: "native recovery console available", Checked: now},
		Backend:          m.checkBackend(now),
		Nginx:            m.checkNginxProcess(now),
		Data:             checkDirectory(m.dataDir, now),
		LetsEncrypt:      checkDirectory(m.letsencryptDir, now),
		Backups:          m.listBackups(),
		FailedCandidates: m.listFailedCandidates(),
	}
	writeJSON(w, http.StatusOK, result)
}

func (m *recoveryManager) checkBackend(now string) recoveryComponent {
	target := *m.backendURL
	target.Path = strings.TrimRight(target.Path, "/") + "/"
	target.RawQuery = ""
	resp, err := m.client.Get(target.String())
	if err != nil {
		return recoveryComponent{Status: "unavailable", Detail: err.Error(), Checked: now}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return recoveryComponent{Status: "degraded", Detail: "HTTP " + strconv.Itoa(resp.StatusCode), Checked: now}
	}
	return recoveryComponent{Status: "healthy", Detail: "management API responding", Checked: now}
}

func (m *recoveryManager) checkNginxProcess(now string) recoveryComponent {
	raw, err := os.ReadFile(m.nginxPIDFile)
	if err != nil {
		return recoveryComponent{Status: "unavailable", Detail: "PID file unavailable: " + err.Error(), Checked: now}
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || pid < 1 {
		return recoveryComponent{Status: "unavailable", Detail: "PID file is invalid", Checked: now}
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return recoveryComponent{Status: "unavailable", Detail: err.Error(), Checked: now}
	}
	if err := process.Signal(syscall.Signal(0)); err != nil {
		return recoveryComponent{Status: "unavailable", Detail: err.Error(), Checked: now}
	}
	return recoveryComponent{Status: "healthy", Detail: fmt.Sprintf("nginx PID %d running", pid), Checked: now}
}

func checkDirectory(dir, now string) recoveryComponent {
	info, err := os.Stat(dir)
	if err != nil {
		return recoveryComponent{Status: "unavailable", Detail: err.Error(), Checked: now}
	}
	if !info.IsDir() {
		return recoveryComponent{Status: "unavailable", Detail: "path is not a directory", Checked: now}
	}
	return recoveryComponent{Status: "healthy", Detail: dir + " accessible", Checked: now}
}

func (m *recoveryManager) runNginxTest() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, m.nginxBinary, "-t", "-g", "error_log off;").CombinedOutput()
	text := strings.TrimSpace(string(output))
	if len(text) > 16384 {
		text = text[len(text)-16384:]
	}
	if ctx.Err() == context.DeadlineExceeded {
		return text, fmt.Errorf("nginx validation timed out")
	}
	return text, err
}

func (m *recoveryManager) testNginx(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	output, err := m.runNginxTest()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "output": output, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "output": output})
}

func (m *recoveryManager) reloadNginx(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	testOutput, err := m.runNginxTest()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "phase": "validate", "output": testOutput, "error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	output, reloadErr := exec.CommandContext(ctx, m.nginxBinary, "-s", "reload").CombinedOutput()
	text := strings.TrimSpace(string(output))
	if reloadErr != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "phase": "reload", "output": text, "error": reloadErr.Error()})
		return
	}
	m.logger.Printf("native recovery console reloaded nginx")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "validation": testOutput, "output": text})
}

func (m *recoveryManager) listBackups() []recoveryBackup {
	entries, err := os.ReadDir(m.backupsDir)
	if err != nil {
		return []recoveryBackup{}
	}
	result := make([]recoveryBackup, 0)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".npmibak") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		result = append(result, recoveryBackup{Name: entry.Name(), Size: info.Size(), Modified: info.ModTime().UTC().Format(time.RFC3339)})
	}
	return result
}

func (m *recoveryManager) listFailedCandidates() []recoveryFailedCandidate {
	root := filepath.Join(m.dataDir, "nginx")
	result := make([]recoveryFailedCandidate, 0)
	_ = filepath.WalkDir(root, func(filename string, entry os.DirEntry, err error) error {
		if err != nil || entry == nil || entry.IsDir() || !strings.HasSuffix(entry.Name(), ".err") {
			return nil
		}
		if len(result) >= 100 {
			return filepath.SkipAll
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return nil
		}
		rel, relErr := filepath.Rel(root, filename)
		if relErr != nil {
			return nil
		}
		result = append(result, recoveryFailedCandidate{Path: filepath.ToSlash(rel), Size: info.Size(), Modified: info.ModTime().UTC().Format(time.RFC3339)})
		return nil
	})
	return result
}

func (m *recoveryManager) downloadBackup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/__npm_improved/recovery/backups/")
	if name == "" || name != filepath.Base(name) || !strings.HasSuffix(name, ".npmibak") {
		http.NotFound(w, r)
		return
	}
	filename := filepath.Join(m.backupsDir, name)
	if info, err := os.Stat(filename); err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/vnd.npm-improved.backup")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+strings.ReplaceAll(name, "\"", "")+"\"")
	http.ServeFile(w, r, filename)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

const recoveryPageHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NPM Improved Recovery</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:dark;background:#10141c;color:#e8edf5}
*{box-sizing:border-box}body{margin:0;background:#10141c}.wrap{max-width:1100px;margin:0 auto;padding:32px 20px 64px}
h1{margin:0 0 6px;font-size:28px}h2{font-size:18px;margin:0 0 12px}.sub{color:#98a6ba;margin:0 0 28px}
.card{background:#171d27;border:1px solid #293244;border-radius:10px;padding:18px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.status{padding:14px;border:1px solid #293244;border-radius:8px}
.name{font-weight:650}.detail{color:#98a6ba;font-size:13px;margin-top:6px;overflow-wrap:anywhere}.healthy{color:#6ee7a2}.degraded{color:#f9ca6a}.unavailable{color:#ff8585}
input,button{font:inherit;border-radius:7px;border:1px solid #3b465b;background:#0f141d;color:#e8edf5;padding:10px 12px}input{width:100%;margin:8px 0 12px}button{cursor:pointer;background:#246bfd;border-color:#246bfd;font-weight:650;margin-right:8px}.secondary{background:#242d3d;border-color:#3b465b}.danger{background:#a63737;border-color:#c94b4b}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;border-bottom:1px solid #293244;padding:9px 7px}th{color:#98a6ba}
pre{white-space:pre-wrap;background:#0c1017;border:1px solid #293244;border-radius:7px;padding:12px;max-height:280px;overflow:auto}.hidden{display:none}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.right{margin-left:auto}a{color:#83b5ff}
</style>
</head>
<body>
<div class="wrap">
<h1>NPM Improved Recovery</h1>
<p class="sub">Native emergency console. This page does not depend on the Node backend or normal admin frontend.</p>

<div id="login" class="card">
<h2>Recovery authentication</h2>
<p class="sub">Enter the recovery token stored in <code>/data/recovery-access.json</code>. The token is also printed once when first created.</p>
<input id="token" type="password" autocomplete="off" placeholder="Recovery token">
<button onclick="login()">Unlock recovery console</button>
<div id="loginError" class="detail unavailable"></div>
</div>

<div id="console" class="hidden">
<div class="card">
<div class="row"><h2>System health</h2><button class="secondary right" onclick="loadStatus()">Refresh</button><button class="secondary" onclick="logout()">Lock</button></div>
<div id="health" class="grid"></div>
</div>

<div class="card">
<h2>Nginx recovery</h2>
<p class="sub">Reload is only attempted after a successful <code>nginx -t</code>.</p>
<button onclick="nginxTest()">Validate configuration</button>
<button class="danger" onclick="nginxReload()">Validate &amp; reload Nginx</button>
<pre id="nginxOutput">No recovery command run yet.</pre>
</div>

<div class="card">
<h2>Failed configuration candidates</h2>
<div id="failed"></div>
</div>

<div class="card">
<h2>Retained recovery backups</h2>
<p class="sub">Encrypted <code>.npmibak</code> files retained under <code>/data/backups</code>.</p>
<div id="backups"></div>
</div>
</div>
</div>
<script>
const api="/__npm_improved/recovery";
const esc=(v)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function login(){const token=document.getElementById("token").value;const r=await fetch(api+"/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});if(!r.ok){document.getElementById("loginError").textContent="Invalid recovery token.";return}document.getElementById("token").value="";await loadStatus()}
async function logout(){await fetch(api+"/logout",{method:"POST"});document.getElementById("console").classList.add("hidden");document.getElementById("login").classList.remove("hidden")}
function card(name,c){return '<div class="status"><div class="name">'+esc(name)+' <span class="'+esc(c.status)+'">'+esc(c.status)+'</span></div><div class="detail">'+esc(c.detail)+'</div></div>'}
function table(rows,cols){if(!rows.length)return '<div class="detail">None.</div>';return '<table><thead><tr>'+cols.map(c=>'<th>'+esc(c[0])+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+cols.map(c=>'<td>'+c[2](row[c[1]],row)+'</td>').join('')+'</tr>').join('')+'</tbody></table>'}
async function loadStatus(){const r=await fetch(api+"/status");if(r.status===401){document.getElementById("console").classList.add("hidden");document.getElementById("login").classList.remove("hidden");return}const s=await r.json();document.getElementById("login").classList.add("hidden");document.getElementById("console").classList.remove("hidden");document.getElementById("health").innerHTML=card("Control plane",s.control_plane)+card("Backend",s.backend)+card("Nginx",s.nginx)+card("/data",s.data)+card("Let's Encrypt",s.letsencrypt);document.getElementById("failed").innerHTML=table(s.failed_candidates,[["Path","path",v=>esc(v)],["Size","size",v=>esc(v+" B")],["Modified","modified_at",v=>esc(v)]]);document.getElementById("backups").innerHTML=table(s.backups,[["Backup","name",v=>esc(v)],["Size","size",v=>esc(v+" B")],["Modified","modified_at",v=>esc(v)],["","name",v=>'<a href="'+api+'/backups/'+encodeURIComponent(v)+'">Download</a>']])}
async function action(path){const r=await fetch(api+path,{method:"POST"});let body={};try{body=await r.json()}catch{}document.getElementById("nginxOutput").textContent=JSON.stringify(body,null,2);await loadStatus()}
const nginxTest=()=>action("/nginx/test");const nginxReload=()=>action("/nginx/reload");loadStatus();
</script>
</body>
</html>`
