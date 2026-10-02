# Music in a voice channel — design

**Goal.** Someone queues a track and everyone in the voice channel hears it,
in sync, without anyone screen-sharing a browser tab.

**Status.** Design only. Nothing is built. This exists because the feature
crosses a line the product has not crossed before and the decisions are
cheaper now than later.

---

## Why this one is different

Every feature Skycord has shipped moves bytes between people who already hold
an account on the instance. A music bot is the first that makes **the server
fetch an attacker-chosen URL**, and the first where **a member's typing causes
the server to execute a program**.

That matters more here than it would for a hosted-only product, because of
what PRODUCT.md already commits to: the server runs on hardware the host
already owns. In practice that is a machine on a **home LAN**, sitting next to
a router admin page, a NAS, a Home Assistant install, a printer, and whatever
else has no authentication because it is "only on the local network".

So the threat is not abstract. `/play http://192.168.1.1/reboot` is a member of
your Discord-replacement asking your server to poke your router. The feature
has to be built so that cannot work, on the first commit, not as hardening
later.

## The two deployments are not the same feature

The answer to "self-hosters or hosted" was **both**, and that splits almost
every decision below.

| | Self-hosted (home box) | Hosted (`app.skycord.xyz`) |
|---|---|---|
| Who fetches the URL | The host's own machine, on their LAN | Our VPS, in a datacentre |
| SSRF blast radius | The host's entire home network | Our internal network, cloud metadata |
| YouTube extraction | Works — residential IP | **Largely does not.** YouTube blocks datacentre ranges; yt-dlp from a VPS hits "Sign in to confirm you're not a bot" |
| Who is doing the downloading | The host, on their own hardware | **Us**, as the operator, for our users |

The third row is a practical problem and the fourth is a positioning one.
Both point the same way: **extraction is a self-host capability, and the
hosted instance should not run it.** Not as a policy stance — because on the
hosted instance it would not reliably work, and making it work means
residential proxies or a logged-in Google cookie, which is a cost and a
liability for a donation-funded project.

## What a "Spotify downloader" actually is

Worth stating plainly, because it changes what gets built.

Spotify's audio is DRM-protected and nothing downloads it. Every tool that
claims to — spotdl and the rest — reads **metadata** from the Spotify API
(title, artist, duration, playlist order), then searches **YouTube** for each
track and downloads from there. The match is approximate: wrong versions,
live recordings, sped-up uploads, and the occasional entirely wrong song.

So "Spotify support" is not a second source. It is a **playlist importer that
feeds the YouTube path**, and it inherits every YouTube problem plus a new one
of its own (bad matches). It should be designed and scoped as exactly that.

It is also against Spotify's developer terms, which forbid using their
metadata to source audio elsewhere. That is the host's decision to make on
their own instance, and this document does not argue it either way — but it
should be a decision somebody made on purpose, especially with the repository
going open-source, rather than a line in a feature list.

## The rule

**The thing that fetches and decodes is not the thing that holds the
database.**

Everything below follows from that. A separate service, its own container,
its own user, no Mongo credentials, and **egress to private address space
blocked at the firewall rather than in application code**. Then an SSRF bug
reaches nothing, and a remote-code-execution bug in a weekly-updated
`yt-dlp` owns a process that can see no secrets and no LAN.

Application-level URL validation is still written, because defence in depth,
but it is the second line. The first line is that the container physically
cannot route to `192.168.0.0/16`.

---

## Architecture

```
member types /play <url>
        |
   sykord-api            validates the member, the channel, the permission,
        |                the queue length. Never fetches the URL.
        |  (authenticated internal call, no user-controlled host)
        v
   sykord-music          own container, own netns.
        |                egress: DENY RFC1918, 127/8, 169.254/16, ::1, fc00::/7
        |                no database credentials, read-only root filesystem
        |                CPU and memory capped
        |                resolves the URL, validates every resolved IP,
        |                connects by IP with an explicit Host header
        |                re-validates on every redirect hop
        v
   LiveKit room          joins as a participant publishing one audio track
```

Publishing into LiveKit as an ordinary participant is the part that is
already proven: it reuses the voice path, needs no client change to be
*heard*, and inherits the server-selection and rejoin logic that two fixes on
2 October made trustworthy.

### SSRF, specifically

