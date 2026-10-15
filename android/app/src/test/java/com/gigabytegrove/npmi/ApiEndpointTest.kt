package com.gigabytegrove.npmi

import org.junit.Assert.assertEquals
import org.junit.Test

class ApiEndpointTest {
    @Test fun rootProbeUsesCanonicalNonredirectingApiPath() {
        assertEquals("http://192.168.1.10:81/api/",
            managementApiUrl("http://192.168.1.10:81/", "").toString())
        assertEquals("https://proxy.example.org:81/api/",
            managementApiUrl("https://proxy.example.org:81/", "/").toString())
    }

    @Test fun tokensAndLiveAnalyticsRemainOnCorrectControlPlane() {
        val server = "http://192.168.1.10:81/"
        assertEquals("http://192.168.1.10:81/api/tokens",
            managementApiUrl(server, "tokens").toString())
        assertEquals("http://192.168.1.10:81/api/tokens/2fa",
            managementApiUrl(server, "/tokens/2fa").toString())
        assertEquals("http://192.168.1.10:81/api/analytics/node/hosts/5/live?minutes=15",
            managementApiUrl(server, "analytics/node/hosts/5/live",
                mapOf("minutes" to "15")).toString())
    }
}
