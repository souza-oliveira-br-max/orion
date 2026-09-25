 package com.orion.agent

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.telephony.CellInfo
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
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

    private lateinit var telephonyManager: TelephonyManager
    private lateinit var locationManager: LocationManager
    // 2026-09-24 v8.6.0 — URL e endpoint corretos
    private var serverUrl = "https://orion-api-1ayv.onrender.com/api/localizar-por-celula"
    private var phoneNumber = ""
    private val handler = Handler(Looper.getMainLooper())
    private var isRunning = false

    override fun onCreate() {
        super.onCreate()
        telephonyManager = getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        intent?.getStringExtra("server_url")?.let { serverUrl = it }
        intent?.getStringExtra("phone_number")?.let { phoneNumber = it }
        startForegroundNotification()
        startCollecting()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startForegroundNotification() {
        val channelId = "orion_agent"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "ORION Agent", NotificationManager.IMPORTANCE_LOW)
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }

        val pendingIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("ORION Agent")
            .setContentText("Coletando torres de celular...")
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        startForeground(1, notification)
    }

    private fun startCollecting() {
        isRunning = true
        val runnable = object : Runnable {
            override fun run() {
                if (isRunning) {
                    collectAndSend()
                    // 2026-09-24 — 30s (equilíbrio entre consumo e coleta)
                    handler.postDelayed(this, 30_000)
                }
            }
        }
        handler.post(runnable)
    }

    // 2026-09-24 — Obter localização GPS do usuário
    private fun obterLocalizacao(): Location? {
        return try {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
                return null
            }
            val gps = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
            val net = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            // Prefere o mais recente
            when {
                gps == null -> net
                net == null -> gps
                gps.time > net.time -> gps
                else -> net
            }
        } catch (e: SecurityException) {
            Log.e("ORION", "Sem permissao de localizacao: ${e.message}")
            null
        } catch (e: Exception) {
            Log.e("ORION", "Erro ao obter localizacao: ${e.message}")
            null
        }
    }

    // 2026-09-24 — Detectar operadora pelo MCC+MNC
    private fun nomeOperadora(mcc: Int, mnc: Int): String {
        if (mcc != 724) return "MCC_$mcc"
        return when (mnc) {
            2 -> "TIM"
            3 -> "CLARO"
            4 -> "OI"
            5 -> "CLARO"
            6 -> "VIVO"
            10 -> "VIVO"
            15 -> "SERCOMTEL"
            25 -> "NEXTEL"
            31 -> "OI"
            else -> "MNC_$mnc"
        }
    }

    private fun collectAndSend() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            Log.w("ORION", "Sem permissao de localizacao")
            return
        }

        val localizacao = obterLocalizacao()

        // 2026-09-24 — Separar célula registrada das vizinhas
        var principal: JSONObject? = null
        val vizinhas = JSONArray()

        try {
            val allCellInfo = telephonyManager.allCellInfo ?: return

            for (info in allCellInfo) {
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
                        // Banda não disponível em API antiga; deixamos 0
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
            }
        } catch (e: Exception) {
            Log.e("ORION", "Erro ao coletar celulas: ${e.message}")
            return
        }

        if (principal == null) {
            Log.w("ORION", "Nenhuma celula registrada encontrada")
            return
        }

        // 2026-09-24 — Montar payload para o backend
        val payload = JSONObject()
        payload.put("cellId", principal.getString("cellId"))
        payload.put("lac", principal.getString("lac"))
        payload.put("rsrp", principal.optInt("rsrp", 0))
        payload.put("rsrq", principal.optInt("rsrq", 0))
        payload.put("rssnr", principal.optInt("rssnr", 0))
        payload.put("pci", principal.optInt("pci", 0))
        payload.put("banda", principal.optInt("banda", 0))
        payload.put("operadora", principal.optString("operadora", ""))

        if (!phoneNumber.isNullOrEmpty()) {
            payload.put("numero", phoneNumber)
        }

        if (localizacao != null) {
            payload.put("lat", localizacao.latitude)
            payload.put("lng", localizacao.longitude)
            payload.put("precisao", localizacao.accuracy.toDouble())
        }

        // Adiciona vizinhas (com filtro de ECI placeholder)
        val vizinhasFiltradas = JSONArray()
        for (i in 0 until vizinhas.length()) {
            val v = vizinhas.getJSONObject(i)
            val eci = v.optString("cellId", "")
            // Filtra ECI placeholder (2147483647) e vazios
            if (eci.isEmpty() || eci == "2147483647") continue
            vizinhasFiltradas.put(v)
        }
        payload.put("vizinhas", vizinhasFiltradas)

        try {
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
            Log.i("ORION", "Enviado CID=${principal.getString("cellId")} vizinhas=${vizinhasFiltradas.length()} - HTTP $code")
            conn.disconnect()
        } catch (e: Exception) {
            Log.e("ORION", "Erro ao enviar dados: ${e.message}")
        }
    }

    override fun onDestroy() {
        isRunning = false
        super.onDestroy()
    }
}
