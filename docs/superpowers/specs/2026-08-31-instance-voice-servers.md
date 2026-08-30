# Instance-level voice servers

**Date:** 2026-08-31
**Status:** Designed, approved in outline, not built
**Extends:** the per-guild voice servers shipped in v0.14.0

---

## The gap

A guild owner can register their own LiveKit servers. An **instance admin** —
the person running a self-hosted build — cannot offer theirs to everyone on
that build.

Today `instanceVoice()` returns exactly one server, from `LIVEKIT_URL` /
`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`:

```ts
export const instanceVoice = (): ResolvedVoice | null => {
  const { url, apiKey, apiSecret } = config.livekit
  if (!url || !apiKey || !apiSecret) return null
  return { id: null, name: 'Default', url, apiKey, apiSecret }
}
```

So an admin with five boxes can expose one. To use the other four, every guild
owner has to re-register them by hand, pasting the same credentials repeatedly —
and a key rotation means every one of them has to do it again. Worse, it hands
the instance's own secrets to every guild owner who wants to use them.

The user's framing, which is the right one: *"if someone adds a server for
themselves it's ok — but if an admin adds a server to files we have to add it to
every server."*

---

## Two tiers, one resolver

| Tier | Declared in | Usable by | Editable in-app |
|---|---|---|---|
| **Instance** | `voice-servers.json` on the host | every guild and every user on the build | No — read-only, file-managed |
| **Guild** | the Voice Servers modal | that guild only | Yes, by its owner |

Resolution order is unchanged in spirit, only longer:

**channel override → guild default → instance default → nothing (503)**

Every step still degrades rather than fails, for the reason already recorded in
`resolveVoiceServer.ts`: voice going silently to the wrong-but-working server
beats voice not working, and the UI names where it landed.

---

## The file

Path from `VOICE_SERVERS_FILE`, defaulting to `voice-servers.json` beside
`.env`. Read once at boot, validated, and held in memory.

```json
[
  { "name": "Frankfurt", "url": "wss://fra.example.com",
    "apiKey": "APIxxx", "apiSecret": "…", "default": true },
  { "name": "Singapore", "url": "wss://sgp.example.com",
    "apiKey": "APIyyy", "apiSecret": "…" }
]
```

Validation at boot, refusing to start on a bad file rather than failing at the
first call — the same rule the rest of `config/env.ts` follows:

- `url` must pass the existing `validUrl` check (`wss://`, or `ws://` only for
  loopback).
- `name` must be unique and non-empty, ≤ 40 chars.
- At most one `default: true`. Zero is fine; the first entry is then used.
- An empty array is fine and means "no instance servers".

**Backwards compatible.** With no file, the existing `LIVEKIT_*` variables
become a single-entry list named "Default". Every current deployment keeps
working with no change at all.

**Secrets.** Same trust level as `.env`, and the self-hosting guide must say so:
gitignore it, `chmod 600`, and Docker users mount it. Instance secrets never
enter Mongo and never reach a client — only the resolved `url` and `name` do,
exactly as now.

---

## Ids

Guild servers keep their Mongo `_id`. Instance servers get `instance:<slug>`,
slugged from the name — `instance:frankfurt`.

The prefix is what lets one resolver read two stores, and it is self-describing
in the database: a row pointing at `instance:frankfurt` explains itself, where a
bare id would not.

**One schema change follows.** `Channel.voiceServer` is `Types.ObjectId` and
becomes `String`. No migration script is needed:

- existing ObjectIds stringify to exactly the same value;
- `shapeChannel` already emits `c.voiceServer.toString()`, so the wire format
  does not move;
- `resolveForChannel` branches on the `instance:` prefix before deciding which
  store to query.

The cross-guild guard stays as it is for guild ids — a channel naming another
guild's server is still refused — and does not apply to instance ids, which are
deliberately available to everyone.

---

## Permissions

- **Any guild owner** may point a channel at an instance server, or set one as
  their guild default.
- **Any user** may pick one as their DM/group default. The membership scoping in
  `resolveForConversation` applies only to guild servers; instance ones are open
  by definition.
- **Nobody** may edit or delete an instance server from the app. `PATCH` and
  `DELETE` on an `instance:` id return 400, and the UI has no control to try.

---

## UI

**Voice Servers modal** gains a second, read-only section above the owner's own:

> **Provided by this instance** — Frankfurt · Singapore · Tokyo
> These come from the server's configuration. Ask whoever runs this instance to
> change them.

Read-only rows carry a lock and no delete. Showing them matters: without it an
owner cannot discover what they already have, and will register duplicates.

**Channel picker** and **Voice & Video → Default Voice Server** group both tiers
with `<optgroup>`: *This server* / *This instance*.

The existing "only show the picker when there is a choice" rule now counts both
tiers together.

---

## Testing

- File validation: bad URL, duplicate names, two defaults, missing fields,
  malformed JSON — each refuses to boot with a message naming the problem.
- `instance:` ids resolve to the file entry; unknown ones fall through.
- A channel pointing at `instance:` is not subjected to the cross-guild guard.
- A guild id from another guild is still refused.
- No file → the `LIVEKIT_*` variables still produce a working single server.
- Instance secrets never appear in any API response.

---

## Out of scope

- Restricting an instance server to particular guilds. The stated need is
  "every user on this build"; per-guild allowlists can come later if wanted.
- Hot-reloading the file. Boot-time read only; changing servers is a restart,
  which is what the rest of the configuration already requires.
- A UI for admins to edit the file. It is a file, deliberately — that is what
  makes it the admin's and not the app's.
