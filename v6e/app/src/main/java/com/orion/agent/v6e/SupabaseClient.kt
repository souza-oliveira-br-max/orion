package com.orion.agent.v6e

import android.util.Log
import org.json.JSONObject
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL

object SupabaseClient {
    data class Result(val ok: Boolean, val code: Int, val body: String)
    fun insert(projectUrl: String, anonKey: String, table: String, payload: JSONObject): Result {
        val endpoint = "${projectUrl.trimEnd('/')}/rest/v1/$table"
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("apikey", anonKey)
                setRequestProperty("Authorization", "Bearer $anonKey")
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Prefer", "return=minimal")
                doOutput = true
                connectTimeout = 15000
                readTimeout = 15000
            }
            val out: OutputStream = conn.outputStream
            out.write(payload.toString().toByteArray(Charsets.UTF_8))
            out.close()
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = try { stream?.bufferedReader()?.use { it.readText() } ?: "" } catch (_: Exception) { "" }
            Result(code in 200..299, code, body)
        } catch (e: Exception) {
            Log.e("ORION", "Supabase: ${e.message}")
            Result(false, -1, e.message ?: "erro")
        } finally {
            try { conn?.disconnect() } catch (_: Exception) { }
        }
    }
}