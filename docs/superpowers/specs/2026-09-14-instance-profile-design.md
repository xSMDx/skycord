# Instance profile — design

**Date:** 2026-09-14 · **Status:** approved design, awaiting the owner's review of this document · **Branch:** `instance-profile`

## The problem

Three planned surfaces need to know who runs a Skycord instance, and nothing tells them:

- **Sign-up** says "By registering you agree to our Terms & Privacy Policy", with both links going to `#`. On an instance someone else runs, "our" names no one, and there is nothing to link to. (Audit finding 13; triage: the host supplies the terms.)
- **"About this instance"** in Settings — triaged as *build it*: who runs it, how to reach them, the version.
- **The desktop app's instance picker** (roadmap 5a / 5.2) has to show what a server is before anyone signs in, and has to tell a Skycord server from any other web address.

Today the client can learn only two things about an instance: `/health`, and whether it can send mail (`/auth/reset-available`).

## Decisions (owner, 2026-09-14)

| Question | Decision |
|---|---|
| One profile for all three surfaces, or separate? | **One public profile**, read by sign-up, Settings and the desktop picker. |
| Where does a host set it? | **Installer questions and `.env`**, changeable later with `sudo skycord config`. No in-app editor — there is no instance-admin role for one to check. |
| Terms and privacy: link or document? | **Either:** a URL, or a Markdown file the instance serves. |
| Extra fields | **An icon.** No hosting location, no sign-up status. |
| Sign-up wording | **Name the instance:** "…agree to Sky Den's Terms and Privacy Policy." |
| About page placement | **Its own row at the bottom of the Settings nav, above Log Out.** |
| Terms documents | **Rendered Markdown**, raw HTML never rendered, renderer loaded only when a document opens. |

## Out of scope

- The desktop picker's UI. This spec only guarantees what it will read.
- Editing the profile inside the app, sign-up status (open/invite-only/closed), where an instance is hosted.
- The hosted instance's own values. Its owner sets them at the containerised cutover, pointing terms at skycord.xyz's (the repository's ToS draft says it applies to skycord.xyz only).

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
| `INSTANCE_DIR` | Where the files below are read from | — | Default: `instance` under the server's working directory (`/app/instance` in the image) |

Values are trimmed. An empty value is the same as unset.

### Files

In `$SKYCORD_DIR/instance/` (`/opt/skycord/instance/` by default), mounted into the container read-only at `/app/instance` by `compose.yaml`. The installer creates the empty folder.

| File | Meaning | Limit |
|---|---|---|
| `terms.md` | The terms of service, as Markdown | 256 KB, UTF-8 |
| `privacy.md` | The privacy policy, as Markdown | 256 KB, UTF-8 |
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

Non-interactive installs (`--yes`) skip them all. The description and the `instance/` files are documented in `docs/self-hosting/installing.md`, with the note that terms and privacy can be Markdown files instead of links, and that `sudo skycord config` changes the rest later. A value containing a character `.env` needs quoted is written quoted.

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
  "terms":   { "kind": "url",      "href": "https://example.com/terms" },
  "privacy": { "kind": "document", "href": "/instance/privacy" }
}
```

- `software` is always `"skycord"`: how the desktop picker tells a Skycord server from any other address.
- `version` is the running version (`SKYCORD_VERSION`, `dev` locally).
- `address` is the public address (`APP_URL`, falling back to `CLIENT_ORIGIN`).
- `name` falls back to the address's host name (`chat.example.com`), with `nameIsAddress: true`.
- `description`, `operator`, `contact`, `icon`, `terms`, `privacy` are `null` when not set.
- With nothing configured the response still carries `software`, `version`, `address` and `name`.

### `GET /instance/icon`, `GET /instance/terms`, `GET /instance/privacy`

Same public CORS policy and rate limit. The icon is served with the content type of its extension, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=3600`. Documents are served as `text/markdown; charset=utf-8`, `Cache-Control: public, max-age=300`. Each answers `404` when its profile field is not a file (absent, or a link).

### Where the logic lives

A pure function, `readInstanceProfile(env, files)`, turns environment values and file facts into the profile and a list of warnings. The route is a thin layer over it, and startup logs the warnings once. Keeping the rules in one pure function is what makes every row in the tables above unit-testable without a server.

---

## 3. Where it shows

### The client's view of it

A composable, `useInstance()`, requests `/instance` once per page load through the same request helper the auth page already uses for `/auth/reset-available`, and exposes the profile, a loading state and a failure state. Both surfaces below share it, so the page makes one request.

### Sign-up

The sentence under the register form, built from the profile by a pure function:

