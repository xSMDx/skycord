# Graph Report - sykord  (2026-06-26)

## Corpus Check
- 99 files · ~66,355 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 624 nodes · 824 edges · 68 communities (64 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `515e6b08`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 17 edges
2. `Discord Kit Rebuild — W0 Foundation — Progress Ledger` - 15 edges
3. `getIO()` - 12 edges
4. `tone()` - 12 edges
5. `compilerOptions` - 12 edges
6. `Task 2: DButton Implementation Report` - 10 edges
7. `requireAuth()` - 9 edges
8. `Status: DONE` - 9 edges
9. `Status: DONE` - 9 edges
10. `Settings polish (Text Readability + Visual Density + subnav) & Theme Sharing` - 9 edges

## Surprising Connections (you probably didn't know these)
- `getGroupMessages()` --calls--> `resolveMessages()`  [EXTRACTED]
  server/controllers/conversationsController.ts → server/controllers/messagesController.ts
- `useSocket()` --calls--> `useAuth()`  [EXTRACTED]
  src/composables/useSocket.ts → src/composables/useAuth.ts
- `start()` --calls--> `createApp()`  [EXTRACTED]
  server/index.ts → server/app.ts
- `start()` --calls--> `connectDB()`  [EXTRACTED]
  server/index.ts → server/config/database.ts
- `register()` --calls--> `setRefreshCookie()`  [EXTRACTED]
  server/controllers/authController.ts → server/utils/cookie.ts

## Import Cycles
- None detected.

## Communities (68 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (37): connectDB(), config, deleteMessage(), dmConvId(), editMessageContent(), getDMMessages(), ReplyPreview, resolveMessages() (+29 more)

### Community 1 - "Community 1"
Cohesion: 0.12
Nodes (32): actorNameOf(), addGroupMembers(), createGroup(), createGroupInvite(), getGroupMembers(), getGroupMessages(), getInvite(), getMyConversations() (+24 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (31): buildSchemeTokens(), CTORS, SCHEME_TOKEN_KEYS, SchemeName, ACCENT_PRESETS, Appearance, applyAppearance(), b64urlDecode() (+23 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (21): dmMessages, groupMessages, serverMessages, activeModal, ModalData, ModalType, Channel, DM (+13 more)

### Community 4 - "Community 4"
Cohesion: 0.17
Nodes (20): login(), logout(), me(), refresh(), register(), Request, requireAuth(), refreshLimit (+12 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (25): description, devDependencies, concurrently, nodemon, ts-node, @types/bcrypt, @types/cookie-parser, @types/cors (+17 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (19): activeCalls, CB, connected, emitCallJoin(), getCtx(), _h, soundCallJoin(), soundCallLeave() (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+12 more)

### Community 8 - "Community 8"
Cohesion: 0.10
Nodes (20): dependencies, bcrypt, cookie-parser, cors, dotenv, express, express-rate-limit, helmet (+12 more)

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (11): emitCallLeave(), applyAudioEl(), attachTrack(), audioEls, cleanup(), ConnectStage, unbindPtt(), voice (+3 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (18): compilerOptions, declaration, esModuleInterop, lib, module, outDir, resolveJsonModule, rootDir (+10 more)

### Community 11 - "Community 11"
Cohesion: 0.16
Nodes (12): cameras, camTesting, capturingPtt, micLevel, micTesting, onReset(), refreshDevices(), speakers (+4 more)

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (15): Decisions (apply to all waves), Discord Kit Rebuild — W0 Foundation — Progress Ledger, Minor findings (for final review), NEXT: kit-fidelity VISUAL pass (the "rebuild" proper) — per-component Figma fetches + restyle. Best in a fresh session. W2 messages next per roadmap., PENDING USER VERIFY: voice smoke (mic/deafen in DUserPanel, call btn in DTitleBar) on localhost:5174., Tasks, Tracked improvements (triage at final review / future polish), W0 COMPLETE (+7 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (15): 1. DTooltip Component (`src/components/ui/DTooltip.vue`), 2. UiGallery.vue Updates, 3. Tasks 1–4 Content Preserved, Build result, Build Status, Code Quality Checks, Commit, Completion Summary (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (15): Backend, `composables/useVoice.ts` (singleton), `composables/useVoiceSettings.ts` (localStorage), Context, Dependencies, Env (server/.env), Frontend, Out of scope (Phase 2) (+7 more)

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (8): closeCtx(), ctxCopy(), ctxJump(), maxCol, maxRow, svgH, svgW, zoom

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (14): Build Verification, Code Quality Checklist, Commit, Component Structure (DButton.vue), Deliverables, Files Changed, Files Created, Files Modified (+6 more)

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (12): Context, Data model — `useAppearance.ts`, Files, Out of scope, Phase A — Settings sections + generalized subnav (client-only), Phase B — Theme share core (client-only), Phase C — Theme share reach (backend + chat), Settings polish (Text Readability + Visual Density + subnav) & Theme Sharing (+4 more)

### Community 18 - "Community 18"
Cohesion: 0.26
Nodes (9): createTheme(), getTheme(), sanitize(), THEME_FIELDS, generateThemeSlug(), ITheme, Theme, ThemeSchema (+1 more)

### Community 19 - "Community 19"
Cohesion: 0.17
Nodes (11): App.vue toggle adaptation, Build Output, Commit, Figma Confirmation, Files Changed, Implementation Notes, Self-Review, Status: DONE (+3 more)

### Community 20 - "Community 20"
Cohesion: 0.17
Nodes (11): Backend changes, Design, Edit Group modal (`EditGroupModal.vue`, new), Frontend changes, Group chat — normal chat + member panel, Group DM Rework — Design Spec, Invite to Group DM modal (`InviteGroupModal.vue`, new), Out of scope (+3 more)

### Community 21 - "Community 21"
Cohesion: 0.21
Nodes (9): EMOJI_CDN, EMOJI_RE, emojify(), escapeHtml(), formatTimeToken(), relative(), renderMessage(), S (+1 more)

### Community 22 - "Community 22"
Cohesion: 0.27
Nodes (8): createSticker(), deleteSticker(), getStickers(), toggleStarSticker(), IStickerDocument, Sticker, StickerSchema, router

### Community 23 - "Community 23"
Cohesion: 0.18
Nodes (10): Build Verification, Commit, Compliance Checklist, Files Created, Files Modified, Implementation Details, Notes, Status: DONE (+2 more)

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (10): Build Verification, Commit, Completion Summary, Files Created, Files Modified, Implementation Details, Notes, Self-Review (+2 more)

### Community 25 - "Community 25"
Cohesion: 0.28
Nodes (8): accessToken, authFetch(), initialized, loading, PublicUser, scheduleRefresh(), silentRefresh(), user

### Community 26 - "Community 26"
Cohesion: 0.25
Nodes (6): DEFAULTS, InputMode, micCaptureOptions(), resetVoiceSettings(), setVoiceSettings(), VoiceSettings

### Community 27 - "Community 27"
Cohesion: 0.22
Nodes (7): avatarById, callActive, connectingHere, inCall, others, showOngoing, visible

### Community 28 - "Community 28"
Cohesion: 0.25
Nodes (4): displayContent, EMOJI_ONLY_RE, hasEveryone, inviteCode

### Community 29 - "Community 29"
Cohesion: 0.29
Nodes (7): ApiMessage, ApiUser, PendingRequest, useApi(), useAuth(), useSocket(), useVoice()

### Community 30 - "Community 30"
Cohesion: 0.25
Nodes (6): filteredDMs, filteredGroups, loading, query, { searchUsers }, string

### Community 31 - "Community 31"
Cohesion: 0.29
Nodes (6): avatar, discriminator, status, string, userId, username

### Community 32 - "Community 32"
Cohesion: 0.33
Nodes (3): EIGHT_BALL, SlashCommand, slashCommands

### Community 33 - "Community 33"
Cohesion: 0.60
Nodes (4): AVATAR_PALETTE, avatarFor(), colorForUsername(), defaultAvatar()

### Community 35 - "Community 35"
Cohesion: 0.50
Nodes (3): Notes for later waves (not part of this plan), Self-Review, Task 5: DTooltip

### Community 36 - "Community 36"
Cohesion: 0.67
Nodes (3): clearAll(), map, submitLogin()

## Knowledge Gaps
- **291 isolated node(s):** `name`, `version`, `description`, `dev`, `dev:client` (+286 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `User` connect `Community 0` to `Community 1`, `Community 18`, `Community 4`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Community 8` to `Community 5`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _291 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06265664160401002 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.12375533428165007 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08108108108108109 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.08994708994708994 - nodes in this community are weakly interconnected._