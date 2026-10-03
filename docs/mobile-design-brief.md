# Skycord — brief for a mobile app design

Written to be handed to a designer (human or AI) with no prior knowledge of this
project. The direction being explored is **minimalism crossed with spatial UI**.
Everything below is what exists as of 2026-09-25, not a wish list; where
something is unbuilt it says so.

---

## 1. What Skycord is

A self-hosted place for a group of friends to talk: text channels, voice
channels, direct messages, calls and screen share. Someone runs the server
themselves — often on an old laptop or desktop they already own — and invites
their crew onto it. No company in the middle, no accounts with anyone, no ads.

It is open source (AGPL-3.0), funded by donations, and it deliberately looks and
behaves like Discord, because everyone arriving already knows Discord.

Landing voice, in use: *"your crew's place to talk."* Plain, unceremonious,
second person. The product never oversells itself; the changelog says what
broke.

### Two very different users

| | **The host** | **The crew** |
|---|---|---|
| Who | One person, technical enough to run a server | 5–30 friends |
| Relationship | Chose Skycord, set it up, owns the machine | Did not choose it; the host did |
| Sees | A terminal, a server address, settings nobody else sees | Only the app |
| Needs | Confidence that it is running and updatable | It to work without thinking about it |

**Nothing may require a crew member to understand self-hosting to use the app.**
The only unavoidable trace is at the very start: they are joining *someone's*
server, at an address, and the app has to say whose.

### What the product is like to live in

- **Long-session software.** People leave it open all day in the background.
  Anything that demands attention repeatedly is a tax, not a delight.
- **Voice is the highest-stakes surface.** The moment a microphone goes live is
  the moment the product is most able to embarrass someone. Microphone state
  must never be ambiguous, ever, in any layout.
- **Crews, not communities.** A server caps at 100 members. There is no
  moderation-at-scale problem to design for, and no discovery problem.
- **Old hardware is a value, not an accident.** The database is pinned to an old
  version specifically so pre-2011 CPUs can run it. A design that assumes an
  expensive phone contradicts the product's reason for existing.

---

## 2. What exists today

### Built and shipped

- **Servers** with categories, text channels and voice channels.
- **Roles and permissions**: a role has a name, a colour, a position in a
  hierarchy, and a set of permissions. Channels and categories can override
  them. Private channels are invisible to those without access, not greyed out.
- **Direct messages** and group DMs.
- **Voice and video calls**, screen share, per-user volume, local mute, speaking
  indicators, spotlight (one big stream) and full screen.
- **Voice moderation**: server mute, server deafen, disconnect, kick.
- **Search** across a server or one conversation, with filters (from, in, has,
  mentions, dates, pinned), and full history scrollback to the first message.
- **Messages**: replies, reactions, pins, edits, GIFs, stickers, custom statuses
  with timers, presence.
- **Invites**, including invites that land someone in a specific voice channel.
- **Themes**: five presets (default, midnight, amoled, light, light-dim), a
  custom theme, nine accents, a custom accent, and a Material-You mode that
  generates the whole palette from one seed colour.
- **Server Settings** and **Settings** (account, profile, devices, appearance,
  voice and video, keybinds).
- **A Windows desktop app** wrapping the same web UI, with its own screen-share
  picker and a list of saved servers.

### Not built — do not design as if these exist

- **File attachments.** Nothing can be attached to a message yet. Links and GIFs
  work.
- **Notifications.** No push, no per-server notification settings. On a phone
  this is the single biggest gap, and the native app is where it gets solved.
- **Bans** (kick exists), **custom emoji**, **audit log**, **polls**,
  **forwarding**.
- **End-to-end encryption.** Designed in detail, not built. Messages are stored
  in plain text in the host's database. Never present it as shipped.
- **Deep links** into a specific message or channel from outside the app.

Unbuilt features that have a visible switch are labelled **Soon** rather than
hidden, and the app never offers a control that silently does nothing. Keep that
honesty in any new design.

---

## 3. The structure that must survive

**Muscle memory is binding.** A redesign replaces the visual world on top of the
existing structure; nobody should have to relearn where anything is.

On a wide screen the app is three columns:

```
server rail (68px) │ channel sidebar (234px) │ conversation │ member list
```

On a phone it collapses to **a stack exactly one level deep**:

- **Root:** the list — servers, channels, or the DM list.
- **Pushed:** the conversation.
- The transition is finger-driven: a swipe reports continuous progress from 0 to
  1, and the panes track the finger rather than waiting for the gesture to end.
  A half-abandoned drag looks correct at every point.
- **Search is its own screen** on a phone, because the header has no room for a
  box worth typing into.
- The phone breakpoint is 768px. Smaller adjustments exist at 600, 560, 420 and
  380.

A call is not a screen in that stack. It is a **layer that persists** while you
move between conversations: you can be in a voice channel and read a different
channel, with the call still visible and controllable.

