# Instance profile — design

**Date:** 2026-09-14, revised 2026-09-19 · **Status:** approved by the owner 2026-09-19, with one addition folded in here: legal pages in the app and a Legal tab of their own in Settings · **Branch:** `instance-profile`

## The problem

Three planned surfaces need to know who runs a Skycord instance, and nothing tells them:

- **Sign-up** says "By registering you agree to our Terms & Privacy Policy", with both links going to `#`. On an instance someone else runs, "our" names no one, and there is nothing to link to. (Audit finding 13; triage: the host supplies the terms.)
- **"About this instance"** in Settings — triaged as *build it*: who runs it, how to reach them, the version.
- **The desktop app's instance picker** (roadmap 5a / 5.2) has to show what a server is before anyone signs in, and has to tell a Skycord server from any other web address.

And a fourth, added by the owner on review:

- **Legal pages.** Every legal document an instance publishes should be readable inside the app, gathered in a **Legal** tab of its own in Settings rather than mixed into About this instance. One of them no host can leave out: Skycord is licensed under the **GNU AGPL v3**, whose §13 requires every instance to offer its users the source code of the software they are using.

Today the client can learn only two things about an instance: `/health`, and whether it can send mail (`/auth/reset-available`).

## Decisions

### Owner, 2026-09-14

| Question | Decision |
|---|---|
| One profile for all three surfaces, or separate? | **One public profile**, read by sign-up, Settings and the desktop picker. |
| Where does a host set it? | **Installer questions and `.env`**, changeable later with `sudo skycord config`. No in-app editor — there is no instance-admin role for one to check. |
| Terms and privacy: link or document? | **Either:** a URL, or a Markdown file the instance serves. |
| Extra fields | **An icon.** No hosting location, no sign-up status. |
| Sign-up wording | **Name the instance:** "…agree to Sky Den's Terms and Privacy Policy." |
| About page placement | **Its own row at the bottom of the Settings nav, above Log Out.** |
| Terms documents | **Rendered Markdown**, raw HTML never rendered, renderer loaded only when a document opens. |

### Owner, 2026-09-19

| Question | Decision |
|---|---|
| Legal pages | **All of an instance's legal documents are readable in the app**, in a **Legal** tab in Settings that keeps them separate from About this instance. |

### Set in this revision (open to the owner's veto)

| Question | Decision | Why |
|---|---|---|
| Which documents? | **Six known kinds, each optional:** Terms of Service, Privacy Policy, Community Guidelines, Cookie Policy, Copyright & Takedowns, Imprint. Each is a link or a Markdown file, exactly as terms and privacy already were. | A fixed list gives every instance the same titles in the same order and stable addresses, and lets sign-up name Terms and Privacy specifically. A free-form list would put page titles in hosts' hands and make "which one is the privacy policy" a guess. |
| Pages the app provides itself | **Two, on every instance:** "Licence & source code" (the AGPL notice, the licence text, and a link to the source of the running version) and "Open-source licences" (the third-party packages bundled into the app, with their licences). | The first is a legal duty the software carries wherever it runs, not a host's choice. The second is owed to the authors of what the app ships, and the desktop app will need it anyway. Neither is legal text written on a host's behalf. |
| Where is the source? | **`SOURCE_URL`, defaulting to the upstream repository at the running version** — `https://github.com/xSMDx/skycord/tree/v<version>`, or the repository itself on a development build. | A host who modifies Skycord must offer *their* source (AGPL §13), so they need a way to point elsewhere; everyone else is covered by the default without doing anything. |
| Before sign-in | **A quiet line of links under the sign-in card** naming every document the instance publishes, on both the sign-in and the register view. | An imprint, where one is required, must be reachable from every page, including before anyone signs in. The consent sentence covers only Terms and Privacy. |
| About this instance | **Keeps who, contact, version and address.** Its Terms and Privacy rows move to Legal. | That is the separation the owner asked for. |
| Reading a document in Settings | **Inside the Settings pane**, as a sub-page with a way back, not a modal opened over the Settings modal. | Settings is already a full-screen surface (and a drill-down on phones); a second modal on top of it breaks both. |

## Out of scope

