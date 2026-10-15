package com.gigabytegrove.npmi

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.toArgb
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Analytics
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
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

private val BrandBlue = Color(0xFF2062CF)
private val DeepNavy = Color(0xFF10243D)
private val CoolWhite = Color(0xFFF5F8FC)
private val TextMuted = Color(0xFF52637B)

@Composable
private fun NpmiTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val palette = if (dark) darkColorScheme(
        primary = Color(0xFF8DB7FF),
        onPrimary = Color(0xFF0A2447),
        background = Color(0xFF0B1425),
        surface = Color(0xFF142238),
        surfaceVariant = Color(0xFF25364C),
        onSurface = Color(0xFFF0F6FF),
        onSurfaceVariant = Color(0xFFC0CBD9)
    ) else lightColorScheme(
        primary = BrandBlue,
        onPrimary = Color.White,
        background = CoolWhite,
        surface = Color.White,
        surfaceVariant = Color(0xFFEDF3F9),
        onSurface = DeepNavy,
        onSurfaceVariant = TextMuted
    )
    MaterialTheme(colorScheme = palette, content = content)
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            NpmiTheme {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { NpmiApp() }
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
private fun BrandWordmark() {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = Color.White,
        shadowElevation = 1.dp
    ) {
        Image(
            painter = painterResource(R.drawable.npmi_logo),
            contentDescription = "NPM Improved official logo",
            modifier = Modifier.fillMaxWidth().height(80.dp).padding(12.dp),
            contentScale = ContentScale.Fit
        )
    }
}

