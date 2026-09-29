package com.orion.agent

import android.Manifest
import android.content.Intent
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

    companion object {
        const val REQUEST_PERMISSIONS = 100
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
            Toast.makeText(this, "Ainda nao implementado", Toast.LENGTH_SHORT).show()
        }

        atualizarStatus(false)

        requestPermissions()
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
        Toast.makeText(this, "ORION Agent ativo", Toast.LENGTH_SHORT).show()
    }

    private fun stopCollection() {
        val intent = Intent(this, CellCollectorService::class.java)
        stopService(intent)
        atualizarStatus(false)
        Toast.makeText(this, "ORION Agent parado", Toast.LENGTH_SHORT).show()
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