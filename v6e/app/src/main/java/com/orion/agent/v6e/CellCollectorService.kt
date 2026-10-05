package com.orion.agent.v6e

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationManager
import android.os.*
import android.telephony.*
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

class CellCollectorService : Service() {
    private var tm: TelephonyManager? = null
    private var lm: LocationManager? = null
    private var isRunning = false
    private var thread: HandlerThread? = null
    private var handler: Handler? = null

    companion object {
        const val BROADCAST_ACTION = "com.orion.agent.v6e.UPDATE"
        const val PREFS = "orion_v6e_prefs"
        const val KEY_TOTAL = "total_envios"
        const val KEY_PROJECT_URL = "supabase_url"
        const val KEY_ANON_KEY = "supabase_anon"
        const val KEY_TABLE = "supabase_table"
        const val KEY_NUMERO = "numero"
        const val INTERVAL_MS = 5 * 60 * 1000L
        const val TAG = "ORION"
        // ---- Dedup ----
        const val KEY_ULT_CID  = "ult_cid"
        const val KEY_ULT_ENB  = "ult_enb"
        const val KEY_ULT_LAT  = "ult_lat"
        const val KEY_ULT_LNG  = "ult_lng"
        const val KEY_ULT_RSRP = "ult_rsrp"
        const val KEY_ULT_TS   = "ult_ts"
        const val HEARTBEAT_MS = 15 * 60 * 1000L
    }
    override fun onCreate() {
        super.onCreate()
        tm = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        lm = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        Log.i(TAG, "onCreate OK")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            startFg()
            startCollecting()
            bStatus("Rodando")
        } catch (e: Exception) {
            Log.e(TAG, "onStart: ${e.message}")
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startFg() {
        val ch = "orion_v6e"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val c = NotificationChannel(ch, "ANA CLARA e Equipe NI", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(c)
        }
        val pi = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(this, ch)
            .setContentTitle("ANA CLARA e Equipe NI").setContentText("Coletando torres...")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pi).setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        else startForeground(1, n)
    }

    private fun startCollecting() {
        if (isRunning) return
        isRunning = true
        thread = HandlerThread("V6E-W").also { it.start() }
        handler = Handler(thread!!.looper)
        val r = object : Runnable {
            override fun run() {
                if (!isRunning) return
                try { collect() } catch (e: Exception) { Log.e(TAG, "loop: ${e.message}") }
                handler?.postDelayed(this, INTERVAL_MS)
            }
        }
        handler?.post(r)
    }

