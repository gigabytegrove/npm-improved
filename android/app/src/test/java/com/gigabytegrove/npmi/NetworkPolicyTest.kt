package com.gigabytegrove.npmi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class NetworkPolicyTest {
    @Test fun allEnteredServersUseManagementPort81() {
        assertEquals("https://proxy.gigabytegrove.net:81/",
            NetworkPolicy.normalize("https://proxy.gigabytegrove.net/", false).baseUrl)
        assertEquals("https://proxy.gigabytegrove.net:81/",
            NetworkPolicy.normalize("https://proxy.gigabytegrove.net", false).baseUrl)
        assertEquals("https://proxy.example.org:81/",
            NetworkPolicy.normalize("https://proxy.example.org:443/api", false).baseUrl)
        assertEquals("http://192.168.20.5:81/",
            NetworkPolicy.normalize("192.168.20.5", true).baseUrl)
        assertEquals("http://10.10.1.15:81/",
            NetworkPolicy.normalize("http://10.10.1.15", true).baseUrl)
    }

    @Test fun deliberateAlternatePublishedManagementPortIsSupported() {
        assertEquals("https://proxy.example.org:8443/",
            NetworkPolicy.normalize("https://proxy.example.org:8443/api", false).baseUrl)
        assertEquals("http://192.168.10.1:8181/",
            NetworkPolicy.normalize("192.168.10.1:8181", true).baseUrl)
    }

    @Test fun hostnameDefaultsToControlPlaneHttpWithExplicitConsent() {
        assertEquals("http://proxy1.gigabytegrove.net:81/",
            NetworkPolicy.normalize("proxy1.gigabytegrove.net", true).baseUrl)
        try {
            NetworkPolicy.normalize("proxy1.gigabytegrove.net", false)
            fail("HTTP must require explicit consent")
        } catch (_: IllegalArgumentException) { }
        assertEquals("http://proxy1.gigabytegrove.net:81",
            NetworkPolicy.insecureAlternative("https://proxy1.gigabytegrove.net"))
    }

    @Test fun noSilentTlsDowngrades() {
        val https = NetworkPolicy.normalize("https://proxy.gigabytegrove.net", false)
        assertFalse(https.insecureLan)
        assertTrue(https.baseUrl.startsWith("https://"))
        try {
            NetworkPolicy.normalize("http://proxy.gigabytegrove.net", false)
            fail("Cleartext requires an explicit acknowledgement")
        } catch (_: IllegalArgumentException) { }
        assertEquals("http://proxy.gigabytegrove.net:81/",
            NetworkPolicy.normalize("proxy.gigabytegrove.net", true).baseUrl)
    }

    private fun rejects(url: String) {
        try {
            NetworkPolicy.normalize(url, true)
            fail("Expected rejection: " + url)
        } catch (_: IllegalArgumentException) { /* expected */ }
    }

    @Test fun rejectsUnsafeOrAmbiguousInputs() {
        rejects("https://admin:password@proxy.example.org/")
        rejects("https://proxy.example.org/admin")
        rejects("https://proxy.example.org/?redirect=attacker")
        rejects("https://proxy.example.org/#fragment")
        rejects("ftp://proxy.example.org")
        rejects("not-a-url/a/b")
    }

    @Test fun tlsDiagnosticsIdentifyPort81TransportMismatch() {
        val problem = IllegalStateException("wrong version number")
        val guidance = ConnectionDiagnostics.explain(problem, "https://proxy.example.org:81/")
        assertTrue(guidance.contains("81"))
        assertTrue(guidance.contains("HTTP"))
    }
}
