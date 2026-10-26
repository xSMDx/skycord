# Music and screen-share batch — design (v0.21)

## Why

Users asked for these, and the owner approved this list on 2026-10-26:
- the music player cannot handle several songs at once;
- the queue cannot be reordered;
- call music cannot be paused;
- joining a call drops you into whatever song is playing;
- a shared screen loads for everyone whether they want it or not, and its sound can only be turned down together with the sharer's voice.

This batch ships with v0.21. It lives on branch `android-shell`, together with the phone app, the phone call screen and the new logo.

## Goals

### Music player (the "Your music" modal)

1. **Multi-select.**
   - Pick several songs in the library list, then either **add them to the queue** (in the order they are listed) or **delete them**.
   - Delete asks once to confirm, naming how many songs it will delete.
   - This works with a mouse, with the keyboard, and with a finger (touch, ≥44 px targets).
2. **Multi-upload.**
   - The file picker accepts several files, and dragging several files onto the player also works.
   - Files upload **one after another**. Each one shows its own progress (uploading, then checking and converting), its result, and its error.
   - A failed file does not stop the rest.
   - The server's upload limit is 20 a minute. When it is reached, the uploader waits and carries on by itself; it does not fail the remaining files.
3. **Reorder the queue.**
   - A **drag handle on the left** of each row in "Next in queue" moves a song up or down.
   - It works with a mouse and a finger. The keyboard can do the same: the handle is focusable, and arrow keys move the song.

### Music in a call

4. **Pause.**
   - A call's music channel can be paused and resumed. It pauses **for everyone listening**, because the server plays one stream per channel.
   - Anyone in the call can pause or resume, as anyone can skip today.
   - Every listener sees the paused state, the elapsed time stops, and resume carries on from the same point.
   - Pause and resume are available on the desktop call flyout, the phone call music sheet, the music modal's channel band and the mini player, wherever skip is offered.
5. **No automatic tuning in (bug).**
   - Being in a voice call where a song is playing must not make you hear it. You hear a music channel only after you tap Join or Listen on it.
   - This holds when you join a call where music is already playing, when someone starts a new channel, and after a reconnect.

### Screen share

6. **Join a stream.**
   - Someone else's shared screen is **not loaded** (not subscribed: no video, no stream audio) until you tap **Join stream** on their tile.
   - Until then the tile shows who is sharing and a Join stream button.
   - Once joined, you can **leave the stream** again, which stops loading it, without leaving the call.
   - Your own share preview is unaffected.
7. **Stream volume.** The participant context menu (right-click on desktop, long-press on a phone, wherever "User Volume" is offered today) gains a **Stream Volume** slider, 0–200 % like User Volume. It changes only the shared screen's audio, only for you, and is remembered per person like User Volume.

## Non-goals

- Reordering the "Next from <playlist>" part of the queue, which follows the playlist order or shuffle.
- Server-side bulk endpoints when per-item calls are fast enough. The builder may add one if per-item deletes prove slow or rate-limited.
- Pausing a song for only yourself while the channel keeps playing.
- Changing who may skip, seek or close.
- Screen-share quality settings.

## Anti-goals (failure even if it works)

- Multi-select that makes single-row clicking worse: a click must still play, and the row menu must still work.
- A bulk delete with no confirmation, or one that deletes anything not selected.
- An upload batch that dies silently halfway, or hammers the rate limit.
- A drag that cannot be done on a phone, or that fights the list's scroll.
- A shared screen that still downloads in the background before Join.
- Any change to someone's mic volume when Stream Volume moves.

## Decided by the owner

- **Multi-select:** add to queue, or delete.
- **Reorder:** a drag handle on the left.
- **Pause:** call music pause.
- **Stop auto-joining** the song channel.
- **Screen share:** a Join button, so it does not load until joined, plus a stream volume in the context menu.
- "Nothing it's right": the owner approved the played-back list.

