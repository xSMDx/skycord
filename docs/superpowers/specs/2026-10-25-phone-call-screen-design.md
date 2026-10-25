# Phone call screen — design (v0.21, slice 3)

## Why

On a phone, a Skycord call today is the desktop call bar squeezed into a 360 px column:
- two rows of mixed-size controls;
- a screen-share button that cannot work;
- desktop pop-over menus;
- a drag-to-resize bar sized for a mouse.

The owner wants calls on phones to feel like **iPhone FaceTime, not Discord's mobile app**: big round
buttons at the bottom, nothing cramped. Skycord is first a place to talk, so this is the screen phone
users spend the most time on.

It also has to close a real gap: a channel that requires push-to-talk leaves a phone user unable to
transmit, because there is no key to hold.

## Who and where

Anyone on a phone in a call:
- a DM call;
- a group call;
- a server voice channel.

"Phone" is the existing phone layout: `isMobile` (≤768 px) in ChatApp. That covers the Android app (the
WebView shell) and phone browsers. The Android app is the main target.

Desktop and wide windows keep today's `CallBar` exactly as it is.

## Goals

1. A full-screen phone call screen, approved by the owner from wireframes (style "C", swipe-up sheet):
   - **Top:** call name, then a subtitle with the people count, or who is on camera, and the call timer.
   - **Middle, no cameras:** whoever is talking, big (their avatar with a talking ring); everyone else
     small in a row beneath.
   - **Bottom sheet:** a drag handle and ONE row of four same-size circles:
     - mute;
     - speaker;
     - camera;
     - hang up (red).

     The circles are about 56 px with about 16 px between them, grouped in the centre, not spread edge to
     edge. The owner asked for them "a little smaller" and "closer" than the first drafts.
   - Under the row, a hint: "Swipe up: people, music, invite".
2. **The swiped-up sheet**, with the buttons staying where they are and the rest sliding up beneath them:
   - **In this call · N:** everyone, with a talking indicator and a muted icon.
   - **Music:** a card reading **Music ›**, then either "Not playing" or the song's cover and title. A
     title that does not fit is cut off and slides back and forth (ping-pong). With reduced motion it
     stays still with an ellipsis. Tapping the card opens the call's music (see Decided by me).
   - **Invite people ›**
   - **Voice settings ›**
3. **Push-to-talk on phones:**
   - When the mode in force is push-to-talk, a wide **Hold to talk** bar sits above the four circles. The
     mode in force is `effectiveInputMode() === 'ptt'`, which on a phone means the channel requires it.
   - Pressing and holding it transmits; letting go stops.
   - The row of circles does not change size or position.
4. **Video:**
   - When someone turns their camera on, their video fills the whole screen behind the top text and the
     sheet, as FaceTime does.
   - In a group call, everyone else shows as small tiles above the sheet.
   - You see your own camera as a small tile in the top-right corner.
   - While a video fills the screen, the controls hide after a few seconds without a touch. A tap anywhere
     brings them back.
5. **No screen-share control on phones.** Android's WebView and phone browsers cannot capture a screen.
   A screen shared by someone on desktop must still be watchable on the phone (see Decided by me).
6. **Touch rules everywhere on this screen:**
   - every target at least 44 × 44 px;
   - safe-area insets respected, top and bottom;
   - laid out for 360 and 412 px widths;
   - `prefers-reduced-motion` honoured.

## Non-goals

- Any change to the desktop `CallBar`, its flyouts or its layout.
- Sharing your screen from a phone.
- Landscape. The web app manifest is portrait.
- System picture-in-picture (a floating call window outside the app), and calls on a locked phone. Both
  are later releases.
- Flipping between the front and back camera, dragging the self-view, pinch-zoom on a shared screen, and
  a Bluetooth/headset route picker.
- Redesigning the incoming-call prompt. Android's native incoming-call screen from slice 2 stays.

## Anti-goals: failure even if it works

- Cramped or small targets, mixed button sizes, or a second row of circles.
- Desktop pop-over menus on a phone.
- A control that cannot work: screen share; speaker in a browser that cannot route audio.
- A function that has no visible way in, as the music queue had before slice 2's fixes.
- Looking like Discord.

## Decided by the owner

- FaceTime feel, big round buttons at the bottom, style C (swipe-up sheet).
- Four equal circles (mute, speaker, camera, red hang-up), grouped closer and a little smaller than the
  first draft.
- The sheet's contents: people, Music, Invite people, Voice settings.
- The Music card reads "Music ›" over "Not playing" or the cover and a cut-off title that ping-pongs.
- Video fills the screen behind the controls, FaceTime-style (confirmed). The rest of the video
  behaviour, and the Hold to talk bar, were played back and approved: "good build it".

## Decided by me (the owner can overrule)

1. **Phones only:**
   - `CallBar` keeps rendering on phones only for its *not-joined* state: an ongoing call you can join,
     with Join (and Dismiss for a DM). On a phone those two buttons become at least 44 px tall.
   - Once you are in, or connecting to, a call, the phone call screen takes over.
2. **Opening, minimising, returning:**
   - The screen opens full screen when you join, answer, or open a voice channel you are in.
   - A chevron-down button at the top left, or Android Back, **minimises** it. It is `role="dialog"`, so
     the existing `androidBack` handling sends it Escape first. Minimising does not leave the call.
   - While minimised and still in a call, a slim **return-to-call bar** shows on every phone screen:
     - 44 px tall, at the top, pushing content down rather than covering it;
     - the call name, a green talking dot when someone is talking, and the timer;
     - tapping it reopens the screen.
   - Leaving the call removes both.
