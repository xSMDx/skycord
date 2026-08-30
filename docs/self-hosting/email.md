# Email and password reset

Skycord sends exactly one kind of email: a password reset link. Setting this up
is optional — an instance without it runs normally, and the login page hides
"Forgot?" rather than offering a link that can never arrive.

Provider is [Resend](https://resend.com). Free tier is 3,000 emails a month and
100 a day, which is far more than a friend-group instance will ever send.

---

## 1. Get a key

1. Sign up at [resend.com](https://resend.com).
2. **API Keys → Create API Key.** Sending permission is all it needs.
3. Copy it now — Resend shows it once.

## 2. Verify a domain

**This is the step people skip, and skipping it means nothing sends.** An
unverified sender is rejected at Resend, and the app cannot tell you why:
from its side the request simply fails. The reason lands in your server log,
not in the browser.

1. **Domains → Add Domain**, enter the domain you send from (`example.com`).
2. Resend gives you DNS records — typically a `TXT` for DKIM and an `MX` plus
   `TXT` for the return path.
3. Add them wherever your DNS lives. **If you use Cloudflare, set these records
   to "DNS only" (grey cloud).** Proxying a `TXT` record does nothing useful,
   and proxying the `MX` breaks mail delivery outright.
4. Wait for Resend to show **Verified**. Usually minutes; DNS can take longer.

You can send to *your own* address without a verified domain, which is enough to
test the flow but not to run it.

## 3. Configure Skycord

In your `.env`:

```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=Skycord <noreply@example.com>
APP_URL=https://app.example.com
```

- **`EMAIL_FROM`** must be an address on the domain you verified. The
  `Name <address>` form is what recipients see as the sender.
- **`APP_URL`** is where reset links point. It defaults to `CLIENT_ORIGIN`,
  which is right unless you serve the app somewhere other than the API's CORS
  origin. Getting this wrong produces links to nowhere, and the link is the
  entire email.

Restart the API:

```bash
pm2 restart skycord
```

## 4. Check it worked

The app exposes whether it thinks mail is configured:

```bash
curl -s https://app.example.com/auth/reset-available
```

`{"enabled":true}` means both variables are set. It does **not** mean Resend
will accept your mail — that depends on domain verification, which only a real
send proves. So send one: open the login page, click **Forgot?**, enter your own
address.

If nothing arrives, the reason is in the server log rather than the browser:

```bash
pm2 logs skycord --lines 50 | grep '\[email\]'
```

| Log line | Means |
|---|---|
| `send failed 403 ... domain is not verified` | Step 2 is incomplete |
| `send failed 401` | Bad or revoked API key |
| `send failed 422` | `EMAIL_FROM` is not on the verified domain |
| `requested but no mail provider configured` | `RESEND_API_KEY` or `EMAIL_FROM` is empty |
| nothing at all | The request never reached the server — check the proxy |

## How the flow behaves

Worth knowing, because two of these look like bugs:

**The confirmation is the same for every address.** Registered or not, typo'd or
not, you get "If that email is registered, a reset link is on its way." That is
deliberate: an endpoint that says "no such account" lets anyone test whether an
address has one here. There is no way to tell from the outside, by design.

**A reset signs out every device.** Someone resetting a password may be doing it
because somebody else is signed in. Leaving those sessions alive would defeat
the point, so the reset invalidates all of them — including the browser that
performed it.

The rest:

- Links **expire after 30 minutes** and work **once**.
- Asking again **invalidates the previous link**. Only the newest works.
- Tokens are stored hashed, so a database dump contains nothing replayable.
- Both endpoints are rate limited to 10 attempts per 15 minutes per IP.

## Running without email

Perfectly supported. Leave `RESEND_API_KEY` empty and:

- "Forgot?" does not appear on the login page.
- Everything else works normally.

The cost is that a user who forgets their password cannot recover it themselves.
Since there is no admin UI yet, resetting one means going into MongoDB directly
— and the stored value is a bcrypt hash, so you cannot simply type a new
password in. The practical options are to delete the account and let them
register again, or to configure Resend.

---

## See also

- [Installing](./installing.md) — the other environment variables
- [Networking](./networking.md) — domains, TLS, Cloudflare
- [`.env.example`](../../.env.example) — every variable, annotated