A denylist applied to the URL string does not work, and the ways it fails are
all well known: DNS rebinding (public on the first lookup, `127.0.0.1` on the
second), a 302 to a private address, IPv6-mapped IPv4 (`::ffff:192.168.1.1`),
decimal and octal IP encodings, and `0.0.0.0` meaning localhost on Linux.

The approach that holds:

1. Parse the URL. Reject anything that is not `http` or `https`.
2. Resolve the hostname yourself. Check **every** returned address, A and
   AAAA, against the private/link-local/loopback/multicast/reserved set.
3. Connect to the **validated IP**, with `Host` set to the original hostname.
   Never hand the hostname to the HTTP client — that is what reopens the
   rebinding window between your check and its lookup.
4. Do not follow redirects automatically. Follow them yourself, one hop at a
   time, repeating steps 1–3, with a hop limit.

And the firewall rule underneath all of it, because every one of those steps
is code that can have a bug.

### Subprocesses

- `spawn` with an argument array. Never `exec`, never a shell, never string
  interpolation into a command.
- `--` before any user-derived argument. `yt-dlp` has had argument injection
  where a URL starting with `-` is read as a flag.
- The URL must already have parsed as `http(s)` in step 1 above before it is
  allowed near an argv.
- A wall-clock timeout and a hard kill, because a hung `ffmpeg` is a leaked
  CPU core on a machine chosen for being old.

### Resource limits

The hardware constraint is load-bearing — PRODUCT.md pins MongoDB to 4.4 so
pre-2011 CPUs can run this. One careless `/play` of a ten-hour livestream is
a denial of service against the whole instance. Caps, all enforced in the
music service and all configurable by the host:

- maximum track duration, and reject livestreams outright
- maximum download size, enforced while streaming, not from a header
- maximum queue length per channel
- maximum concurrent streams per instance (a small number; transcoding is
  the expensive thing)
- a per-member rate limit on queueing

### Permissions

Roles and permissions are **not built** — PRODUCT.md says everything is
owner-versus-member today. A music bot needs "who may skip", "who may clear a
queue someone else filled", "who may play in which channel" on day one.

Two honest options: ship v1 with owner-only controls for anything
destructive (skip-own, clear-own, owner can do anything), or let this be the
feature that forces roles to ship first. The first is smaller and does not
block; the second is probably what the product wants anyway.

---

## Phasing

**Phase 1 — uploads and direct audio links. No extraction.**

A member links an `.mp3`, `.ogg`, `.flac`, `.opus` or uploads one. The service
validates, caps the size, and streams it into the room.

This ships every hard part — the LiveKit publishing path, the queue, the
sync, the permissions, the controls, the UI — against the smallest possible
attack surface and with no ToS or copyright exposure at all. It works
identically on both deployments. It is also the whole of "own music uploader
by link", which was on the list.

If only one phase ever ships, this is the one worth having.

**Phase 2 — extraction, off by default, self-host only.**

`yt-dlp` in the music container, enabled by a host who turned it on
deliberately and read what it entails. Not enabled on `app.skycord.xyz`, for
the reasons in the deployment table: it would not reliably work there, and
making it work costs money and exposure.

Note what this phase really is: **auto-updating a third-party binary, weekly,
onto self-hosters' home machines**, because that is the only way it keeps
working against YouTube. That is a supply-chain dependency aimed at exactly
the network this document spends its first half protecting. It is defensible
inside the egress-blocked container and indefensible outside it.

**Phase 3 — Spotify as a playlist importer.**

Reads a playlist's metadata, resolves each track through phase 2, shows the
member what it matched and lets them fix the wrong ones. Depends on phase 2
existing and on the decision in "What a Spotify downloader actually is"
having been made on purpose.

---

## Out of scope

- Playing anything to a member who is not in the voice channel.
- Per-member volume. LiveKit gives this for free as a participant.
- Lyrics, album art scraping, "now playing" rich presence.
- Any claim that the bot is a Discord bot or compatible with one.

## Open questions

1. Owner-only controls in v1, or does this force roles to ship first?
2. For the hosted instance, is phase 1 (uploads) enough to be worth having,
   given phase 2 will not run there?
3. Upload storage on the hosted instance — quota per server, retention, and
   who pays for the disk.
4. Does the music service share the LiveKit deployment or get its own? A
   runaway transcode should not be able to degrade voice.
