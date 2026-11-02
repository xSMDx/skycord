package xyz.skycord.android.core

interface KeyValue {
    fun get(key: String): String?
    fun put(key: String, value: String?)
}

/** The saved servers and the one used last, over any key-value store. */
class ServerStore(private val kv: KeyValue) {
    private companion object {
        const val SERVERS = "servers"
        const val LAST = "last"
    }

    fun list(): List<SavedServer> = SavedServers.read(kv.get(SERVERS))

    fun find(origin: String): SavedServer? = list().firstOrNull { it.origin == origin }

    fun save(origin: String, name: String?, icon: String?): List<SavedServer> {
        val e = SavedServers.entry(origin, name, icon) ?: return list()
        return write(SavedServers.save(list(), e, keepName = true))
    }

    fun remove(origin: String): List<SavedServer> = write(SavedServers.remove(list(), origin))

    /** The server opened last — only while it is still saved. */
    fun last(): String? = kv.get(LAST)?.takeIf { o -> list().any { it.origin == o } }

    fun setLast(origin: String?) = kv.put(LAST, origin)

    private fun write(list: List<SavedServer>): List<SavedServer> {
        kv.put(SERVERS, SavedServers.write(list))
        return list
    }
}
