# scaffold-v6e.ps1
# Cria o projeto V6E clonando mobile/ e substituindo os sources.

param(
    [string]$SupabaseUrl     = "https://SEU-PROJETO.supabase.co",
    [string]$SupabaseAnonKey = "COLE_AQUI_A_ANON_KEY"
)

$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
$src  = Join-Path $root "mobile"
$dst  = Join-Path $root "v6e"

if (-not (Test-Path $src)) { throw "Nao achei 'mobile' em $root" }
if (Test-Path $dst)        { throw "'v6e' ja existe. Apaga ou renomeia antes." }

Write-Host "1/5 Copiando mobile -> v6e (sem caches)..." -ForegroundColor Cyan
robocopy $src $dst /E /XD .gradle build .idea .git /NFL /NDL /NJH /NJS /NP | Out-Null

$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-File($path, $content) {
    $dir = Split-Path $path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::WriteAllText($path, $content, $utf8)
    Write-Host "    + $path" -ForegroundColor DarkGray
}

Write-Host "2/5 Removendo sources antigos..." -ForegroundColor Cyan
$oldPkg = Join-Path $dst "app\src\main\java\com\orion\agent"
if (Test-Path $oldPkg) { Remove-Item $oldPkg -Recurse -Force }

$pkg = Join-Path $dst "app\src\main\java\com\orion\agent\v6e"
New-Item -ItemType Directory -Path $pkg -Force | Out-Null

Write-Host "3/5 Escrevendo Kotlin..." -ForegroundColor Cyan

# ---------- BandHelper.kt ----------
Write-File (Join-Path $pkg "BandHelper.kt") @'
package com.orion.agent.v6e

import android.os.Build
import android.telephony.CellIdentityLte

/**
 * Obtem a banda LTE em 3 camadas:
 *   1) CellIdentityLte.getBands()  -> Android 11+ (API 30)  [fonte oficial]
 *   2) EARFCN -> banda (3GPP TS 36.101)
 *   3) 0 (desconhecida)
 */
object BandHelper {

    fun fromLte(id: CellIdentityLte): Int {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                val bands = id.bands
                if (bands != null && bands.isNotEmpty() && bands[0] > 0) {
                    return bands[0]
                }
            } catch (_: Exception) { }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                val b = earfcnToBand(id.earfcn)
                if (b > 0) return b
            } catch (_: Exception) { }
        }
        return 0
    }

    fun earfcnToBand(earfcn: Int): Int {
        if (earfcn <= 0 || earfcn == Int.MAX_VALUE) return 0
        return when (earfcn) {
            in 0..599        -> 1
            in 600..1199     -> 2
            in 1200..1949    -> 3
            in 1950..2399    -> 4
            in 2400..2649    -> 5
            in 2650..2749    -> 6
            in 2750..3449    -> 7
            in 3450..37749   -> 8
            in 37750..38249  -> 38
            in 38650..39649  -> 39
            in 39650..41589  -> 40
            in 9210..9659    -> 28
            else             -> 0
        }
    }
}
'@

# ---------- SupabaseClient.kt ----------
Write-File (Join-Path $pkg "SupabaseClient.kt") @'
package com.orion.agent.v6e

import android.util.Log
import org.json.JSONObject
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL

object SupabaseClient {

    private const val TAG = "ORION"

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
            Log.e(TAG, "Supabase insert: ${e.message}")
            Result(false, -1, e.message ?: "erro")
        } finally {
            try { conn?.disconnect() } catch (_: Exception) { }
        }
    }
}
'@

