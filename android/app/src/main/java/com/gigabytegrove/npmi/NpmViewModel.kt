package com.gigabytegrove.npmi

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class NpmViewModel(application: Application): AndroidViewModel(application) {
    private val store = SessionStore(application)
    val profiles = mutableStateListOf<ServerProfile>().apply { addAll(store.profiles()) }

    var selectedId by mutableStateOf(store.selectedId() ?: profiles.firstOrNull()?.id)
        private set
    val selected: ServerProfile? get() = profiles.firstOrNull { it.id == selectedId }
    val signedIn: Boolean get() = selected?.let { store.token(it.id) != null } == true
    var screen by mutableStateOf("dashboard")
    var addingServer by mutableStateOf(profiles.isEmpty())
    var status by mutableStateOf<NodeStatus?>(null)
        private set
    var summary by mutableStateOf<AnalyticsSummary?>(null)
        private set
    var analyticsNotice by mutableStateOf("")
        private set
    val hosts = mutableStateListOf<ProxyHost>()
    val rules = mutableStateListOf<BlockRule>()
    var loading by mutableStateOf(false)
        private set
    var message by mutableStateOf("")
        private set
    var error by mutableStateOf("")
        private set
    var challenge by mutableStateOf<String?>(null)
        private set
    var liveHostId by mutableStateOf<Int?>(null)
    var liveMinutes by mutableStateOf(15)
    var live by mutableStateOf<LiveTraffic?>(null)
    var liveError by mutableStateOf("")
        private set
    var blockDraft by mutableStateOf(BlockDraft("ip", ""))
    var blockConfirmation by mutableStateOf(false)

    init { if (signedIn) refresh() }

    private fun client(profile: ServerProfile): NpmApi =
        NpmApi(profile) { store.token(profile.id) }

    fun clearError() { error = ""; message = "" }

    fun addServer(name: String, url: String, acknowledgeHttp: Boolean) {
        try {
            require(name.isNotBlank() && name.length <= 80) { "Give this server a name (up to 80 characters)." }
            val endpoint = NetworkPolicy.normalize(url, acknowledgeHttp)
            val profile = store.upsert(name.trim(), endpoint)
            profiles.clear()
            profiles.addAll(store.profiles())
            selectedId = profile.id
            resetState()
            addingServer = false
            if (signedIn) refresh()
        } catch (e: Exception) { error = e.message ?: "Invalid server address." }
    }

    fun switch(id: String) {
        if (profiles.none { it.id == id }) return
        store.select(id)
        selectedId = id
        resetState()
        addingServer = false
        if (signedIn) refresh()
    }

    fun deleteServer(id: String) {
        store.delete(id)
        profiles.clear()
        profiles.addAll(store.profiles())
        selectedId = store.selectedId()
        resetState()
        addingServer = profiles.isEmpty()
        if (signedIn) refresh()
    }

    fun logout() {
        selected?.let { store.removeToken(it.id) }
        resetState()
    }

    private fun resetState() {
        status = null
        summary = null
        analyticsNotice = ""
        hosts.clear()
        rules.clear()
        live = null
        liveHostId = null
        liveError = ""
        challenge = null
        screen = "dashboard"
        clearError()
    }

    fun signIn(identity: String, password: String) {
        val profile = selected ?: return
        if (identity.isBlank() || password.isBlank()) {
            error = "Enter your NPMi account email and password."
            return
        }
        viewModelScope.launch {
            loading = true
            error = ""
            try {
                when (val result = client(profile).login(identity.trim(), password)) {
                    is LoginResult.Authorized -> {
                        if (selectedId == profile.id) {
                            store.saveToken(profile.id, result.token)
                            challenge = null
                            refresh()
                        }
                    }
                    is LoginResult.Challenge -> {
                        if (selectedId == profile.id) challenge = result.challengeToken
                    }
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (selectedId == profile.id) error = e.message ?: "Sign-in failed." }
            finally { loading = false }
        }
    }

    fun verifyTwoFactor(code: String) {
        val profile = selected ?: return
        val pending = challenge ?: return
        if (!Regex("^(?:[0-9]{6}|[A-Fa-f0-9]{8})$").matches(code.trim())) {
            error = "Enter your six- to eight-digit authenticator or backup code."
            return
        }
        viewModelScope.launch {
            loading = true
            error = ""
            try {
                val token = client(profile).verify2fa(pending, code.trim())
                if (selectedId == profile.id) {
                    store.saveToken(profile.id, token)
                    challenge = null
                    refresh()
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (selectedId == profile.id) error = e.message ?: "Two-factor verification failed." }
            finally { loading = false }
        }
    }

    fun cancelChallenge() { challenge = null; clearError() }

    fun refresh() {
        val profile = selected ?: return
        if (!signedIn) return
        viewModelScope.launch {
            loading = true
            clearError()
            val api = client(profile)
            try {
                val info = api.status()
                val list = api.hosts()
                if (selectedId != profile.id) return@launch
                status = info
                hosts.clear()
                hosts.addAll(list)
                try {
                    val stats = api.summary()
                    if (selectedId == profile.id) {
                        summary = stats
                        analyticsNotice = ""
                    }
                } catch (e: ApiFailure) {
                    if (e.statusCode == 401) throw e
                    if (selectedId == profile.id) { summary = null; analyticsNotice = "Analytics requires administrator access (" + e.statusCode + ")." }
                }
                try {
                    val result = api.blocks()
                    if (selectedId == profile.id) { rules.clear(); rules.addAll(result) }
                } catch (e: ApiFailure) {
                    if (e.statusCode == 401) throw e
                    // Host read-only users may not access administrative block policies.
                }
            } catch (e: CancellationException) { throw e }
            catch (e: ApiFailure) {
                if (selectedId == profile.id) {
                    if (e.statusCode == 401) {
                        store.removeToken(profile.id)
                        resetState()
                        error = "Session expired. Please sign in again."
                    } else error = e.message ?: "Server request failed."
                }
            } catch (e: Exception) {
                if (selectedId == profile.id) error = e.message ?: "Unable to reach this server."
            } finally { loading = false }
        }
    }

    fun openLive(id: Int) {
        liveHostId = id
        live = null
        liveError = ""
        screen = "traffic"
    }

    /** Called by lifecycle-aware Compose polling only while the screen is RESUMED. */
    suspend fun fetchLive(id: Int, minutes: Int) {
        val profile = selected ?: return
        if (!signedIn || liveHostId != id) return
        try {
            val result = client(profile).live(id, minutes)
            if (selectedId == profile.id && liveHostId == id && liveMinutes == minutes) {
                live = result
                liveError = ""
            }
        } catch (e: CancellationException) { throw e }
        catch (e: ApiFailure) {
            if (selectedId == profile.id) {
                liveError = e.message ?: "Cannot retrieve traffic."
                if (e.statusCode == 401) { store.removeToken(profile.id); resetState() }
            }
        } catch (e: Exception) {
            if (selectedId == profile.id) liveError = e.message ?: "Cannot retrieve traffic."
        }
    }

    fun toggleHost(host: ProxyHost) {
        val profile = selected ?: return
        if (status?.role == "secondary") {
            error = "This NPMX node is read-only for proxy host changes. Select the primary."
            return
        }
        viewModelScope.launch {
            loading = true
            clearError()
            try {
                client(profile).toggleHost(host.id, !host.enabled)
                if (selectedId == profile.id) {
                    message = if (host.enabled) "Host disabled." else "Host enabled."
                    refresh()
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (selectedId == profile.id) error = e.message ?: "Host update failed." }
            finally { loading = false }
        }
    }

    fun prepareBlock(type: String, target: String) {
        blockDraft = BlockDraft(type, target.take(160))
        blockConfirmation = false
        screen = "security"
    }

    fun addBlock() {
        val profile = selected ?: return
        val data = blockDraft
        blockConfirmation = false
        viewModelScope.launch {
            loading = true
            clearError()
            try {
                client(profile).addBlock(data.type, data.target.trim(), data.note)
                if (selectedId == profile.id) {
                    message = "Node-wide deny rule activated on this node."
                    blockDraft = BlockDraft("ip", "")
                    rules.clear()
                    rules.addAll(client(profile).blocks())
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (selectedId == profile.id) error = e.message ?: "Nginx block activation failed." }
            finally { loading = false }
        }
    }

    fun removeBlock(rule: BlockRule) {
        val profile = selected ?: return
        viewModelScope.launch {
            loading = true
            clearError()
            try {
                client(profile).removeBlock(rule.id)
                if (selectedId == profile.id) {
                    rules.clear()
                    rules.addAll(client(profile).blocks())
                    message = "Node-wide rule removed."
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (selectedId == profile.id) error = e.message ?: "Rule removal failed." }
            finally { loading = false }
        }
    }
}
