package com.gigabytegrove.npmi

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Analytics
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(Modifier.fillMaxSize()) { NpmiApp() }
            }
        }
    }
}

@Composable
private fun NpmiApp(vm: NpmViewModel = viewModel()) {
    when {
        vm.profiles.isEmpty() || vm.addingServer -> ServerForm(vm)
        !vm.signedIn -> SignIn(vm)
        else -> ControlCenter(vm)
    }
}

@Composable
private fun ServerForm(vm: NpmViewModel) {
    var name by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var confirmLocal by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(15.dp)) {
        Text("NPM Improved", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text("Connect a server", style = MaterialTheme.typography.titleLarge)
        Text("Every server has its own login and independently stored session.",
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(name, { name = it }, label = { Text("Friendly name") },
            modifier = Modifier.fillMaxWidth(), singleLine = true)
        OutlinedTextField(address, { address = it }, label = { Text("Server address") },
            placeholder = { Text("https://proxy.example.com") },
            modifier = Modifier.fillMaxWidth(), singleLine = true)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = confirmLocal, onCheckedChange = { confirmLocal = it })
            Text("Allow private LAN HTTP by IP (unencrypted)", style = MaterialTheme.typography.bodySmall)
        }
        Text("HTTPS is recommended. LAN HTTP transmits credentials without encryption; public HTTP is refused.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        if (vm.error.isNotBlank()) ErrorText(vm.error)
        Button(onClick = { vm.addServer(name, address, confirmLocal) },
            enabled = name.isNotBlank() && address.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
            Text("Save server and sign in")
        }
        if (vm.profiles.isNotEmpty()) TextButton(onClick = { vm.addingServer = false }) { Text("Cancel") }
    }
}