## Decided by me (the owner can overrule)

1. **Selection mode.**
   - A **Select** button in the library header enters selection mode. Rows then show checkboxes, and a click toggles the row instead of playing it.
   - A bottom action bar reads "N selected", with **Add to queue**, **Delete** and **Cancel**.
   - On desktop, Shift-click selects a range and Ctrl/Cmd-click toggles a row without entering the mode first.
   - Escape or Cancel leaves the mode.
   - Long-press on a phone row enters the mode with that row selected.
2. **Bulk delete runs one by one.**
   - It calls the existing delete endpoint per track. The confirmation reads "Delete N songs? This can't be undone".
   - Progress shows on the bar. A song that fails to delete stays selected, with the reason.
   - Deleting a song that is in the queue removes it from the queue, as single delete does today.
3. **Upload queue.**
   - A small list under the upload controls shows each file: its name, its state (waiting, uploading N %, checking and converting, done, failed with the reason) and an ✕ to drop a waiting file.
   - On a 429, it waits for the limiter's reset (Retry-After or RateLimit headers when present, otherwise 60 s), shows "Waiting for the upload limit…", then retries the same file.
   - The library refreshes as each file finishes.
4. **Wrong limiter message.** The upload limiter's message "Too many profile updates" is wrong for music. It becomes neutral: "Too many uploads — wait a moment".
5. **Reorder mechanics.**
   - A pointer drag on the handle uses pointer capture. Other rows move aside to show the drop point, and the drop commits through a pure `moveManual(state, from, to)` in `musicQueue.ts`.
   - Arrow Up and Arrow Down on the focused handle move the song one place, and focus follows it.
   - The handle is ≥44 px on touch, and the list auto-scrolls when the drag nears its edges.
6. **Pause state.**
   - `musicState` gains `pausedAt`. While paused, `elapsedMs` is frozen and `now` stays.
   - The music service (publisher) stops sending audio frames and resumes from the paused position, using the existing seek path where that is simpler.
   - Socket events are `music:pause` / `music:resume`, rate-limited like seek, and the state broadcast carries `paused: boolean`.
   - The UI shows Play in place of Pause while paused. Skip and seek still work while paused; seek leaves it paused.
7. **Auto-tune bug.** Fixed at the root, after it is reproduced. My guess is that LiveKit auto-subscribes the music bot's track at connect, before the listening rule runs. A test pins "joining a call with music playing hears nothing until Listen".
8. **Stream subscription.**
   - ScreenShare and ScreenShareAudio publications from others start unsubscribed. Subscribing happens only on Join stream; Leave stream unsubscribes.
   - The choice is per stream and per call, not remembered across calls.
   - On the phone call screen, a screen share that would fill the screen shows the sharer's tile with the Join stream button until joined.
9. **Stream volume** is stored next to User Volume (`userPrefs`) as `streamVolume`, default 100. It is applied to the ScreenShareAudio element's volume (0–2.0 via the same gain path User Volume uses, if User Volume uses one). The slider appears only while that person is sharing a screen with audio.

### Settled after the builder check (also mine)

10. **Bulk Add to queue goes to your own queue**, in list order, client-side only, even while you are tuned into a call channel. The bar says "Add to your queue". Adding to a shared channel stays per row, through the row menu and the click, because the channel bucket allows 10 actions a minute and holds at most 50 entries.
11. **Bulk removal follows the view.** In All tracks and search it is **Delete**: it deletes from the library, with the confirmation. Inside an open playlist it is **Remove from playlist**, the same as the per-row ✕ there: removal by index, highest first, and no library deletion. The bar label and the confirmation text change to match.
12. **Stream Volume is 0–100 %.** It only needs to go down; the owner asked for "decrease".
    - The screen share's audio becomes independent of the sharer's voice. It gets its own audio element and its own stored `streamVolume`. User Volume and the local Mute stop touching it.
    - Deafen still silences everything.
    - **User Volume above 100 % is reproduced first.** Setting `HTMLMediaElement.volume` above 1 throws. If it is broken, fix it so values above 100 % amplify, through one shared AudioContext gain stage per remote voice element, keeping the chosen output device where the browser supports it. If amplification cannot keep the output device, cap the slider at 100 % and say so. This is part of this batch.
