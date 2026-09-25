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
import android.os.Looper
import android.telephony.CellInfoLte
import android.telephony.CellInfoGsm
import android.telephony.CellInfoWcdma
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL

class CellCollectorService : Service() {

    private var telephonyManager: TelephonyManager? = null
    private var locationManager: LocationManager? = null
    private var serverUrl = "https://orion-api-1ayv.onrender.com/api/localizar-por-celula"
    private var phoneNumber = ""
    private var isRunning = false
    private var workerThread: HandlerThread? = null
    private var workerHandler: Handler? = null

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
            val channel = NotificationChannel(channelId, "ORION Agent", NotificationManager.IMPORTANCE_LOW)
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }

        val pendingIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("ORION Agent")
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
                            cell.put("cellId", id.ci.toString())
                            cell.put("lac", id.tac.toString())
                            cell.put("mcc", id.mcc)
                            cell.put("mnc", id.mnc)
                            cell.put("pci", id.pci)
                            cell.put("rsrp", sig.rsrp)
                            cell.put("rsrq", sig.rsrq)
                            cell.put("rssnr", sig.rssnr)
                            cell.put("banda", 0)
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
            payload.put("rsrp", celPrincipal.optInt("rsrp", 0))
            payload.put("rsrq", celPrincipal.optInt("rsrq", 0))
            payload.put("rssnr", celPrincipal.optInt("rssnr", 0))
            payload.put("pci", celPrincipal.optInt("pci", 0))
            payload.put("banda", celPrincipal.optInt("banda", 0))
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
                    if (eci.isEmpty() || eci == "2147483647") continue
                    vizinhasFiltradas.put(v)
                } catch (e: Exception) {
                    // ignora vizinha com erro
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
            Log.i("ORION", "Enviado CID=${celPrincipal.optString("cellId")} vizinhas=${vizinhasFiltradas.length()} - HTTP $code")
            conn.disconnect()
        } catch (e: Exception) {
            Log.e("ORION", "Erro enviar: ${e.message}")
        }
    }

    override fun onDestroy() {
        isRunning = false
        try {
            workerThread?.quitSafely()
        } catch (e: Exception) {
            // ignore
        }
        super.onDestroy()
    }
}