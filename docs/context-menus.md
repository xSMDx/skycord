# Context Menu Inventory

Living map of every right-clickable surface in Skycord: what has a menu, what
doesn't, and what each one should offer. Built piece by piece — update the
Status column as menus land.

Audited 2026-07-19 against `video-screenshare` @ `9ee6cbf`.

**Status key**
`DONE` real right-click menu · `BUTTON` menu exists but only opens from a click
target, right-click does nothing · `NONE` no menu · `PARTIAL` menu exists but
incomplete or partly dead

---

## Ground truth

The entire `src/` tree contains **six** `@contextmenu` handlers. Everything not
listed under "Existing" below has no right-click behaviour at all — the browser's
native menu appears instead.

Two things to settle before building:

**1. Nested targets fall through.** The handler sits on the whole message row
(`MessageItem.vue:126`), so right-clicking the avatar, the username, a reaction,
a link or an image all open the *message* menu. Per-target menus need `.stop`
handlers on the children, and a decision per target: does it get its own menu, or
deliberately inherit the parent's?

**2. There are two menu implementations already.** `chat/ContextMenu.vue` and a
separate inline copy inside `ReplyTreeModal.vue`. The generic primitive should
absorb both rather than becoming a third.

---

## Existing

| Surface | Target | Status | Where |
|---|---|---|---|
| Message list | Message row | `PARTIAL` | `MessageItem.vue:126` → `chat/ContextMenu.vue` |
| Reply-tree modal | Message node | `DONE` | `ReplyTreeModal.vue:179` (own inline menu — duplicate) |
| Message input | Text selection | `DONE` | `MessageInput.vue:39` — formatting toolbar, only with a selection; falls through to native menu otherwise |
| Left sidebar | DM conversation | `BUTTON` | `ChatApp.vue:1471` `.dm-x` → Close DM / Delete Conversation |
| Left sidebar | Group conversation | `BUTTON` | `ChatApp.vue:1491` `.dm-x` → Hide Group / Leave Group |

**Message menu is `PARTIAL`** — `Mark as Unread` (`ContextMenu.vue:70`) only emits
`close`. It's a dead row that looks functional. Either wire it or drop it.

**Both sidebar menus are `BUTTON`** — right-clicking a conversation does nothing
today, which is the single most expected right-click in a Discord-like app.

---

## To build

### Call surface — already specced (P3)
| Target | Status | Notes |
|---|---|---|
| Other participant tile | `NONE` | Profile · Message · Start Call · User Volume · Mute (local) · Disable Video (local) · Add Friend · Copy ID. **Block has no backend** — leave out. |
| Own tile / avatar | `NONE` | Profile · Preview Camera · Mute · Deafen · Show Non-Video ✓ · Show Own Camera ✓ · Copy ID |
| Own screen-share tile | `NONE` | Stop Sharing · Change Stream · Stream Quality ▸ · Share Stream Audio ✓ · Pop Out (deferred) |
| Call bar buttons (mic/cam/share/leave) | `NONE` | Mic/cam already have ▾ flyouts — decide whether right-click duplicates them |

Per-user local mute/volume/disable-video is **new client state** — `useVoice` has
none. Audio elements live in the `audioEls` map: volume = `el.volume`, local mute
= `el.muted`, disable video = filter in `CallStage`.

### Message area
| Target | Status | Notes |
|---|---|---|
| Author avatar | `NONE` | Currently inherits message menu. Wants user menu. |
| Author username | `NONE` | Same as avatar. |
| Reaction pill | `NONE` | Who reacted · remove own · copy emoji |
| Link in message text | `NONE` | Copy link · open in new tab |
| Image / GIF / attachment | `NONE` | Save · copy · copy link · open original |
| System message (call log, rename) | `NONE` | Decide: any menu at all? |
| Date divider | `NONE` | Probably intentionally none |

### Sidebars & rails
| Target | Status | Notes |
|---|---|---|
| DM / group conversation (right-click) | `BUTTON` | Promote the existing `.dm-x` menu to right-click; likely extend with Mark as Read, Mute, Profile |
| Server rail — server icon | `NONE` | |
| Server rail — Home button | `NONE` | |
| Channel sidebar — channel | `NONE` | Blocked on channels existing |
| Channel sidebar — category header | `NONE` | Blocked on channels existing |
| Members panel — member row | `NONE` | `ChatApp.vue:1876` (server) / `:1886` (group DM). Click opens profile; right-click should give the user menu. |
| Members panel — section label | `NONE` | Probably none |

### User panel (bottom-left)
| Target | Status | Notes |
|---|---|---|
| Own avatar / name | `NONE` | Set status · copy ID · profile |
| Mic button | `NONE` | Device picker (chevron is `disabled`, "coming soon") |
| Headphones button | `NONE` | Output picker (same) |
| Settings button | `NONE` | Jump to a settings section |

### Friends view
| Target | Status | Notes |
|---|---|---|
| Friend row | `NONE` | `ChatApp.vue:1640` `.f-row` |
| Pending request row | `NONE` | `ChatApp.vue:1667` |
| Active Now entry | `NONE` | `ChatApp.vue:1689` |

### Chat header
| Target | Status | Notes |
|---|---|---|
| Conversation title / icon | `NONE` | |
| Call / video buttons | `NONE` | |
| Pinned / search buttons | `NONE` | |

### Modals & cards
| Target | Status | Notes |
|---|---|---|
| Pinned-messages entry | `NONE` | Jump to message · unpin |
| GIF / emoji / sticker picker item | `NONE` | Favourite · copy link |
| Theme card in chat | `NONE` | Apply · copy · save |
| Group invite card | `NONE` | Copy invite · revoke |
| User profile modal | `NONE` | |

---

## Open questions for the user

1. **Right-click on a message avatar/username** — user menu, or keep the message
   menu? (Discord gives the user menu.)
2. **Suppress the native browser menu everywhere**, or only where we provide our
   own? Blanket suppression breaks Inspect Element and native text actions.
3. **Touch/long-press** — same menus on mobile, or defer?
4. `Mark as Unread` — wire it up or remove it?
