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
private fun ConnectionHelp(isHttp: Boolean) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(16.dp)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("NPM Improved management API · port 81",
                style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(if (isHttp)
                "NPMi normally serves /api over HTTP on port 81. This connection is unencrypted. For access outside a trusted LAN or VPN, configure a secure management endpoint."
            else
                "Port 81 uses HTTP by default. An explicit HTTPS URL requires TLS on that port. If you have an HTTPS management gateway on port 443 that forwards /api/ to port 81, enter https://hostname:443 explicitly.",
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
    var confirmHttp by remember(editing?.id) { mutableStateOf(false) }
    // Preview uses acknowledgement only to parse; saving still requires an explicit opt-in.
    val preview = remember(address) { runCatching { NetworkPolicy.normalize(address, true) }.getOrNull() }
    val isHttp = preview?.insecureLan == true
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState())
        .padding(horizontal = 20.dp, vertical = 26.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)) {
        BrandWordmark()
        PageIntro("Server connection",
            if (editing == null) "Connect your server" else "Edit server connection",
            "Enter your server hostname or IP once. The app automatically uses NPM Improved's management API on port 81.")
        ElevatedCard(shape = RoundedCornerShape(22.dp)) {
            Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("Connection name") },
                    placeholder = { Text("Home proxy") }, modifier = Modifier.fillMaxWidth(),
                    singleLine = true)
                OutlinedTextField(address, { address = it },
                    label = { Text("Server URL or IP address") },
                    placeholder = { Text("https://proxy.example.com or 192.168.1.20") },
                    supportingText = { Text("Management API port 81 is selected automatically.") },
                    modifier = Modifier.fillMaxWidth(), singleLine = true)
                if (preview != null) {
                    Surface(color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("API ENDPOINT", style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(preview.baseUrl + "api/",
                                style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
                if (isHttp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = confirmHttp, onCheckedChange = { confirmHttp = it })
                        Text("I understand HTTP credentials are unencrypted",
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
                if (vm.error.isNotBlank()) InlineIssue(vm.error)
                if (!isHttp && address.isNotBlank()) {
                    TextButton(onClick = {
                        runCatching { NetworkPolicy.insecureAlternative(address) }
                            .onSuccess { address = it; confirmHttp = false; vm.clearError() }
                    }, modifier = Modifier.fillMaxWidth()) {
                        Text("Use default HTTP management connection (:81)")
                    }
                    Text("HTTP sends passwords and session tokens unencrypted. Only use it on a trusted LAN/VPN and acknowledge the risk before connecting.",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall)
                }
                Button(onClick = { vm.addServer(name, address, confirmHttp) },
                    enabled = !vm.loading && name.isNotBlank() && address.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RoundedCornerShape(14.dp)) {
                    Text(if (vm.loading) "Checking port 81…" else "Verify API and save")
                }
                if (vm.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (vm.profiles.isNotEmpty()) {
                    TextButton(onClick = vm::cancelServerEdit, modifier = Modifier.fillMaxWidth()) {
                        Text("Cancel")
                    }
                }
            }
        }
        ConnectionHelp(isHttp)
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
                    Text("HTTP management connection · port 81",
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
                    Text("Change API address / HTTP or HTTPS")
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
    val tabs = listOf(
        Triple("dashboard", "Overview", Icons.Default.Analytics),
        Triple("hosts", "Hosts", Icons.Default.Dns),
        Triple("security", "Security", Icons.Default.Security)
    )
    var switcherOpen by remember { mutableStateOf(false) }
    BackHandler(enabled = vm.screen == "traffic" || vm.screen == "servers") {
        if (vm.screen == "traffic") { vm.screen = "hosts"; vm.liveHostId = null }
        else vm.screen = "dashboard"
    }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Column {
                TopAppBar(
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.surface),
                    navigationIcon = {
                        Box(Modifier.padding(start = 12.dp, end = 6.dp).size(38.dp)
                            .background(MaterialTheme.colorScheme.primaryContainer,
                                RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.Dns, contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary)
                        }
                    },
                    title = {
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text("NPM IMPROVED", style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                            Text(server.name, style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Bold, maxLines = 1)
                        }
                    },
                    actions = {
                        IconButton(onClick = vm::refresh, enabled = !vm.loading) {
                            Icon(Icons.Default.Refresh, contentDescription = "Refresh node")
                        }
                        Box {
                            IconButton(onClick = { switcherOpen = true }) {
                                Icon(Icons.Default.Settings, contentDescription = "Servers and account")
                            }
                            DropdownMenu(expanded = switcherOpen, onDismissRequest = { switcherOpen = false }) {
                                Text("YOUR SERVERS", Modifier.padding(16.dp, 8.dp),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                vm.profiles.forEach { profile ->
                                    DropdownMenuItem(
                                        text = { Text(profile.name +
                                            if (profile.id == vm.selectedId) "  ·  Current" else "") },
                                        onClick = {
                                            switcherOpen = false
                                            if (profile.id != vm.selectedId) vm.switch(profile.id)
                                        },
                                        leadingIcon = { Icon(Icons.Default.Dns, contentDescription = null) })
                                }
                                HorizontalDivider()
                                DropdownMenuItem(text = { Text("Manage servers and account") },
                                    onClick = { switcherOpen = false; vm.screen = "servers" },
                                    leadingIcon = { Icon(Icons.Default.Settings, contentDescription = null) })
                            }
                        }
                    }
                )
                if (vm.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        },
        bottomBar = {
            if (vm.screen != "servers") NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
                tabs.forEach { (route, label, symbol) ->
                    NavigationBarItem(
                        selected = if (vm.screen == "traffic") route == "hosts" else vm.screen == route,
                        onClick = {
                            vm.screen = route
                            if (route != "hosts") vm.liveHostId = null
                        },
                        icon = { Icon(symbol, contentDescription = null) },
                        label = { Text(label) },
                        alwaysShowLabel = true)
                }
            }
        }
    ) { insets ->
        Column(Modifier.fillMaxSize().padding(insets)) {
            if (server.insecureLan) {
                Surface(color = MaterialTheme.colorScheme.errorContainer) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Default.Security, contentDescription = null,
                            tint = MaterialTheme.colorScheme.onErrorContainer,
                            modifier = Modifier.size(16.dp))
                        Text("Unencrypted HTTP · Trusted LAN or VPN only",
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            if (vm.error.isNotBlank()) InlineIssue(vm.error)
            if (vm.message.isNotBlank()) Text(vm.message,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.bodySmall)
            Box(Modifier.weight(1f)) {
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
    val total = vm.hosts.size
    val enabled = vm.hosts.count { it.enabled }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
        .padding(horizontal = 18.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text("Overview", style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold)
            Text("Your reverse proxy at a glance",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Surface(shape = RoundedCornerShape(22.dp), color = DeepNavy) {
            Column(Modifier.fillMaxWidth().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp).background(
                        if (status?.healthy == true) Color(0xFF4ACF9C) else Color(0xFFFFC46D),
                        CircleShape))
                    Spacer(Modifier.width(8.dp))
                    Text(if (status?.healthy == true) "MANAGEMENT API CONNECTED" else "CHECKING NODE",
                        style = MaterialTheme.typography.labelMedium,
                        color = Color(0xFFD0DFF1), fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.weight(1f))
                    Text(status?.role?.uppercase() ?: "NPMi",
                        color = Color(0xFFD0DFF1),
                        style = MaterialTheme.typography.labelSmall)
                }
                Text(status?.hostname?.ifBlank { vm.selected?.name ?: "NPMi node" }
                    ?: (vm.selected?.name ?: "NPMi node"),
                    color = Color.White, style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.Bold)
                Text(vm.selected?.url.orEmpty(), color = Color(0xFFC4D4E9),
                    style = MaterialTheme.typography.bodySmall)
                HorizontalDivider(color = Color(0xFF40516A))
                Text("NPM Improved " + (status?.version ?: "—"),
                    color = Color(0xFFE6EEF8),
                    style = MaterialTheme.typography.bodyMedium)
            }
        }
        SectionHeading("Infrastructure", "Proxy host availability")
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            MetricTile("Configured", total.toString(), "Proxy hosts", Modifier.weight(1f))
            MetricTile("Enabled", enabled.toString(), "Active routes", Modifier.weight(1f))
        }
        if (total > 0) {
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                LinearProgressIndicator(
                    progress = { enabled.toFloat() / total },
                    modifier = Modifier.weight(1f).height(8.dp),
                    color = Color(0xFF279A75),
                    trackColor = MaterialTheme.colorScheme.surfaceVariant)
                Text(enabled.toString() + " of " + total + " enabled",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        OutlinedButton(onClick = { vm.screen = "hosts" },
            modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = RoundedCornerShape(13.dp)) {
            Icon(Icons.Default.Dns, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("Browse proxy hosts")
        }
        SectionHeading("Traffic", "Last 24 hours · this node only")
        if (summary == null) {
            ElevatedCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
                Text(vm.analyticsNotice.ifBlank { "Waiting for node analytics…" },
                    modifier = Modifier.padding(18.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MetricTile("Requests", summary.requests.toString(), "Completed", Modifier.weight(1f))
                MetricTile("Data sent", summary.bytesOut.bytesLabel(), "Response bytes", Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MetricTile("Source IPs", summary.uniqueIps?.toString() ?: "—", "Not unique users", Modifier.weight(1f))
                MetricTile("Denied", summary.denied?.toString() ?: "—", "Blocked requests", Modifier.weight(1f))
            }
        }
        SectionHeading("Quick actions", "Jump into the work")
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ElevatedCard(Modifier.weight(1f), shape = RoundedCornerShape(18.dp)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Icon(Icons.Default.Analytics, contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary)
                    Text("Live traffic", fontWeight = FontWeight.SemiBold)
                    Text("Investigate one host", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = { vm.screen = "hosts" }) { Text("View hosts →") }
                }
            }
            ElevatedCard(Modifier.weight(1f), shape = RoundedCornerShape(18.dp)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Icon(Icons.Default.Security, contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary)
                    Text("Security", fontWeight = FontWeight.SemiBold)
                    Text("Review local rules", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = { vm.screen = "security" }) { Text("Review rules →") }
                }
            }
        }
        Text(if (status?.role == "secondary")
            "Secondary: configuration changes are read-only; local traffic remains separate from NPMX peers."
            else "Counts are node-local. IP addresses can represent shared gateways, not individual people.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SectionHeading(title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(subtitle, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun HostsScreen(vm: NpmViewModel) {
    var confirm by remember { mutableStateOf<ProxyHost?>(null) }
    var query by remember { mutableStateOf("") }
    var show by remember { mutableStateOf("all") }
    val canModify = vm.status?.role != "secondary"
    val all = vm.hosts.toList()
    val filtered = all.filter { host ->
        (show == "all" || (show == "enabled" && host.enabled) ||
            (show == "disabled" && !host.enabled)) &&
            (query.isBlank() || host.domains.any { it.contains(query.trim(), ignoreCase = true) } ||
                host.upstream.contains(query.trim(), ignoreCase = true))
    }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Proxy hosts", style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold)
                    Text(all.size.toString() + " configured · " + all.count { it.enabled } + " enabled",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = vm::refresh, enabled = !vm.loading) {
                    Icon(Icons.Default.Refresh, contentDescription = "Reload host list")
                }
            }
            OutlinedTextField(query, { query = it },
                label = { Text("Search domains or upstreams") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                modifier = Modifier.fillMaxWidth(), singleLine = true,
                shape = RoundedCornerShape(15.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("all" to "All", "enabled" to "Enabled", "disabled" to "Disabled")
                    .forEach { (code, label) ->
                        FilterChip(selected = show == code, onClick = { show = code },
                            label = { Text(label) })
                    }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        LazyColumn(modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(filtered, key = { it.id }) { host ->
                var expanded by remember(host.id) { mutableStateOf(false) }
                ElevatedCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(17.dp)) {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalArrangement = Arrangement.spacedBy(11.dp)) {
                        Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(host.domains.joinToString(", ").ifBlank { "Host #" + host.id },
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold)
                                Text(host.upstream, style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Box {
                                IconButton(onClick = { expanded = true }) {
                                    Icon(Icons.Default.MoreVert, contentDescription = "Actions for " +
                                        host.domains.joinToString(", "))
                                }
                                DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                                    DropdownMenuItem(text = { Text("Investigate traffic") },
                                        onClick = { expanded = false; vm.openLive(host.id) },
                                        leadingIcon = { Icon(Icons.Default.Analytics, contentDescription = null) })
                                    DropdownMenuItem(
                                        text = { Text(if (host.enabled) "Disable proxy" else "Enable proxy") },
                                        enabled = canModify && !vm.loading,
                                        onClick = { expanded = false; confirm = host })
                                }
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(Modifier.size(9.dp).background(
                                if (host.enabled) Color(0xFF1C9A70) else Color(0xFF96A4B3), CircleShape))
                            Text(if (host.enabled) "Enabled" else "Disabled",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.weight(1f))
                            TextButton(onClick = { vm.openLive(host.id) }) {
                                Icon(Icons.Default.Analytics, contentDescription = null,
                                    modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(5.dp))
                                Text("Traffic")
                            }
                        }
                    }
                }
            }
            if (filtered.isEmpty()) item {
                ElevatedCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(17.dp)) {
                    Column(Modifier.fillMaxWidth().padding(24.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.Search, contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(if (all.isEmpty()) "No proxy hosts configured" else "No matching hosts",
                            style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(if (all.isEmpty()) "Hosts added in NPM Improved will appear here." else
                            "Try a different domain, upstream, or status filter.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (query.isNotBlank() || show != "all") TextButton(onClick = {
                            query = ""; show = "all"
                        }) { Text("Clear filters") }
                    }
                }
            }
        }
    }
    confirm?.let { host ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(if (host.enabled) "Disable proxy host?" else "Enable proxy host?") },
            text = { Text(host.domains.joinToString(", ") +
                "\nThis changes the live NPM Improved proxy configuration. Existing connections may be affected.") },
            confirmButton = {
                TextButton(onClick = { vm.toggleHost(host); confirm = null }) {
                    Text(if (host.enabled) "Disable host" else "Enable host")
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
    var panel by remember(id) { mutableStateOf("overview") }
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
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            TextButton(onClick = { vm.screen = "hosts"; vm.liveHostId = null }) {
                Text("← All proxy hosts")
            }
            Text(host?.domains?.joinToString(", ").orEmpty().ifBlank { "Host #" + id },
                style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("Completed HTTP requests · this NPMi node",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(5, 15, 60).forEach { choice ->
                    FilterChip(selected = minutes == choice,
                        onClick = { vm.liveMinutes = choice; vm.live = null },
                        label = { Text(choice.toString() + " min") })
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("overview" to "Overview", "clients" to "Clients", "requests" to "Requests")
                    .forEach { (code, label) ->
                        FilterChip(selected = panel == code, onClick = { panel = code },
                            label = { Text(label) })
                    }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (vm.liveError.isNotBlank()) InlineIssue(vm.liveError)
            if (live == null) {
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(14.dp)) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp))
                    Text("Loading traffic recorded by this node…")
                }
            } else when (panel) {
                "clients" -> {
                    SectionHeading("Client signals", "Indicators are not proof of abuse; user-agent names can be spoofed")
                    ClientSection("Source IP addresses", "ip", live.ips, vm)
                    ClientSection("User-agent strings", "user_agent", live.agents, vm)
                    Text("Proposed blocks will affect every HTTP host on this node.",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall)
                }
                "requests" -> {
                    SectionHeading("Recent requests", "Latest completed requests on this host")
                    if (live.requests.isEmpty()) Text("No completed requests recorded in this interval.")
                    live.requests.forEach { request ->
                        ElevatedCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp)) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(request.method, fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.primary,
                                        style = MaterialTheme.typography.labelMedium)
                                    Spacer(Modifier.width(9.dp))
                                    Text("HTTP " + request.status, style = MaterialTheme.typography.labelMedium,
                                        color = if (request.status >= 400) MaterialTheme.colorScheme.error
                                            else MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Text(request.path, style = MaterialTheme.typography.bodyMedium)
                                Text(request.ip + " · " + request.at, style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(request.userAgent, style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                if (request.deniedBy.isNotBlank() && request.deniedBy != "null")
                                    Text("Denied: " + request.deniedBy, color = MaterialTheme.colorScheme.error,
                                        style = MaterialTheme.typography.labelMedium)
                            }
                        }
                    }
                    SectionHeading("Requested paths", "Most frequently requested URLs")
                    live.paths.take(25).forEach { (path, count) ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(path, modifier = Modifier.weight(1f),
                                style = MaterialTheme.typography.bodySmall)
                            Text(count.toString(), color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.labelMedium)
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                    SectionHeading("Claimed browsers", "Based on reported user-agent headers")
                    live.browsers.forEach { (label, count) ->
                        Row {
                            Text(label, modifier = Modifier.weight(1f))
                            Text(count.toString())
                        }
                    }
                }
                else -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        MetricTile("Requests", live.total.toString(), "Recorded", Modifier.weight(1f))
                        MetricTile("Data sent", live.sent.bytesLabel(), "Responses", Modifier.weight(1f))
                    }
                    MetricTile("Source IPs", live.uniqueIps.toString(), "Not unique visitors")
                    SectionHeading("Requests per minute", "Auto-refresh every 10 seconds while viewing")
                    ElevatedCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(17.dp)) {
                        Box(Modifier.padding(16.dp)) { RequestsBar(live.timeline) }
                    }
                    Text("These are ingested, completed requests—not live packet captures.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    SectionHeading("Geography", "Only available when the server provides enrichment")
                    Text(live.geographyNote, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedButton(onClick = { panel = "clients" },
                        modifier = Modifier.fillMaxWidth()) {
                        Text("Review client signals")
                    }
                    OutlinedButton(onClick = { panel = "requests" },
                        modifier = Modifier.fillMaxWidth()) {
                        Text("Browse recent requests")
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
