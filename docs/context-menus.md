# Context Menu Inventory

Living map of every right-clickable surface in Skycord: what has a menu, what
doesn't, and what each one should offer.

Audited **2026-08-08** against `main` @ `38766ea`.

**Status key**
`DONE` real right-click menu · `PARTIAL` menu exists but incomplete or on the
old implementation · `NONE` no menu, nothing happens on right-click

---

## Summary

43 surfaces audited.

| | Shell | Friends | Chat | Call | Profile | Modals | **Total** |
|---|---|---|---|---|---|---|---|
| **Has a menu** | 4 | 3 | 5 | 4 | 0 | 0 | **16** |
| **No menu** | 5 | 3 | 8 | 3 | 4 | 4 | **27** |

Profile surfaces and modals have zero right-click coverage — those are the two
whole areas still untouched.

Native browser menu is suppressed app-wide (`main.ts:26`), except inside text
inputs and over a live text selection — right-click is how people copy. So a
`NONE` surface right-clicks into *nothing at all*, not into the browser menu.

---

## 1. App shell

| Part | Status | Menu | Where |
|---|---|---|---|
| Conversation row — DM | `DONE` | Profile · Start a Call · **Pin** · **Mute ▸** (15m/1h/3h/8h/24h/Until I turn it back on) · Copy User ID · Copy Channel ID · Close DM · Delete Conversation | `ChatApp.vue:1643` → `conversationMenu.ts:64` |
| Conversation row — group | `DONE` | Invites · Edit Group · **Pin** · **Mute ▸** · Copy Channel ID · Hide Group · Leave Group | `ChatApp.vue:1666` → `conversationMenu.ts:83` |
| User panel — mic button | `DONE` | Opens the input-device flyout (upward) | `ChatApp.vue:1698,1762` |
| User panel — headphones button | `DONE` | Opens the output-device flyout (upward) | `ChatApp.vue:1706,1770` |
| Server rail (`.rail`) | `NONE` | — | `ChatApp.vue:1592` |
| Sidebar nav items (Friends / Shop / …) | `NONE` | — | `ChatApp.vue:1626` |
| User panel — own avatar / name | `NONE` | Should be: Profile · Set Status ▸ · Copy User ID | `ChatApp.vue` user panel |
| User panel — settings cog | `NONE` | — | |
| DM list section header (`+` add) | `NONE` | — | |

## 2. Home / Friends page

| Part | Status | Menu | Where |
|---|---|---|---|
| Friend row (Online / All) | `DONE` | Profile · Message · Call · Copy User ID | `ChatApp.vue:1835` → `userMenu.ts:38` |
| Pending request row | `DONE` | same user menu | `ChatApp.vue:1862` |
| Active Now entry | `DONE` | same user menu | `ChatApp.vue:1892` |
| Friends tab bar (Online/All/Pending/Blocked) | `NONE` | — | |
| Search field | `NONE` | native (input) | |
| "Add friends" button | `NONE` | — | |

**Known gap in the user menu:** no *Remove Friend* or *Block*.

*Block* has no backend — `Friendship.status` has `blocked` in the enum but
nothing writes or reads it. *Remove Friend* is only missing: the route exists
(`DELETE /users/friends/:userId`) and `callMenu` already offers it, so this menu
should too, behind a confirm step.

## 3. Chat — DM & group

| Part | Status | Menu | Where |
|---|---|---|---|
| Message row | `PARTIAL` | Quick reactions (👍❤️😂😮😢 + more) · Add Reaction · Reply · View Reply Chain · Edit Message · Copy Text · **Pin/Unpin Message** · Mark as Unread · Copy Message ID · Delete Message | `MessageItem.vue:126` → `chat/ContextMenu.vue` |
| System / call-log row | `DONE` | same menu, shares the handler | `MessageItem.vue:116` |
| Message input, with selection | `DONE` | Formatting toolbar (bold/italic/etc.), not a menu | `MessageInput.vue:39` |
| Reply-tree node | `DONE` | own inline copy of the message menu | `ReplyTreeModal.vue` |
| Members panel — member row | `DONE` | Profile · Message · Call · Copy User ID | `ChatApp.vue:2075,2087` |
| Message **avatar** | `NONE` | falls through to the message menu | |
| Message **username** | `NONE` | falls through to the message menu | |
| Message **reaction pill** | `NONE` | should be: see who reacted · remove | |
| Message **image / attachment** | `NONE` | should be: Copy Image · Save Image · Open Original | |
| Message **link** | `NONE` | should be: Copy Link · Open | |
| Chat header (name / call buttons) | `NONE` | — | |
| Pinned-messages panel row | `NONE` | should be: Jump · Unpin | |
| Members panel section headers | `NONE` | — | |