---

## 4. The design system as it stands

The mobile design may evolve this, but it should evolve it, not ignore it. Every
colour in the app is a token; nothing hardcodes a hex value, because a user's
custom accent or Material-You palette can replace the whole set at runtime.

### Colour (dark default)

| Role | Token | Value |
|---|---|---|
| Accent | `--accent` | `#38b6f1` (Sky) |
| Rail, darkest chrome | `--bg-floor` | `#111214` |
| User panel | `--bg-deep` | `#17191c` |
| Sidebars, modals, panels | `--bg-panel` | `#2b2d31` |
| Main content surface | `--bg-chat` | `#313338` |
| Inputs, code | `--bg-input` | `#1e1f22` |
| Composer | `--bg-chatbar` | `#383a40` |
| Body text | `--text-1` | `#dcddde` |
| Secondary | `--text-2` | `#b5bac1` |
| Muted, labels | `--text-3` | `#949ba4` |

**There is already a depth model in the colour, and it is a gift for a spatial
design:** inputs go *darker* than their surface (cut into it), while the
composer goes *lighter* (laid on top of it). Depth is expressed as light, not
only as shadow.

Two rules that constrain any new component:

1. **Text on the accent is measured, not assumed.** It is computed per accent by
   comparing contrast of ink versus white; Sky lands on ink (`#0e0f11`). Never
   hardcode white on the accent.
2. **Light themes invert every tint**: white-alpha overlays become black-alpha.
   A hardcoded white overlay is invisible in light themes.

### Type

- **Archivo** for UI, **Chakra Petch** for display and headings, a mono for
  code. Users can swap the UI font (Archivo / Inter / Roboto / System).
- No `--font-size-N` scale. Sizes in practice: 20/700 modal titles, 18/700
  section headings, 16/600 card titles, 15 message body (user-adjustable), 14
  standard body and inputs, 13 secondary, 12 labels, 11/700 uppercase with
  `.4px` tracking for group labels.
- That uppercase 11px label is a strong recurring signature of the app.

### Space, radius, targets

- **Everything even.** Spacing, radii and icon sizes sit on a 2px grid. Common
  values: 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 22 · 24.
- Radii: 4 chips, 6 rows and inputs, 8 panels and menus, 12 modals and cards,
  999 pills and avatars.
- **Touch targets ≥40px on mobile.** Components scale up at the breakpoint
  rather than shipping a separate mobile control.
- Three densities exist (compact, cozy, roomy) and change row and message
  padding.

### Motion

```
--dur-1: 120ms   hover, press tint, colour
--dur-2: 180ms   chevrons, folds, small enters
--dur-3: 240ms   popovers, menus, panels
--dur-4: 340ms   sheets, modals, big moves
--dur-exit: 140ms  every dismissal

--ease-out:   cubic-bezier(.32, .72, 0, 1)   the house curve, for arrivals
--ease-in:    cubic-bezier(.4, 0, 1, 1)      for leaving
--ease-inout: cubic-bezier(.4, 0, .2, 1)     for on-screen state changes
```

1. Exits are always shorter than entrances.
2. Press feedback has **no** transition: it lands on finger-down or it is late.
3. Reduced motion is honoured globally, spinners exempt.

### Elevation

Shadows are big, offset and dark, because on near-black surfaces a subtle shadow
does nothing. Two are directional on purpose: a right-hand drawer casts **left**,
a bottom sheet casts **up**. A scrim of `rgba(0,0,0,.75)` sits behind modals,
sheets and full-screen media, and stays black in light themes.

### Accessibility, treated as commitments

1. Every control has an accessible name; a placeholder is not a label.
2. Contrast is measured against the *darkest* surface a colour can land on.
3. Reduced motion is honoured globally.
4. Touch targets ≥40px.
5. **Colour is never the only signal.** Presence is a shape as well as a colour:
   a dot for online, a crescent for idle, a bar for do-not-disturb, a ring for
   offline. Voice state shows an icon and a colour. A mention gets a bar and a
   tint.

---

## 5. What a phone adds that the desktop never had

The mobile app is planned as a **native app**, not a wrapped web page, and these
are its reasons for existing:

- **Push notifications**, which the web app cannot do. This is the first thing
  the crew will ask for, and the design has to answer: what is worth waking a
  phone for, how a mention differs from a message, how a call rings, and how a
  person mutes a server or a channel without hunting.
- **Joining a call from a locked phone**, with audio continuing in the
  background, and a persistent call affordance in the OS.
- **The server address problem.** The app talks to whichever server its owner
  runs, so before any sign-in there is a choice: the hosted instance, or an
  address someone gives you. The desktop app solves this with a saved list of
  servers; the phone needs the same idea with far less room.
- **Unreliable networks.** Reconnecting, degraded voice and "this did not send"
  are normal states, not edge cases, and deserve real design rather than a
  spinner.
