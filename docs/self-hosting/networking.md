# Networking: domain, TLS, reverse proxy, Cloudflare

Getting Skycord onto a domain, served over HTTPS, and not trivially attackable.

This is written from the setup that actually runs
[app.skycord.xyz](https://app.skycord.xyz) — not from a template. Where a choice
was made for a reason, the reason is here.

> **Before anything else:** `NODE_ENV=production` in your `.env`. Auth cookies
> only get `Secure` and `SameSite=Strict` when it reads exactly that. The server
> refuses to boot in development mode on a non-localhost origin, so a mistake
> here fails loudly rather than quietly shipping readable session cookies.

---

## 0. Pick how far you want to go

Most of this document describes a hardened public deployment. **You may not want
that**, and that is a legitimate choice rather than a mistake. Three setups,
each fine for what it is:

### A. Localhost or LAN only

No domain, no TLS, no Cloudflare, no firewall rules. You and whoever is on your
network. Follow [installing.md](./installing.md) and **stop there** — none of
this document applies.

Keep `NODE_ENV=development` for this. The server allows it while every origin is
loopback, and cookie flags do not matter when nothing leaves the machine.

Good for: trying it out, a house LAN, a LAN party. Costs you: nobody outside can
reach it, and there is nothing protecting it from anyone who is already on the
network.

### B. Public, TLS, nothing else

A domain, a reverse proxy, and a Let's Encrypt certificate. No CDN, no firewall
tuning. This is a perfectly reasonable way to run a server for a dozen friends,
and it is what most small self-hosted things do.

Follow **§1–§4 and §6**, skip §5 (Cloudflare) and §7 (firewall).

Costs you: your IP is public and known, you absorb any traffic aimed at you, and
the box's other services are exposed to whoever looks. For a small private
instance that is usually an acceptable trade.

### C. The full setup

Everything here. Worth it if the instance is genuinely public, if the machine
runs other things you care about, or if you would rather not think about it
again.

---

**The one thing that is not optional.** If your server is reachable from the
internet, it needs TLS — not for tidiness, but because auth cookies carry the
`Secure` flag in production and a browser will not send them over plain HTTP.
Public + no TLS means nobody can stay logged in. The server refuses to start in
that configuration rather than let you discover it through a login loop.

So: **localhost without TLS is fine. Public without TLS does not work.** There
is no middle option, and that is the only place this guide is strict.

---

## 1. What has to be reachable

Skycord is three separate things behind one domain:

| Piece | Where it lives | Reached as |
|---|---|---|
| The client | static files in `dist/` | `app.example.com` |
| The API + websocket | Node on `127.0.0.1:3001` | `app.example.com/api-ish paths` |
| LiveKit (voice/video) | its own server on `:7880` | `livekit.example.com` |

The API is **not** exposed directly. It binds to localhost and only the reverse
proxy talks to it. That single decision removes a whole class of problem: no
matter what your firewall does, nothing outside the box can reach Node.

A marketing/landing page, if you want one, is a fourth static root on the apex
domain. It is entirely optional.

## 2. DNS

Two records, both pointing at your server's public IP:

```
A    app        203.0.113.10
A    livekit    203.0.113.10
```

Add the apex (`@`) too if you want a landing page there.

If you are using Cloudflare (§5), **proxy all of them** (orange cloud),
`livekit` included.

That last part is worth stating clearly, because the opposite advice is common
and it is wrong for the reason people give. Cloudflare cannot carry UDP, so
media does not travel through it either way — but media never uses DNS. It goes
direct to your server over ICE candidates negotiated in-band. Only *signalling*
resolves the hostname, and signalling is a websocket, which Cloudflare proxies
perfectly well.

Grey-clouding `livekit` therefore buys you nothing and costs you the one thing
Cloudflare was protecting: an unproxied record publishes your origin IP to
anybody who runs `dig`. Verified on the reference deployment — every record
proxied, calls working.

Check propagation before going further; half the "TLS is broken" reports are
really "DNS has not propagated yet":

```bash
dig +short app.example.com
```

## 3. Reverse proxy

nginx, though Caddy works and gets you TLS with less ceremony.

```nginx
server {
    listen 80;
    listen 443 ssl;
    server_name app.example.com;

    ssl_certificate     /etc/ssl/certs/example.pem;
    ssl_certificate_key /etc/ssl/private/example.key;

    # The built client. `try_files` with the SPA fallback is required:
    # Skycord routes in the browser, so a deep link must return index.html
    # rather than 404.
    root /var/www/app.example.com;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # The API. Every one of these is a path the Node server owns.
    location ~ ^/(auth|users|messages|conversations|servers|invites|gifs|stickers|themes|voice|health) {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Socket.IO needs the Upgrade headers or it silently falls back to
    # long-polling and every realtime feature feels broken rather than dead.
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_read_timeout 7d;
    }
}
```

### Security headers

Add these inside the `server` block. Six lines, no downside, and without them a
browser will happily frame your app inside someone else's page:

```nginx
    # Force HTTPS for two years, including subdomains. Add this only once you
    # are certain every subdomain can serve TLS — browsers honour it for the
    # full duration and there is no quick way to take it back.
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    # Nobody may frame this app. Without it, a login page can be loaded
    # invisibly over an attacker's page and clicks stolen from it.
    add_header X-Frame-Options "DENY" always;

    # Do not let a browser guess a file's type. Guessing is how an uploaded
    # image gets executed as script.
    add_header X-Content-Type-Options "nosniff" always;

    # Send the page path to same-origin destinations only, never to third
    # parties -- an invite URL is a secret.
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Features this app never uses. Denying them means a compromised script
    # cannot reach for them either.
    add_header Permissions-Policy "geolocation=(), payment=(), usb=()" always;
```

`always` on every one of them is load-bearing: without it nginx omits the header
on error responses, so exactly the pages most likely to be probed go out bare.

**Not included, deliberately: `Content-Security-Policy`.** A real CSP for this
app has to allow Google Fonts, `blob:` and `data:` media for avatars and screen
share, and websocket connections to your LiveKit host. A copy-pasted one breaks
calls in ways that are miserable to debug, so it belongs in a session where it
can be tested rather than in a list of quick wins.

Reload and verify:

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -sI https://app.example.com/ | grep -iE 'strict-transport|x-frame|x-content|referrer|permissions'
```

**Two traps worth naming, because both have bitten this project:**

**Prefix matches are greedy.** A block written as `location ^~ /server` also
catches `/servers`, which is the entire channels API. If you are blocking or
special-casing a path, include the trailing slash — `^~ /server/` — and then
test that the neighbouring route still works. It is not enough to check that
the thing you blocked is blocked.

**The document root is not your build directory.** `npm run build` writes to
`dist/` inside the repo; nginx serves from `/var/www/...`. Nothing connects
them automatically. If you deploy and the site does not change, this is almost
always why:

```bash
sudo cp -r ~/skycord/dist/* /var/www/app.example.com/
```

Confirm the bundle actually changed rather than trusting the build log — the
filename is content-hashed, so it moves on every real deploy:

```bash
curl -s https://app.example.com/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
```

## 4. TLS

**Let's Encrypt** if your domain points straight at the box:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d app.example.com -d livekit.example.com
```

Renewal is automatic via a systemd timer. Verify it rather than assuming:

```bash
sudo certbot renew --dry-run
```

**Cloudflare Origin CA** if you are behind Cloudflare — a 15-year certificate
that only Cloudflare trusts, which is fine because only Cloudflare talks to your
origin. Generate it in the dashboard under SSL/TLS → Origin Server, and point
`ssl_certificate` / `ssl_certificate_key` at the files.

Either way, set Cloudflare's SSL mode to **Full (strict)**. "Flexible" encrypts
browser→Cloudflare and leaves Cloudflare→origin in plaintext, which looks
secure in the address bar and is not.

## 5. Cloudflare

Worth using — it absorbs traffic before it reaches a small VPS, and it keeps
your origin IP out of DNS.

**It does not hide your origin on its own**, and it is worth being precise about
that rather than assuming a proxy is a boundary. Two things give the address
away regardless of how DNS is configured:

- **Your own TLS certificate.** Connect to the origin IP on 443 and it serves a
  certificate naming your domain. Scanners sweep all of IPv4 doing exactly this
  and index the result, so the domain↔IP link is a search away. The fix is a
  firewall rule limiting 443 to Cloudflare's ranges (§7) — without it, every
  other precaution here is decorative.
- **Anyone who joins a voice call.** ICE candidates carry the address. That is
  inherent to WebRTC and cannot be designed away.

Treat Cloudflare as protection against opportunistic traffic. **The origin
firewall is the actual boundary.**

**Settings that matter:**

- **SSL/TLS: Full (strict)** — see above.
- **Always Use HTTPS: on.**
- **WebSockets: on.** Off by default on some plans, and Socket.IO stops working
  without it.
- **Caching.** The app's `index.html` must not be cached, or people keep loading
  an old bundle after a deploy. Hashed assets under `/assets/` can be cached
  hard, because their names change when they change.

A cache rule for the app: bypass cache on `app.example.com/`, cache everything
under `/assets/`.

**Purging.** "Purge Everything" is unreliable for hot objects. Purge the
specific URLs instead — the page, and the bundle if you must. Then check what
you are actually being served:

```bash
curl -s -o /dev/null -D - https://app.example.com/ | grep -i cf-cache-status
```

`DYNAMIC` means Cloudflare is not caching it — which is what you want for the
app shell. If you see `HIT` on `index.html` after a deploy, that is your stale
bundle.

**Proxying the LiveKit subdomain is fine** — see §6 for why the common advice to grey-cloud it is wrong.

## 6. Voice and video (LiveKit)

The part people get wrong, because it does not behave like HTTP.

Signalling is a websocket over TLS, which Cloudflare proxies fine. **Media is
UDP**, which it does not carry at all.

The intuitive conclusion — grey-cloud the subdomain so media can reach you — is
wrong, and it is worth understanding why, because it also explains what to do
when calls connect silently.

**Media never resolves the hostname.** The browser learns where to send audio
from ICE candidates, negotiated inside the signalling channel, containing your
server's address directly. DNS is not involved. So proxying the subdomain does
not block media, and unproxying it does not help media — it only publishes your
origin IP.

What *does* break audio is the **UDP ports being closed**, or LiveKit
advertising an address the browser cannot reach. Those are the two things to
check, not the cloud colour.

Ports that must be open on the host firewall:

```bash
sudo ufw allow 443/tcp        # signalling, via the proxy
sudo ufw allow 50000:60000/udp  # media
```

Then in your `.env`:

```
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

`LIVEKIT_URL` is handed to the **browser**, so it has to be reachable from the
public internet — not `localhost`, not a private IP, however tempting during
setup.

If both participants sit behind strict NAT and media never establishes, you need
a TURN relay. LiveKit can run one itself; the config lives in LiveKit's own
`config.yaml`, not here.

**Running LiveKit in Docker** is the easier path, and is what the reference
deployment does — LiveKit plus a small Caddy in front of it for TLS on the
`livekit.` subdomain, both with `--restart unless-stopped`. Caddy rather than
nginx here purely because it obtains and renews the certificate on its own,
which is one less thing to forget. nginx works identically if you already have
it terminating TLS for the app.

Whichever you use, the Cloudflare setting on the subdomain does not affect media — that
is about UDP, and no reverse proxy changes it.

## 7. Firewall

Default deny, then open only what serves traffic:

```bash
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 3478/udp                      # TURN, if you run one
sudo ufw allow 50000:60000/udp               # LiveKit media — CHECK YOUR RANGE
```

**443 goes to Cloudflare only.** This is the rule that closes the certificate
leak described in §5, and it is the reason the rest of this section matters:

```bash
curl -s https://www.cloudflare.com/ips-v4 | while read -r r; do sudo ufw allow from "$r" to any port 443 proto tcp; done
curl -s https://www.cloudflare.com/ips-v6 | while read -r r; do sudo ufw allow from "$r" to any port 443 proto tcp; done
```

**Then check for a blanket 443 rule before enabling.** A single
`ufw allow 443` — or `ufw allow 'Nginx Full'`, which includes it — silently
cancels all twenty rules above, and nothing warns you:

```bash
sudo ufw show added | grep 443
```

Every line must read `from <range> to any port 443`. Delete any bare
`allow 443`, `allow 443/tcp` or `allow 'Nginx Full'`.

### Before you enable

`ufw enable` takes effect instantly and anything not allowed stops working. Two
checks first, both of which have caught real mistakes:

```bash
ss -tlnp   # TCP listeners
ss -ulnp   # UDP listeners — a TCP-only look misses voice entirely
```

**Do not take default port numbers on trust.** On the reference deployment,
TeamSpeak was on `11269/udp`, not the documented default of `9987` — a rule
written from the manual would have allowed a port nothing used and blocked the
one everyone connected on, with no error message either side. `ss -ulnp` is the
only authority on what is actually listening.

The same applies to the LiveKit range above: nothing listens there while idle,
because ports are allocated per call. Read `port_range_start` and
`port_range_end` from LiveKit's `config.yaml` rather than trusting the default.

Then:

```bash
sudo ufw enable
```

Verify in this order, because the first fails silently:

1. Connect a voice client (TeamSpeak or equivalent) — UDP, no error if blocked
2. `curl -s -o /dev/null -w "%{http_code}\n" https://app.example.com/` → 200
3. Make a call in Skycord — exercises the LiveKit UDP range

`sudo ufw disable` reverts instantly and keeps the rules.

**MongoDB must not be in that list.** It should listen on `127.0.0.1` only.
An internet-exposed MongoDB is found by scanners within hours. Confirm:

```bash
ss -tlnp | grep 27017
```

The address must be `127.0.0.1:27017`, never `0.0.0.0:27017`.

> **If MongoDB runs in Docker, ufw will not save you.** Docker writes its own
> iptables rules ahead of ufw's, so a container published with `-p 27017:27017`
> is reachable from the internet even while ufw reports the port as denied.
> Bind the publish explicitly — `-p 127.0.0.1:27017:27017` — and check with the
> command above rather than trusting `ufw status`. The same applies to any
> container you publish.

Same principle as §1: the API on localhost, the database on localhost, and
exactly one process facing the internet.

## 8. Hardening worth the time

**SSH keys, not passwords.** Then `PasswordAuthentication no` in
`/etc/ssh/sshd_config`.

**Unattended security upgrades:**

```bash
sudo apt install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
```

**Rate limiting is already in the app** (`server/middleware/rateLimit.ts`) for
auth, writes, uploads and the GIF proxy. Cloudflare rate-limiting rules on
`/auth/*` are a reasonable second layer if you are public.

**Back up the database.** Nothing in Skycord does this for you:

```bash
mongodump --uri="mongodb://localhost:27017/skycord" --out=/backup/$(date +%F)
```

**Watch the certificate expiry** if you used Let's Encrypt and ever disabled the
timer. An expired certificate takes the whole instance down, and it is a
tedious way to find out.

## 9. When it does not work

| Symptom | Usually |
|---|---|
| Deployed, but the UI is unchanged | The build was never copied to the nginx root (§3), or `index.html` is cached (§5) |
| "Reconnecting…" forever | WebSockets off in Cloudflare, or the `/socket.io/` block is missing the Upgrade headers |
| Calls connect, no audio | The UDP media range is closed on the firewall, or LiveKit is advertising an address the browser cannot reach (§6). **Not** the Cloudflare cloud colour — media never resolves the hostname |
| Logged in, then logged out on refresh | `NODE_ENV` is not `production`, so the cookie has no `Secure` flag and is dropped over HTTPS |
| One API path 404s, the rest work | A greedy `location` prefix is swallowing it (§3) |
| Server refuses to start | Read the message — the boot guard names the variable and the value it objected to |

Check the app's own logs first; they are usually more specific than nginx's:

```bash
pm2 logs skycord --lines 50
```

---

## See also

- [Installing](./installing.md) — first-time setup, environment variables, API keys
- [`.env.example`](../../.env.example) — every variable, annotated
- [ROADMAP.md](../ROADMAP.md) — what is coming