13. **"Not loaded" is strict.** The room connects with `autoSubscribe: false`. One pure policy decides every subscription:
    - mic and camera are always subscribed;
    - music is subscribed only when you are tuned into that channel;
    - screen share and its audio are subscribed only after Join stream.

    The policy is applied on connect (to existing publications), on every TrackPublished and on every relevant state change. This also fixes the auto-tune bug at its root: the current music sweep runs before `getRoom()` is set, so autoSubscribe wins the race.
    - The policy is unit-tested exhaustively.
    - The real-browser check proves that in a two-person call each can hear the other, that music is silent until Listen, and that a shared screen is not received until Join.
14. **Pause and the other controls.**
    - Skip, previous and play-now while paused start that song playing and clear the pause. Seek keeps the pause.
    - The music service gains `/pause` and `/resume`. They stop and restart sending frames from the held position.
    - The server asks the service first, and broadcasts `paused` only once the service has done it. If the service fails, the pause is refused with a reason.
    - The state carries `pausable: true` only when the service supports pause; an older service makes the server send no `pausable`. The client shows Pause only when `pausable`.
    - Deploy order for hosts: the music service first, then the server. The changelog says so.
    - The `/pause` and `/resume` chat commands pause the channel you are tuned into.
15. **The person who starts or shares music still hears it.** `createMusicChannel` (thenListen) and `shareToChannel` keep moving the initiator's ear: they asked for it. Everyone else in the call must tap Listen.
16. **Stream Volume on the phone call screen.**
    - Tapping a person in the call sheet's "In this call" list opens a person sheet (the app's `BottomSheet`) with User Volume, Stream Volume (while they share a screen with audio) and the local Mute.
    - On the phone stage, a not-joined screen share shows the sharer's tile with **Join stream**. Once joined, the same tile's long-press opens the person sheet.
17. **Library rows on a phone.** Long-press enters selection mode with that row selected, which replaces long-press opening the row menu. The ⋯ button still opens the row menu.
18. **Assumed, as the builder proposed.**
    - Reordering a shared channel's queue is out of scope.
    - A viewer's "joined" state for a stream resets when the sharer stops and starts again.
    - The upload queue lives in `useMusicLibrary` and survives closing the modal.

## Constraints

- Vue 3 and the existing composables (`useMusicPlayer`, `musicQueue`, `useMusicLibrary`, `useMusic`, `useVoice`, `useVoiceMedia`, `callMenu` and `voiceOccupantMenu`), plus the server (Express + Socket.IO, `musicState.ts`, `chatSocket.ts` music handlers) and the music service (`music/src/publisher.ts`).
- Older clients must keep working against the new server. An unknown `paused` field is ignored, and the new socket events are additive.
- The new client must work against a server without pause: the pause control hides when the state has no `paused` field.
- Desktop and phone both: 44 px touch targets, existing tokens only (no hex), lucide icons, `prefers-reduced-motion`.
- The owner requires the design skills for UI work: `impeccable` (primary), `apple-design` and `emil-design-eng`.
- Never put the Iran instance address in any copy, changelog or commit.
- Commits are local, with pathspecs. Push only when asked.

## Left to the builder

- Component structure: for example, a `LibrarySelectionBar` and an `UploadQueue` component.
- Whether bulk add-to-queue uses one `enqueue` per track or a batch helper.
- Exact drag visuals within the motion rules.
- Test split. Pure logic (moveManual, the upload scheduler with 429 back-off, pause bookkeeping in `musicState`, subscription rules) gets real unit tests; components follow the repo's source-text pattern.
