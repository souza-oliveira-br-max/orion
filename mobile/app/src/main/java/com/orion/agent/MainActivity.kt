package com.orion.agent

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
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var etServerUrl: EditText
    private lateinit var etPhoneNumber: EditText
    private lateinit var btnStart: Button
    private lateinit var btnStop: Button
    private lateinit var btnSendNow: Button

    private lateinit var tvStatusCabecalho: TextView
    private lateinit var tvCid: TextView
    private lateinit var tvLac: TextView
    private lateinit var tvBanda: TextView
    private lateinit var tvRsrp: TextView
    private lateinit var tvOperadora: TextView
    private lateinit var tvLat: TextView
    private lateinit var tvLng: TextView
    private lateinit var tvPrecisao: TextView
    private lateinit var tvTotalEnvios: TextView
    private lateinit var tvUltimoStatus: TextView
    private lateinit var tvTempoDesdeEnvio: TextView
    private lateinit var tvVizinhas: TextView
    private lateinit var tvLog: TextView

    private var ultimaAtualizacao: Long = 0
    private val logLinhas = mutableListOf<String>()

    companion object {
        const val REQUEST_PERMISSIONS = 100
        const val MAX_LOG_LINHAS = 10
    }

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            try {
                val tipo = intent?.getStringExtra("tipo") ?: return

                when (tipo) {
                    "dados" -> {
                        tvCid.text = "CID: ${intent.getStringExtra("cid") ?: "—"}"
                        tvLac.text = "LAC: ${intent.getStringExtra("lac") ?: "—"}"
                        tvBanda.text = "Banda: ${intent.getStringExtra("banda") ?: "—"}"
                        tvRsrp.text = "RSRP: ${intent.getStringExtra("rsrp") ?: "—"} dBm"
                        tvOperadora.text = "Operadora: ${intent.getStringExtra("operadora") ?: "—"}"

                        val lat = intent.getStringExtra("lat")
                        val lng = intent.getStringExtra("lng")
                        val prec = intent.getStringExtra("precisao")
                        tvLat.text = "Lat: ${lat ?: "—"}"
                        tvLng.text = "Lng: ${lng ?: "—"}"
                        tvPrecisao.text = "Precisao: ${if (prec != null) "$prec m" else "—"}"

                        val httpCode = intent.getStringExtra("httpCode") ?: "?"
                        val ts = intent.getStringExtra("timestamp") ?: "—"
                        tvUltimoStatus.text = "Ultimo: HTTP $httpCode ($ts)"

                        val total = intent.getStringExtra("total") ?: "0"
                        tvTotalEnvios.text = "Total: $total"

                        val vizCount = intent.getStringExtra("vizinhasCount") ?: "0"
                        tvVizinhas.text = if (vizCount == "0") "Nenhuma" else "$vizCount detectadas"

                        ultimaAtualizacao = System.currentTimeMillis()
                        adicionarLog("[${ts}] CID=${intent.getStringExtra("cid")} HTTP=$httpCode")

                        tvStatusCabecalho.text = "● Rodando"
                        tvStatusCabecalho.setTextColor(0xFF4CAF50.toInt())
                    }
                    "erro" -> {
                        val msg = intent.getStringExtra("mensagem") ?: "erro"
                        adicionarLog("[ERRO] $msg")
                    }
                    "status" -> {
                        val status = intent.getStringExtra("status") ?: "?"
                        if (status == "Rodando") {
                            tvStatusCabecalho.text = "● Rodando"
                            tvStatusCabecalho.setTextColor(0xFF4CAF50.toInt())
                        } else {
                            tvStatusCabecalho.text = "● Parado"
                            tvStatusCabecalho.setTextColor(0xFFff6b6b.toInt())
                        }
                    }
                }
            } catch (e: Exception) {
                adicionarLog("[EXCECAO] ${e.message}")
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        etServerUrl = findViewById(R.id.etServerUrl)
        etPhoneNumber = findViewById(R.id.etPhoneNumber)
        btnStart = findViewById(R.id.btnStart)
        btnStop = findViewById(R.id.btnStop)
        btnSendNow = findViewById(R.id.btnSendNow)

        tvStatusCabecalho = findViewById(R.id.tvStatusCabecalho)
        tvCid = findViewById(R.id.tvCid)
        tvLac = findViewById(R.id.tvLac)
        tvBanda = findViewById(R.id.tvBanda)
        tvRsrp = findViewById(R.id.tvRsrp)
        tvOperadora = findViewById(R.id.tvOperadora)
        tvLat = findViewById(R.id.tvLat)
        tvLng = findViewById(R.id.tvLng)
        tvPrecisao = findViewById(R.id.tvPrecisao)
        tvTotalEnvios = findViewById(R.id.tvTotalEnvios)
        tvUltimoStatus = findViewById(R.id.tvUltimoStatus)
        tvTempoDesdeEnvio = findViewById(R.id.tvTempoDesdeEnvio)
        tvVizinhas = findViewById(R.id.tvVizinhas)
        tvLog = findViewById(R.id.tvLog)

        etServerUrl.setText("https://orion-api-1ayv.onrender.com/api/localizar-por-celula")

        btnStart.setOnClickListener { startCollection() }
        btnStop.setOnClickListener { stopCollection() }
        btnSendNow.setOnClickListener {
            Toast.makeText(this, "Aguardando proxima coleta (30s)", Toast.LENGTH_SHORT).show()
        }

        atualizarStatus(false)
        carregarContador()

        requestPermissions()
    }

    override fun onResume() {
        super.onResume()
        val filtro = IntentFilter(CellCollectorService.BROADCAST_ACTION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            LocalBroadcastManager.getInstance(this).registerReceiver(receiver, filtro)
        } else {
            LocalBroadcastManager.getInstance(this).registerReceiver(receiver, filtro)
        }
    }

    override fun onPause() {
        super.onPause()
        try {
            LocalBroadcastManager.getInstance(this).unregisterReceiver(receiver)
        } catch (e: Exception) {
        }
    }

    private fun carregarContador() {
        val prefs = getSharedPreferences(CellCollectorService.PREFS_NAME, MODE_PRIVATE)
        val total = prefs.getInt(CellCollectorService.PREF_TOTAL, 0)
        tvTotalEnvios.text = "Total: $total"
    }

    private fun adicionarLog(linha: String) {
        logLinhas.add(0, linha)
        if (logLinhas.size > MAX_LOG_LINHAS) logLinhas.removeAt(logLinhas.size - 1)
        tvLog.text = logLinhas.joinToString("\n")
    }

    private fun atualizarStatus(rodando: Boolean) {
        if (rodando) {
            tvStatusCabecalho.text = "● Rodando"
            tvStatusCabecalho.setTextColor(0xFF4CAF50.toInt())
        } else {
            tvStatusCabecalho.text = "● Parado"
            tvStatusCabecalho.setTextColor(0xFFff6b6b.toInt())
        }
    }

    private fun requestPermissions() {
        val permissoes = mutableListOf<String>()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            permissoes.add(Manifest.permission.ACCESS_FINE_LOCATION)
            permissoes.add(Manifest.permission.ACCESS_COARSE_LOCATION)
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE)
            != PackageManager.PERMISSION_GRANTED) {
            permissoes.add(Manifest.permission.READ_PHONE_STATE)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                permissoes.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        if (permissoes.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                permissoes.toTypedArray(),
                REQUEST_PERMISSIONS
            )
        }
    }

    private fun startCollection() {
        val serverUrl = etServerUrl.text.toString().trim()
        val phoneNumber = etPhoneNumber.text.toString().trim()

        if (serverUrl.isEmpty()) {
            Toast.makeText(this, "URL do servidor e obrigatoria", Toast.LENGTH_SHORT).show()
            return
        }

        val intent = Intent(this, CellCollectorService::class.java)
        intent.putExtra("server_url", serverUrl)
        intent.putExtra("phone_number", phoneNumber)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(this, intent)
        } else {
            startService(intent)
        }

        atualizarStatus(true)
        adicionarLog("[${java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date())}] Servico iniciado")
        Toast.makeText(this, "SOUZA ativo", Toast.LENGTH_SHORT).show()
    }

    private fun stopCollection() {
        val intent = Intent(this, CellCollectorService::class.java)
        stopService(intent)
        atualizarStatus(false)
        adicionarLog("[${java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date())}] Servico parado")
        Toast.makeText(this, "SOUZA parado", Toast.LENGTH_SHORT).show()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_PERMISSIONS) {
            val todasConcedidas = grantResults.isNotEmpty() &&
                grantResults.all { it == PackageManager.PERMISSION_GRANTED }
            if (todasConcedidas) {
                Toast.makeText(this, "Permissoes concedidas", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this, "Permissoes negadas - o app nao vai funcionar", Toast.LENGTH_LONG).show()
            }
        }
    }
}