@Composable
private fun SignIn(vm: NpmViewModel) {
    val server = vm.selected ?: return
    var email by remember(server.id) { mutableStateOf("") }
    var password by remember(server.id) { mutableStateOf("") }
    var code by remember(server.id) { mutableStateOf("") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("NPM Improved", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(server.name, style = MaterialTheme.typography.titleLarge)
        Text(server.url, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (server.insecureLan) ErrorText("Private LAN HTTP: credentials are unencrypted in transit.")
        if (vm.challenge == null) {
            OutlinedTextField(email, { email = it }, label = { Text("Account email") },
                modifier = Modifier.fillMaxWidth(), singleLine = true)
            OutlinedTextField(password, { password = it }, label = { Text("Password") },
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(), singleLine = true)
            Button(onClick = {
                vm.signIn(email, password)
                password = ""
            }, enabled = !vm.loading && email.isNotBlank() && password.isNotBlank(),
                modifier = Modifier.fillMaxWidth()) { Text("Sign in") }
        } else {
            Text("Two-factor verification", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(code, { code = it }, label = { Text("6-digit code or 8-character backup code") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                singleLine = true, modifier = Modifier.fillMaxWidth())
            Button(onClick = { vm.verifyTwoFactor(code); code = "" },
                enabled = !vm.loading && code.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                Text("Verify and continue")
            }
            TextButton(onClick = vm::cancelChallenge) { Text("Back to password") }
        }
        if (vm.loading) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        if (vm.error.isNotBlank()) ErrorText(vm.error)
        TextButton(onClick = { vm.screen = "servers"; vm.addingServer = true }) {
            Text("Add another server")
        }
        if (vm.profiles.size > 1) {
            Text("Other servers", style = MaterialTheme.typography.titleSmall)
            vm.profiles.filter { it.id != server.id }.forEach { other ->
                TextButton(onClick = { vm.switch(other.id) }) { Text(other.name) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ControlCenter(vm: NpmViewModel) {
    val server = vm.selected ?: return
    val destinations = listOf(
        Triple("dashboard", "Overview", Icons.Default.Analytics),
        Triple("hosts", "Hosts", Icons.Default.Dns),
        Triple("security", "Security", Icons.Default.Security),
        Triple("servers", "Servers", Icons.Default.Settings),
    )
    BackHandler(enabled = vm.screen == "traffic") { vm.screen = "hosts"; vm.liveHostId = null }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Column {
                    Text("NPM Improved", style = MaterialTheme.typography.titleMedium)
                    Text(server.name, style = MaterialTheme.typography.bodySmall)
                } },
                actions = {
                    IconButton(onClick = vm::refresh, enabled = !vm.loading) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh server data")
                    }
                })
        },
        bottomBar = {
            NavigationBar {
                destinations.forEach { (route, label, symbol) ->
                    NavigationBarItem(
                        selected = if (vm.screen == "traffic") route == "hosts" else vm.screen == route,
                        onClick = { vm.screen = route; if (route != "traffic") vm.liveHostId = null },
                        icon = { Icon(symbol, contentDescription = null) },
                        label = { Text(label) }
                    )
                }
            }
        }
    ) { insets ->
        Column(Modifier.fillMaxSize().padding(insets)) {
            if (server.insecureLan) {
                Text("Unencrypted LAN connection", modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            }
            if (vm.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (vm.error.isNotBlank()) ErrorText(vm.error)
            if (vm.message.isNotBlank()) {
                Text(vm.message, color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
            }
            Box(Modifier.fillMaxSize()) {
                when (vm.screen) {
                    "hosts" -> HostsScreen(vm)
                    "traffic" -> TrafficScreen(vm)
                    "security" -> SecurityScreen(vm)
                    "servers" -> ServersScreen(vm)
                    else -> DashboardScreen(vm)
                }
            }
        }
    }
}

@Composable
private fun ErrorText(message: String) {
    Text(message, color = MaterialTheme.colorScheme.error,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
}

@Composable
private fun StatCard(title: String, value: String, detail: String = "") {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp)) {
            Text(title, color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelMedium)
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            if (detail.isNotBlank()) Text(detail, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun DashboardScreen(vm: NpmViewModel) {
    val status = vm.status
    val summary = vm.summary
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Server overview", style = MaterialTheme.typography.headlineSmall)
        StatCard("Node", status?.hostname?.ifBlank { "Unknown host" } ?: "Connecting",
            "Version " + (status?.version ?: "—") + " · " + (status?.role?.ifBlank { "standalone" } ?: "Unknown role"))
        StatCard("Proxy hosts", vm.hosts.size.toString(),
            vm.hosts.count { it.enabled }.toString() + " enabled")
        if (summary != null) {
            StatCard("Requests (24 hours)", summary.requests.toString(),
                "Local node: " + summary.observedNode)
            StatCard("HTTP traffic sent", summary.bytesOut.bytesLabel())
            StatCard("Source IPs", summary.uniqueIps?.toString() ?: "Raw events unavailable",
                "Not unique people")
            StatCard("Blocked requests", summary.denied?.toString() ?: "Unavailable")
        } else {
            Text(vm.analyticsNotice.ifBlank { "Analytics have not been loaded." },
                style = MaterialTheme.typography.bodySmall)
        }
        if (status?.role == "secondary") {
            Text("This NPMX secondary can report local traffic but rejects proxy-host configuration writes.",
                color = MaterialTheme.colorScheme.error)
        }
        Text("Analytics are node-local. The app does not combine unrelated NPMX nodes.",
            style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun HostsScreen(vm: NpmViewModel) {
    var confirm by remember { mutableStateOf<ProxyHost?>(null) }
    val canModify = vm.status?.role != "secondary"
    val hosts = vm.hosts.toList()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Text("Proxy hosts (" + hosts.size + ")", style = MaterialTheme.typography.headlineSmall) }
        items(hosts, key = { it.id }) { host ->
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(host.domains.joinToString(", ").ifBlank { "Host #" + host.id },
                        style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(host.upstream, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(if (host.enabled) "Enabled" else "Disabled",
                        color = if (host.enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { vm.openLive(host.id) }) { Text("Live traffic") }
                        OutlinedButton(onClick = { confirm = host }, enabled = canModify && !vm.loading) {
                            Text(if (host.enabled) "Disable" else "Enable")
                        }
                    }
                }
            }
        }
        if (hosts.isEmpty()) item { Text("No proxy hosts reported on this server.") }
    }
    confirm?.let { host ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(if (host.enabled) "Disable proxy host?" else "Enable proxy host?") },
            text = { Text(host.domains.joinToString(", ") + "\nThis changes the live NPMi configuration.") },
            confirmButton = {
                TextButton(onClick = { vm.toggleHost(host); confirm = null }) {
                    Text(if (host.enabled) "Disable" else "Enable")
                }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } }
        )
    }
}

@Composable
private fun RequestsBar(values: List<Long>) {
    if (values.isEmpty()) return
    val tint = MaterialTheme.colorScheme.primary
    Canvas(Modifier.fillMaxWidth().height(110.dp)) {
        val peak = (values.maxOrNull() ?: 0L).coerceAtLeast(1L)
        val step = size.width / values.size
        values.forEachIndexed { i, count ->
            val height = (count.toFloat() / peak) * size.height
            drawRect(tint, topLeft = Offset(i * step, size.height - height),
                size = Size((step * 0.72f).coerceAtLeast(1f), height.coerceAtLeast(2f)))
        }
    }
}

@Composable
private fun TrafficScreen(vm: NpmViewModel) {
    val id = vm.liveHostId ?: return
    val owner = LocalLifecycleOwner.current
    val minutes = vm.liveMinutes
    LaunchedEffect(id, minutes, vm.selectedId, owner) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (isActive) {
                vm.fetchLive(id, minutes)
                delay(10_000)
            }
        }
    }
    val host = vm.hosts.firstOrNull { it.id == id }
    val live = vm.live
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(onClick = { vm.screen = "hosts"; vm.liveHostId = null }) { Text("← Back to hosts") }
        Text(host?.domains?.joinToString(", ").orEmpty().ifBlank { "Host #" + id },
            style = MaterialTheme.typography.headlineSmall)
        Text("Near-real-time HTTP investigations · this NPMi node only",
            style = MaterialTheme.typography.bodySmall)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(5, 15, 60).forEach { choice ->
                FilterChip(selected = minutes == choice, onClick = { vm.liveMinutes = choice; vm.live = null },
                    label = { Text(choice.toString() + " min") })
            }
        }
        if (vm.liveError.isNotBlank()) ErrorText(vm.liveError)
        if (live == null) {
            CircularProgressIndicator()
            Text("Loading recorded requests…")
        } else {
            StatCard("Requests", live.total.toString(),
                "10-second refresh while this screen is open")
            StatCard("Traffic sent", live.sent.bytesLabel())
            StatCard("Source addresses", live.uniqueIps.toString(), "An IP is not necessarily one person.")
            Text("Requests per minute", style = MaterialTheme.typography.titleMedium)
            ElevatedCard(Modifier.fillMaxWidth()) { Box(Modifier.padding(16.dp)) { RequestsBar(live.timeline) } }
            Text("Traffic is drawn from completed, ingested requests. Not a packet capture.",
                style = MaterialTheme.typography.bodySmall)
            Text("Client review signals", style = MaterialTheme.typography.titleLarge)
            Text("Indicators do not prove malicious behavior; crawler and browser identities are self-reported.",
                style = MaterialTheme.typography.bodySmall)
            ClientSection("Source IP addresses", "ip", live.ips, vm)
            ClientSection("User-agent strings", "user_agent", live.agents, vm)
            Text("Requested paths", style = MaterialTheme.typography.titleLarge)
            live.paths.take(25).forEach { (path, count) ->
                HorizontalDivider()
                Text(path + " — " + count + " requests", style = MaterialTheme.typography.bodyMedium)
            }
            Text("Browser and client claims", style = MaterialTheme.typography.titleLarge)
            live.browsers.forEach { (label, count) ->
                Text(label + ": " + count, style = MaterialTheme.typography.bodyMedium)
            }
            Text("Geography", style = MaterialTheme.typography.titleLarge)
            Text(live.geographyNote, style = MaterialTheme.typography.bodySmall)
            Text("Recent completed requests", style = MaterialTheme.typography.titleLarge)
            live.requests.forEach { r ->
                ElevatedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(r.method + " " + r.path + " · HTTP " + r.status,
                            fontWeight = FontWeight.SemiBold)
                        Text(r.ip + " · " + r.at, style = MaterialTheme.typography.bodySmall)
                        Text(r.userAgent, style = MaterialTheme.typography.bodySmall)
                        if (r.deniedBy.isNotBlank() && r.deniedBy != "null")
                            Text("Denied: " + r.deniedBy, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
}

@Composable
private fun ClientSection(title: String, type: String, entries: List<ClientSignal>, vm: NpmViewModel) {
    Text(title, style = MaterialTheme.typography.titleMedium)
    if (entries.isEmpty()) Text("No clients met the current review thresholds.",
        style = MaterialTheme.typography.bodySmall)
    entries.take(20).forEach { signal ->
        ElevatedCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(signal.value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                Text(signal.requests.toString() + " requests · " + signal.probes + " sensitive-path probes · " +
                    signal.notFound + " not-found responses", style = MaterialTheme.typography.bodySmall)
                signal.signals.forEach { Text("• " + it, style = MaterialTheme.typography.bodySmall) }
                Text("Signal level: " + signal.priority, style = MaterialTheme.typography.labelSmall)
                OutlinedButton(onClick = { vm.prepareBlock(type, signal.value) }) {
                    Text("Review node-wide block")
                }
            }
        }
    }
}

@Composable
private fun SecurityScreen(vm: NpmViewModel) {
    val draft = vm.blockDraft
    var removeRule by remember { mutableStateOf<BlockRule?>(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Security & enforcement", style = MaterialTheme.typography.headlineSmall)
        Text("Blocks in NPMi v1.6.11 apply to ALL HTTP hosts on THIS NODE. They do not automatically synchronize across NPMX nodes. Review the affected traffic before changing rules.",
            color = MaterialTheme.colorScheme.error)
        Text("Prepare a node-wide deny", style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = draft.type == "ip",
                onClick = { vm.blockDraft = draft.copy(type = "ip", target = "") }, label = { Text("IP / CIDR") })
            FilterChip(selected = draft.type == "user_agent",
                onClick = { vm.blockDraft = draft.copy(type = "user_agent", target = "") },
                label = { Text("User-agent substring") })
        }
        OutlinedTextField(draft.target, { vm.blockDraft = vm.blockDraft.copy(target = it.take(160)) },
            label = { Text("Match target") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        OutlinedTextField(draft.note, { vm.blockDraft = vm.blockDraft.copy(note = it.take(256)) },
            label = { Text("Reason / audit note") }, modifier = Modifier.fillMaxWidth())
        Button(onClick = { vm.blockConfirmation = true },
            enabled = !vm.loading && draft.target.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
            Text("Review node-wide block")
        }
        Text("Active local deny rules", style = MaterialTheme.typography.titleLarge)
        if (vm.rules.isEmpty()) Text("No deny rules reported (or your account does not have access).",
            style = MaterialTheme.typography.bodySmall)
        vm.rules.forEach { rule ->
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp)) {
                    Text(rule.type + " · " + rule.target, fontWeight = FontWeight.Bold)
                    Text(rule.note, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { removeRule = rule }) { Text("Remove rule") }
                }
            }
        }
    }
    if (vm.blockConfirmation) AlertDialog(
        onDismissRequest = { vm.blockConfirmation = false },
        title = { Text("Block traffic on ALL hosts on this node?") },
        text = {
            Text("Rule: " + draft.type + " = " + draft.target +
                "\nThis can block legitimate visitors across every site served by this NPMi node. " +
                "It does not apply only to the host being investigated. Nginx will validate and reload the policy; there is no automatic expiry.")
        },
        confirmButton = {
            TextButton(onClick = vm::addBlock) { Text("Activate node-wide deny") }
        },
        dismissButton = {
            TextButton(onClick = { vm.blockConfirmation = false }) { Text("Cancel") }
        }
    )
    removeRule?.let { rule ->
        AlertDialog(onDismissRequest = { removeRule = null },
            title = { Text("Remove node-wide block?") },
            text = { Text("Unblock " + rule.target + " on this NPMi node?") },
            confirmButton = { TextButton(onClick = { vm.removeBlock(rule); removeRule = null }) { Text("Unblock") } },
            dismissButton = { TextButton(onClick = { removeRule = null }) { Text("Cancel") } })
    }
}

@Composable
private fun ServersScreen(vm: NpmViewModel) {
    var removeId by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Managed servers", style = MaterialTheme.typography.headlineSmall)
        Text("Each connection has an independent encrypted session.",
            style = MaterialTheme.typography.bodySmall)
        vm.profiles.forEach { profile ->
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text(profile.name, style = MaterialTheme.typography.titleMedium)
                    Text(profile.url, style = MaterialTheme.typography.bodySmall)
                    if (profile.insecureLan) Text("Unencrypted private LAN",
                        color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { vm.switch(profile.id) },
                            enabled = vm.selectedId != profile.id) {
                            Text(if (vm.selectedId == profile.id) "Current" else "Switch")
                        }
                        TextButton(onClick = { removeId = profile.id }) { Text("Remove") }
                    }
                }
            }
        }
        Button(onClick = { vm.addingServer = true }, modifier = Modifier.fillMaxWidth()) {
            Text("Add another server")
        }
        OutlinedButton(onClick = vm::logout, modifier = Modifier.fillMaxWidth()) {
            Text("Sign out of this server")
        }
    }
    removeId?.let { id ->
        AlertDialog(onDismissRequest = { removeId = null },
            title = { Text("Remove this server?") },
            text = { Text("The locally stored connection and encrypted token will be erased. NPMi itself is not modified.") },
            confirmButton = { TextButton(onClick = { vm.deleteServer(id); removeId = null }) { Text("Remove server") } },
            dismissButton = { TextButton(onClick = { removeId = null }) { Text("Cancel") } })
    }
}
