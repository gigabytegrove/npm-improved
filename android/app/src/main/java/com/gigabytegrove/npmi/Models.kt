package com.gigabytegrove.npmi

import org.json.JSONArray

data class ServerProfile(val id: String, val name: String, val url: String, val insecureLan: Boolean)
data class NodeStatus(val hostname: String, val name: String, val role: String, val version: String, val healthy: Boolean)
data class ProxyHost(val id: Int, val domains: List<String>, val upstream: String, val enabled: Boolean)
data class AnalyticsSummary(
    val requests: Long, val bytesOut: Long, val uniqueIps: Long?,
    val denied: Long?, val activeHosts: Int, val observedNode: String
)
data class ClientSignal(
    val value: String, val requests: Long, val probes: Long,
    val notFound: Long, val priority: String, val signals: List<String>
)
data class TrafficRequest(
    val at: String, val path: String, val method: String, val status: Int,
    val ip: String, val userAgent: String, val botClass: String, val deniedBy: String
)
data class LiveTraffic(
    val minutes: Int, val total: Long, val sent: Long, val uniqueIps: Long,
    val latest: String, val lastIngested: String, val timeline: List<Long>,
    val paths: List<Pair<String, Long>>, val browsers: List<Pair<String, Long>>,
    val ips: List<ClientSignal>, val agents: List<ClientSignal>,
    val requests: List<TrafficRequest>, val geographyAvailable: Boolean,
    val geographyNote: String
)
data class BlockRule(val id: Int, val type: String, val target: String, val note: String)
data class BlockDraft(val type: String, val target: String, val note: String = "")
sealed interface LoginResult {
    data class Authorized(val token: String): LoginResult
    data class Challenge(val challengeToken: String): LoginResult
}

internal fun JSONArray.strings(): List<String> =
    (0 until length()).mapNotNull { optString(it).takeIf(String::isNotBlank) }

internal fun Long.bytesLabel(): String {
    if (this < 1024) return this.toString() + " B"
    var count = toDouble()
    var level = 0
    while (count >= 1024 && level < 4) { count /= 1024; level++ }
    return "%.1f %s".format(java.util.Locale.US, count,
        listOf("B", "KiB", "MiB", "GiB", "TiB")[level])
}