- **One hand, at night, in bed.** The most common posture for the crew. Reach
  matters more than density here, which is the one place the phone is allowed to
  disagree with the desktop.

---

## 6. Screens to design

Ordered by how much they matter. Each needs its empty, loading, error and
offline states, not only its happy path.

1. **Launch and server choice** — the hosted instance or an address you were
   given; what a server's identity looks like (name, icon, who runs it); what
   happens when the address is wrong or the server is unreachable.
2. **Sign in and sign up** — the server is named, and its documents are readable
   before signing in.
3. **Conversation** — the message list, grouping, replies, reactions, pins,
   edits, the day divider, the jump-to-present bar, and the unread boundary.
4. **The composer** — plain text, emoji, GIFs, stickers, and a reply banner.
   Remember there are no file attachments yet.
5. **The list root** — servers, channels within a server, and DMs. On a phone
   these compete for the same screen; the desktop gives them two columns.
6. **In a call** — the single most important screen. Participant tiles,
   speaking indication, who is muted, screen share, spotlight, and the controls:
   mute, deafen, camera, share, hang up. Then the harder parts: what it looks
   like while you read another channel, on the lock screen, and when the network
   degrades.
7. **Joining voice** — the difference between listening and speaking, and the
   moment the microphone goes live, which must be unmistakable.
8. **Search** — its own screen, with filters that are typed as words
   (`from:`, `in:`, `has:`) and results that jump into history.
9. **A person** — profile, status, and the actions you take on someone.
10. **Settings** — account, profile, appearance (themes and accent), voice and
    video, notifications (new), and the server list.
11. **Server settings for the host** — roles, permissions, channels, invites.
    Rarely opened, dense, and currently designed for a wide screen.

---

## 7. The direction: minimalism crossed with spatial UI

This is the part to have a point of view about. What follows is context and
guardrails, not a solution.

### What minimalism has to mean here

Skycord is **dense by nature**: lists of channels, lists of people, a river of
messages, and state that must be readable at a glance (who is talking, who is
muted, what is unread). Minimalism has to come from **hierarchy and restraint**,
not from removing signals:

- Strip chrome — borders, boxes, panels — and let type and spacing do the
  separating. The palette is already six greys apart; that is the instrument.
- Keep exactly one saturated colour on screen, the accent, and spend it on what
  matters right now.
- Do not hide frequent actions behind gestures with no visible trace. The crew
  did not choose this app and will not go looking.
- Unread, mention, muted, live, speaking and offline all have to survive the
  simplification. If a signal disappears, it has to be replaced, not dropped.

### Where spatial thinking earns its place

- **Depth already means something in this product**: recessed inputs, a raised
  composer, a call that floats above the conversation. Make that literal rather
  than inventing a new metaphor.
- **A voice channel is a place you enter**, not a button you press. The strongest
  spatial idea available is the room: entering, being inside, hearing who is
  there, and stepping out.
- **The stack is already physical.** The list-to-conversation swipe tracks the
  finger continuously. Extend that rather than replacing it: momentum,
  interruptibility, and a gesture that can be abandoned halfway.
- **Sheets for the transient**, planes for the persistent. A call is not a sheet;
  it is a surface that stays.
- Continuity between states — an avatar that becomes a profile, a channel row
  that becomes a conversation — is where depth stops being decoration.

### Guardrails

- **Battery and cheap phones.** Heavy blur, glass and always-on parallax
  contradict a product whose whole premise is old hardware. Depth should come
  from colour, shadow and motion that stops.
- **Long sessions.** Anything that animates every time you switch a channel will
  be seen hundreds of times a day. Repeated actions get less motion, not more.
- **Reduced motion must still carry the model.** If depth is only legible while
  something moves, it is not legible.
- **Never let spatial polish blur a state.** Especially the microphone.
- **Both themes.** Light is not an afterthought: five themes ship, and a
  user-generated palette can replace every value.
- **The accent is not fixed.** Components must survive a palette they have never
  seen, including a light accent that forces dark text.

---

## 8. What would be most useful back

1. A point of view, in a paragraph, on what the hybrid actually means here.
2. The call screen and the conversation screen, in dark and light.
3. The navigation model: how the stack, the call layer and the server list fit
   in one hand.
4. A motion spec that maps onto the four duration bands above, or a reasoned
   argument for replacing them with springs.
5. The signal set: unread, mention, muted, live, speaking, offline, connecting —
   as a small system rather than per screen.

## 9. Open questions worth an opinion

- Does the server rail survive on a phone, or does switching servers become
  something else entirely?
- Where do notifications settle: per server, per channel, or one global switch
  that people actually understand?
- Is the member list a screen, a sheet, or gone?
- Does the host's server settings belong on a phone at all, or is it honest to
  send them to a bigger screen?
