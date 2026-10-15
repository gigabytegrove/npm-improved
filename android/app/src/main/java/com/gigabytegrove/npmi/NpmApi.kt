package com.gigabytegrove.npmi

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiFailure(val statusCode: Int, message: String): IOException(message)

/** Never follow redirects with bearer credentials or weaken TLS verification. */
class NpmApi(private val profile: ServerProfile, private val auth: () -> String?) {
    private val client = OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false)
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private fun endpoint(path: String, query: Map<String, String> = emptyMap()): HttpUrl {
        val builder = profile.url.toHttpUrl().newBuilder().addPathSegment("api")
        path.trim('/').split('/').filter(String::isNotEmpty).forEach { builder.addPathSegment(it) }
        query.forEach { (name, value) -> builder.addQueryParameter(name, value) }
        return builder.build()
    }

    private suspend fun request(
        method: String, path: String, body: JSONObject? = null,
        authenticated: Boolean = true, query: Map<String, String> = emptyMap()
    ): String = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(endpoint(path, query)).header("Accept", "application/json")
        if (authenticated) {
            val token = auth().orEmpty()
            require(token.isNotBlank()) { "Sign in to this server first." }
            builder.header("Authorization", "Bearer " + token)
        }
        when (method) {
            "POST" -> builder.post((body ?: JSONObject()).toString()
                .toRequestBody("application/json".toMediaType()))
            "DELETE" -> builder.delete()
            else -> builder.get()
        }
        client.newCall(builder.build()).execute().use { response ->
            val content = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val parsed = runCatching { JSONObject(content) }.getOrNull()
                val error = parsed?.optJSONObject("error")?.optString("message")
                throw ApiFailure(response.code, error?.takeIf(String::isNotBlank)
                    ?: "NPM Improved returned HTTP " + response.code)
            }
            content
        }
    }

    private suspend fun obj(path: String, q: Map<String, String> = emptyMap()): JSONObject =
        JSONObject(request("GET", path, query = q))

    suspend fun status(): NodeStatus {
        val response = JSONObject(request("GET", "", authenticated = false))
        val node = response.optJSONObject("node") ?: JSONObject()
        val ver = response.optJSONObject("version") ?: JSONObject()
        fun field(name: String) = node.optString(name).takeUnless { it == "null" }.orEmpty()
        return NodeStatus(field("hostname"), field("name"), field("role"),
            ver.optString("display"), response.optString("status") == "OK")
    }

    suspend fun login(identity: String, password: String): LoginResult {
        val response = JSONObject(request("POST", "tokens",
            JSONObject().put("identity", identity).put("secret", password), authenticated = false))
        val token = response.optString("token")
        if (token.isNotBlank()) return LoginResult.Authorized(token)
        if (response.optBoolean("requires_2fa", false)) {
            val challenge = response.optString("challenge_token")
            if (challenge.isNotBlank()) return LoginResult.Challenge(challenge)
        }
        throw IOException("Authentication returned an unexpected response.")
    }

    suspend fun verify2fa(challenge: String, code: String): String {
        val response = JSONObject(request("POST", "tokens/2fa",
            JSONObject().put("challenge_token", challenge).put("code", code), authenticated = false))
        return response.optString("token").takeIf(String::isNotBlank)
            ?: throw IOException("Two-factor verification did not return a session token.")
    }

    suspend fun hosts(): List<ProxyHost> {
        val arr = JSONArray(request("GET", "nginx/proxy-hosts"))
        return (0 until arr.length()).map { i ->
            val h = arr.getJSONObject(i)
            val domains = h.optJSONArray("domain_names")?.strings() ?: emptyList()
            val upstream = h.optString("forward_scheme", "http") + "://" +
                h.optString("forward_host") + ":" + h.optInt("forward_port")
            ProxyHost(h.getInt("id"), domains, upstream, h.optBoolean("enabled", false))
        }
    }

    suspend fun toggleHost(id: Int, enable: Boolean) {
        require(id > 0)
        request("POST", "nginx/proxy-hosts/" + id +
            (if (enable) "/enable" else "/disable"))
    }

    suspend fun summary(): AnalyticsSummary {
        val a = obj("analytics/node", mapOf("hours" to "24"))
        val node = a.optJSONObject("node") ?: JSONObject()
        return AnalyticsSummary(a.optLong("requests"), a.optLong("bytes_out"),
            if (a.isNull("unique_ips")) null else a.optLong("unique_ips"),
            if (a.isNull("blocked_requests")) null else a.optLong("blocked_requests"),
            a.optInt("active_hosts"), node.optString("hostname"))
    }

    suspend fun live(id: Int, minutes: Int): LiveTraffic {
        require(id > 0 && minutes in listOf(5, 15, 60))
        val o = obj("analytics/node/hosts/" + id + "/live", mapOf("minutes" to minutes.toString()))
        fun pairs(name: String, value: String): List<Pair<String, Long>> {
            val arr = o.optJSONArray(name) ?: return emptyList()
            return (0 until arr.length()).map { i ->
                val row = arr.getJSONObject(i)
                row.optString(value) to row.optLong("requests")
            }
        }
        fun signals(name: String): List<ClientSignal> {
            val arr = o.optJSONArray(name) ?: return emptyList()
            return (0 until arr.length()).map { i ->
                val c = arr.getJSONObject(i)
                ClientSignal(c.optString("value"), c.optLong("requests"),
                    c.optLong("probe_requests"), c.optLong("not_found"),
                    c.optString("priority"), c.optJSONArray("signals")?.strings() ?: emptyList())
            }
        }
        val timelineArray = o.optJSONArray("timeline") ?: JSONArray()
        val timeline = (0 until timelineArray.length()).map {
            timelineArray.getJSONObject(it).optLong("requests")
        }
        val recentArray = o.optJSONArray("recent") ?: JSONArray()
        val recent = (0 until recentArray.length()).map {
            val row = recentArray.getJSONObject(it)
            TrafficRequest(row.optString("at"), row.optString("path"), row.optString("method"),
                row.optInt("status"), row.optString("client_ip"),
                row.optString("user_agent"), row.optString("bot_class"), row.optString("block_reason"))
        }
        val geo = o.optJSONObject("geography") ?: JSONObject()
        return LiveTraffic(minutes, o.optLong("requests"), o.optLong("bytes_out"),
            o.optLong("unique_ips"), o.optString("latest_request_at"),
            o.optString("last_ingested_at"), timeline, pairs("paths", "label"),
            pairs("browsers", "label"), signals("suspicious_ips"),
            signals("suspicious_agents"), recent, geo.optBoolean("available"),
            geo.optString("reason", "Geographic enrichment is unavailable."))
    }

    suspend fun blocks(): List<BlockRule> {
        val arr = obj("analytics/blocks").optJSONArray("rules") ?: JSONArray()
        return (0 until arr.length()).map { i ->
            val r = arr.getJSONObject(i)
            BlockRule(r.optInt("id"), r.optString("type"), r.optString("target"), r.optString("note"))
        }
    }

    suspend fun addBlock(type: String, target: String, note: String) {
        require(type in listOf("ip", "user_agent"))
        require(target.isNotBlank() && target.length <= 160 && note.length <= 256)
        request("POST", "analytics/blocks", JSONObject().put("type", type)
            .put("target", target).put("note", note))
    }

    suspend fun removeBlock(id: Int) {
        require(id > 0)
        request("DELETE", "analytics/blocks/" + id)
    }
}
