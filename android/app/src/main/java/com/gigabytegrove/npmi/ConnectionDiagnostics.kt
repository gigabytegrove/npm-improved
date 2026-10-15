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
                "TLS handshake rejected the requested hostname. NPMi's default management listener on port 81 is HTTP, not HTTPS. Use the explicit HTTP option on a trusted LAN/VPN, or configure a TLS-enabled management gateway with a certificate covering this hostname."
            "wrong version number" in message || "protocol_version" in message ||
                "unsupported or unrecognized ssl" in message ->
                "The selected port does not appear to support HTTPS. NPMi's default port 81 uses HTTP, not TLS. Use an explicit HTTP URL only on a trusted network (with the unencrypted-transport acknowledgement), or enable HTTPS on the management endpoint."
            failure is SSLException || "certificate" in message || "sslhandshake" in message ->
                "TLS validation failed: verify that the management endpoint has a certificate whose names include this hostname, and that HTTPS is actually enabled on the selected port. The app will not ignore a mismatched or untrusted certificate."
            "failed to connect" in message || "timeout" in message || "unreachable" in message ->
                "The management API could not be reached at $baseUrl. Verify the host, port, network access, and that port 81 is published (or proxied by your HTTPS gateway)."
            failure is ApiFailure && failure.statusCode == 404 ->
                "No NPMi management API was found at $baseUrl. The correct endpoint is /api on management port 81, not a proxy host on 80/443."
            else -> failure.message?.take(240) ?: "Unable to reach the NPM Improved management API."
        }
    }
}