| Terms | Privacy | Name set | Sentence |
|---|---|---|---|
| ✓ | ✓ | yes | By registering you agree to Sky Den's [Terms] and [Privacy Policy]. |
| ✓ | — | yes | By registering you agree to Sky Den's [Terms]. |
| — | ✓ | yes | By registering you agree to Sky Den's [Privacy Policy]. |
| ✓ | ✓ | no | By registering you agree to the [Terms] and [Privacy Policy] of chat.example.com. |
| ✓ | — | no | By registering you agree to the [Terms] of chat.example.com. |
| — | ✓ | no | By registering you agree to the [Privacy Policy] of chat.example.com. |
| — | — | either | *(no sentence)* |

"Sky Den" stands for the configured name and "chat.example.com" for the address's host name; both are plain text, styled like the rest of the sentence. Brackets mark the links. While the profile is loading, or if it failed to load, there is no sentence: the page must not claim terms it cannot show.

A **link** opens in a new tab (`target="_blank" rel="noopener noreferrer"`). A **document** opens in a modal built on the existing `ModalBase`, titled "Terms" or "Privacy Policy", with the instance's name beneath. The Markdown renderer is imported dynamically when the modal opens, never in the main bundle. It renders headings, paragraphs, lists, emphasis, code and links; **raw HTML is shown as text, never rendered; images are not rendered**; links are allowed only for `https:`, `http:` and `mailto:` and open in a new tab. A document that fails to load says so in the modal with a retry.

### Settings › About this instance

A new nav row, **"About this instance"**, in its own unlabelled section after App Settings, directly above the divider and Log Out. Nothing existing moves. It is a real page (`page === 'about'`), so the Settings nav test from slice 7 covers it.

The page, in the existing settings page style (`.st-section`, `.st-card`, `.st-field`):

- **Header:** the icon (or the Skycord mark when there is none), the name, the description.
- **Rows, each omitted when empty:** Run by · Contact · Terms · Privacy Policy.
- **Always shown:** Version · Address.

Omitted, not "Not provided": the product's honesty pattern omits a row that has nothing to say. An instance with nothing configured shows its address as the name, then Version and Address, and nothing that reads as broken or unfinished. **No host-facing detail appears here** — no variable names, file paths or setup hints; a member never needs them.

Loading shows the page's rows as a quiet placeholder; a failed request shows "Couldn't reach the server." with a Retry button.

### The desktop picker (later)

Reads `https://<address>/instance` before sign-in and accepts the address only if `software` is `"skycord"`. Nothing more is decided here.

---

## 4. Safety

- Every host-supplied string is rendered as text. None reaches `v-html` except the Markdown renderer's output, which never contains raw HTML.
- Only `https:`, `http:` and `mailto:` become links, in the profile and inside documents.
- The endpoint sends no cookies and allows no credentials, so a permissive origin exposes nothing that is not already public.
- Size limits on every string and file; a rate limit on every route.
- SVG is not accepted as an icon.
- `INSTANCE_DIR` is read-only in the container and only the five named files are ever served from it; no path from a request reaches the filesystem.

## 5. Design constraints carried from the audit

- **Only tokens** in any rule touched; **AA** for every text colour, in every theme.
- **Muscle memory is binding:** the new nav row adds; nothing moves.
- **The two audiences:** host detail lives in the installer, `.env.example` and the self-hosting docs, never in member-facing UI.
- **Bundle weight is a real cost:** the Markdown renderer is loaded on demand.

## 6. Testing

**Server, unit (`readInstanceProfile`):** every row of the variable and file tables — set, unset, empty, too long, invalid URL; contact classification for email, URL and text; link-over-file precedence and its warning; icon order and size limit; name falling back to the host name; the warnings list.

**Server, routes:** `GET /instance` with nothing configured and with everything configured; `Access-Control-Allow-Origin: *` present and `Access-Control-Allow-Credentials` absent on all four routes while the rest of the API keeps its single-origin policy; icon served with the right type and `nosniff`, `404` when absent or oversize; documents served as Markdown, `404` when the field is a link; the rate limit; `API_PREFIXES` parity.

**Client, node:** the consent sentence for every row of its table, including loading and failure; the About page's row omission; the link-scheme filter; the Settings nav test sees `about`.

**Deploy:** `deploy/tests/cli.test.sh` covers the new installer questions writing `.env`, quoting, and `--yes` skipping them; `compose.yaml` forwards every new variable and mounts `instance/` read-only; ShellCheck passes.

**In the browser:** sign-up with no terms, one, and both, as link and as document; the terms modal with a document containing raw HTML and a `javascript:` link (both inert); About this instance with nothing configured and with everything, in `default`, `light` and `light-dim`, at desktop and phone width.
