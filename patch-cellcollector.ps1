# patch-cellcollector.ps1
# Substitui CellCollectorService.kt com a versao corrigida
# - banda via EARFCN
# - enb extraido do ECI
# - ta (timing advance)
# - mcc/mnc/enb/ta no payload
# - filtro de vizinhas

$ErrorActionPreference = 'Stop'

# ---------- Localizar arquivo ----------
$rel = "mobile\app\src\main\java\com\orion\agent\CellCollectorService.kt"

if (Test-Path $rel) {
    $arq = (Resolve-Path $rel).Path
} else {
    Write-Host "Nao achei $rel no diretorio atual." -ForegroundColor Red
    Write-Host "Rode este script na raiz do projeto orion (onde tem a pasta mobile)." -ForegroundColor Yellow
    exit 1
}

Write-Host "Alvo: $arq" -ForegroundColor Cyan

# ---------- Backup ----------
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bkp = "$arq.bak-$stamp"
Copy-Item $arq $bkp -Force
Write-Host "Backup: $bkp" -ForegroundColor Green

# ---------- Conteudo novo ----------
$novo = @'
package com.orion.agent

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
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class CellCollectorService : Service() {

    private var telephonyManager: TelephonyManager? = null
    private var locationManager: LocationManager? = null
    private var serverUrl = "https://orion-api-izcm.onrender.com/api/localizar-por-celula"
    private var phoneNumber = ""
    private var isRunning = false
    private var workerThread: HandlerThread? = null
    private var workerHandler: Handler? = null

    companion object {
        const val BROADCAST_ACTION = "com.orion.agent.UPDATE"
        const val BROADCAST_PERMISSION = "com.orion.agent.PERMISSION"
        const val PREFS_NAME = "orion_prefs"
        const val PREF_TOTAL = "total_envios"
    }

    override fun onCreate() {
        super.onCreate()
        try {
            telephonyManager = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            Log.i("ORION", "onCreate OK")
        } catch (e: Exception) {
            Log.e("ORION", "Erro onCreate: ${e.message}")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            intent?.getStringExtra("server_url")?.let { if (it.isNotEmpty()) serverUrl = it }
            intent?.getStringExtra("phone_number")?.let { phoneNumber = it }
            startForegroundNotification()
            startCollecting()
            enviarBroadcastStatus("Rodando")
        } catch (e: Exception) {
            Log.e("ORION", "Erro onStartCommand: ${e.message}")
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startForegroundNotification() {
        val channelId = "orion_agent"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "SOUZA", NotificationManager.IMPORTANCE_LOW)
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }

        val pendingIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("SOUZA")
            .setContentText("Coletando torres de celular...")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(1, notification)
        }
    }

    private fun startCollecting() {
        if (isRunning) return
        isRunning = true

        workerThread = HandlerThread("ORION-Worker").also { it.start() }
        workerHandler = Handler(workerThread!!.looper)

        val runnable = object : Runnable {
            override fun run() {
                if (!isRunning) return
                try {
                    collectAndSend()
                } catch (e: Exception) {
                    Log.e("ORION", "Erro no worker: ${e.message}")
                }
                workerHandler?.postDelayed(this, 30_000)
            }
        }
        workerHandler?.post(runnable)
    }

    private fun obterLocalizacao(): Location? {
        return try {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
                return null
            }
            val lm = locationManager ?: return null
            val gps = try { lm.getLastKnownLocation(LocationManager.GPS_PROVIDER) } catch (e: Exception) { null }
            val net = try { lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER) } catch (e: Exception) { null }
            when {
                gps == null -> net
                net == null -> gps
                gps.time > net.time -> gps
                else -> net
            }
        } catch (e: Exception) {
            Log.e("ORION", "Erro GPS: ${e.message}")
            null
        }
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

    /**
     * Converte EARFCN (LTE) para numero da banda 3GPP.
     * Referencia: 3GPP TS 36.101.
     * Cobre as bandas usadas no Brasil: 1, 2, 3, 5, 7, 28, 38, 40.
     */
    private fun earfcnToBand(earfcn: Int): Int {
        return when (earfcn) {
            in 0..599         -> 1      // 2100 MHz
            in 600..1199      -> 2      // 1900 MHz
            in 1200..1949     -> 3      // 1800 MHz
            in 1950..2399     -> 4      // 1700/2100 AWS
            in 2400..2649     -> 5      // 850 MHz
            in 2650..2749     -> 6      // 900 MHz
            in 2750..3449     -> 7      // 2600 MHz
            in 3450..37749    -> 8      // 900 MHz (variante)
            in 37750..38249   -> 38     // 2600 TDD
            in 39650..41589   -> 40     // 2300 TDD
            in 9210..9659     -> 28     // 700 MHz APT
            else              -> 0
        }
    }

    /**
     * Extrai eNB (eNodeB ID) do ECI.
     * No LTE, o ECI tem 28 bits: 20 bits = eNB, 8 bits = setor.
     * enb = eci >> 8
     */
    private fun extrairEnb(eci: Int): Int {
        if (eci <= 0 || eci == Int.MAX_VALUE) return 0
        return eci shr 8
    }

    private fun collectAndSend() {
        val tm = telephonyManager ?: return
        val lm = locationManager ?: return

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            return
        }

        val localizacao = obterLocalizacao()

        var principal: JSONObject? = null
        val vizinhas = JSONArray()

        try {
            val allCellInfo = tm.allCellInfo ?: return

            for (info in allCellInfo) {
                try {
                    val isRegistered = info.isRegistered

                    when (info) {
                        is CellInfoLte -> {
                            val id = info.cellIdentity
                            val sig = info.cellSignalStrength
                            val cell = JSONObject()

                            val eci = id.ci
                            val banda = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                                earfcnToBand(id.earfcn)
                            } else 0
                            val ta = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                sig.timingAdvance
                            } else 0
                            val enb = extrairEnb(eci)

                            cell.put("cellId", eci.toString())
                            cell.put("lac", id.tac.toString())
                            cell.put("mcc", id.mcc)
                            cell.put("mnc", id.mnc)
                            cell.put("pci", id.pci)
                            cell.put("rsrp", sig.rsrp)
                            cell.put("rsrq", sig.rsrq)
                            cell.put("rssnr", sig.rssnr)
                            cell.put("banda", banda)
                            cell.put("ta", ta)
                            cell.put("enb", enb)
                            cell.put("earfcn", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) id.earfcn else 0)
                            cell.put("operadora", nomeOperadora(id.mcc, id.mnc))

                            if (isRegistered) principal = cell
                            else vizinhas.put(cell)
                        }
                        is CellInfoGsm -> {
                            val id = info.cellIdentity
                            val sig = info.cellSignalStrength
                            val cell = JSONObject()
                            cell.put("cellId", id.cid.toString())
                            cell.put("lac", id.lac.toString())
                            cell.put("mcc", id.mcc)
                            cell.put("mnc", id.mnc)
                            cell.put("pci", 0)
                            cell.put("rsrp", sig.dbm)
                            cell.put("rsrq", -20)
                            cell.put("rssnr", 0)
                            cell.put("banda", 0)
                            cell.put("ta", 0)
                            cell.put("enb", 0)
                            cell.put("earfcn", 0)
                            cell.put("operadora", nomeOperadora(id.mcc, id.mnc))
                            if (isRegistered) principal = cell
                            else vizinhas.put(cell)
                        }
                        is CellInfoWcdma -> {
                            val id = info.cellIdentity
                            val sig = info.cellSignalStrength
                            val cell = JSONObject()
                            cell.put("cellId", id.cid.toString())
                            cell.put("lac", id.lac.toString())
                            cell.put("mcc", id.mcc)
                            cell.put("mnc", id.mnc)
                            cell.put("pci", id.psc)
                            cell.put("rsrp", sig.dbm)
                            cell.put("rsrq", -20)
                            cell.put("rssnr", 0)
                            cell.put("banda", 0)
                            cell.put("ta", 0)
                            cell.put("enb", 0)
                            cell.put("earfcn", 0)
                            cell.put("operadora", nomeOperadora(id.mcc, id.mnc))
                            if (isRegistered) principal = cell
                            else vizinhas.put(cell)
                        }
                    }
                } catch (e: Exception) {
                    Log.e("ORION", "Erro celula: ${e.message}")
                }
            }
        } catch (e: Exception) {
            Log.e("ORION", "Erro allCellInfo: ${e.message}")
            return
        }

        val celPrincipal = principal ?: return

        try {
            val payload = JSONObject()
            payload.put("cellId", celPrincipal.optString("cellId", ""))
            payload.put("lac", celPrincipal.optString("lac", ""))
            payload.put("mcc", celPrincipal.optInt("mcc", 0))
            payload.put("mnc", celPrincipal.optInt("mnc", 0))
            payload.put("rsrp", celPrincipal.optInt("rsrp", 0))
            payload.put("rsrq", celPrincipal.optInt("rsrq", 0))
            payload.put("rssnr", celPrincipal.optInt("rssnr", 0))
            payload.put("pci", celPrincipal.optInt("pci", 0))
            payload.put("banda", celPrincipal.optInt("banda", 0))
            payload.put("ta", celPrincipal.optInt("ta", 0))
            payload.put("enb", celPrincipal.optInt("enb", 0))
            payload.put("earfcn", celPrincipal.optInt("earfcn", 0))
            payload.put("operadora", celPrincipal.optString("operadora", ""))

            if (phoneNumber.isNotEmpty()) {
                payload.put("numero", phoneNumber)
            }

            if (localizacao != null) {
                payload.put("lat", localizacao.latitude)
                payload.put("lng", localizacao.longitude)
                payload.put("precisao", localizacao.accuracy.toDouble())
            }

            val vizinhasFiltradas = JSONArray()
            for (i in 0 until vizinhas.length()) {
                try {
                    val v = vizinhas.getJSONObject(i)
                    val eci = v.optString("cellId", "")
                    if (eci.isEmpty() || eci == "2147483647" || eci == "0") continue
                    vizinhasFiltradas.put(v)
                } catch (e: Exception) {
                }
            }
            payload.put("vizinhas", vizinhasFiltradas)

            val url = URL(serverUrl)
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.doOutput = true
            conn.connectTimeout = 15000
            conn.readTimeout = 15000

            val output: OutputStream = conn.outputStream
            output.write(payload.toString().toByteArray(Charsets.UTF_8))
            output.close()

            val code = conn.responseCode
            Log.i(
                "ORION",
                "Enviado CID=${celPrincipal.optString("cellId")} " +
                "banda=${celPrincipal.optInt("banda")} " +
                "enb=${celPrincipal.optInt("enb")} " +
                "ta=${celPrincipal.optInt("ta")} " +
                "vizinhas=${vizinhasFiltradas.length()} - HTTP $code"
            )
            conn.disconnect()

            // Persistir contador
            val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            val totalAtual = prefs.getInt(PREF_TOTAL, 0)
            val novoTotal = totalAtual + 1
            prefs.edit().putInt(PREF_TOTAL, novoTotal).apply()

            // Enviar broadcast
            enviarBroadcastDados(celPrincipal, localizacao, vizinhasFiltradas, code, novoTotal)

        } catch (e: Exception) {
            Log.e("ORION", "Erro enviar: ${e.message}")
            enviarBroadcastErro(e.message ?: "erro desconhecido")
        }
    }

    private fun enviarBroadcastDados(
        cel: JSONObject,
        loc: Location?,
        vizinhas: JSONArray,
        httpCode: Int,
        total: Int
    ) {
        try {
            val intent = Intent(BROADCAST_ACTION)
            intent.putExtra("tipo", "dados")
            intent.putExtra("cid", cel.optString("cellId", "-"))
            intent.putExtra("lac", cel.optString("lac", "-"))
            intent.putExtra("banda", cel.optInt("banda", 0).toString())
            intent.putExtra("rsrp", cel.optInt("rsrp", 0).toString())
            intent.putExtra("operadora", cel.optString("operadora", "-"))
            if (loc != null) {
                intent.putExtra("lat", String.format(Locale.US, "%.6f", loc.latitude))
                intent.putExtra("lng", String.format(Locale.US, "%.6f", loc.longitude))
                intent.putExtra("precisao", String.format(Locale.US, "%.1f", loc.accuracy))
            }
            intent.putExtra("httpCode", httpCode.toString())
            intent.putExtra("total", total.toString())
            intent.putExtra("vizinhasCount", vizinhas.length().toString())
            intent.putExtra("timestamp", SimpleDateFormat("HH:mm:ss", Locale.US).format(Date()))

            LocalBroadcastManager.getInstance(this).sendBroadcast(intent)
        } catch (e: Exception) {
            Log.e("ORION", "Erro broadcast dados: ${e.message}")
        }
    }

    private fun enviarBroadcastErro(mensagem: String) {
        try {
            val intent = Intent(BROADCAST_ACTION)
            intent.putExtra("tipo", "erro")
            intent.putExtra("mensagem", mensagem)
            LocalBroadcastManager.getInstance(this).sendBroadcast(intent)
        } catch (e: Exception) {
            Log.e("ORION", "Erro broadcast erro: ${e.message}")
        }
    }

    private fun enviarBroadcastStatus(status: String) {
        try {
            val intent = Intent(BROADCAST_ACTION)
            intent.putExtra("tipo", "status")
            intent.putExtra("status", status)
            LocalBroadcastManager.getInstance(this).sendBroadcast(intent)
        } catch (e: Exception) {
            Log.e("ORION", "Erro broadcast status: ${e.message}")
        }
    }

    override fun onDestroy() {
        isRunning = false
        try {
            workerThread?.quitSafely()
        } catch (e: Exception) {
        }
        enviarBroadcastStatus("Parado")
        super.onDestroy()
    }
}
'@

