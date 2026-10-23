package xyz.skycord.android.notify

import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import xyz.skycord.android.core.ConvPrefs
import xyz.skycord.android.core.Me
import xyz.skycord.android.core.MessageEvents
import xyz.skycord.android.core.RuleState
import java.util.concurrent.ConcurrentHashMap

/**
 * What the background service knows about the person and their places, from
 * the server's REST routes: who they are and whether they are Do Not Disturb
 * (GET /auth/me), their mutes and levels (GET /users/me/conversations), and the
 * names a message event leaves out — servers (GET /servers), a server's
 * channels (GET /servers/:sid, only once a channel message needs naming) and
 * groups (GET /conversations/groups).
 *
 * [load] runs on every connect; the prefs again on `prefsChanged` and every
 * 15 minutes; DND follows `presence:self`. Lookups that miss fetch once and
 * then wait a minute before asking again, so a server that refuses (a channel
 * in a server the person has left) is not asked on every message.
 *
 * Names of people are kept as they are met (DM authors, group members): the
 * ring (Task 12) names its caller from them.
 *
 * Written on the service's thread only; the maps can be read from any.
 */
internal class Directory(private val api: ServerApi) : MessageEvents.Names {
    /** How a fetch came out. */
    enum class Outcome { READY, SIGNED_OUT, FAILED }

    private class Group(val name: String, val memberIds: Set<String>)

    @Volatile var me: Me? = null
        private set

    @Volatile private var status: String? = null
    @Volatile private var statusUntil: Long? = null
    @Volatile private var prefs: ConvPrefs = ConvPrefs.EMPTY

    private val servers = ConcurrentHashMap<String, String>()
    private val channels = ConcurrentHashMap<String, Map<String, String>>() // serverId -> (channelId -> name)
    private val groups = ConcurrentHashMap<String, Group>()
    private val people = ConcurrentHashMap<String, String>()

    // When a lookup last went to the server, by what it looked for (monotonic ms).
    private val askedAt = HashMap<String, Long>()

    /**
     * Everything a connect needs. Who the person is and their mutes are required:
     * without them nothing can be decided (a muted conversation would buzz), so either
     * failing fails the load. The names are best effort; a miss is looked up later.
     */
    fun load(): Outcome {
        val self = when (val r = api.get("/auth/me")) {
            is ApiResult.Ok -> r.body.optJSONObject("user") ?: return Outcome.FAILED
            ApiResult.SignedOut -> return Outcome.SIGNED_OUT
            else -> return Outcome.FAILED
        }
        val id = self.str("id") ?: return Outcome.FAILED
        me = Me(id, self.str("displayName") ?: "", self.str("username") ?: "")
        status = self.str("status")
        statusUntil = null // /auth/me does not carry the end; a presence:self that does replaces this

        val prefsOutcome = refreshPrefs()
        if (prefsOutcome != Outcome.READY) return prefsOutcome

        // A reconnect is the moment to forget names that may have changed.
        channels.clear()
        askedAt.clear()
        fetchServers()
        fetchGroups()
        return Outcome.READY
    }

    /** The mutes and levels again. A failure keeps the ones already held. */
    fun refreshPrefs(): Outcome = when (val r = api.get("/users/me/conversations")) {
        is ApiResult.Ok -> ConvPrefs.parse(r.body)?.let { prefs = it; Outcome.READY } ?: Outcome.FAILED
        ApiResult.SignedOut -> Outcome.SIGNED_OUT
        else -> Outcome.FAILED
    }

    /** The rules' inputs as they stand now, or null before [load] has said who the person is. */
    fun ruleState(nowMs: Long = System.currentTimeMillis()): RuleState? {
        val who = me ?: return null
        val p = prefs
        return RuleState(
            me = who,
            dnd = ConvPrefs.dnd(status, statusUntil, nowMs),
            isMuted = { id -> p.isMuted(id, nowMs) },
            levelOf = p::levelOf,
        )
    }

    /** `presence:self`: the person changed their status somewhere. `until` absent keeps the end known; null clears it. */
    fun onPresenceSelf(p: JSONObject) {
        p.str("status")?.let { status = it }
        if (p.has("until")) statusUntil = MessageEvents.epochMs(p.opt("until") as? String)
    }

    /**
     * `group:created` / `group:updated`: a group's name and members changed, or the person
     * was added to one. Returns the group's id when the person is in it, so the service can
     * subscribe its socket to the group's messages (the server joins a socket to its groups
     * only at connect).
     */
    fun onGroup(g: JSONObject): String? {
        val id = putGroup(g) ?: return null
        val mine = me?.id ?: return null
        return id.takeIf { groups[it]?.memberIds?.contains(mine) == true }
    }