3. **Speaker:**
   - Works in the **Android app only**, through a new bridge member. Natively it uses `AudioManager`:
     communication mode and the speakerphone (`setCommunicationDevice` on Android 12+,
     `setSpeakerphoneOn` before). `MODIFY_AUDIO_SETTINGS` is already declared.
   - Each call starts on the **speaker**: a crew call is usually held away from the ear, and WebRTC's
     communication mode defaults to the earpiece.
   - With a wired or Bluetooth headset connected, audio goes to the headset. The button then shows a
     headphones icon and is disabled with the label "Using headset".
   - In a phone browser, or an older app build without the bridge member, the speaker circle is left
     out, so the row is three circles. A control that cannot work is worse than an absent one.
4. **Mic button under push-to-talk:**
   - It shows mic-off and is disabled, labelled "This channel uses push to talk". The Hold to talk bar
     is the only way to transmit.
   - While held, the bar fills with the accent and reads "Talking…".
   - Press and release go through the same code as the push-to-talk key: refactor `useVoice`'s key
     handlers into exported `pttPress()` / `pttRelease()`.
   - Release on pointerup, pointercancel, lost pointer capture, or the page being hidden, so the mic can
     never stick open.
   - While deafened the bar is disabled, matching the key, which does nothing while deafened.
   - A 10 ms vibration on press where `navigator.vibrate` exists.
5. **Who fills the screen:**
   - A **screen share** wins over cameras. It is shown fitted (letterboxed, `contain`), because it is
     text that cannot be cropped.
   - Otherwise, the camera of the most recent speaker among those with cameras on, filled (`cover`).
   - Your own camera fills the screen only when nobody else has video.
   - With no video at all, the most recent speaker's avatar is the big one, as in goal 1.
   - Reuse the existing ordering helpers (`callLimits.visibleTiles`, the last-spoke tracking in
     `CallStage`) rather than inventing a second rule.
6. **Auto-hide:**
   - Only while a video fills the screen, and never while the sheet is pulled up.
   - Four seconds after the last touch.
   - The top text, the sheet and the small tiles fade together; the self-view stays.
   - With reduced motion they appear and disappear without fading.
7. **Music card:**
   - Shown only when the server runs music (`musicAvailable`).
   - The song is that of the channel you are tuned into (`musicChannel.now`).
   - If you are tuned in but nothing is queued, or not tuned in and no channel in the call has a song,
     it reads "Not playing". If you are not tuned in but a channel is playing, it reads "N playing".
   - Tapping opens a **phone Music sheet**: the same contents and actions as the desktop `MusicFlyout`
     (channels with who is listening, listen and stop, queue, skip, create, close), laid out as a
     full-height phone sheet. It has a "Your library" row that opens the existing phone `MusicModal`.
   - The desktop flyout is not shown on phones.
8. **Invite people:**
   - A voice channel opens the existing `InviteToVoice` (modal shape).
   - A group call opens the existing add-friends-to-group sheet.
   - **Hidden in a DM call**: a third person would turn it into a group, which is not this screen's job.
9. **Voice settings ›** opens Settings › Voice & Video.
10. **Call states the screen must carry**, all of them existing behaviour in `CallBar` and `useVoice`:
    - **Connecting:** the subtitle reads "Connecting…"; camera is disabled until joined, as today.
    - **Ringing (DM, before they answer):** their avatar is the big one, with the subtitle "Ringing…".
      After the ring times out it reads "No answer", with a **Ring again** button under the avatar, which
      the desktop has only on right-click.
    - **Mic failures:** the existing `micNotice(voice.mic)` line under the subtitle (blocked, missing,
      insecure, muted by the server).
    - **Server-muted:** the mute circle is disabled with "Muted by the server".
11. **Icons** come from the app's set (`lucide-vue-next`): Mic / MicOff, Volume2 (speaker), Headphones,
    Video / VideoOff, PhoneOff, ChevronDown, Music2, UserPlus, SlidersHorizontal.
    **Colours** come from existing tokens only; the hard-coded-colour guards must stay green. The
    hang-up circle uses the app's danger role.

## Constraints

- Vue 3 and the existing composables (`useVoice`, `useVoiceMedia`, `useMusic`, `useVoiceSettings`,
  `voicePermits`, `callLimits`, `micState`). No new dependencies.
- Android WebView Chromium 86+ (the shell's floor). minSdk 26, targetSdk 35.
- Every Android bridge member is optional and feature-detected through `appBridge()`. An older app build
  simply has no speaker circle.
- Phone-only CSS and components. Desktop behaviour must be provably unchanged: its tests keep passing,
  and a desktop-width capture looks as before.
- Commits are local; push only when asked.

## Left to the builder

- Component structure and file names. A `PhoneCallScreen` with a presentational phone stage, a sheet and
  a return bar is the obvious shape, not a requirement.
- How the sheet drags and snaps (two positions), and exact durations and curves, within the motion rules
  above.
- How the return bar pushes content down in the phone shell.
- The precise sizes, within: circles 52–60 px, gaps 12–20 px, Hold to talk at least 52 px tall.
- How to test:
  - unit tests for the pure rules (who fills the screen, the Music card's label, auto-hide,
    press/release);
  - an Android unit test for the speaker route logic;
  - a headless phone capture at 360 and 412 with the existing harness, for the visual check.