# ---------- CellCollectorService.kt ----------
Write-File (Join-Path $pkg "CellCollectorService.kt") @'
package com.orion.agent.v6e

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.telephony.CellInfoLte
import android.telephony.CellInfoGsm
import android.telephony.CellInfoWcdma
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class CellCollectorService : Service() {

    private var tm: TelephonyManager? = null
    private var lm: LocationManager? = null
    private var isRunning = false
    private var thread: HandlerThread? = null
    private var handler: Handler? = null

    companion object {
        const val BROADCAST_ACTION = "com.orion.agent.v6e.UPDATE"
        const val PREFS = "orion_v6e_prefs"
        const val KEY_TOTAL       = "total_envios"
        const val KEY_PROJECT_URL = "supabase_url"
        const val KEY_ANON_KEY    = "supabase_anon"
        const val KEY_TABLE       = "supabase_table"
        const val KEY_NUMERO      = "numero"
        const val INTERVAL_MS     = 30_000L
        private const val TAG = "ORION"
    }

    override fun onCreate() {
        super.onCreate()
        try {
            tm = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            lm = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            Log.i(TAG, "onCreate OK")
        } catch (e: Exception) {
            Log.e(TAG, "onCreate: ${e.message}")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            startForegroundNotification()
            startCollecting()
            broadcastStatus("Rodando")
        } catch (e: Exception) {
            Log.e(TAG, "onStartCommand: ${e.message}")
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startForegroundNotification() {
        val chId = "orion_v6e"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(chId, "V6E", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(ch)
        }
        val pi = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = NotificationCompat.Builder(this, chId)
            .setContentTitle("V6E")
            .setContentText("Coletando torres...")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(1, n)
        }
    }

    private fun startCollecting() {
        if (isRunning) return
        isRunning = true
        thread = HandlerThread("V6E-Worker").also { it.start() }
        handler = Handler(thread!!.looper)
        val r = object : Runnable {
            override fun run() {
                if (!isRunning) return
                try { collectAndSend() } catch (e: Exception) { Log.e(TAG, "loop: ${e.message}") }
                handler?.postDelayed(this, INTERVAL_MS)
            }
        }
        handler?.post(r)
    }

    private fun ultimaLocalizacao(): Location? {
        return try {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) return null
            val l = lm ?: return null
            val gps = try { l.getLastKnownLocation(LocationManager.GPS_PROVIDER) } catch (_: Exception) { null }
            val net = try { l.getLastKnownLocation(LocationManager.NETWORK_PROVIDER) } catch (_: Exception) { null }
            when {
                gps == null -> net
                net == null -> gps
                gps.time > net.time -> gps
                else -> net
            }
        } catch (e: Exception) { null }
    }

    private fun nomeOperadora(mcc: Int, mnc: Int): String {
        if (mcc != 724) return "MCC_$mcc"
        return when (mnc) {
            2 -> "TIM"; 3 -> "CLARO"; 4 -> "OI"; 5 -> "CLARO"
            6 -> "VIVO"; 10 -> "VIVO"; 15 -> "SERCOMTEL"
            25 -> "NEXTEL"; 31 -> "OI"
            else -> "MNC_$mnc"
        }
    }

    private fun collectAndSend() {
        val tm = tm ?: return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) return

        val loc = ultimaLocalizacao()
        var principal: JSONObject? = null
        val vizinhas = JSONArray()

        try {
            val infos = tm.allCellInfo ?: return
            for (info in infos) {
                try {
                    val reg = info.isRegistered
                    when (info) {
                        is CellInfoLte -> {
                            val id = info.cellIdentity
                            val sig = info.cellSignalStrength
                            val eci = id.ci
                            val banda = BandHelper.fromLte(id)
                            val ta = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) sig.timingAdvance else 0
                            val enb = if (eci > 0 && eci != Int.MAX_VALUE) eci shr 8 else 0
                            val earfcn = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) id.earfcn else 0

                            val cell = JSONObject().apply {
                                put("cell_id", eci.toString())
                                put("lac", id.tac.toString())
                                put("mcc", id.mcc)
                                put("mnc", id.mnc)
                                put("pci", id.pci)
                                put("rsrp", sig.rsrp)
                                put("rsrq", sig.rsrq)
                                put("rssnr", sig.rssnr)
                                put("banda", banda)
                                put("ta", ta)
                                put("enb", enb)
                                put("earfcn", earfcn)
                                put("operadora", nomeOperadora(id.mcc, id.mnc))
                            }
                            if (reg) principal = cell else vizinhas.put(cell)
                        }
                        is CellInfoGsm -> {
                            val id = info.cellIdentity
                            val sig = info.cellSignalStrength
                            val cell = JSONObject().apply {
                                put("cell_id", id.cid.toString())
                                put("lac", id.lac.toString())
                                put("mcc", id.mcc)
                                put("mnc", id.mnc)
                                put("pci", 0)
                                put("rsrp", sig.dbm)
                                put("rsrq", -20)
                                put("rssnr", 0)
                                put("banda", 0)
                                put("ta", 0)
                                put("enb", 0)
                                put("earfcn", 0)
                                put("operadora", nomeOperadora(id.mcc, id.mnc))
                            }
                            if (reg) principal = cell else vizinhas.put(cell)
                        }
                        is CellInfoWcdma -> {
                            val id = info.cellIdentity
                            val sig = info.cellSignalStrength
                            val cell = JSONObject().apply {
                                put("cell_id", id.cid.toString())
                                put("lac", id.lac.toString())
                                put("mcc", id.mcc)
                                put("mnc", id.mnc)
                                put("pci", id.psc)
                                put("rsrp", sig.dbm)
                                put("rsrq", -20)
                                put("rssnr", 0)
                                put("banda", 0)
                                put("ta", 0)
                                put("enb", 0)
                                put("earfcn", 0)
                                put("operadora", nomeOperadora(id.mcc, id.mnc))
                            }
                            if (reg) principal = cell else vizinhas.put(cell)
                        }
                    }
                } catch (e: Exception) { Log.e(TAG, "cell: ${e.message}") }
            }
        } catch (e: Exception) {
            Log.e(TAG, "allCellInfo: ${e.message}")
            return
        }

        val cel = principal ?: return

        try {
            val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
            val projectUrl = prefs.getString(KEY_PROJECT_URL, "") ?: ""
            val anonKey    = prefs.getString(KEY_ANON_KEY, "") ?: ""
            val table      = prefs.getString(KEY_TABLE, "amostras") ?: "amostras"
            val numero     = prefs.getString(KEY_NUMERO, "") ?: ""

            if (projectUrl.isEmpty() || anonKey.isEmpty()) {
                broadcastErro("Supabase URL/anon key nao configurados")
                return
            }

            val payload = JSONObject().apply {
                put("cell_id", cel.optString("cell_id", ""))
                put("lac", cel.optString("lac", ""))
                put("mcc", cel.optInt("mcc", 0))
                put("mnc", cel.optInt("mnc", 0))
                put("rsrp", cel.optInt("rsrp", 0))
                put("rsrq", cel.optInt("rsrq", 0))
                put("rssnr", cel.optInt("rssnr", 0))
                put("pci", cel.optInt("pci", 0))
                put("banda", cel.optInt("banda", 0))
                put("ta", cel.optInt("ta", 0))
                put("enb", cel.optInt("enb", 0))
                put("earfcn", cel.optInt("earfcn", 0))
                put("operadora", cel.optString("operadora", ""))
                if (numero.isNotEmpty()) put("numero", numero)
                if (loc != null) {
                    put("lat", loc.latitude)
                    put("lng", loc.longitude)
                    put("precisao", loc.accuracy.toDouble())
                }
                // Filtra vizinhas sem ECI valido
                val vf = JSONArray()
                for (i in 0 until vizinhas.length()) {
                    val v = vizinhas.getJSONObject(i)
                    val cid = v.optString("cell_id", "")
                    if (cid.isEmpty() || cid == "2147483647" || cid == "0") continue
                    vf.put(v)
                }
                put("vizinhas", vf)
            }

            val res = SupabaseClient.insert(projectUrl, anonKey, table, payload)
            Log.i(TAG, "POST Supabase -> HTTP ${res.code} banda=${payload.optInt("banda")} " +
                    "enb=${payload.optInt("enb")} ta=${payload.optInt("ta")} viz=${payload.optJSONArray("vizinhas")?.length()}")
            if (!res.ok) Log.w(TAG, "resposta: ${res.body}")

            val total = prefs.getInt(KEY_TOTAL, 0) + 1
            prefs.edit().putInt(KEY_TOTAL, total).apply()
            broadcastDados(cel, loc, vizinhas.length(), res.code, total)
        } catch (e: Exception) {
            Log.e(TAG, "enviar: ${e.message}")
            broadcastErro(e.message ?: "erro")
        }
    }

    private fun broadcastDados(cel: JSONObject, loc: Location?, vizCount: Int, httpCode: Int, total: Int) {
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
            if (loc != null) {
                putExtra("lat", String.format(Locale.US, "%.6f", loc.latitude))
                putExtra("lng", String.format(Locale.US, "%.6f", loc.longitude))
                putExtra("precisao", String.format(Locale.US, "%.1f", loc.accuracy))
            }
            putExtra("httpCode", httpCode.toString())
            putExtra("total", total.toString())
            putExtra("vizinhasCount", vizCount.toString())
            putExtra("timestamp", SimpleDateFormat("HH:mm:ss", Locale.US).format(Date()))
        }
        LocalBroadcastManager.getInstance(this).sendBroadcast(i)
    }

    private fun broadcastErro(msg: String) {
        val i = Intent(BROADCAST_ACTION).apply {
            putExtra("tipo", "erro")
            putExtra("mensagem", msg)
        }
        LocalBroadcastManager.getInstance(this).sendBroadcast(i)
    }

    private fun broadcastStatus(s: String) {
        val i = Intent(BROADCAST_ACTION).apply {
            putExtra("tipo", "status")
            putExtra("status", s)
        }
        LocalBroadcastManager.getInstance(this).sendBroadcast(i)
    }

    override fun onDestroy() {
        isRunning = false
        try { thread?.quitSafely() } catch (_: Exception) { }
        broadcastStatus("Parado")
        super.onDestroy()
    }
}
'@

