package com.gigabytegrove.npmi

import java.net.URI
import java.util.Locale

/**
 * Resolve the user's single server hostname/IP to NPMi's management API.
 * NPMi's control plane listens on port 81; 80/443 are proxy website ports.
 * Preserve the selected transport: NEVER silently downgrade HTTPS credentials
 * to HTTP, even when the default port-81 listener is cleartext.
 */
object NetworkPolicy {
    const val DEFAULT_API_PORT = 81
    data class Endpoint(val baseUrl: String, val insecureLan: Boolean)

    fun normalize(input: String, acknowledgedHttp: Boolean): Endpoint {
        val raw = input.trim()
        require(raw.isNotBlank()) { "Enter your NPM Improved hostname or IP address." }
        val address = when {
            raw.startsWith("http://", ignoreCase = true) ||
                raw.startsWith("https://", ignoreCase = true) -> raw
            else -> {
                // Unqualified private IPs connect to the standard HTTP control
                // plane; all other hostnames default to HTTPS, not plaintext.
                val provisional = try { URI("https://" + raw) } catch (_: Exception) {
                    throw IllegalArgumentException("Enter a valid hostname or IP address.")
                }
                val scheme = if (provisional.host?.let(::isPrivateIpv4) == true) "http" else "https"
                "$scheme://$raw"
            }
        }
        val uri = try { URI(address) } catch (_: Exception) {
            throw IllegalArgumentException("Enter a valid hostname or IP address.")
        }
        val scheme = uri.scheme?.lowercase(Locale.US)
        require(scheme == "http" || scheme == "https") { "Only HTTP and HTTPS management connections are supported." }
        require(uri.host != null && uri.host.isNotBlank() && uri.userInfo == null &&
            uri.rawQuery == null && uri.rawFragment == null) {
            "The server address cannot include credentials, queries, or fragments."
        }
        require(uri.rawPath.isNullOrBlank() || uri.rawPath in listOf("/", "/api", "/api/")) {
            "Enter the server hostname or IP, not a web page or API path."
        }
        require(uri.port == -1 || uri.port in 1..65535) { "Invalid management port." }
        val hostname = uri.host.lowercase(Locale.US)
        val isHttp = scheme == "http"
        if (isHttp) {
            require(acknowledgedHttp) {
                "HTTP sends your password and session token without encryption. Acknowledge this risk, or use HTTPS on the management port."
            }
        }
        // Default to 81 for EVERY hostname and IP. An explicitly supplied
        // nonstandard management port remains possible for remapped instances.
        val managementPort = if (uri.port == -1 || uri.port == 80 || uri.port == 443) {
            DEFAULT_API_PORT
        } else uri.port
        return Endpoint("$scheme://$hostname:$managementPort/", isHttp)
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
