# Graph Report - .  (2026-07-07)

## Corpus Check
- 102 files · ~67,083 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 544 nodes · 835 edges · 50 communities (49 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.86)
- Token cost: 130,000 input · 6,242 output

## Community Hubs (Navigation)
- [[_COMMUNITY_App Shell & Theme UI|App Shell & Theme UI]]
- [[_COMMUNITY_Server Core & Messages API|Server Core & Messages API]]
- [[_COMMUNITY_Group Conversations Backend|Group Conversations Backend]]
- [[_COMMUNITY_Package Dependencies|Package Dependencies]]
- [[_COMMUNITY_Discord Kit Rebuild Docs|Discord Kit Rebuild Docs]]
- [[_COMMUNITY_Voice Engine (LiveKit)|Voice Engine (LiveKit)]]
- [[_COMMUNITY_Client State Composables|Client State Composables]]
- [[_COMMUNITY_Auth Backend|Auth Backend]]
- [[_COMMUNITY_Client TSConfig|Client TSConfig]]
- [[_COMMUNITY_Client API & Group Modals|Client API & Group Modals]]
- [[_COMMUNITY_Server TSConfig|Server TSConfig]]
- [[_COMMUNITY_Realtime Socket Layer|Realtime Socket Layer]]
- [[_COMMUNITY_VoiceVideo Settings UI|Voice/Video Settings UI]]
- [[_COMMUNITY_Users & Friends Backend|Users & Friends Backend]]
- [[_COMMUNITY_Reply Tree Modal|Reply Tree Modal]]
- [[_COMMUNITY_Dev Dependencies|Dev Dependencies]]
- [[_COMMUNITY_Rich Text Rendering|Rich Text Rendering]]
- [[_COMMUNITY_Stickers Backend|Stickers Backend]]
- [[_COMMUNITY_Themes Backend|Themes Backend]]
- [[_COMMUNITY_In-Call UI|In-Call UI]]
- [[_COMMUNITY_Mute & Participant Sync|Mute & Participant Sync]]
- [[_COMMUNITY_Voice Settings Store|Voice Settings Store]]
- [[_COMMUNITY_Quick Switcher Modal|Quick Switcher Modal]]
- [[_COMMUNITY_Skycord Icon & Brand|Skycord Icon & Brand]]
- [[_COMMUNITY_User Profile Modal|User Profile Modal]]
- [[_COMMUNITY_Slash Commands|Slash Commands]]
- [[_COMMUNITY_Default Avatars|Default Avatars]]
- [[_COMMUNITY_Auth Page|Auth Page]]
- [[_COMMUNITY_Rebuild Progress Ledger|Rebuild Progress Ledger]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 17 edges
2. `getIO()` - 12 edges
3. `tone()` - 12 edges
4. `attemptConnect()` - 12 edges
5. `compilerOptions` - 12 edges
6. `tokens.css Design Token Scales` - 10 edges
7. `updateGroup()` - 9 edges
8. `requireAuth()` - 9 edges
9. `config` - 8 edges
10. `User` - 8 edges

## Surprising Connections (you probably didn't know these)
- `attemptConnect()` --calls--> `getVoiceToken()`  [INFERRED]
  src/composables/useVoice.ts → server/controllers/voiceController.ts
- `Settings Density + Theme Sharing Design Spec` --references--> `tokens.css Design Token Scales`  [EXTRACTED]
  docs/superpowers/specs/2026-06-24-settings-density-theme-sharing-design.md → .superpowers/sdd/task-1-report.md
- `Palette Decision: Kit Anatomy + Modern Token Colors` --rationale_for--> `tokens.css Design Token Scales`  [INFERRED]
  .superpowers/sdd/progress.md → .superpowers/sdd/task-1-report.md
- `Task 1 Report — Token Scales + Gallery Harness (W0)` --references--> `Task 1 Brief — DUserPanel Extraction (W1)`  [AMBIGUOUS]
  .superpowers/sdd/task-1-report.md → .superpowers/sdd/task-1-brief.md
- `getGroupMessages()` --calls--> `resolveMessages()`  [EXTRACTED]
  server/controllers/conversationsController.ts → server/controllers/messagesController.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **W0 Foundation UI Primitive Kit** — styles_tokens, views_uigallery, ui_dbutton, ui_davatar, ui_dinput, ui_dtextarea, ui_dtooltip [EXTRACTED 1.00]
- **W1 Shell Components Extracted from ChatApp** — views_chatapp, shell_duserpanel, shell_dserverrail, shell_dtitlebar, shell_dchannelrow, shell_dcategoryheader, shell_dconversationrow [EXTRACTED 1.00]
- **LiveKit Voice Call Flow (Phase 1 Audio)** — composables_usevoice, specs_2026_06_24_voice_calls_livekit_design_voice_token_endpoint, specs_2026_06_24_voice_calls_livekit_design_livekit_server, sockets_chatsocket, voice_callbar, voice_voiceconnectedpanel [EXTRACTED 1.00]

## Communities (50 total, 1 thin omitted)

### Community 0 - "App Shell & Theme UI"
Cohesion: 0.06
Nodes (39): displayContent, EMOJI_ONLY_RE, hasEveryone, inviteCode, buildSchemeTokens(), CTORS, SCHEME_TOKEN_KEYS, SchemeName (+31 more)

### Community 1 - "Server Core & Messages API"
Cohesion: 0.07
Nodes (31): connectDB(), config, deleteMessage(), dmConvId(), editMessageContent(), getDMMessages(), ReplyPreview, resolveMessages() (+23 more)

### Community 2 - "Group Conversations Backend"
Cohesion: 0.14
Nodes (27): actorNameOf(), addGroupMembers(), createGroup(), createGroupInvite(), getGroupMembers(), getGroupMessages(), getInvite(), getMyConversations() (+19 more)

### Community 3 - "Package Dependencies"
Cohesion: 0.06
Nodes (30): dependencies, bcrypt, cookie-parser, cors, dotenv, express, express-rate-limit, helmet (+22 more)

### Community 4 - "Discord Kit Rebuild Docs"
Cohesion: 0.11
Nodes (28): A11y Focus-Visible Outline Standard, Palette Decision: Kit Anatomy + Modern Token Colors, Sizing Decision: Scale Kit Geometry to Real Discord Sizes, W1 Shell Extraction (Extract-via-Props), Task 1 Brief — DUserPanel Extraction (W1), Task 1 Report — Token Scales + Gallery Harness (W0), Task 2 Brief — DButton, Task 2 Report — DButton Implementation (+20 more)

### Community 5 - "Voice Engine (LiveKit)"
Cohesion: 0.10
Nodes (23): emitCallJoin(), emitCallLeave(), soundCallLeave(), applyAudioEl(), attachTrack(), attemptConnect(), audioEls, bindPtt() (+15 more)

### Community 6 - "Client State Composables"
Cohesion: 0.09
Nodes (21): dmMessages, groupMessages, serverMessages, activeModal, ModalData, ModalType, Channel, DM (+13 more)

### Community 7 - "Auth Backend"
Cohesion: 0.17
Nodes (20): login(), logout(), me(), refresh(), register(), Request, requireAuth(), refreshLimit (+12 more)

### Community 8 - "Client TSConfig"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+12 more)

### Community 9 - "Client API & Group Modals"
Cohesion: 0.13
Nodes (15): ApiMessage, ApiUser, PendingRequest, useApi(), accessToken, authFetch(), initialized, loading (+7 more)

### Community 10 - "Server TSConfig"
Cohesion: 0.11
Nodes (18): compilerOptions, declaration, esModuleInterop, lib, module, outDir, resolveJsonModule, rootDir (+10 more)

### Community 11 - "Realtime Socket Layer"
Cohesion: 0.17
Nodes (13): activeCalls, CB, connected, getCtx(), _h, soundCallJoin(), soundMessage(), soundNotification() (+5 more)

### Community 12 - "Voice/Video Settings UI"
Cohesion: 0.16
Nodes (12): cameras, camTesting, capturingPtt, micLevel, micTesting, onReset(), refreshDevices(), speakers (+4 more)

### Community 13 - "Users & Friends Backend"
Cohesion: 0.23
Nodes (12): acceptFriendRequest(), changeEmail(), changePassword(), changeUsername(), getFriends(), getPendingRequests(), searchUsers(), sendFriendRequest() (+4 more)

### Community 14 - "Reply Tree Modal"
Cohesion: 0.15
Nodes (8): closeCtx(), ctxCopy(), ctxJump(), maxCol, maxRow, svgH, svgW, zoom

### Community 15 - "Dev Dependencies"
Cohesion: 0.13
Nodes (15): devDependencies, concurrently, nodemon, ts-node, @types/bcrypt, @types/cookie-parser, @types/cors, @types/express (+7 more)

### Community 16 - "Rich Text Rendering"
Cohesion: 0.21
Nodes (9): EMOJI_CDN, EMOJI_RE, emojify(), escapeHtml(), formatTimeToken(), relative(), renderMessage(), S (+1 more)

### Community 17 - "Stickers Backend"
Cohesion: 0.27
Nodes (8): createSticker(), deleteSticker(), getStickers(), toggleStarSticker(), IStickerDocument, Sticker, StickerSchema, router

### Community 18 - "Themes Backend"
Cohesion: 0.29
Nodes (8): createTheme(), getTheme(), sanitize(), THEME_FIELDS, generateThemeSlug(), ITheme, Theme, ThemeSchema

### Community 19 - "In-Call UI"
Cohesion: 0.18
Nodes (8): Voice Calls via LiveKit Design Spec, avatarById, callActive, connectingHere, inCall, others, showOngoing, visible

### Community 20 - "Mute & Participant Sync"
Cohesion: 0.29
Nodes (8): soundDeafen(), soundMute(), soundUndeafen(), soundUnmute(), syncParticipants(), toggleDeafen(), toggleMute(), micCaptureOptions()

### Community 21 - "Voice Settings Store"
Cohesion: 0.29
Nodes (5): DEFAULTS, InputMode, resetVoiceSettings(), setVoiceSettings(), VoiceSettings

### Community 22 - "Quick Switcher Modal"
Cohesion: 0.25
Nodes (6): filteredDMs, filteredGroups, loading, query, { searchUsers }, string

### Community 23 - "Skycord Icon & Brand"
Cohesion: 0.36
Nodes (8): 256x256 Icon Canvas (transparent background), Discord Blurple Palette (#5865f2), Discord Visual Brand Language, Twin Eye Dots (filled circles r=12), Mascot Face Motif (eared head with two dot eyes), Rounded Outline Stroke Style (16px, round caps/joins), Skycord Application (Discord-like chat app), Skycord App Icon (SVG)

### Community 24 - "User Profile Modal"
Cohesion: 0.29
Nodes (6): avatar, discriminator, status, string, userId, username

### Community 25 - "Slash Commands"
Cohesion: 0.33
Nodes (3): EIGHT_BALL, SlashCommand, slashCommands

### Community 26 - "Default Avatars"
Cohesion: 0.60
Nodes (4): AVATAR_PALETTE, avatarFor(), colorForUsername(), defaultAvatar()

### Community 28 - "Auth Page"
Cohesion: 0.67
Nodes (3): clearAll(), map, submitLogin()

## Ambiguous Edges - Review These
- `Task 1 Brief — DUserPanel Extraction (W1)` → `Task 1 Report — Token Scales + Gallery Harness (W0)`  [AMBIGUOUS]
  .superpowers/sdd/task-1-report.md · relation: references

## Knowledge Gaps
- **198 isolated node(s):** `name`, `version`, `description`, `dev`, `dev:client` (+193 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Task 1 Brief — DUserPanel Extraction (W1)` and `Task 1 Report — Token Scales + Gallery Harness (W0)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `Theme Sharing (Code + Link, Preview/Revert)` connect `App Shell & Theme UI` to `Client API & Group Modals`, `Themes Backend`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **Why does `DUserPanel Shell Component` connect `Discord Kit Rebuild Docs` to `Voice Engine (LiveKit)`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `User` connect `Server Core & Messages API` to `Group Conversations Backend`, `Themes Backend`, `Users & Friends Backend`, `Auth Backend`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _200 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App Shell & Theme UI` be split into smaller, more focused modules?**
  _Cohesion score 0.055152394775036286 - nodes in this community are weakly interconnected._
- **Should `Server Core & Messages API` be split into smaller, more focused modules?**
  _Cohesion score 0.07312925170068027 - nodes in this community are weakly interconnected._