    private fun loc(): Location? {
        return try {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) return null
            val l = lm ?: return null
            val g = try { l.getLastKnownLocation(LocationManager.GPS_PROVIDER) } catch (_: Exception) { null }
            val n = try { l.getLastKnownLocation(LocationManager.NETWORK_PROVIDER) } catch (_: Exception) { null }
            when { g == null -> n; n == null -> g; g.time > n.time -> g; else -> n }
        } catch (_: Exception) { null }
    }

    private fun op(mcc: Int, mnc: Int): String {
        if (mcc != 724) return "MCC_$mcc"
        return when (mnc) {
            2 -> "TIM"; 3 -> "CLARO"; 4 -> "OI"; 5 -> "CLARO"
            6 -> "VIVO"; 10 -> "VIVO"; 15 -> "SERCOMTEL"; 25 -> "NEXTEL"; 31 -> "OI"
            else -> "MNC_$mnc"
        }
    }
    private fun collect() {
        val t = tm ?: return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) return
        val l = loc()
        var principal: JSONObject? = null
        val viz = JSONArray()
        try {
            val infos = t.allCellInfo ?: return
            for (info in infos) {
                try {
                    val reg = info.isRegistered
                    when (info) {
                        is CellInfoLte -> {
                            val id = info.cellIdentity
                            val s = info.cellSignalStrength
                            val eci = id.ci
                            val banda = BandHelper.fromLte(id)
                            val ta = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) { val t = s.timingAdvance; if (t == Int.MAX_VALUE) 0 else t } else 0
                            val enb = if (eci > 0 && eci != Int.MAX_VALUE) eci shr 8 else 0
                            val earfcn = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) id.earfcn else 0
                            val o = JSONObject().apply {
                                put("cell_id", eci.toString()); put("lac", id.tac.toString())
                                put("mcc", id.mcc); put("mnc", id.mnc); put("pci", id.pci)
                                put("rsrp", s.rsrp); put("rsrq", s.rsrq); put("rssnr", s.rssnr)
                                put("banda", banda); put("ta", ta); put("enb", enb); put("earfcn", earfcn)
                                put("operadora", op(id.mcc, id.mnc))
                            }
                            if (reg) principal = o else viz.put(o)
                        }
                        is CellInfoGsm -> {
                            val id = info.cellIdentity; val s = info.cellSignalStrength
                            val o = JSONObject().apply {
                                put("cell_id", id.cid.toString()); put("lac", id.lac.toString())
                                put("mcc", id.mcc); put("mnc", id.mnc); put("pci", 0)
                                put("rsrp", s.dbm); put("rsrq", -20); put("rssnr", 0)
                                put("banda", 0); put("ta", 0); put("enb", 0); put("earfcn", 0)
                                put("operadora", op(id.mcc, id.mnc))
                            }
                            if (reg) principal = o else viz.put(o)
                        }
                        is CellInfoWcdma -> {
                            val id = info.cellIdentity; val s = info.cellSignalStrength
                            val o = JSONObject().apply {
                                put("cell_id", id.cid.toString()); put("lac", id.lac.toString())
                                put("mcc", id.mcc); put("mnc", id.mnc); put("pci", id.psc)
                                put("rsrp", s.dbm); put("rsrq", -20); put("rssnr", 0)
                                put("banda", 0); put("ta", 0); put("enb", 0); put("earfcn", 0)
                                put("operadora", op(id.mcc, id.mnc))
                            }
                            if (reg) principal = o else viz.put(o)
                        }
                    }
                } catch (e: Exception) { Log.e(TAG, "cell: ${e.message}") }
            }
        } catch (e: Exception) { Log.e(TAG, "all: ${e.message}"); return }
        val cel = principal ?: return
        try {
            val p = getSharedPreferences(PREFS, MODE_PRIVATE)
            val url = p.getString(KEY_PROJECT_URL, "") ?: ""
            val key = p.getString(KEY_ANON_KEY, "") ?: ""
            val tab = p.getString(KEY_TABLE, "amostras") ?: "amostras"
            val num = p.getString(KEY_NUMERO, "") ?: ""
            if (url.isEmpty() || key.isEmpty()) { bErro("Supabase nao configurado"); return }
            val payload = JSONObject().apply {
                put("cell_id", cel.optString("cell_id", ""))
                put("lac", cel.optString("lac", ""))
                put("mcc", cel.optInt("mcc", 0)); put("mnc", cel.optInt("mnc", 0))
                put("rsrp", cel.optInt("rsrp", 0)); put("rsrq", cel.optInt("rsrq", 0))
                put("rssnr", cel.optInt("rssnr", 0)); put("pci", cel.optInt("pci", 0))
                put("banda", cel.optInt("banda", 0)); put("ta", cel.optInt("ta", 0))
                put("enb", cel.optInt("enb", 0)); put("earfcn", cel.optInt("earfcn", 0))
                put("operadora", cel.optString("operadora", ""))
                if (num.isNotEmpty()) put("numero", num)
                if (l != null) {
                    put("lat", l.latitude); put("lng", l.longitude)
                    put("precisao", l.accuracy.toDouble())
                }
                val vf = JSONArray()
                for (i in 0 until viz.length()) {
                    val v = viz.getJSONObject(i)
                    val cid = v.optString("cell_id", "")
                    if (cid.isEmpty() || cid == "2147483647" || cid == "0") continue
                    vf.put(v)
                }
                put("vizinhas", vf)
            }
            if (!deveEnviar(cel, l)) {
                Log.i(TAG, "Pulado: sem mudanca significativa")
                return
            }

            val r = SupabaseClient.insert(url, key, tab, payload)
            Log.i(TAG, "POST Supabase -> HTTP ${r.code} banda=${payload.optInt("banda")} enb=${payload.optInt("enb")} ta=${payload.optInt("ta")} viz=${payload.optJSONArray("vizinhas")?.length()}")
            if (!r.ok) Log.w(TAG, "resposta: ${r.body}")
            val tot = p.getInt(KEY_TOTAL, 0) + 1
            p.edit().putInt(KEY_TOTAL, tot).apply()
            if (r.ok) salvarUltimoEnvio(cel, l)
            bDados(cel, l, viz.length(), r.code, tot)
        } catch (e: Exception) {
            Log.e(TAG, "send: ${e.message}")
            bErro(e.message ?: "erro")
        }
    }

    private fun deveEnviar(cel: JSONObject, l: Location?): Boolean {
        val p = getSharedPreferences(PREFS, MODE_PRIVATE)
        val agora = System.currentTimeMillis()
        val ultTs = p.getLong(KEY_ULT_TS, 0L)
        if (ultTs == 0L) return true

        val cid  = cel.optString("cell_id", "")
        val enb  = cel.optInt("enb", 0)
        val rsrp = cel.optInt("rsrp", 0)

        // 1. Mudou de torre
        if (cid != p.getString(KEY_ULT_CID, "") || enb != p.getInt(KEY_ULT_ENB, 0)) return true

        // 2. Sinal variou mais de 8 dBm
        if (Math.abs(rsrp - p.getInt(KEY_ULT_RSRP, 0)) > 8) return true

        // 3. Heartbeat 15 min
        if (agora - ultTs > HEARTBEAT_MS) return true

        // 4. Moveu mais de ~30m
        if (l != null) {
            val ultLat = p.getFloat(KEY_ULT_LAT, 0f)
            val ultLng = p.getFloat(KEY_ULT_LNG, 0f)
            if (ultLat != 0f && ultLng != 0f) {
                val dLat = Math.abs(l.latitude.toFloat()  - ultLat)
                val dLng = Math.abs(l.longitude.toFloat() - ultLng)
                if (dLat > 0.0003f || dLng > 0.0003f) return true
            }
        }
        return false
    }

    private fun salvarUltimoEnvio(cel: JSONObject, l: Location?) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(KEY_ULT_CID, cel.optString("cell_id", ""))
            .putInt(KEY_ULT_ENB,    cel.optInt("enb", 0))
            .putInt(KEY_ULT_RSRP,   cel.optInt("rsrp", 0))
            .putFloat(KEY_ULT_LAT,  (l?.latitude  ?: 0.0).toFloat())
            .putFloat(KEY_ULT_LNG,  (l?.longitude ?: 0.0).toFloat())
            .putLong(KEY_ULT_TS,    System.currentTimeMillis())
            .apply()
    }

    private fun bDados(cel: JSONObject, l: Location?, vc: Int, hc: Int, tot: Int) {
        val i = Intent(BROADCAST_ACTION).apply {
            putExtra("tipo", "dados")
            putExtra("cid", cel.optString("cell_id", "-"))
            putExtra("lac", cel.optString("lac", "-"))
            putExtra("banda", cel.optInt("banda", 0).toString())
            putExtra("enb", cel.optInt("enb", 0).toString())
            putExtra("ta", cel.optInt("ta", 0).toString())
            putExtra("earfcn", cel.optInt("earfcn", 0).toString())
            putExtra("rsrp", cel.optInt("rsrp", 0).toString())
            putExtra("operadora", cel.optString("operadora", "-"))
            if (l != null) {
                putExtra("lat", String.format(Locale.US, "%.6f", l.latitude))
                putExtra("lng", String.format(Locale.US, "%.6f", l.longitude))
                putExtra("precisao", String.format(Locale.US, "%.1f", l.accuracy))
            }
            putExtra("httpCode", hc.toString())
            putExtra("total", tot.toString())
            putExtra("vizinhasCount", vc.toString())
            putExtra("timestamp", SimpleDateFormat("HH:mm:ss", Locale.US).format(Date()))
        }
        LocalBroadcastManager.getInstance(this).sendBroadcast(i)
    }
    private fun bErro(m: String) {
        val i = Intent(BROADCAST_ACTION).apply { putExtra("tipo", "erro"); putExtra("mensagem", m) }
        LocalBroadcastManager.getInstance(this).sendBroadcast(i)
    }
    private fun bStatus(s: String) {
        val i = Intent(BROADCAST_ACTION).apply { putExtra("tipo", "status"); putExtra("status", s) }
        LocalBroadcastManager.getInstance(this).sendBroadcast(i)
    }

    override fun onDestroy() {
        isRunning = false
        try { thread?.quitSafely() } catch (_: Exception) { }
        bStatus("Parado")
        super.onDestroy()
    }
}