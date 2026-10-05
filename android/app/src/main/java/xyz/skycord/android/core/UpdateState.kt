package xyz.skycord.android.core

import org.json.JSONObject

enum class UpdatePhase(val wire: String) {
    IDLE("idle"), CHECKING("checking"), AVAILABLE("available"), DOWNLOADING("downloading"), READY("ready"), ERROR("error")
}

/** The desktop's UpdateState (desktop/src/updateState.ts), so the web's Updates page needs nothing new. */
data class UpdateState(
    val phase: UpdatePhase,
    val version: String,
    val percent: Double,
    val bytesPerSecond: Double,
    val lastCheckedAt: Long,
    val error: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("phase", phase.wire).put("version", version).put("percent", percent)
        .put("bytesPerSecond", bytesPerSecond).put("lastCheckedAt", lastCheckedAt).put("error", error)

    companion object {
        val INITIAL = UpdateState(UpdatePhase.IDLE, "", 0.0, 0.0, 0, "")
    }
}

sealed interface UpdateEvent {
    data object Check : UpdateEvent
    data class Available(val version: String) : UpdateEvent
    data class Progress(val percent: Double, val bytesPerSecond: Double) : UpdateEvent
    data class Downloaded(val version: String) : UpdateEvent
    data class None(val at: Long) : UpdateEvent
    data class Error(val message: String, val at: Long) : UpdateEvent
}

private fun clamp(n: Double) = if (n.isFinite()) n.coerceIn(0.0, 100.0) else 0.0

fun reduce(s: UpdateState, e: UpdateEvent): UpdateState = when (e) {
    UpdateEvent.Check -> s.copy(phase = UpdatePhase.CHECKING)
    is UpdateEvent.Available -> s.copy(phase = UpdatePhase.AVAILABLE, version = e.version, percent = 0.0, bytesPerSecond = 0.0, error = "")
    is UpdateEvent.Progress -> s.copy(phase = UpdatePhase.DOWNLOADING, percent = clamp(e.percent), bytesPerSecond = e.bytesPerSecond, error = "")
    is UpdateEvent.Downloaded -> s.copy(phase = UpdatePhase.READY, version = e.version, percent = 100.0, bytesPerSecond = 0.0, error = "")
    is UpdateEvent.None -> s.copy(phase = UpdatePhase.IDLE, version = "", percent = 0.0, bytesPerSecond = 0.0, lastCheckedAt = e.at, error = "")
    // A downloaded update stays installable when a later check fails.
    is UpdateEvent.Error ->
        if (s.phase == UpdatePhase.READY) s.copy(lastCheckedAt = e.at, error = e.message)
        else s.copy(phase = UpdatePhase.ERROR, lastCheckedAt = e.at, error = e.message)
}
