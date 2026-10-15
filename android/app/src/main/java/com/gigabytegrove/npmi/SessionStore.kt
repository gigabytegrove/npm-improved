package com.gigabytegrove.npmi

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Save only encrypted API tokens, never passwords or 2FA challenges. */
class SessionStore(context: Context) {
    private val preferences = context.getSharedPreferences("npmi_servers_v1", Context.MODE_PRIVATE)
    private val keyAlias = "npmi_session_aes_v1"
    private val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun key(): SecretKey {
        (store.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(keyAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build())
        }.generateKey()
    }

    fun profiles(): List<ServerProfile> = try {
        val array = JSONArray(preferences.getString("profiles", "[]"))
        (0 until array.length()).map { index ->
            val o = array.getJSONObject(index)
            ServerProfile(o.getString("id"), o.getString("name"), o.getString("url"), o.optBoolean("lan", false))
        }
    } catch (_: Exception) { emptyList() }

    fun selectedId(): String? = preferences.getString("active", null)

    fun upsert(name: String, endpoint: NetworkPolicy.Endpoint, editId: String? = null): ServerProfile {
        val all = profiles().toMutableList()
        val existing = if (editId != null) all.firstOrNull { it.id == editId }
            else all.firstOrNull { it.url == endpoint.baseUrl }
        if (existing != null && existing.url != endpoint.baseUrl) removeToken(existing.id)
        val profile = existing?.copy(name = name, url = endpoint.baseUrl,
            insecureLan = endpoint.insecureLan) ?: ServerProfile(
            UUID.randomUUID().toString(), name, endpoint.baseUrl, endpoint.insecureLan
        )
        all.removeAll { it.id == profile.id }
        all.add(profile)
        save(all)
        select(profile.id)
        return profile
    }

    fun select(id: String) = preferences.edit().putString("active", id).apply()

    fun delete(id: String) {
        removeToken(id)
        save(profiles().filterNot { it.id == id })
        if (selectedId() == id) preferences.edit().putString("active", profiles().firstOrNull()?.id).apply()
    }

    private fun save(items: List<ServerProfile>) {
        val array = JSONArray()
        items.forEach { p ->
            array.put(JSONObject().put("id", p.id).put("name", p.name)
                .put("url", p.url).put("lan", p.insecureLan))
        }
        preferences.edit().putString("profiles", array.toString()).apply()
    }

    fun token(id: String): String? {
        val stored = preferences.getString("auth_" + id, null) ?: return null
        return try {
            val bytes = Base64.decode(stored, Base64.NO_WRAP)
            if (bytes.size < 29) return null
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
        } catch (_: Exception) { removeToken(id); null }
    }

    fun saveToken(id: String, token: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val combined = cipher.iv + cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        preferences.edit().putString("auth_" + id,
            Base64.encodeToString(combined, Base64.NO_WRAP)).apply()
    }

    fun removeToken(id: String) = preferences.edit().remove("auth_" + id).apply()
}
