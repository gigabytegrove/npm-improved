package com.gigabytegrove.npmi

import javax.net.ssl.SSLException

/** Redact low-level TLS stack messages from the UI while keeping useful diagnosis. */
object ConnectionDiagnostics {
    fun explain(failure: Throwable, baseUrl: String): String {
        val message = generateSequence(failure) { it.cause }
            .mapNotNull { it.message }
            .joinToString(" | ").lowercase()
        return when {
            "unrecognized_name" in message || "unrecognized name" in message ->
                "TLS hostname was rejected by the server. This address may be reaching the proxy website listener on port 443, not NPMi's management API on port 81. Use Direct LAN with a private server IP, or configure an HTTPS management gateway that forwards /api to port 81."
            "wrong version number" in message || "protocol_version" in message ||
                "unsupported or unrecognized ssl" in message ->
                "The selected port does not appear to support HTTPS. NPMi's default port 81 uses HTTP, not TLS. Choose Direct LAN, or connect through a separately configured HTTPS management gateway."
            failure is SSLException || "certificate" in message || "sslhandshake" in message ->
                "Secure connection failed. Check the gateway's hostname, certificate, and whether it forwards /api to management port 81. Certificate verification remains enabled."
            "failed to connect" in message || "timeout" in message || "unreachable" in message ->
                "The management API could not be reached at $baseUrl. Verify the host, port, network access, and that port 81 is published (or proxied by your HTTPS gateway)."
            failure is ApiFailure && failure.statusCode == 404 ->
                "No NPMi management API was found at $baseUrl. The correct endpoint is /api on management port 81, not a proxy host on 80/443."
            else -> failure.message?.take(240) ?: "Unable to reach the NPM Improved management API."
        }
    }
}
