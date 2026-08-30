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

If you are using Cloudflare (§5), set app to **Proxied** (orange cloud) and
**leave `livekit` unproxied** (grey cloud). This matters more than it looks —
see §6.

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
    location ~ ^/(auth|users|messages|conversations|servers|invites|gifs|stickers|voice|health) {
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

Worth using — it absorbs traffic before it reaches a small VPS and hides your
origin IP.

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

**Do not proxy the LiveKit subdomain.** Next section.

## 6. Voice and video (LiveKit)

The part people get wrong, because it does not behave like HTTP.

LiveKit signalling is a websocket over TLS — Cloudflare can proxy that. **Media
is UDP**, and Cloudflare's proxy does not carry UDP. If `livekit.example.com`
is orange-clouded, calls connect, both sides show as joined, and nobody hears
anything. Grey-cloud it.

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

Whichever you use, the subdomain still must not be proxied by Cloudflare — that
is about UDP, and no reverse proxy changes it.

## 7. Firewall

Default deny, then open only what serves traffic:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80,443/tcp
sudo ufw allow 50000:60000/udp
sudo ufw enable
```

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
| Calls connect, no audio | `livekit` is orange-clouded (§6), or the UDP range is closed |
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
