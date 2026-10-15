package com.gigabytegrove.npmi

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthenticationApiTest {
    @Test fun passwordLoginAndUserVerificationUseSameManagementApiOrigin() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setBody("""{"token":"test-token","expires":"2026-12-01T00:00:00Z"}"""))
            server.enqueue(MockResponse().setBody("""{"id":9,"email":"admin@example.org"}"""))
            val profile = ServerProfile("test", "Test", server.url("/").toString(), true)
            val api = NpmApi(profile) { "test-token" }
            val response = api.login("admin@example.org", "test-password")
            assertTrue(response is LoginResult.Authorized)
            assertEquals("test-token", (response as LoginResult.Authorized).token)
            api.verifySession()
            val login = server.takeRequest()
            assertEquals("POST", login.method)
            assertEquals("/api/tokens", login.path)
            assertTrue(login.body.readUtf8().contains("admin@example.org"))
            val me = server.takeRequest()
            assertEquals("GET", me.method)
            assertEquals("/api/users/me", me.path)
            assertEquals("Bearer test-token", me.getHeader("Authorization"))
        } finally { server.shutdown() }
    }

    @Test fun twoFactorChallengeAndVerificationUseServerSchema() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setBody("""{"requires_2fa":true,"challenge_token":"challenge-123"}"""))
            server.enqueue(MockResponse().setBody("""{"token":"verified-token","expires":"2026-12-01T00:00:00Z"}"""))
            val profile = ServerProfile("test", "Test", server.url("/").toString(), true)
            val api = NpmApi(profile) { null }
            val first = api.login("admin@example.org", "password")
            assertTrue("Expected 2FA challenge, received $first", first is LoginResult.Challenge)
            assertEquals("2FA challenge token", "challenge-123", (first as LoginResult.Challenge).challengeToken)
            assertEquals("2FA verification token", "verified-token", api.verify2fa("challenge-123", "123456"))
            server.takeRequest()
            val verify = server.takeRequest()
            assertEquals("2FA URL", "/api/tokens/2fa", verify.path)
            val verificationPayload = verify.body.readUtf8()
            assertTrue("Challenge missing from 2FA POST: $verificationPayload", verificationPayload.contains("challenge_token"))
            assertTrue("Code missing from 2FA POST: $verificationPayload", verificationPayload.contains("123456"))
        } finally { server.shutdown() }
    }

    @Test fun server401RemainsAnAuthErrorRatherThanFakeTlsFailure() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setResponseCode(401)
                .setBody("""{"error":{"message":"Invalid email or password"}}"""))
            val profile = ServerProfile("test", "Test", server.url("/").toString(), true)
            val api = NpmApi(profile) { null }
            try {
                api.login("admin@example.org", "wrong")
                throw AssertionError("Expected HTTP 401")
            } catch (e: ApiFailure) {
                assertEquals(401, e.statusCode)
                assertTrue(e.message!!.contains("Invalid email or password"))
            }
        } finally { server.shutdown() }
    }

    @Test fun healthEndpointUsesCanonicalTrailingSlash() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setBody("""{"status":"OK","version":{"display":"v1.6.11"},"node":{"role":"primary"}}"""))
            val profile = ServerProfile("test", "Test", server.url("/").toString(), true)
            val status = NpmApi(profile) { null }.status()
            assertTrue(status.healthy)
            assertEquals("/api/", server.takeRequest().path)
        } finally { server.shutdown() }
    }
}