- The desktop picker's UI. This spec only guarantees what it will read.
- Editing the profile inside the app, sign-up status (open/invite-only/closed), where an instance is hosted.
- The hosted instance's own values. Its owner sets them at the containerised cutover, pointing terms at skycord.xyz's (the repository's ToS draft says it applies to skycord.xyz only).
- **Asking members to accept changed terms again.** A document shows "Last updated" when the server knows the date; a re-consent prompt is later work.
- **Stand-alone public web pages** for each document. The client has no router, and a host who needs a public privacy address for an app store can publish their policy as a link.
- Translating document titles.

---

## 1. What a host sets

### Environment variables

All optional. Each is added to `.env.example` with a comment, and passed through `deploy/compose.yaml`'s explicit `environment:` list for the `skycord` service — compose does not forward `.env` values it is not told about.

| Variable | Meaning | Limit | If invalid |
|---|---|---|---|
| `INSTANCE_NAME` | The instance's name, shown to people who join | 64 characters | Truncated, startup warning |
| `INSTANCE_DESCRIPTION` | A sentence or two about it | 300 characters | Truncated, startup warning |
| `INSTANCE_OPERATOR` | Who runs it: a person or organisation people will recognise | 100 characters | Truncated, startup warning |
| `INSTANCE_CONTACT` | How to reach them: an email address, a web link, or any short text | 200 characters | Truncated, startup warning |
| `TERMS_URL` | The terms of service, as a link | `https:` or `http:` only | Ignored, startup warning |
| `PRIVACY_URL` | The privacy policy, as a link | `https:` or `http:` only | Ignored, startup warning |
| `GUIDELINES_URL` | The community guidelines, as a link | `https:` or `http:` only | Ignored, startup warning |
| `COOKIES_URL` | The cookie policy, as a link | `https:` or `http:` only | Ignored, startup warning |
| `COPYRIGHT_URL` | The copyright and takedown policy, as a link | `https:` or `http:` only | Ignored, startup warning |
| `IMPRINT_URL` | The imprint (legal notice), as a link | `https:` or `http:` only | Ignored, startup warning |
| `SOURCE_URL` | Where this instance's source code is | `https:` or `http:` only | Ignored, startup warning; the default applies |
| `INSTANCE_DIR` | Where the files below are read from | — | Default: `instance` under the server's working directory (`/app/instance` in the image) |

Values are trimmed. An empty value is the same as unset.

### Files

In `$SKYCORD_DIR/instance/` (`/opt/skycord/instance/` by default), mounted into the container read-only at `/app/instance` by `compose.yaml`. The installer creates the empty folder.

| File | Meaning | Limit |
|---|---|---|
| `terms.md` | The terms of service, as Markdown | 256 KB, UTF-8 |
| `privacy.md` | The privacy policy, as Markdown | 256 KB, UTF-8 |
| `guidelines.md` | The community guidelines, as Markdown | 256 KB, UTF-8 |
| `cookies.md` | The cookie policy, as Markdown | 256 KB, UTF-8 |
| `copyright.md` | The copyright and takedown policy, as Markdown | 256 KB, UTF-8 |
| `imprint.md` | The imprint, as Markdown | 256 KB, UTF-8 |
| `icon.png`, `icon.webp`, `icon.jpg` | The instance's icon; the first present in that order is used | 512 KB |

No SVG icon: an SVG opened directly runs script in the instance's origin.

A file over its limit is ignored with a warning, as if absent. **A link wins over a file** for the same document, with a startup warning naming both, because a host who set both is most likely mid-migration and the link is the explicit choice.

Files are read when requested and cached in memory for 60 seconds, so replacing `terms.md` takes effect within a minute without a restart. Environment changes take effect through `sudo skycord config`, which already re-applies and restarts.

### Contact

`INSTANCE_CONTACT` is classified once:

- one `@`, no spaces, and a dot after the `@` (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) → `email`, shown as a `mailto:` link;
- parses as an `https:` or `http:` URL → `url`, shown as a link;
- anything else (e.g. "@sky on Matrix") → `text`, shown as plain text.

### The installer

`deploy/install.sh` asks, after its existing optional questions and in the same "Enter to skip" style, and writes answers to `.env`:

```
Name for this instance, shown to people who join (Enter to use the address):
Who runs it — a name people will recognise (Enter to skip):
How people can reach you — an email or a link (Enter to skip):
Link to your terms of service (Enter to skip):
Link to your privacy policy (Enter to skip):
```

Only terms and privacy are asked: they are the two sign-up names, and six document questions would make the installer a form. Non-interactive installs (`--yes`) skip them all. The description, the other four documents, `SOURCE_URL` and the `instance/` files are documented in `docs/self-hosting/installing.md`, with the note that every document can be a Markdown file instead of a link, that `SOURCE_URL` matters only to a host who has changed the code, and that `sudo skycord config` changes the rest later. A value containing a character `.env` needs quoted is written quoted.

---

## 2. What the server offers

### `GET /instance`

Public. No sign-in, no cookies. Readable from any origin: mounted **before** the app's global CORS middleware, with its own policy — `Access-Control-Allow-Origin: *`, no `Access-Control-Allow-Credentials`, `GET` and `HEAD` only. The global policy (one origin, credentials) is unchanged for everything else. `/instance` is added to `API_PREFIXES` in `server/utils/serveClient.ts`, whose parity test enforces it.

Its own rate limit: 120 requests per minute per IP. `Cache-Control: public, max-age=300`.

```json
{
  "software": "skycord",
  "version": "0.20.0",
  "address": "https://chat.example.com",
  "name": "Sky Den",
  "nameIsAddress": false,
  "description": "A server for our study group.",
  "operator": "Sam Doe",
  "contact": { "kind": "email", "value": "sam@example.com" },
  "icon": "/instance/icon",
  "legal": [
    { "kind": "terms",   "source": "url",      "href": "https://example.com/terms" },
    { "kind": "privacy", "source": "document", "href": "/instance/legal/privacy", "updated": "2026-09-02" },
    { "kind": "imprint", "source": "document", "href": "/instance/legal/imprint", "updated": "2026-08-30" }
  ],
  "source": "https://github.com/xSMDx/skycord/tree/v0.20.0"
}
```

- `software` is always `"skycord"`: how the desktop picker tells a Skycord server from any other address.
- `version` is the running version (`SKYCORD_VERSION`, `dev` locally).
- `address` is the public address (`APP_URL`, falling back to `CLIENT_ORIGIN`).
- `name` falls back to the address's host name (`chat.example.com`), with `nameIsAddress: true`.
- `description`, `operator`, `contact` and `icon` are `null` when not set.
- `legal` lists only the documents the instance publishes, always in the fixed order — terms, privacy, guidelines, cookies, copyright, imprint — and is `[]` when there are none. `updated` is the file's last-modified date (`YYYY-MM-DD`) and is present only for documents: a link's date is not the server's to know.
- `source` is `SOURCE_URL` when set; otherwise the upstream repository at the running version's tag, or the repository itself when the version is `dev`. Never `null`: every instance owes its members the source.
- With nothing configured the response still carries `software`, `version`, `address`, `name`, `legal: []` and `source`.

The app's own licence text and the third-party licence list are not in the profile: they are the same on every instance and ship with the app (see §3).

### `GET /instance/icon`, `GET /instance/legal/:kind`

Same public CORS policy and rate limit. The icon is served with the content type of its extension, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=3600`. Documents are served as `text/markdown; charset=utf-8`, `Cache-Control: public, max-age=300`.

`:kind` must be one of the six known kinds, or the answer is `404`. Each kind maps to its one fixed file name; nothing from the request is ever joined into a path. A kind answers `404` when that document is absent or published as a link.

### Where the logic lives

A pure function, `readInstanceProfile(env, files)`, turns environment values and file facts into the profile and a list of warnings. The route is a thin layer over it, and startup logs the warnings once. Keeping the rules in one pure function is what makes every row in the tables above unit-testable without a server. The list of kinds and their order live in `server/utils/legalKinds.ts`. The client cannot import it — `tsconfig.server.json` pins `rootDir` to `server/` — so it keeps a mirror, held equal to the server's by a test, the way `permissionMeta.ts` is held to `server/permissions.ts`. The two cannot disagree about what a kind is called without a test failing.

---

## 3. Where it shows

### The client's view of it

A composable, `useInstance()`, requests `/instance` once per page load through the same request helper the auth page already uses for `/auth/reset-available`, and exposes the profile, a loading state and a failure state. Every surface below shares it, so the page makes one request.

Each kind has one fixed title, used everywhere a document is named:

| Kind | Title |
|---|---|
| `terms` | Terms of Service |
| `privacy` | Privacy Policy |
| `guidelines` | Community Guidelines |
| `cookies` | Cookie Policy |
| `copyright` | Copyright & Takedowns |
| `imprint` | Imprint |

### Sign-up

The sentence under the register form, built from the profile by a pure function, reading the `terms` and `privacy` entries of `legal`:

| Terms | Privacy | Name set | Sentence |
|---|---|---|---|
| ✓ | ✓ | yes | By registering you agree to Sky Den's [Terms] and [Privacy Policy]. |
| ✓ | — | yes | By registering you agree to Sky Den's [Terms]. |
| — | ✓ | yes | By registering you agree to Sky Den's [Privacy Policy]. |
| ✓ | ✓ | no | By registering you agree to the [Terms] and [Privacy Policy] of chat.example.com. |
| ✓ | — | no | By registering you agree to the [Terms] of chat.example.com. |
| — | ✓ | no | By registering you agree to the [Privacy Policy] of chat.example.com. |
| — | — | either | *(no sentence)* |

"Sky Den" stands for the configured name and "chat.example.com" for the address's host name; both are plain text, styled like the rest of the sentence. Brackets mark the links. The sentence keeps the approved short wording, "Terms", where every other surface uses the full title. While the profile is loading, or if it failed to load, there is no sentence: the page must not claim terms it cannot show.

### Under the sign-in card

On both the sign-in and the register view, one quiet line beneath the card lists every document the instance publishes, by title, separated by middots — `Terms of Service · Privacy Policy · Imprint`. It is absent while loading, on failure, and when `legal` is empty. Its text uses `--text-faint`, the quietest token that still clears AA on that ground.

### Opening a document before sign-in

A **link** opens in a new tab (`target="_blank" rel="noopener noreferrer"`). A **document** opens in a modal built on the existing `ModalBase`, titled with the kind's title, with the instance's name and "Last updated" (when known) beneath. The Markdown renderer is imported dynamically when a document opens, never in the main bundle. It renders headings, paragraphs, lists, emphasis, code and links; **raw HTML is shown as text, never rendered; images are not rendered**; links are allowed only for `https:`, `http:` and `mailto:` and open in a new tab. A document that fails to load says so with a retry.

### Settings: the bottom section

After App Settings, one unlabelled section with two rows, directly above the divider and Log Out:

- **About this instance** (`page === 'about'`)
- **Legal** (`page === 'legal'`)

Nothing existing moves. Both are real pages, so the Settings nav test from slice 7 covers them.

### Settings › About this instance

In the existing settings page style (`.st-section`, `.st-card`, `.st-field`):

- **Header:** the icon (or the Skycord mark when there is none), the name, the description.
- **Rows, each omitted when empty:** Run by · Contact.
- **Always shown:** Version · Address.

Omitted, not "Not provided": the product's honesty pattern omits a row that has nothing to say. An instance with nothing configured shows its address as the name, then Version and Address, and nothing that reads as broken or unfinished. **No host-facing detail appears here** — no variable names, file paths or setup hints; a member never needs them.

Loading shows the page's rows as a quiet placeholder; a failed request shows "Couldn't reach the server." with a Retry button.

### Settings › Legal

Two groups, in the same page style.

**The instance's documents**, headed with the instance's name ("Sky Den"): one row per document in `legal`, in the fixed order, each showing its title and, for documents, "Updated 2 Sep 2026". A link row carries an external-link icon and opens a new tab. A document row carries a chevron and opens the document **in the Settings pane**: the page is replaced by the document, under a header with a back control and the title ("Legal › Privacy Policy"), rendered by the same lazy Markdown renderer under the same rules as before sign-in. On phones this is one more step in Settings' existing drill-down. When the instance publishes nothing, the group is a single line — "Sky Den hasn't published any legal documents." — rather than an empty card that reads as broken; it names no variables and suggests nothing, since a member cannot act on it.

**Skycord**, the software, on every instance:

- **Licence & source code.** One short paragraph — "Skycord is free software, licensed under the GNU Affero General Public License, version 3. You can read the licence and get the source code of the version this server runs." — then two rows: **GNU AGPL v3** (the licence text, bundled with the app and shown in the same document view) and **Source code** (the profile's `source`, opening in a new tab). The source row is shown even while the profile is loading or failed, falling back to the upstream repository, because the offer must not depend on the server answering.
- **Open-source licences.** A document view listing every third-party package bundled into the app — name, version, licence — with each licence's full text behind a disclosure. Generated at build time from what the bundler actually included, written to a JSON asset, and loaded only when the page opens.

### The desktop picker (later)

Reads `https://<address>/instance` before sign-in and accepts the address only if `software` is `"skycord"`. Nothing more is decided here.

---

## 4. Safety

- Every host-supplied string is rendered as text. None reaches `v-html` except the Markdown renderer's output, which never contains raw HTML.
- Only `https:`, `http:` and `mailto:` become links, in the profile and inside documents. `SOURCE_URL` is held to `https:` and `http:`.
- The endpoint sends no cookies and allows no credentials, so a permissive origin exposes nothing that is not already public.
- Size limits on every string and file; a rate limit on every route.
- SVG is not accepted as an icon.
- `INSTANCE_DIR` is read-only in the container, and only the icon and the six named documents are ever served from it. A document route's `:kind` is checked against the fixed list and mapped to a fixed file name; no path from a request reaches the filesystem.
- The licence text and the third-party list are build artifacts shipped with the app, not fetched from the instance, so a host cannot alter what the app says about its own licence.

## 5. Design constraints carried from the audit

- **Only tokens** in any rule touched; **AA** for every text colour, in every theme.
- **Muscle memory is binding:** the new nav rows add; nothing moves.
- **The two audiences:** host detail lives in the installer, `.env.example` and the self-hosting docs, never in member-facing UI.
- **Bundle weight is a real cost:** the Markdown renderer, the licence text and the third-party list are all loaded on demand.
- **Legal text is the host's own.** The app never writes legal text on an instance's behalf, and nothing a member sees tells a host what they ought to publish. The only legal words the app supplies are about the app itself.

## 6. Testing

**Server, unit (`readInstanceProfile`):** every row of the variable and file tables — set, unset, empty, too long, invalid URL — for all six documents; contact classification for email, URL and text; link-over-file precedence and its warning, per document; `legal` in the fixed order whatever order the inputs arrive in, `[]` with nothing published, `updated` only on documents; `source` from `SOURCE_URL`, from the tag, and on `dev`; icon order and size limit; name falling back to the host name; the warnings list.

**Server, routes:** `GET /instance` with nothing configured and with everything configured; `Access-Control-Allow-Origin: *` present and `Access-Control-Allow-Credentials` absent on every instance route while the rest of the API keeps its single-origin policy; icon served with the right type and `nosniff`, `404` when absent or oversize; each document kind served as Markdown, `404` when absent or a link; an unknown kind and a kind carrying path characters (`..%2fprivacy`, `privacy.md`) both `404` without touching the filesystem; the rate limit; `API_PREFIXES` parity.

**Client, node:** the consent sentence for every row of its table, including loading and failure; the sign-in footer's list and its absence; titles for every kind; the About page's row omission; the Legal page's rows (link vs document), its empty line, and the Skycord group present in every state, including a failed profile; the link-scheme filter; the Settings nav test sees `about` and `legal`; the client's mirror of the kinds matches the server's list.

**Build:** the licence generator produces an entry for every package in the client bundle, and the build fails if a bundled package has no licence it can read.

**Deploy:** `deploy/tests/cli.test.sh` covers the new installer questions writing `.env`, quoting, and `--yes` skipping them; `compose.yaml` forwards every new variable and mounts `instance/` read-only; ShellCheck passes.

**In the browser:** sign-up with no documents, one, and both, as link and as document; the sign-in footer with several documents; the document modal with a document containing raw HTML and a `javascript:` link (both inert); Settings › Legal with nothing published and with all six, links and documents mixed, reading a document in the pane and coming back; Licence & source code and Open-source licences; About this instance with nothing configured and with everything — all in `default`, `light` and `light-dim`, at desktop and phone width.
