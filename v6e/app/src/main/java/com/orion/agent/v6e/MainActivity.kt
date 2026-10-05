package com.orion.agent.v6e

import android.Manifest
import android.content.*
import android.content.pm.PackageManager
import android.os.*
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import java.text.SimpleDateFormat
import java.util.*

class MainActivity : AppCompatActivity() {
    private lateinit var etUrl: EditText
    private lateinit var etKey: EditText
    private lateinit var etNum: EditText
    private lateinit var tvStatus: TextView
    private lateinit var tvVersao: TextView
    private lateinit var tvColeta: TextView
    private lateinit var tvGps: TextView
    private lateinit var tvEnvios: TextView
    private lateinit var tvViz: TextView
    private lateinit var tvLog: TextView
    private val prefs by lazy { getSharedPreferences(CellCollectorService.PREFS, MODE_PRIVATE) }

    private val rcv = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, i: Intent?) {
            when (i?.getStringExtra("tipo")) {
                "dados" -> {
                    tvColeta.text = "CID: ${i.getStringExtra("cid")}\nLAC: ${i.getStringExtra("lac")}\nBanda: ${i.getStringExtra("banda")}\neNB: ${i.getStringExtra("enb")}\nTA: ${i.getStringExtra("ta")}\nEARFCN: ${i.getStringExtra("earfcn")}\nRSRP: ${i.getStringExtra("rsrp")} dBm\nOperadora: ${i.getStringExtra("operadora")}"
                    tvGps.text = "Lat: ${i.getStringExtra("lat") ?: "-"}\nLng: ${i.getStringExtra("lng") ?: "-"}\nPrecisao: ${i.getStringExtra("precisao") ?: "-"} m"
                    tvEnvios.text = "Total: ${i.getStringExtra("total")}\nUltimo HTTP: ${i.getStringExtra("httpCode")} (${i.getStringExtra("timestamp")})"
                    tvViz.text = "Vizinhas: ${i.getStringExtra("vizinhasCount")}"
                    log("HTTP ${i.getStringExtra("httpCode")} - CID ${i.getStringExtra("cid")}")
                }
                "erro" -> log("ERRO: ${i.getStringExtra("mensagem")}")
                "status" -> tvStatus.text = "* ${i.getStringExtra("status")}"
            }
        }
    }

    private fun log(s: String) {
        val ts = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
        tvLog.text = "[$ts] $s\n${tvLog.text}"
    }

    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        setContentView(R.layout.activity_main)
        etUrl = findViewById(R.id.etUrl)
        etKey = findViewById(R.id.etKey)
        etNum = findViewById(R.id.etNumero)
        tvStatus = findViewById(R.id.tvStatus)
        tvVersao = findViewById(R.id.tvVersao)
        tvColeta = findViewById(R.id.tvColeta)
        tvGps = findViewById(R.id.tvGps)
        tvEnvios = findViewById(R.id.tvEnvios)
        tvViz = findViewById(R.id.tvViz)
        tvLog = findViewById(R.id.tvLog)

        val defUrl = getString(R.string.default_supabase_url)
        val defKey = getString(R.string.default_supabase_anon)
        etUrl.setText(prefs.getString(CellCollectorService.KEY_PROJECT_URL, defUrl))
        etKey.setText(prefs.getString(CellCollectorService.KEY_ANON_KEY, defKey))
        etNum.setText(prefs.getString(CellCollectorService.KEY_NUMERO, ""))
        tvEnvios.text = "Total: ${prefs.getInt(CellCollectorService.KEY_TOTAL, 0)}"
        tvVersao.text = "v${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"

        findViewById<Button>(R.id.btnIniciar).setOnClickListener { salvar(); start() }
        findViewById<Button>(R.id.btnParar).setOnClickListener { stopService(Intent(this, CellCollectorService::class.java)); tvStatus.text = "* Parado" }
        findViewById<Button>(R.id.btnEnviarAgora).setOnClickListener {
            salvar()
            stopService(Intent(this, CellCollectorService::class.java))
            start()
        }
        pedir()
    }

    private fun salvar() {
        prefs.edit()
            .putString(CellCollectorService.KEY_PROJECT_URL, etUrl.text.toString().trim())
            .putString(CellCollectorService.KEY_ANON_KEY, etKey.text.toString().trim())
            .putString(CellCollectorService.KEY_NUMERO, etNum.text.toString().trim())
            .apply()
    }

    private fun start() {
        val i = Intent(this, CellCollectorService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i) else startService(i)
    }

    private fun pedir() {
        val l = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.READ_PHONE_STATE
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) l.add(Manifest.permission.POST_NOTIFICATIONS)
        val f = l.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (f.isNotEmpty()) ActivityCompat.requestPermissions(this, f.toTypedArray(), 100)
    }

    override fun onResume() {
        super.onResume()
        LocalBroadcastManager.getInstance(this).registerReceiver(rcv, IntentFilter(CellCollectorService.BROADCAST_ACTION))
    }
    override fun onPause() {
        LocalBroadcastManager.getInstance(this).unregisterReceiver(rcv)
        super.onPause()
    }
}