    /** A person's name, as met in a DM or a group. */
    fun learnName(userId: String, name: String) {
        if (userId.isNotEmpty() && name.isNotEmpty()) people[userId] = name
    }

    /** For the ring (Task 12): a DM partner's or group member's name, when one has been met. */
    fun personName(userId: String): String? = people[userId]

    /**
     * The name a ring gives its caller: one already met, else asked of the server once (the person's
     * profile) and kept. A friend who has not written since the phone connected is not in [people], and
     * a ring that said "Someone" for them would be a poor one. Null when the server will not say
     * (asked again after a minute at the earliest). Blocking, on the service's thread.
     */
    fun callerName(userId: String): String? {
        people[userId]?.let { return it }
        if (!mayAsk("person:$userId")) return null
        val user = (api.get("/users/${ServerApi.segment(userId)}/profile") as? ApiResult.Ok)?.body?.optJSONObject("user") ?: return null
        val name = user.str("displayName") ?: user.str("username") ?: return null
        learnName(userId, name)
        return name
    }

    /** For the ring (Task 12): whether the person is in [groupId], as far as the last fetch knows. */
    fun isGroupMember(groupId: String): Boolean = me?.id?.let { groups[groupId]?.memberIds?.contains(it) } == true

    // ---- MessageEvents.Names: looked up only for a message that is going to be shown ----------

    override fun groupName(groupId: String): String? {
        groups[groupId]?.let { return it.name }
        if (mayAsk("groups")) fetchGroups()
        return groups[groupId]?.name
    }

    override fun channelName(serverId: String, channelId: String): String? {
        channels[serverId]?.get(channelId)?.let { return it }
        if (mayAsk("server:$serverId")) fetchServer(serverId)
        return channels[serverId]?.get(channelId)
    }

    override fun serverName(serverId: String): String? {
        servers[serverId]?.let { return it }
        if (mayAsk("server:$serverId")) fetchServer(serverId)
        return servers[serverId]
    }

    // ---- fetching -------------------------------------------------------------------------------

    private fun mayAsk(what: String): Boolean {
        val now = SystemClock.elapsedRealtime()
        val last = askedAt[what]
        if (last != null && now - last < RETRY_AFTER_MS) return false
        askedAt[what] = now
        return true
    }

    private fun fetchServers() {
        val list = (api.get("/servers") as? ApiResult.Ok)?.body?.optJSONArray("servers") ?: return
        for (o in list.objects()) {
            val id = o.str("id") ?: continue
            o.str("name")?.let { servers[id] = it }
        }
    }

    private fun fetchServer(serverId: String) {
        val body = (api.get("/servers/${ServerApi.segment(serverId)}") as? ApiResult.Ok)?.body ?: return
        body.optJSONObject("server")?.str("name")?.let { servers[serverId] = it }
        val names = HashMap<String, String>()
        body.optJSONArray("channels")?.objects()?.forEach { c ->
            val id = c.str("id") ?: return@forEach
            c.str("name")?.let { names[id] = it }
        }
        channels[serverId] = names
    }

    private fun fetchGroups() {
        val list = (api.get("/conversations/groups") as? ApiResult.Ok)?.body?.optJSONArray("groups") ?: return
        for (o in list.objects()) putGroup(o)
    }

    /** Keeps one group (the shapeGroup shape); its id, or null when it has none. */
    private fun putGroup(g: JSONObject): String? {
        val id = g.str("id") ?: return null
        val members = g.optJSONArray("members")?.objects().orEmpty()
        val memberNames = ArrayList<String>()
        val ids = HashSet<String>()
        for (m in members) {
            val name = m.str("displayName") ?: m.str("username") ?: ""
            m.str("id")?.let { ids.add(it); learnName(it, name) }
            memberNames.add(name)
        }
        // The web client's groupDisplayName: the group's own name, else its first three members' names.
        val name = g.str("name") ?: memberNames.take(3).joinToString(", ")
        groups[id] = Group(name, ids)
        return id
    }

    private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { opt(it) as? JSONObject }

    /** A real, non-empty JSON string (Android's optString turns null into "null"). */
    private fun JSONObject.str(key: String): String? = (opt(key) as? String)?.takeIf { it.isNotEmpty() }

    private companion object {
        const val RETRY_AFTER_MS = 60_000L
    }
}