@Composable
private fun PageIntro(eyebrow: String, title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(eyebrow.uppercase(), color = MaterialTheme.colorScheme.primary,
            style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
        Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun ConnectionHelp(direct: Boolean) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(16.dp)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(if (direct) "Management API · port 81" else "HTTPS gateway · management backend",
                style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(if (direct)
                "NPM Improved serves its management interface and /api over HTTP on port 81. Use a private LAN IP; your credentials are unencrypted in transit. Do not expose this directly to the internet."
            else
                "Use a dedicated HTTPS management hostname that forwards /api and the Control Center to NPMi port 81. The ordinary proxy-host website listener on 443 is not automatically the admin API.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun InlineIssue(message: String) {
    Surface(color = MaterialTheme.colorScheme.errorContainer,
        shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text("Connection needs attention",
                color = MaterialTheme.colorScheme.onErrorContainer,
                style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Text(message, color = MaterialTheme.colorScheme.onErrorContainer,
                style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun ServerForm(vm: NpmViewModel) {
    val editing = vm.editing
    var name by remember(editing?.id) { mutableStateOf(editing?.name.orEmpty()) }
    var address by remember(editing?.id) { mutableStateOf(editing?.url.orEmpty()) }
    var mode by remember(editing?.id) {
        mutableStateOf(if (editing != null && !editing.insecureLan) "gateway" else "direct")
    }
    var confirmLocal by remember(editing?.id) { mutableStateOf(false) }
    val direct = mode == "direct"
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState())
        .padding(horizontal = 20.dp, vertical = 26.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)) {
        BrandWordmark()
        PageIntro("Server connection",
            if (editing == null) "Connect your server" else "Edit management connection",
            "Connect directly to the NPMi control plane—not to a website served by the reverse proxy.")
        ElevatedCard(shape = RoundedCornerShape(22.dp)) {
            Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("Connection type", style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = direct,
                        onClick = { if (!direct) { mode = "direct"; address = "" } },
                        label = { Text("Direct LAN · :81") })
                    FilterChip(selected = !direct,
                        onClick = { if (direct) { mode = "gateway"; address = "" } },
                        label = { Text("HTTPS gateway") })
                }
                OutlinedTextField(name, { name = it }, label = { Text("Connection name") },
                    placeholder = { Text("Home proxy") }, modifier = Modifier.fillMaxWidth(),
                    singleLine = true)
                OutlinedTextField(address, { address = it },
                    label = { Text(if (direct) "Private IP / management address" else "HTTPS management URL") },
                    placeholder = { Text(if (direct) "192.168.1.20:81" else "https://admin.example.com") },
                    supportingText = {
                        Text(if (direct) "Port 81 is automatically added if omitted."
                            else "Must proxy the management service on port 81.")
                    },
                    modifier = Modifier.fillMaxWidth(), singleLine = true)
                if (direct) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = confirmLocal, onCheckedChange = { confirmLocal = it })
                        Text("I understand direct LAN HTTP is unencrypted",
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
                if (vm.error.isNotBlank()) InlineIssue(vm.error)
                Button(onClick = { vm.addServer(name, address, mode, confirmLocal) },
                    enabled = !vm.loading && name.isNotBlank() && address.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RoundedCornerShape(14.dp)) {
                    Text(if (vm.loading) "Checking /api…" else "Verify API and save")
                }
                if (vm.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (vm.profiles.isNotEmpty()) {
                    TextButton(onClick = vm::cancelServerEdit, modifier = Modifier.fillMaxWidth()) {
                        Text("Cancel")
                    }
                }
            }
        }
        ConnectionHelp(direct)
    }
}

@Composable
private fun SignIn(vm: NpmViewModel) {
    val server = vm.selected ?: return
    var email by remember(server.id) { mutableStateOf("") }
    var password by remember(server.id) { mutableStateOf("") }
    var code by remember(server.id) { mutableStateOf("") }
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState())
        .padding(horizontal = 20.dp, vertical = 26.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)) {
        BrandWordmark()
        PageIntro("Secure management",
            if (vm.challenge == null) "Welcome back" else "Verify your identity",
            if (vm.challenge == null) "Sign in with your existing NPM Improved administrator account."
            else "Use your authenticator's six-digit code or an eight-character recovery code.")
        ElevatedCard(shape = RoundedCornerShape(22.dp)) {
            Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(server.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(server.url, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (server.insecureLan) {
                    Text("Direct LAN connection · HTTP port 81",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.error)
                }
                HorizontalDivider()
                if (vm.challenge == null) {
                    OutlinedTextField(email, { email = it }, label = { Text("Account email") },
                        placeholder = { Text("admin@example.com") },
                        modifier = Modifier.fillMaxWidth(), singleLine = true)
                    OutlinedTextField(password, { password = it }, label = { Text("Password") },
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth(), singleLine = true)
                    Button(onClick = {
                        vm.signIn(email, password)
                        password = ""
                    }, enabled = !vm.loading && email.isNotBlank() && password.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(14.dp)) { Text("Sign in to NPMi") }
                } else {
                    OutlinedTextField(code, { code = it }, label = { Text("Authentication code") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                        modifier = Modifier.fillMaxWidth(), singleLine = true)
                    Button(onClick = { vm.verifyTwoFactor(code); code = "" },
                        enabled = !vm.loading && code.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(14.dp)) { Text("Verify and continue") }
                    TextButton(onClick = vm::cancelChallenge) { Text("Back to password") }
                }
                if (vm.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (vm.error.isNotBlank()) InlineIssue(vm.error)
                OutlinedButton(onClick = { vm.editServer(server.id) },
                    modifier = Modifier.fillMaxWidth()) {
                    Text("Change management address / port")
                }
            }
        }
        ConnectionHelp(server.insecureLan)
        TextButton(onClick = { vm.addingServer = true },
            modifier = Modifier.fillMaxWidth()) { Text("Connect another server") }
        vm.profiles.filter { it.id != server.id }.forEach { other ->
            OutlinedButton(onClick = { vm.switch(other.id) }, modifier = Modifier.fillMaxWidth()) {
                Text("Switch to " + other.name)
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
private fun MetricTile(label: String, value: String, details: String = "", modifier: Modifier = Modifier) {
    ElevatedCard(modifier, shape = RoundedCornerShape(18.dp)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            if (details.isNotBlank()) Text(details, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun DashboardScreen(vm: NpmViewModel) {
    val status = vm.status
    val summary = vm.summary
    val server = vm.selected
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(15.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.weight(1f)) {
                Text("Overview", style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold)
                Text("Your reverse proxy at a glance",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(onClick = vm::refresh) { Text("Refresh") }
        }
        Surface(shape = RoundedCornerShape(22.dp), color = DeepNavy) {
            Column(Modifier.fillMaxWidth().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(9.dp)) {
                Text("CONTROL PLANE", style = MaterialTheme.typography.labelMedium,
                    color = Color(0xFF90BAFF), fontWeight = FontWeight.SemiBold)
                Text(status?.hostname?.ifBlank { server?.name ?: "NPMi node" }
                    ?: (server?.name ?: "Connecting…"),
                    color = Color.White, style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold)
                Text(if (status?.healthy == true) "Management API connected"
                    else "Waiting for management API response",
                    color = Color(0xFFD4E0F1), style = MaterialTheme.typography.bodyMedium)
                HorizontalDivider(color = Color(0xFF3C506B))
                Text("Version " + (status?.version ?: "—") +
                    "  ·  " + (status?.role?.ifBlank { "standalone" } ?: "unknown role"),
                    color = Color(0xFFD4E0F1), style = MaterialTheme.typography.bodySmall)
            }
        }
        Text("Proxy infrastructure", style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            MetricTile("Proxy hosts", vm.hosts.size.toString(),
                "Configured", Modifier.weight(1f))
            MetricTile("Enabled", vm.hosts.count { it.enabled }.toString(),
                "Active routes", Modifier.weight(1f))
        }
        Text("HTTP traffic · last 24 hours", style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold)
        if (summary != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MetricTile("Requests", summary.requests.toString(),
                    "This node", Modifier.weight(1f))
                MetricTile("Data sent", summary.bytesOut.bytesLabel(),
                    "HTTP response bytes", Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MetricTile("Source IPs", summary.uniqueIps?.toString() ?: "—",
                    "Not unique users", Modifier.weight(1f))
                MetricTile("Denied", summary.denied?.toString() ?: "—",
                    "Blocked requests", Modifier.weight(1f))
            }
        } else {
            ElevatedCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
                Text(vm.analyticsNotice.ifBlank { "Node analytics are currently unavailable." },
                    modifier = Modifier.padding(16.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Text("Manage", style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold)
        ElevatedCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                Text("Proxy host management", style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold)
                Text("Inspect configured hosts, view recorded traffic, and manage availability.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = { vm.screen = "hosts" }, modifier = Modifier.fillMaxWidth()) {
                    Text("Open hosts")
                }
            }
        }
        if (status?.role == "secondary") {
            Text("NPMX secondary: host configuration is read-only here. Traffic observations remain node-local.",
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall)
        } else {
            Text("Traffic and deny rules are local to this node. Counts are not automatically combined across NPMX.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun HostsScreen(vm: NpmViewModel) {
    var confirm by remember { mutableStateOf<ProxyHost?>(null) }
    var query by remember { mutableStateOf("") }
    var show by remember { mutableStateOf("all") }
    val canModify = vm.status?.role != "secondary"
    val hosts = vm.hosts.toList()
    val filtered = hosts.filter { host ->
        (show == "all" || (show == "enabled" && host.enabled) ||
            (show == "disabled" && !host.enabled)) &&
            (query.isBlank() || host.domains.any { it.contains(query.trim(), ignoreCase = true) } ||
                host.upstream.contains(query.trim(), ignoreCase = true))
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(12.dp))
        Text("Proxy hosts", style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold)
        Text(hosts.size.toString() + " configured · " + hosts.count { it.enabled } + " enabled",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(13.dp))
        OutlinedTextField(query, { query = it },
            label = { Text("Search hosts or upstreams") },
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            modifier = Modifier.fillMaxWidth(), singleLine = true)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("all" to "All", "enabled" to "Enabled", "disabled" to "Disabled").forEach { (code, label) ->
                FilterChip(selected = show == code, onClick = { show = code }, label = { Text(label) })
            }
        }
        LazyColumn(modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(top = 7.dp, bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(filtered, key = { it.id }) { host ->
                var expanded by remember(host.id) { mutableStateOf(false) }
                ElevatedCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Text(host.domains.joinToString(", ").ifBlank { "Host #" + host.id },
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold)
                                Text(host.upstream, style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Box {
                                IconButton(onClick = { expanded = true }) {
                                    Icon(Icons.Default.MoreVert, contentDescription = "Host actions")
                                }
                                DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                                    DropdownMenuItem(text = { Text("Inspect live traffic") },
                                        onClick = { expanded = false; vm.openLive(host.id) })
                                    DropdownMenuItem(
                                        text = { Text(if (host.enabled) "Disable host" else "Enable host") },
                                        enabled = canModify && !vm.loading,
                                        onClick = { expanded = false; confirm = host })
                                }
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth()) {
                            Box(Modifier.size(9.dp).background(
                                if (host.enabled) Color(0xFF25A36D) else Color(0xFF9AA9BA),
                                CircleShape))
                            Spacer(Modifier.width(8.dp))
                            Text(if (host.enabled) "Enabled" else "Disabled",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.labelMedium)
                            Spacer(Modifier.weight(1f))
                            TextButton(onClick = { vm.openLive(host.id) }) { Text("Traffic →") }
                        }
                    }
                }
            }
            if (filtered.isEmpty()) item {
                Text(if (hosts.isEmpty()) "No proxy hosts are configured on this server."
                    else "No hosts match these filters.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(24.dp))
            }
        }
    }
    confirm?.let { host ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(if (host.enabled) "Disable this host?" else "Enable this host?") },
            text = { Text(host.domains.joinToString(", ") +
                "\nThis changes the live NPM Improved proxy configuration.") },
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
