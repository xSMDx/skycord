# Installing Skycord

One command on a fresh Linux server, and you have a running instance on HTTPS.

```bash
curl -fsSL https://skycord.xyz/install.sh | sudo bash
```

It asks for the address people will use and an email for certificate notices.
Everything else it works out or generates.

Prefer to read it first? That is the point of it being one short script:

```bash
curl -fsSL https://skycord.xyz/install.sh -o install.sh
less install.sh
sudo bash install.sh
```

Each release also publishes the checksum of that file, on
[the releases page](https://github.com/xSMDx/skycord/releases).

## What you need

| | |
|---|---|
| **A server** | Linux on x86-64 or ARM64, about 1 GB of memory and 5 GB of disk |
| **A domain** | one address, e.g. `chat.example.com`, pointing at the server |
| **Two ports open** | 80 and 443, plus `7882/udp` and `7881/tcp` for voice |
| **Docker** | installed for you if it is missing |

Nothing else: no Node, no database, no web server to configure.

**Point the address at the server first.** The certificate is issued by
answering a challenge on port 80, so the name has to resolve before the
installer can finish. If it does not yet, the installer says so and you can run
`sudo skycord apply` once DNS has caught up.

## What it sets up

- **Skycord**, serving the app and its API on one port.
- **MongoDB 4.4**, with a password, reachable only by Skycord. Version 4.4
  deliberately: 5.0 and later need AVX, which older and some ARM processors
  lack.
- **LiveKit** for voice and video, using a single UDP port instead of a range.
- **Caddy**, which gets and renews the HTTPS certificate on its own.

It all lives in `/opt/skycord`: your settings and secrets in `.env`, the
configuration beside it, and backups underneath. The database and the
certificates live in Docker volumes, and survive updates and reinstalls.

## Everyday commands

```bash
sudo skycord status      # version, health, disk, last backup, updates available
sudo skycord update      # update, with a backup and automatic rollback
sudo skycord logs        # follow what it is doing
sudo skycord config      # change settings, then apply them
sudo skycord backup      # back up the database now
```

## Updating

```bash
sudo skycord update
```

It backs up the database, downloads the new version while the old one keeps
serving, switches over, and checks the new version is running and can reach its
database. If it cannot, it puts the previous version back on its own and shows
you why it failed.

The database is deliberately **not** restored when that happens: a release only
ever adds to it, so the previous version runs fine on the newer data, and
restoring would throw away everything written since the backup.

To update by itself every night:

```bash
sudo skycord auto-update on
```

## Backups

A backup runs nightly at 04:00 and the last 14 are kept, in
`/opt/skycord/backups`. Every update takes one first, and the last five of
those are kept separately, so a run of updates cannot push out your nightly
history.

```bash
sudo skycord backup                                   # one now
sudo skycord restore /opt/skycord/backups/FILE.gz     # put one back
```

**Copy them off the machine.** A backup on the same disk survives a mistake but
not a dead server. `rsync` or `rclone` on the same schedule is enough.

## Using pieces you already run

Each part can be replaced by something already on the machine:

```bash
# You already run a web server: Skycord listens on 127.0.0.1:3001 instead,
# and the installer prints the block to paste into it.
sudo bash install.sh --proxy external

# You already run MongoDB, or LiveKit.
sudo bash install.sh --mongo-uri mongodb://user:pass@localhost:27017/skycord
sudo bash install.sh --livekit-url wss://livekit.example.com \
                     --livekit-key APIxxx --livekit-secret ...

# No voice at all.
sudo bash install.sh --no-voice
```

If ports 80 or 443 are already busy, the installer notices and switches to
`--proxy external` by itself rather than failing.

## Moving an existing install onto this

Already running Skycord the manual way? Keep your secrets, and everyone stays
signed in:

```bash
sudo bash install.sh --from-env /path/to/your/.env --proxy external
```

If that machine also runs the database and LiveKit itself, keep those too and
move only the app:

```bash
sudo bash install.sh --from-env /path/to/your/.env \
                     --proxy external --host-network \
                     --mongo-external --voice-external
```

`--mongo-external` and `--voice-external` say "I already run this" and read the
address, the key and the secret out of the `.env` you pointed at, so nothing
sensitive goes on the command line. `--host-network` puts the app on the
machine’s own network, where `127.0.0.1` means what it says.

Your current `.env` supplies the JWT secrets and the encryption key, so
existing sessions and stored voice-server credentials keep working. Point your
web server at `127.0.0.1:3001`, forwarding everything — the app serves its own
files now, so the old rule about listing each API path in the proxy is gone.

**Remove any security headers your web server adds.** The app sends its own
(`Strict-Transport-Security`, `X-Frame-Options`, `Referrer-Policy`,
`X-Content-Type-Options`, `Permissions-Policy`), and a second set arrives as a
second value rather than replacing the first, which is how browsers end up with
two contradictory framing rules.

## Behind Cloudflare

Set SSL/TLS to **Full (strict)** and give the installer a Cloudflare Origin
Certificate when it asks. Let's Encrypt cannot complete its check through
Cloudflare's forced-HTTPS redirect, which is why the installer asks rather than
guessing.

Also turn **WebSockets** on, or live updates fall back to polling and
everything feels broken rather than being broken.

## Voice

Media goes straight to your server, not through Cloudflare, which cannot carry
UDP. Two ports must reach the machine:

```
7882/udp    the audio and video itself
7881/tcp    the fallback for networks that block UDP
```

On a home server that is two port forwards on the router. If ufw is running,
the installer offers to open them; it never touches your SSH rules.

## Removing it

```bash
cd /opt/skycord && sudo docker compose down -v    # -v also deletes the database
sudo rm -rf /opt/skycord /usr/local/bin/skycord
sudo systemctl disable --now skycord-backup.timer skycord-update.timer
```

Take a backup and copy it somewhere else first if you might want the data back.

## See also

- **[networking.md](./networking.md)** — DNS, Cloudflare, firewalls, and what
  to check when calls connect with no sound.
- **[email.md](./email.md)** — password reset through Resend. Optional.
- **[manual-install.md](./manual-install.md)** — the same thing without Docker:
  Node, MongoDB, a web server and a process manager, installed by hand.
- **[../RELEASING.md](../RELEASING.md)** — how releases are made, if you are
  working on Skycord rather than running it.
