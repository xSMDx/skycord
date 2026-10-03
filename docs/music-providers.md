# Where a music channel's audio comes from

Today there is one answer: our own service fetches bytes and decodes them
into the call. This is the note for when there is more than one, written
before the second one exists because the shape of the second one is not
what most people assume.

## The thing to know before designing anything

**Spotify audio cannot be mixed into a voice call.** Not "is awkward to" —
cannot. The audio is DRM-protected and never leaves the Spotify client in a
form anything else may touch, and the developer terms forbid it explicitly.
Any design that has a server decoding Spotify and publishing it to LiveKit
is dead before it starts, however the code is arranged.

What Spotify does allow is the model Discord uses: **each listener plays it
themselves**, through their own account, and the server coordinates only
*what* and *when*. That is a genuinely different mechanism from the one that
exists, and the difference is not an implementation detail — it changes who
needs an account, what happens to listeners who do not have one, and what
"in sync" even means.

So the seam is not "another kind of URL". It is: **a music channel has a
provider, and the provider decides how sound reaches ears.**

## The two mechanisms

**Mixed** — what exists. The service decodes the track and publishes one
LiveKit track per music channel; listeners subscribe. Everyone hears it,
including people with no account anywhere, and the sync is exact because
there is literally one stream. Works for uploads and for direct links.

**Federated** — what Spotify would need. The server tells every listener
"play track X at position Y as of timestamp T"; each client plays it with
its own SDK. Nothing passes through LiveKit. Listeners without a Spotify
Premium account hear nothing and have to be told why, not left wondering.
Sync is approximate and drifts, so it needs periodic correction.

A channel is one or the other. A queue holding both would have to switch
mechanism mid-playback, which means every listener's audio path changes
between tracks — that is a feature to refuse, not to engineer.

## What the code already has

`Track` in `server/sockets/musicState.ts` is a tagged union: a queue entry
says what kind of thing it is, and every place that starts playback
switches on that tag in one function, `startSource`. Adding a third kind is
a compile error at each place that must learn about it, which is the point
of the tag — the branch used to exist in three copies and they would have
drifted.

`kind: 'link'` carries a URL a member pasted, guarded in the service.
`kind: 'library'` carries a track id the API has checked the caller owns.
A `kind: 'spotify'` would carry a Spotify URI and, critically, would **not**
go to `musicPlay`/`musicPlayTrack` at all — it would broadcast to the room
instead, because the service has no part in it.

## What would actually have to be built

Roughly, and in the order the dependencies run:

1. **OAuth per member.** Spotify playback needs each listener's own token,
   so this is an account linking flow, refresh handling, and a place in
   Settings to disconnect. Not a server-wide API key.
2. **Premium detection.** The Web Playback SDK requires Premium. A free
   account must be told that before it joins a channel, not after.
3. **A clock.** "Play from 1:23 as of server time T" plus drift correction.
   The existing channel state has no notion of position because it has
   never needed one — a mixed channel's position is whatever the stream is
   at.
4. **A second listener path in the client.** `useMusic` subscribes to a
   LiveKit track; a federated channel subscribes to nothing and drives the
   SDK instead.
5. **Honest UI.** A channel badged with where it comes from, and a plain
   sentence for the people who cannot hear it.

Search and metadata are a separate, much smaller thing: using the Spotify
Web API to find a track and read its title, artist and cover art needs no
user account and no playback, and could be added to the library's "add"
flow on its own. If the point is nicer metadata rather than streaming,
that is the cheap version and it is worth doing first.
