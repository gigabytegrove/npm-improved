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
        assertEquals("http://172.31.1.5/", NetworkPolicy.normalize("http://172.31.1.5", true).baseUrl)
        assertEquals("http://10.0.2.2/", NetworkPolicy.normalize("http://10.0.2.2", true).baseUrl)
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
