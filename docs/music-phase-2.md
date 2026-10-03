# Music, phase 2 — libraries, playlists, and a room to play them in

Phase 1 gave a voice call several music channels, each decoding one link, with
members tuning into at most one. It had no memory: close the channel and the
link is gone. Nobody owns anything.

Phase 2 is the part that makes it a feature people use rather than demo. Three
things, in dependency order:

1. **A library.** Every member has tracks they own — uploaded, or fetched from a
   link — with real metadata, and playlists built from them.
2. **A room to browse it in.** A full modal, not a popover. The popover from
   phase 1 stays as the in-call control; the modal is where you manage music.
3. **The call, joined up.** Play from your library into a music channel, see
   what is playing with its artwork, see who is listening, hear a cue when a
   channel opens.

## What already exists and does not change

- Selective subscription: the service publishes N tracks as one hidden
  participant and each member subscribes to at most one. Works, tested.
- `svc:music` is filtered out of the participant list, so no bot appears in the
  call. This was already true; phase 2 keeps it that way deliberately.
- The SSRF guard (`music/src/urlGuard.ts`) and `safeFetch` — judge the resolved
  address, connect by IP with a `Host` header, re-approve every redirect hop,
  cap bytes while streaming. 19 tests. Phase 2 reuses it unchanged for imports.
- The caps in `server/utils/musicLimits.ts`. Phase 2 adds library caps beside
  them rather than inventing a second system.

## 1. Storage — the decision everything else rests on

Skycord stores every other piece of media as a base64 data URL inside a Mongo
document: avatars, banners, stickers. That is defensible for a 40 KB image and
impossible for audio. One four-minute track is 5–10 MB, base64 inflates it by a
third, and Mongo's document ceiling is 16 MB. A hundred-track library is not
expressible in that design.

So audio needs real file storage, and the choice is constrained by who runs
this. PRODUCT.md pins MongoDB 4.4 so pre-2011 hardware can run an instance; a
self-hoster will not stand up MinIO to listen to music with four friends.

**GridFS**, therefore — Mongo's own chunked file store. No new infrastructure
for a self-hoster, streams rather than buffers, no 16 MB ceiling, and it
replicates and backs up with everything else. It is slower than a filesystem and
much slower than S3 at scale, and that is an acceptable trade for a product
capped at 100 members per server.

Behind an interface, so the trade is reversible:

```ts
interface TrackStore {
  put(src: Readable, meta: PutMeta): Promise<StoredRef>
  open(ref: StoredRef): Readable
  remove(ref: StoredRef): Promise<void>
}
```

`GridFsTrackStore` ships. An `S3TrackStore` is a file, not a refactor, the day a
hosted instance outgrows this.

## 2. Ingest — where the security lives

Two ways in, one pipeline. An upload streams from the browser; an import is
fetched from a link. They converge immediately, because the bytes are equally
untrusted either way: a member uploading a file is not more trustworthy than a
member pasting a link, they are the same member.

Every stage runs **in the music service container**, which is the one with
restricted egress, never in the API.

```
bytes ──▶ cap ──▶ sniff ──▶ scan ──▶ transcode ──▶ probe ──▶ store
         size    magic    clamd     ffmpeg       tags     GridFS
```

**Cap.** Already built: a `Transform` counting bytes, erroring past
`MUSIC_MAX_BYTES`. Never trust `Content-Length`.

**Sniff.** Read the magic bytes and decide what the file actually is. A filename
and a `Content-Type` are both attacker-controlled; `playlist.mp3` holding a PE
binary must be rejected here, before anything parses it.

**Scan.** clamd over TCP, `INSTREAM`. Optional, because a signature database
costs about a gigabyte of RAM and that is real money against a product sized for
old hardware — but **fail closed when it is enabled**: scanner configured and
unreachable means the upload is refused, never quietly admitted. Off by default
for self-hosters, on for hosted, documented either way.

Worth being straight about what this buys. Malware signatures on an audio file
mostly matter because the library is shareable and a member can download what
another member uploaded — that is the path where a planted executable reaches
someone. Against an exploit aimed at a *decoder*, a signature scan is close to
useless. The next stage is what defends that.