# ---------- Escrever UTF-8 sem BOM (compativel com Kotlin/Android Studio) ----------
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($arq, $novo, $utf8NoBom)

Write-Host "Arquivo sobrescrito: $arq" -ForegroundColor Green

# ---------- Verificacao ----------
Write-Host "`n=== Verificacao ===" -ForegroundColor Cyan
Write-Host ("earfcnToBand definida ..... : " + (Select-String -Path $arq -Pattern 'private fun earfcnToBand').Count)
Write-Host ("extrairEnb definida ....... : " + (Select-String -Path $arq -Pattern 'private fun extrairEnb').Count)
Write-Host ("put(\"banda\", 0) hardcoded  : " + (Select-String -Path $arq -Pattern 'put\("banda", 0\)' -SimpleMatch).Count + "  (esperado: 2 apenas no GSM/WCDMA)")
Write-Host ("payload.put(\"ta\" ...) ....... : " + (Select-String -Path $arq -Pattern 'payload.put\("ta"').Count)
Write-Host ("payload.put(\"enb\" ...) ...... : " + (Select-String -Path $arq -Pattern 'payload.put\("enb"').Count)
Write-Host ("payload.put(\"earfcn\" ...) ... : " + (Select-String -Path $arq -Pattern 'payload.put\("earfcn"').Count)

Write-Host "`nSe os contadores acima batem, o patch foi aplicado." -ForegroundColor Yellow
Write-Host "Proximo passo: build no Android Studio e instalar no celular." -ForegroundColor Yellow
Write-Host "Se algo der errado, restore com:" -ForegroundColor Yellow
Write-Host "  Copy-Item '$bkp' '$arq' -Force" -ForegroundColor DarkGray
