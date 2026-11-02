package xyz.skycord.android.core

/**
 * A CSS colour as getComputedStyle reports it (#rgb, #rrggbb, rgb(), rgba()),
 * as ARGB — without android.graphics.Color, which is a stub in JVM tests.
 */
object CssColor {
    private val RGB = Regex("^rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*(?:,\\s*[\\d.]+\\s*)?\\)$")
    private val HEX = Regex("^#([0-9a-f]{3}|[0-9a-f]{6})$")

    fun parse(css: String): Int? {
        val t = css.trim().lowercase()
        if (t.startsWith("#")) {
            if (!HEX.matches(t)) return null
            val hex = t.drop(1)
            val full = if (hex.length == 3) hex.map { "$it$it" }.joinToString("") else hex
            return (0xFF000000 or full.toLong(16)).toInt()
        }
        val m = RGB.matchEntire(t) ?: return null
        // A channel too long for an Int is still "too bright": CSS clamps it, and so does this.
        val (r, g, b) = m.destructured.toList().map { (it.toIntOrNull() ?: 255).coerceIn(0, 255) }
        return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }

    /** Light enough that the status bar needs dark icons. */
    fun isLight(argb: Int): Boolean {
        fun ch(shift: Int): Double {
            val c = ((argb shr shift) and 0xFF) / 255.0
            return if (c <= 0.03928) c / 12.92 else Math.pow((c + 0.055) / 1.055, 2.4)
        }
        // 0.179: where dark text and light text have equal contrast on it.
        return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0) > 0.179
    }
}
