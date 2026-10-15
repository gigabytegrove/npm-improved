package com.gigabytegrove.npmi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class NetworkPolicyTest {
    @Test fun validTlsAndLocalIpv4() {
        assertEquals("https://proxy.example.org/", NetworkPolicy.normalize("https://proxy.example.org", false).baseUrl)
        assertEquals("https://proxy.example.org:8443/", NetworkPolicy.normalize("https://proxy.example.org:8443/api", false).baseUrl)
        assertEquals("http://192.168.0.18:8080/", NetworkPolicy.normalize("http://192.168.0.18:8080", true).baseUrl)
        assertEquals("http://172.31.1.5:81/", NetworkPolicy.normalize("http://172.31.1.5", true).baseUrl)
        assertEquals("http://10.0.2.2:81/", NetworkPolicy.normalize("http://10.0.2.2", true).baseUrl)
    }

    @Test fun directManagementDefaultsTo81() {
        assertEquals("http://192.168.20.5:81/",
            NetworkPolicy.directLan("192.168.20.5", true).baseUrl)
        assertEquals("http://10.10.1.15:8181/",
            NetworkPolicy.directLan("10.10.1.15:8181", true).baseUrl)
        assertEquals("http://172.18.5.10:81/",
            NetworkPolicy.directLan("http://172.18.5.10/api", true).baseUrl)
        assertEquals("https://admin.example.com/",
            NetworkPolicy.secureGateway("admin.example.com").baseUrl)
        assertEquals("https://admin.example.com:9443/",
            NetworkPolicy.secureGateway("https://admin.example.com:9443").baseUrl)
        try {
            NetworkPolicy.directLan("proxy.example.com", true)
            fail("Public HTTP must never be accepted.")
        } catch (_: IllegalArgumentException) { }
        try {
            NetworkPolicy.directLan("192.168.20.5", false)
            fail("LAN HTTP requires acknowledgment.")
        } catch (_: IllegalArgumentException) { }
    }

    @Test fun tlsProblemsProduceManagementGuidance() {
        val error = IllegalStateException("TLSV1_ALERT_UNRECOGNIZED_NAME")
        val text = ConnectionDiagnostics.explain(error, "https://proxy.example.org/")
        assertTrue(text.contains("443"))
        assertTrue(text.contains("81"))
    }

    private fun rejects(url: String, acknowledge: Boolean = true) {
        try {
            NetworkPolicy.normalize(url, acknowledge)
            fail("Expected rejection: " + url)
        } catch (_: IllegalArgumentException) { /* expected */ }
    }

    @Test fun rejectsPublicOrUnacknowledgedHttp() {
        rejects("http://8.8.8.8")
        rejects("http://google.example")
        rejects("http://192.168.0.18", false)
        rejects("http://172.32.0.1")
        rejects("http://192.169.0.1")
        rejects("http://192.168.001.1")
        rejects("http://0.0.0.0")
    }

    @Test fun rejectsCredentialAndPathInjection() {
        rejects("https://admin:password@proxy.example.org/")
        rejects("https://proxy.example.org/admin")
        rejects("https://proxy.example.org/?redirect=attacker")
        rejects("https://proxy.example.org/#fragment")
        rejects("ftp://proxy.example.org")
        rejects("not-a-url")
    }
}