# ---------- MainActivity.kt ----------
Write-File (Join-Path $pkg "MainActivity.kt") @'
package com.orion.agent.v6e

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager

class MainActivity : AppCompatActivity() {

    private lateinit var etUrl: EditText
    private lateinit var etKey: EditText
    private lateinit var etNumero: EditText
    private lateinit var tvStatus: TextView
    private lateinit var tvColeta: TextView
    private lateinit var tvGps: TextView
    private lateinit var tvEnvios: TextView
    private lateinit var tvViz: TextView
    private lateinit var tvLog: TextView

    private val prefs by lazy { getSharedPreferences(CellCollectorService.PREFS, MODE_PRIVATE) }

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, i: Intent?) {
            when (i?.getStringExtra("tipo")) {
                "dados" -> {
                    tvColeta.text = buildString {
                        append("CID: ${i.getStringExtra("cid")}\n")
                        append("LAC: ${i.getStringExtra("lac")}\n")
                        append("Banda: ${i.getStringExtra("banda")}\n")
                        append("eNB: ${i.getStringExtra("enb")}\n")
                        append("TA: ${i.getStringExtra("ta")}\n")
                        append("EARFCN: ${i.getStringExtra("earfcn")}\n")
                        append("RSRP: ${i.getStringExtra("rsrp")} dBm\n")
                        append("Operadora: ${i.getStringExtra("operadora")}")
                    }
                    tvGps.text = "Lat: ${i.getStringExtra("lat") ?: "-"}\n" +
                                 "Lng: ${i.getStringExtra("lng") ?: "-"}\n" +
                                 "Precisao: ${i.getStringExtra("precisao") ?: "-"} m"
                    tvEnvios.text = "Total: ${i.getStringExtra("total")}\n" +
                                    "Ultimo HTTP: ${i.getStringExtra("httpCode")} (${i.getStringExtra("timestamp")})"
                    tvViz.text = "Vizinhas: ${i.getStringExtra("vizinhasCount")}"
                    appendLog("HTTP ${i.getStringExtra("httpCode")} - CID ${i.getStringExtra("cid")}")
                }
                "erro" -> appendLog("ERRO: ${i.getStringExtra("mensagem")}")
                "status" -> tvStatus.text = "* ${i.getStringExtra("status")}"
            }
        }
    }

    private fun appendLog(line: String) {
        val ts = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date())
        tvLog.text = "[$ts] $line\n${tvLog.text}"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        etUrl     = findViewById(R.id.etUrl)
        etKey     = findViewById(R.id.etKey)
        etNumero  = findViewById(R.id.etNumero)
        tvStatus  = findViewById(R.id.tvStatus)
        tvColeta  = findViewById(R.id.tvColeta)
        tvGps     = findViewById(R.id.tvGps)
        tvEnvios  = findViewById(R.id.tvEnvios)
        tvViz     = findViewById(R.id.tvViz)
        tvLog     = findViewById(R.id.tvLog)

        etUrl.setText(prefs.getString(CellCollectorService.KEY_PROJECT_URL, ""))
        etKey.setText(prefs.getString(CellCollectorService.KEY_ANON_KEY, ""))
        etNumero.setText(prefs.getString(CellCollectorService.KEY_NUMERO, ""))
        tvEnvios.text = "Total: ${prefs.getInt(CellCollectorService.KEY_TOTAL, 0)}"

        findViewById<Button>(R.id.btnIniciar).setOnClickListener { iniciar() }
        findViewById<Button>(R.id.btnParar).setOnClickListener { parar() }
        findViewById<Button>(R.id.btnEnviarAgora).setOnClickListener {
            salvarPrefs()
            // Forca um ciclo: para e reinicia
            stopService(Intent(this, CellCollectorService::class.java))
            startForegroundServiceCompat()
        }

        pedirPermissoes()
    }

    private fun salvarPrefs() {
        prefs.edit()
            .putString(CellCollectorService.KEY_PROJECT_URL, etUrl.text.toString().trim())
            .putString(CellCollectorService.KEY_ANON_KEY, etKey.text.toString().trim())
            .putString(CellCollectorService.KEY_NUMERO, etNumero.text.toString().trim())
            .apply()
    }

    private fun iniciar() {
        salvarPrefs()
        startForegroundServiceCompat()
    }

    private fun parar() {
        stopService(Intent(this, CellCollectorService::class.java))
        tvStatus.text = "* Parado"
    }

    private fun startForegroundServiceCompat() {
        val i = Intent(this, CellCollectorService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i)
        else startService(i)
    }

    private fun pedirPermissoes() {
        val list = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.READ_PHONE_STATE
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            list.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        val faltando = list.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (faltando.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, faltando.toTypedArray(), 100)
        }
    }

    override fun onResume() {
        super.onResume()
        val f = IntentFilter(CellCollectorService.BROADCAST_ACTION)
        LocalBroadcastManager.getInstance(this).registerReceiver(receiver, f)
    }

    override fun onPause() {
        LocalBroadcastManager.getInstance(this).unregisterReceiver(receiver)
        super.onPause()
    }
}
'@

