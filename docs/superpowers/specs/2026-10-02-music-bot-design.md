# Music channels inside a voice channel — design

**Goal.** Ten people are in a voice channel. Two of them are listening to one
thing, two to another, and anyone can start a third. They can all still talk
to each other.

**Status.** Design only. Nothing is built.

**This is not a music bot.** A bot plays one thing to a room. This is several
simultaneous streams inside one room that each member picks between, like
tuning a radio while staying in the conversation. The difference drives
nearly every decision below, and it makes the feature *cheaper* than a bot,
not dearer.

---

## Why this one needs care

Every feature Skycord has shipped so far moves bytes between people who
already hold an account on the instance. This is the first that makes **the
server fetch an attacker-chosen URL**, and the first where **a member's
typing causes the server to run a program**.

That matters more here than for a hosted-only product, because of what
PRODUCT.md already commits to: the server runs on hardware the host already
owns. In practice that is a machine on a **home LAN**, next to a router admin
page, a NAS, a Home Assistant install, and whatever else has no
authentication because it is "only on the local network".

`/play http://192.168.1.1/reboot` is a member of your Discord-replacement
asking your server to poke your router. That has to be impossible on the
first commit, not hardened later.

## The shape

One voice channel is one LiveKit room, as today. The music service joins that
room as **a single participant publishing N audio tracks** — one per music
channel. Each member **subscribes to at most one** of them.

```
 voice channel #general  ->  one LiveKit room
   Ana      mic track          subscribed to: everyone's mic, music "Chill"
   Ben      mic track          subscribed to: everyone's mic, music "Chill"
   Cleo     mic track          subscribed to: everyone's mic, music "Metal"
   Dai      mic track          subscribed to: everyone's mic, nothing
   ...
   sykord-music (1 participant)
            track "Chill"      <- Ana, Ben
            track "Metal"      <- Cleo
            track "Lo-fi"      <- nobody yet
```

Four things fall out of this, and they are the reason this shape is right:

- **Selective subscription is native.** LiveKit already lets a client choose
  which remote tracks it receives. Nobody downloads audio they are not
  listening to, and the server mixes nothing per-person. Cost scales with the
  number of *channels*, not the number of *listeners*.
- **Voice is untouched.** Mic tracks are subscribed by everyone exactly as
  they are today. The music channels are extra tracks sitting beside them, so
  all ten people keep talking regardless of what anyone is listening to.
- **Everyone in a music channel hears the same moment.** It is a published
  live track, not a file each client plays. There is no per-person position
  to keep in sync, which is the hard part of every "watch together" feature
  and it simply does not arise.
- **Volume is free.** Voice and music arrive as separate tracks, so the
  client mixes them. A music volume slider that is independent of voice
  volume costs nothing — it is a gain node on one track.

**One participant, N tracks** rather than one participant per channel: the
member list stays honest (one entry, not five), and the channels render in
their own piece of UI with names carried in track metadata.

## The two deployments are not the same feature

The answer to "self-hosters or hosted" was **both**, and that splits the
source question even though it leaves the architecture alone.

| | Self-hosted (home box) | Hosted (`app.skycord.xyz`) |
|---|---|---|
| SSRF blast radius | The host's **entire home network** | Our VPS, cloud metadata endpoints |
| YouTube extraction | Works — residential IP | **Largely does not.** YouTube blocks datacentre ranges; yt-dlp from a VPS meets "Sign in to confirm you're not a bot" |
| Who is doing the downloading | The host, on their own hardware | **Us**, as operator, for our users |

The middle row is decisive and is not a policy argument: on the hosted
instance, extraction would not reliably work. Making it work means
residential proxies or a logged-in Google cookie — a running cost and a
liability for a donation-funded project. **So extraction is a self-host
capability, and the hosted instance runs uploads only.**

## What a "Spotify downloader" actually is

Worth stating plainly, because it changes what gets built.

Spotify's audio is DRM-protected and nothing downloads it. Every tool that
claims to — spotdl and the rest — reads **metadata** from Spotify's API
(title, artist, duration, playlist order), then searches **YouTube** for each
track and downloads from there. Matches are approximate: wrong versions, live
recordings, sped-up uploads, occasionally the wrong song.

So it is not a second source. It is **a playlist importer feeding the YouTube
path**, inheriting every YouTube problem plus one of its own. It should be
scoped as exactly that.

It also breaches Spotify's developer terms, which forbid using their metadata
to source audio elsewhere. That is the host's call on their own instance and
this document does not argue it either way — but it should be a decision
someone made on purpose, especially with the repository going open-source,
rather than a line in a feature list.

---

## The rule

**The thing that fetches and decodes is not the thing that holds the
database.**

A separate `sykord-music` service: own container, own user, no Mongo
credentials, read-only root filesystem, CPU and memory capped, and **egress
to private address space blocked at the firewall rather than in application
code**. Then an SSRF bug reaches nothing, and a remote-code-execution bug in
a weekly-updated `yt-dlp` owns a process that can see no secrets and no LAN.

Application-level URL validation is still written — defence in depth — but it
is the second line. The first is that the container cannot route to
`192.168.0.0/16` at all.

