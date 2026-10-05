package com.orion.agent.v6e

import android.os.Build
import android.telephony.CellIdentityLte

object BandHelper {
    fun fromLte(id: CellIdentityLte): Int {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                val b = id.bands
                if (b != null && b.isNotEmpty() && b[0] > 0) return b[0]
            } catch (_: Exception) { }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                val x = earfcnToBand(id.earfcn)
                if (x > 0) return x
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