Write-Host "4/5 Escrevendo layout + manifest..." -ForegroundColor Cyan

# ---------- layout ----------
Write-File (Join-Path $dst "app\src\main\res\layout\activity_main.xml") @'
<?xml version="1.0" encoding="utf-8"?>
<ScrollView xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#0F1116">

    <LinearLayout
        android:orientation="vertical"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:padding="16dp">

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="V6E"
            android:textColor="#F87171"
            android:textSize="32sp"
            android:textStyle="bold"/>

        <TextView
            android:id="@+id/tvStatus"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="* Parado"
            android:textColor="#4ADE80"
            android:paddingTop="4dp"
            android:paddingBottom="12dp"/>

        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
            android:text="Supabase URL" android:textColor="#FFF"/>
        <EditText
            android:id="@+id/etUrl"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:hint="https://xxxx.supabase.co"
            android:textColor="#FFF"
            android:textColorHint="#666"
            android:inputType="textUri"/>

        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
            android:text="Anon key" android:textColor="#FFF" android:paddingTop="8dp"/>
        <EditText
            android:id="@+id/etKey"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:hint="eyJhbGci..."
            android:textColor="#FFF"
            android:textColorHint="#666"
            android:inputType="text"/>

        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
            android:text="Numero" android:textColor="#FFF" android:paddingTop="8dp"/>
        <EditText
            android:id="@+id/etNumero"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:hint="5571988..."
            android:textColor="#FFF"
            android:textColorHint="#666"
            android:inputType="phone"/>

        <LinearLayout
            android:orientation="horizontal"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:paddingTop="12dp">
            <Button android:id="@+id/btnIniciar"
                android:layout_width="0dp" android:layout_weight="1"
                android:layout_height="wrap_content" android:text="INICIAR"/>
            <Button android:id="@+id/btnParar"
                android:layout_width="0dp" android:layout_weight="1"
                android:layout_height="wrap_content" android:text="PARAR"/>
        </LinearLayout>
        <Button android:id="@+id/btnEnviarAgora"
            android:layout_width="match_parent" android:layout_height="wrap_content"
            android:text="ENVIAR AGORA"/>

        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
            android:text="ULTIMA COLETA" android:textColor="#F87171" android:paddingTop="16dp"/>
        <TextView android:id="@+id/tvColeta" android:layout_width="match_parent"
            android:layout_height="wrap_content" android:textColor="#DDD"
            android:background="#1A2230" android:padding="8dp"/>

        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
            android:text="GPS" android:textColor="#F87171" android:paddingTop="12dp"/>
        <TextView android:id="@+id/tvGps" android:layout_width="match_parent"
            android:layout_height="wrap_content" android:textColor="#DDD"
            android:background="#1A2230" android:padding="8dp"/>

        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
            android:text="ENVIOS" android:textColor="#F87171" android:paddingTop="12dp"/>
        <TextView android:id="@+id/tvEnvios" android:layout_width="match_parent"
            android:layout_height="wrap_content" android:textColor="#DDD"
            android:background="#1A2230" android:padding="8dp"/>

        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
            android:text="VIZINHAS" android:textColor="#F87171" android:paddingTop="12dp"/>
        <TextView android:id="@+id/tvViz" android:layout_width="match_parent"
            android:layout_height="wrap_content" android:textColor="#DDD"
            android:background="#1A2230" android:padding="8dp"/>

        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
            android:text="LOG" android:textColor="#F87171" android:paddingTop="12dp"/>
        <TextView android:id="@+id/tvLog" android:layout_width="match_parent"
            android:layout_height="wrap_content" android:textColor="#4ADE80"
            android:fontFamily="monospace" android:textSize="11sp"
            android:background="#0A0E14" android:padding="8dp"/>
    </LinearLayout>