**Two things still outstanding here.**

1. *Message row is `PARTIAL`* — it's the only surface still on the old bespoke
   `chat/ContextMenu.vue` rather than the generic `ui/ContextMenu.vue` +
   builder registry. `ReplyTreeModal` carries yet another copy. That's three
   implementations where there should be one. **Mark as Unread is a dead row —
   it closes the menu and does nothing.** *Copy Message Link* is also missing,
   and blocked on deep links (task #50).

2. *Nested targets fall through.* The handler sits on the whole row, so
   right-clicking the avatar, username, a reaction, a link or an image all open
   the *message* menu. Per-target menus need `.stop` handlers on the children.

## 4. Call bar & call stage

| Part | Status | Menu | Where |
|---|---|---|---|
| Own tile | `DONE` | Profile · Preview Camera · Mute ✓ · Deafen ✓ · Voice Settings · Show Non-Video Participants ✓ · Show My Own Camera ✓ · Copy User ID · Copy Channel ID | `CallStage.vue` → `callMenu.ts:53` |
| Participant tile | `DONE` | Profile · **User Volume slider (0–200)** · Mute ✓ · Disable Video ✓ · Show Non-Video Participants ✓ · Copy User ID · Copy Channel ID · Remove Friend | `CallStage.vue` → `callMenu.ts:75` |
| Call bar mic button | `DONE` | Opens the mic flyout | `CallBar.vue` |
| Call bar camera button | `DONE` | Opens the camera flyout | `CallBar.vue` |
| Screen-share tile | `NONE` | should be: Fullscreen · Pop Out · Stop Watching | |
| Call bar — screen-share button | `NONE` | should open the share-picker flyout | |
| Call bar — disconnect / more | `NONE` | — | |

## 5. Profile surfaces

| Part | Status | Menu | Where |
|---|---|---|---|
| Profile popout (self or other) | `NONE` | has a `⋯` button menu; right-click does nothing | `ProfilePopout.vue` |
| Full profile modal | `NONE` | has a `⋯` button menu; right-click does nothing | `UserProfileModal.vue` |
| Profile card banner / avatar | `NONE` | should be: Copy Image · Change Banner (self) | `ProfileCard.vue` |
| Mutual friends row | `NONE` | should be the standard user menu | `UserProfileModal.vue` |

## 6. Modals & pickers

| Part | Status | Menu | Where |
|---|---|---|---|
| Emoji picker — emoji | `NONE` | — | `EmojiPickerModal.vue` |
| GIF picker — GIF | `NONE` | should be: Copy GIF Link | `GifPickerModal.vue` |
| Settings — any row | `NONE` | — | `SettingsModal.vue` |
| Invites modal — invite row | `NONE` | should be: Copy Link · Revoke | |

---

## Implementation notes

Menus are **data, not markup**. A surface costs one `@contextmenu` handler and
one builder call:

```
ui/ContextMenu.vue          the only renderer (teleported, click-away, clamped)
useContextMenu.ts           open/close + a shallowRef *builder*, so items
                            re-evaluate on every render — a snapshotted array
                            froze checkmarks mid-menu
contextMenus/userMenu.ts    one person, everywhere a person appears
contextMenus/conversationMenu.ts   DM + group rows
contextMenus/callMenu.ts    own tile + participant tile
```

Item kinds: action · separator · **slider** (user volume) · **submenu** (mute
durations) · `check` for toggles · `keepOpen` so toggling doesn't dismiss.

**Next, in order:**
1. Migrate the message menu onto the registry, killing `chat/ContextMenu.vue`
   and the `ReplyTreeModal` copy — 3 implementations → 1.
2. Delete or implement *Mark as Unread*.
3. Nested chat targets: avatar, username, reaction, link, image.
4. Profile surfaces — right-click should give what the `⋯` button gives.
5. *Remove Friend* / *Block* once the backend routes exist.
