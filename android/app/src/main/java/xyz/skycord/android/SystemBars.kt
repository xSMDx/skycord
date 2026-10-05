package xyz.skycord.android

import android.view.View
import android.view.Window
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import xyz.skycord.android.core.CssColor

/**
 * Android 15 draws every app edge to edge, and ignores a status bar colour.
 * So the content is padded clear of the bars (and of the keyboard), and the
 * root view behind them is painted the theme's colour; the icons go light or
 * dark by that colour's luminance.
 */
object SystemBars {
    fun install(window: Window, root: View) {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
    }

    fun paint(window: Window, root: View, argb: Int) {
        root.setBackgroundColor(argb)
        val light = CssColor.isLight(argb)
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
    }
}