</ScrollView>
'@

# ---------- Manifest ----------
Write-File (Join-Path $dst "app\src\main\AndroidManifest.xml") @'
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
    <uses-permission android:name="android.permission.READ_PHONE_STATE"/>
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION"/>
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>

    <application
        android:allowBackup="true"
        android:label="V6E"
        android:supportsRtl="true"
        android:usesCleartextTraffic="false"
        android:theme="@style/Theme.AppCompat.NoActionBar">

        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
        </activity>

        <service
            android:name=".CellCollectorService"
            android:exported="false"
            android:foregroundServiceType="location"/>
    </application>
</manifest>
'@

Write-Host "5/5 Ajustando build.gradle e defaults..." -ForegroundColor Cyan

# Patch build.gradle[.kts]
$gradleFile = $null
foreach ($n in @("build.gradle.kts", "build.gradle")) {
    $p = Join-Path $dst "app\$n"
    if (Test-Path $p) { $gradleFile = $p; break }
}
if (-not $gradleFile) { throw "Nao achei build.gradle[.kts] em $dst\app" }

$g = Get-Content $gradleFile -Raw
$g = $g -replace 'applicationId\s*=?\s*"[^"]+"', 'applicationId = "com.orion.agent.v6e"'
$g = $g -replace 'namespace\s*=?\s*"[^"]+"',     'namespace = "com.orion.agent.v6e"'
[System.IO.File]::WriteAllText($gradleFile, $g, $utf8)
Write-Host "    + applicationId/namespace = com.orion.agent.v6e" -ForegroundColor DarkGray

# Grava defaults do Supabase no SharedPreferences -> nao da, SharedPreferences
# e runtime. Entao, injetamos como resources pra MainActivity ler na 1a vez.
$stringsPath = Join-Path $dst "app\src\main\res\values\strings.xml"
$stringsXml = @"
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">V6E</string>
    <string name="default_supabase_url">$SupabaseUrl</string>
    <string name="default_supabase_anon">$SupabaseAnonKey</string>
</resources>
"@
[System.IO.File]::WriteAllText($stringsPath, $stringsXml, $utf8)
Write-Host "    + strings.xml com defaults do Supabase" -ForegroundColor DarkGray

Write-Host ""
Write-Host "OK! Projeto V6E em: $dst" -ForegroundColor Green
Write-Host ""
Write-Host "Proximo passo:" -ForegroundColor Yellow
Write-Host "  cd v6e"
Write-Host "  .\gradlew.bat installDebug"
Write-Host ""
Write-Host "Ou abre a pasta 'v6e' no Android Studio e roda."