**Transcode.** Re-encode to Opus in WebM through ffmpeg, and store that, not the
original. This is the strongest control in the pipeline and it is worth saying
why: whatever the original container held — a malformed atom aimed at a parser,
a payload stuffed in an unread tag, a polyglot that is both a valid MP3 and a
valid something-else — the bytes that end up stored are the bytes *our encoder
wrote*. The attack would have to survive being decoded to PCM and re-encoded,
which no container-parser exploit does. ffmpeg runs with a constant argv, no
shell, in the sandboxed container, as it already does for playback.

It also makes playback cheaper: the publisher gets one codec instead of eight.

**Probe.** Pull title, artist, album, duration and cover art from the *original*
with ffprobe, then sanitise all of it: clamp every string, strip control
characters, re-encode the cover through ffmpeg to a small WebP. Tag text is
user-controlled data that will be rendered in a list, and cover art is an image
decoder's input — neither gets to pass through untouched. Reject here if the
duration exceeds `MUSIC_MAX_DURATION_SEC`.

**Store.** Normalised audio to GridFS, metadata and the storage ref to Mongo.

### What is deliberately not built

Downloading from YouTube or Spotify. It needs an extractor that breaks
constantly, and it is a terms-of-service and copyright question rather than a
technical one — the kind of thing that gets a hosted instance a letter. Direct
links to audio files work, uploads work, and if YouTube import is wanted it
should be a decision taken on its own, not slipped in under "add from link".

## 3. Data model

```ts
Track {
  owner, title, artist, album,
  durationSec, bytes, coverWebp?,          // small, inline is fine
  store: { kind: 'gridfs', id },           // the normalised Opus
  source: 'upload' | 'link', sourceUrl?,
  scan: 'clean' | 'skipped' | 'infected' | 'error',
  createdAt
}

Playlist { owner, name, description?, trackIds[], createdAt, updatedAt }
```

A track is owned by one member. Playing it into a music channel shares the
*sound*, not the file: other members in the call hear it, and nothing is copied
into their library unless they ask for it.

New caps, beside the existing ones: tracks per member, total bytes per member,
playlists per member, tracks per playlist.

## 4. The modal

Spotify's layout is the right reference for the shape — a library rail, a list
view, a now-playing panel — and the wrong reference for the content, because
Spotify is one person with headphones and this is a room. mybox's player is the
closer reference for the *player* itself: the album-art-themed accent, the
marquee on long titles, the mini/full pair.

What that means concretely, and where this diverges from the screenshot:

- **Left rail.** Your tracks, your playlists, create. Search over your own
  library. No "Podcasts / Albums / Artists" — there is no catalogue here, only
  what members put in.
- **Centre.** Header themed from the cover art, the way mybox themes its modal:
  dominant colour for the wash, vibrant colour for the accent. Track table with
  title, artist, album, duration.
- **Right.** This is the panel that is *not* Spotify's. Spotify puts "about the
  artist" there because it is selling a catalogue. Skycord puts **the call**
  there: the music channels open in the voice channel you are in, what each is
  playing, and who is listening to each — by name, because these are people you
  know. Picking a channel to listen to is the thing you came to do.
- **Bottom.** The transport. In a call it controls the music channel; outside a
  call it is local preview through the browser's own audio element.

Tune-in is a ring, not a fill — the selection idiom the rest of the app now
uses. The accent in these lists already means hover.

## 5. The cue

A music channel opening is an event in the room with nothing visible to announce
it, since there is no bot in the member list. It gets a sound.

The palette is synthesised, not sampled (`useSounds.ts`), built on an F–C fifth:
rising means opened, falling means closed, and the interval carries how final
the action is. The call-join triad is the biggest cue in the app.

Music gets a rolled four-note chord rather than a struck triad — F, A, C, D,
tightly spaced, so it reads as an arpeggio rather than as a chime. It is the
only cue in the palette with a fourth note, which is what makes it identifiable
as *music* rather than as another call event, and it is quieter than call-join
because it is not about you.

## Order of work

1. Store, models, caps.
2. Ingest in the service: sniff, scan, transcode, probe.
3. API: upload, import, list, delete, stream.
4. The modal.
5. The call: play from library, artwork in channel state, rosters, cue.

Each step is useful before the next exists, and the modal is deliberately last
of the big pieces because it is the one that needs everything else to be real.
