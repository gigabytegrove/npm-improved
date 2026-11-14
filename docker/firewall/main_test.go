package main

import (
  "strings"
  "testing"
)

func TestPolicyValidation(t *testing.T) {
  good := policy{SchemaVersion: 1, Mode: "dmz", State: "active", ManagementPort: 81,
    ManagementNetworks: []string{"192.168.1.0/24", "2001:db8::/64"},
    Ports: []portRule{{Port: 80, Protocol: "tcp"}, {Port: 443, Protocol: "tcp"}, {Port: 39482, Protocol: "udp"}}}
  if err := validatePolicy(good); err != nil { t.Fatal(err) }
  cases := []policy{
    {SchemaVersion: 9, Mode: "dmz", State: "active", ManagementPort: 81, ManagementNetworks: []string{"10.0.0.0/8"}},
    {SchemaVersion: 1, Mode: "unmanaged", State: "active", ManagementPort: 81, ManagementNetworks: []string{"10.0.0.0/8"}},
    {SchemaVersion: 1, Mode: "dmz", State: "active", ManagementPort: 81, ManagementNetworks: []string{"0.0.0.0/0"}},
    {SchemaVersion: 1, Mode: "dmz", State: "active", ManagementPort: 81, ManagementNetworks: []string{"10.0.0.0/8"}, Ports: []portRule{{Port: 81, Protocol: "tcp"}}},
    {SchemaVersion: 1, Mode: "dmz", State: "active", ManagementPort: 81, ManagementNetworks: []string{"10.0.0.0/8"}, Ports: []portRule{{Port: 70000, Protocol: "udp"}}},
  }
  for i, candidate := range cases {
    if err := validatePolicy(candidate); err == nil { t.Errorf("case %d accepted unsafe policy", i) }
  }
}

func TestRuleRenderingPreservesManagementAndDefaultDeny(t *testing.T) {
  p := policy{SchemaVersion: 1, Mode: "forwarded", State: "active", ManagementPort: 81,
    ManagementNetworks: []string{"192.168.1.0/24"},
    Ports: []portRule{{Port: 39482, Protocol: "tcp"}, {Port: 39482, Protocol: "udp"}}}
  rules := desiredScript(p)
  expected := []string{
    "flush chain inet npmi_instance incoming",
    "ct state established,related accept",
    "ip saddr 192.168.1.0/24 tcp dport 81 accept",
    "tcp dport 39482 accept",
    "udp dport 39482 accept",
    "counter drop",
  }
  for _, part := range expected {
    if !strings.Contains(rules, part) { t.Errorf("missing rule: %s", part) }
  }
  if strings.Contains(rules, "flush ruleset") { t.Fatal("must never flush unrelated nftables rules") }
}

func TestPendingActivationDeadline(t *testing.T) {
  p := policy{SchemaVersion: 1, Mode: "dmz", State: "active", ManagementPort: 81,
    ManagementNetworks: []string{"192.168.1.0/24"}, ConfirmBy: "bad-date"}
  if err := validatePolicy(p); err == nil { t.Fatal("bad deadline accepted") }
  p.ConfirmBy = "2026-11-14T14:00:00Z"
  if err := validatePolicy(p); err != nil { t.Fatal(err) }
  p.State = "deferred"
  if err := validatePolicy(p); err == nil { t.Fatal("deferred policy accepted activation deadline") }
}

func TestDroppedCounterJSON(t *testing.T) {
  sample := []byte(`{"nftables":[{"metainfo":{"version":"1"}},{"rule":{"expr":[{"counter":{"packets":47,"bytes":2586}},{"drop":null}]}}]}`)
  packets, bytes := parseDroppedPackets(sample)
  if packets != 47 || bytes != 2586 { t.Fatalf("unexpected counters: %d, %d", packets, bytes) }
}
