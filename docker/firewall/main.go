package main

import (
  "crypto/sha256"
  "encoding/hex"
  "encoding/json"
  "errors"
  "fmt"
  "net/netip"
  "os"
  "os/exec"
  "sort"
  "strings"
  "time"
)

const (
  policyFile = "/policy/policy.json"
  statusFile = "/policy/status.json"
  tableName = "npmi_instance"
)

type portRule struct {
  Port int
  Protocol string
}
type policy struct {
  SchemaVersion int
  Mode string
  State string
  ManagementPort int
  ManagementNetworks []string
  ConfirmBy string
  Ports []portRule
}

func runNft(input string, args ...string) error {
  cmd := exec.Command("nft", args...)
  if input != "" { cmd.Stdin = strings.NewReader(input) }
  output, err := cmd.CombinedOutput()
  if err != nil {
    msg := strings.TrimSpace(string(output))
    if len(msg) > 300 { msg = msg[:300] }
    return fmt.Errorf("nft operation failed: %s: %w", msg, err)
  }
  return nil
}

func validatePolicy(p policy) error {
  if p.SchemaVersion != 1 { return errors.New("unsupported security policy format") }
  if p.ManagementPort < 1 || p.ManagementPort > 65535 { return errors.New("invalid management port") }
  if p.State != "active" && p.State != "deferred" { return errors.New("invalid policy state") }
  switch p.Mode {
  case "static", "forwarded", "dmz":
  case "unmanaged":
    if p.State == "active" { return errors.New("unmanaged mode cannot enforce a firewall") }
  default:
    return errors.New("invalid deployment model")
  }
  if len(p.ManagementNetworks) > 128 { return errors.New("too many management networks") }
  if p.State == "active" && len(p.ManagementNetworks) == 0 { return errors.New("management networks required") }
  for _, cidr := range p.ManagementNetworks {
    prefix, err := netip.ParsePrefix(cidr)
    if err != nil || prefix.Bits() == 0 { return errors.New("invalid management CIDR") }
  }
  if p.ConfirmBy != "" {
    if _, err := time.Parse(time.RFC3339, p.ConfirmBy); err != nil { return errors.New("invalid activation deadline") }
    if p.State != "active" { return errors.New("activation deadline requires an active policy") }
  }
  if len(p.Ports) > 1024 { return errors.New("too many service ports") }
  for _, port := range p.Ports {
    if port.Port < 1 || port.Port > 65535 || (port.Protocol != "tcp" && port.Protocol != "udp") {
      return errors.New("invalid service port")
    }
    if port.Port == p.ManagementPort { return errors.New("management port cannot be a public service") }
  }
  return nil
}

func desiredScript(p policy) string {
  lines := []string {
    "flush chain inet " + tableName + " incoming",
    "add rule inet " + tableName + " incoming iifname \"lo\" accept",
    "add rule inet " + tableName + " incoming ct state established,related accept",
    "add rule inet " + tableName + " incoming ct state invalid drop",
    "add rule inet " + tableName + " incoming meta l4proto ipv6-icmp accept",
    "add rule inet " + tableName + " incoming ip protocol icmp accept",
  }
  networks := append([]string(nil), p.ManagementNetworks...)
  sort.Strings(networks)
  for _, cidr := range networks {
    prefix, _ := netip.ParsePrefix(cidr)
    family := "ip"
    if prefix.Addr().Is6() { family = "ip6" }
    lines = append(lines, fmt.Sprintf("add rule inet %s incoming %s saddr %s tcp dport %d accept",
      tableName, family, prefix.String(), p.ManagementPort))
  }
  ports := append([]portRule(nil), p.Ports...)
  sort.Slice(ports, func(i, j int) bool {
    if ports[i].Port != ports[j].Port { return ports[i].Port < ports[j].Port }
    return ports[i].Protocol < ports[j].Protocol
  })
  for _, port := range ports {
    lines = append(lines, fmt.Sprintf("add rule inet %s incoming %s dport %d accept",
      tableName, port.Protocol, port.Port))
  }
  lines = append(lines, "add rule inet "+tableName+" incoming counter drop")
  return strings.Join(lines, "\n") + "\n"
}

func ensureTable() error {
  if err := runNft("", "list", "table", "inet", tableName); err != nil {
    if err := runNft("", "add", "table", "inet", tableName); err != nil { return err }
  }
  if err := runNft("", "list", "chain", "inet", tableName, "incoming"); err != nil {
    return runNft("", "add", "chain", "inet", tableName, "incoming",
      "{ type filter hook input priority 0; policy accept; }")
  }
  return nil
}

func applyPolicy(p policy) error {
  if err := ensureTable(); err != nil { return err }
  script := desiredScript(p)
  if err := runNft(script, "-c", "-f", "-"); err != nil { return err }
  return runNft(script, "-f", "-")
}

func releasePolicy() error {
  if err := runNft("", "list", "table", "inet", tableName); err != nil { return nil }
  return runNft("", "delete", "table", "inet", tableName)
}

func writeStatus(state, hash string, err error) {
  status := map[string]any {
    "checkedAt": time.Now().UTC().Format(time.RFC3339),
    "state": state, "policyHash": hash,
  }
  if err != nil { status["error"] = err.Error() }
  data, marshalErr := json.MarshalIndent(status, "", "  ")
  if marshalErr != nil { return }
  tmp := statusFile + ".tmp"
  if writeErr := os.WriteFile(tmp, append(data, '\n'), 0644); writeErr != nil {
    fmt.Fprintln(os.Stderr, "security status write failed:", writeErr)
    return
  }
  if renameErr := os.Rename(tmp, statusFile); renameErr != nil {
    fmt.Fprintln(os.Stderr, "security status replace failed:", renameErr)
  }
}

func reconcile() {
  data, err := os.ReadFile(policyFile)
  if errors.Is(err, os.ErrNotExist) {
    cleanupErr := releasePolicy()
    writeStatus("deferred", "", cleanupErr)
    return
  }
  if err != nil { writeStatus("needs_attention", "", err); return }
  var p policy
  if err := json.Unmarshal(data, &p); err != nil {
    writeStatus("needs_attention", "", errors.New("unable to parse policy")); return
  }
  if err := validatePolicy(p); err != nil { writeStatus("needs_attention", "", err); return }
  hashValue := sha256.Sum256(data)
  hash := hex.EncodeToString(hashValue[:])
  if p.ConfirmBy != "" {
    until, _ := time.Parse(time.RFC3339, p.ConfirmBy)
    if !time.Now().Before(until) {
      if err := releasePolicy(); err != nil { writeStatus("needs_attention", "", err); return }
      writeStatus("confirmation_expired", "", errors.New("Unconfirmed instance firewall policy released automatically."))
      return
    }
  }
  if p.Mode == "unmanaged" || p.State == "deferred" {
    if err := releasePolicy(); err != nil { writeStatus("needs_attention", "", err); return }
    writeStatus("deferred", hash, nil)
    return
  }
  if err := applyPolicy(p); err != nil { writeStatus("needs_attention", "", err); return }
  writeStatus("active", hash, nil)
}

func main() {
  for {
    reconcile()
    time.Sleep(5 * time.Second)
  }
}