```
member picks a track in music channel "Chill"
        |
   sykord-api          authenticates the member, checks they are in the voice
        |              channel, checks the queue cap. Never fetches the URL.
        |  (authenticated internal call, no user-controlled host)
        v
   sykord-music        egress: DENY RFC1918, 127/8, 169.254/16, ::1, fc00::/7
        |              resolves the URL, validates every resolved address,
        |              connects by IP with an explicit Host header,
        |              re-validates on every redirect hop
        v
   LiveKit room        publishes/updates the track named "Chill"
```

### SSRF, specifically

A denylist applied to the URL string does not work, and the ways it fails are
well known: DNS rebinding (public on the first lookup, `127.0.0.1` on the
second), a 302 to a private address, IPv6-mapped IPv4 (`::ffff:192.168.1.1`),
decimal and octal encodings, and `0.0.0.0` meaning localhost on Linux.

What holds:

1. Parse the URL. Reject anything that is not `http` or `https`.
2. Resolve the hostname yourself. Check **every** returned address, A and
   AAAA, against the private/loopback/link-local/multicast/reserved set.
3. Connect to the **validated IP**, with `Host` set to the original hostname.
   Never hand the hostname to the HTTP client — that reopens the rebinding
   window between your check and its lookup.
4. Do not follow redirects automatically. Follow them a hop at a time,
   repeating 1–3, with a hop limit.

And the firewall rule underneath all of it, because each of those steps is
code that can have a bug.

### Subprocesses

- `spawn` with an argument array. Never `exec`, never a shell, never string
  interpolation into a command line.
- `--` before any user-derived argument. `yt-dlp` has had argument injection
  where a URL beginning with `-` is read as a flag.
- The URL must already have parsed as `http(s)` before it goes near an argv.
- A wall-clock timeout and a hard kill. A hung `ffmpeg` is a leaked CPU core
  on a machine chosen for being old.

### Resource limits

The hardware constraint is load-bearing — PRODUCT.md pins MongoDB to 4.4 so
pre-2011 CPUs can run this. The multi-channel shape changes the arithmetic:
cost is per **channel**, not per listener, but members can now create
channels, so the count is user-driven.

Caps, enforced in the music service, configurable by the host:

- music channels per voice channel (3–4 is plenty for a crew of thirty)
- music channels per instance — the real ceiling, since each is a decode
- maximum track duration; reject livestreams outright
- maximum download size, enforced while streaming, not read from a header
- queue length per music channel
- a per-member rate limit on queueing and on creating channels

**A channel with no listeners stops.** Not paused-and-still-decoding —
stopped, and torn down after a grace period. Otherwise an abandoned channel
is a CPU core burning for nobody, and on this hardware that is the whole
problem.

### Who controls what

Roles and permissions do **not** exist — PRODUCT.md says everything is
owner-versus-member today. The decision taken for v1: **anyone in the voice
channel can create a music channel and control any of them.**

That fits the product — 5–30 people who already know each other, where social
pressure handles most of it, and where asking the owner to DJ would kill the
feature. The resource caps above, not permissions, are what stop the real
damage.

The griefing case it leaves open is someone skipping a track in a channel
they are not listening to. If that turns out to matter, the fix is one
condition — *only members currently subscribed to a music channel may control
it* — which is self-limiting, needs no roles, and can be added without
changing anything else here.

---

## Phasing

**Phase 1 — uploads and direct audio links. No extraction.**

A member links an `.mp3`, `.ogg`, `.flac` or `.opus`, or uploads one. The
service validates it, caps the size, and publishes it as a track.

This ships every hard part — the multi-track publishing, selective
subscription, the channel UI, the queue, the caps — against the smallest
possible attack surface, with no ToS or copyright exposure, and it works
identically on both deployments. It is also the whole of "own music uploader
by link".

If only one phase ever ships, this is the one worth having.

**Phase 2 — extraction, off by default, self-host only.**

`yt-dlp` inside the music container, enabled by a host who turned it on
deliberately. Not on `app.skycord.xyz`, for the reason in the deployment
table.

Be clear-eyed about what this phase is: **auto-updating a third-party binary,
weekly, onto self-hosters' home machines**, because that is the only way it
keeps working against YouTube. That is a supply-chain dependency aimed at
exactly the network the first half of this document protects. Defensible
inside the egress-blocked container; indefensible outside it.

**Phase 3 — Spotify as a playlist importer.**

Reads a playlist's metadata, resolves each track through phase 2, and shows
the member what it matched so they can fix the wrong ones. Depends on phase 2
and on the decision above having been made on purpose.

---

## Out of scope

- Hearing a music channel without being in the voice channel.
- Video. This is audio.
- Per-person seeking. The track is live; everyone in a channel is at the same
  moment, and that is a feature.
- Lyrics, album art scraping, rich presence.
- Any claim of being a Discord bot or compatible with one.

## Open questions

1. **Upload storage on the hosted instance** — quota per server, retention,
   and who pays for the disk. Phase 1 is the only phase that runs there, so
   this is the hosted instance's whole cost model for the feature.
2. **Does the music service share the LiveKit deployment?** A runaway
   transcode must not be able to degrade voice. Separate instance, or shared
   with resource isolation.
3. **What happens to a music channel when the last listener leaves** —
   stopped immediately, or held briefly in case they come back? A grace
   period is kinder and costs CPU.
4. **Does a music channel survive the voice channel emptying?** Related to
   the call-ended grace period added on 2 October; the same question, and
   probably wants the same answer.
