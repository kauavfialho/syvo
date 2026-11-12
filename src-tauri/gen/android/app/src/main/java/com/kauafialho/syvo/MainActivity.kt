package com.kauafialho.syvo

import android.graphics.Color
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // o android 15 desenha o app por baixo da barra de status e da barra de gestos.
    // aqui eu empurro a tela pra dentro e pinto essas faixas com o bege do syvo
    val raiz = findViewById<android.view.View>(android.R.id.content)
    raiz.setBackgroundColor(Color.parseColor("#F1EDE2"))
    WindowCompat.getInsetsController(window, raiz).isAppearanceLightStatusBars = true
    WindowCompat.getInsetsController(window, raiz).isAppearanceLightNavigationBars = true
    ViewCompat.setOnApplyWindowInsetsListener(raiz) { v, insets ->
      val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      v.setPadding(b.left, b.top, b.right, b.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
