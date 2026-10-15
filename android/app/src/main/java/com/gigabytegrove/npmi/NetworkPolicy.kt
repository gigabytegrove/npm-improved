package com.gigabytegrove.npmi

import java.net.URI
import java.util.Locale

/** Reject credential-bearing, ambiguous, or public cleartext server URLs. */
object NetworkPolicy {
    data class Endpoint(val baseUrl: String, val insecureLan: Boolean)

    fun normalize(input: String, acknowledgedLanHttp: Boolean): Endpoint {
        val uri = try { URI(input.trim()) } catch (_: Exception) {
            throw IllegalArgumentException("Enter a complete http:// or https:// server URL.")
        }
        val scheme = uri.scheme?.lowercase(Locale.US)
        require(scheme == "https" || scheme == "http") { "Enter an HTTPS or private LAN HTTP address." }
        require(uri.host != null && uri.host.isNotBlank() && uri.userInfo == null &&
            uri.rawQuery == null && uri.rawFragment == null) {
            "Server addresses cannot contain credentials, queries, or fragments."
        }
        require(uri.rawPath.isNullOrBlank() || uri.rawPath in listOf("/", "/api", "/api/")) {
            "Enter the server address, not an application path."
        }
        val host = uri.host.lowercase(Locale.US)
        val localHttp = scheme == "http"
        if (localHttp) {
            require(isPrivateIpv4(host)) { "HTTP is restricted to private LAN IPv4 addresses. Use HTTPS for public servers." }
            require(acknowledgedLanHttp) { "Acknowledge that local HTTP sends credentials without encryption." }
        }
        require(uri.port == -1 || uri.port in 1..65535) { "Invalid port." }
        val port = if (uri.port == -1) "" else ":" + uri.port
        return Endpoint(scheme + "://" + host + port + "/", localHttp)
    }

    private fun isPrivateIpv4(host: String): Boolean {
        val octets = host.split(".")
        if (octets.size != 4 || octets.any { it.isEmpty() || it.length > 3 ||
                !it.all(Char::isDigit) || (it.length > 1 && it[0] == '0') }) return false
        val bytes = octets.map { it.toIntOrNull() ?: return false }
        if (bytes.any { it !in 0..255 }) return false
        return bytes[0] == 10 || bytes[0] == 127 ||
            (bytes[0] == 172 && bytes[1] in 16..31) ||
            (bytes[0] == 192 && bytes[1] == 168)
    }
}
