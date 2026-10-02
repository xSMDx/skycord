# Releasing

A release is a version tag. Everything after the tag is automatic, and every
server in the world — including skycord.xyz — takes it with `skycord update`.

## The routine

1. **Write the changelog** on the landing page (`landing/index.html`, the
   `RELEASES` list at the top). Say what changed for the people using it,
   including what was broken.
2. **Tag and push:**

   ```bash
   git tag v0.19.1
   git push origin v0.19.1
   ```

3. **Wait for the release workflow.** It runs the typecheck, both test suites,
   the script tests and ShellCheck; builds the image for x86-64 and ARM64;
   rehearses a real install, update and rollback against that image; and only
   then moves `latest` and publishes the GitHub release with the installer and
   the config templates attached.
4. **Update skycord.xyz:**

   ```bash
   sudo skycord update
   sudo skycord status
   ```

5. **Deploy the landing page**, which is separate and static:

   ```bash
   cd ~/sykord && git pull origin main
   sudo cp -r ~/sykord/landing/* /var/www/skycord.xyz/
   ```

Nothing is built or copied on the server any more, so the old traps — the
lockfile aborting a pull, a forgotten `dist` copy — cannot happen.

**A stale landing page behind Cloudflare still can, and did on 2 October.**
The app is immune for a reason that does not extend to the landing: its
bundles are content-hashed, so every build is a new URL and there is nothing
old at that address to serve. The landing's files are `pages.css`,
`pages.js`, `content.js` — the same five names forever — and Cloudflare
holds them for four hours. A landing deploy therefore lands on the origin and
stays invisible to everyone until that expires, which reads exactly like a
deploy that silently failed.

So after any deploy that touches `landing/`, purge those paths:

```bash
for f in pages.css pages.js content.js site.css site.js; do
  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE/purge_cache" \
    -H "Authorization: Bearer $CF_TOKEN" -H 'Content-Type: application/json' \
    --data "{\"files\":[\"https://skycord.xyz/$f\"]}" > /dev/null
done
```

To check whether you are looking at the cache or the origin, add a query
string — it changes the cache key, so the answer comes from the origin:

```bash
curl -s "https://skycord.xyz/content.js?cb=$(date +%s)" | grep -oE 'v[0-9.]+' | head -1
```

## The one rule: a release may only add to the database

`skycord update` puts the previous version back when a new one does not come up
healthy, and it does **not** restore the database when it does that. Restoring
would erase everything written in between, which is far worse than a version
mismatch.

That safety net only holds if the previous version can read data the new one
has touched. So:

- **Allowed:** new fields, new indexes, new collections, and idempotent
  backfills at startup — the way `words`, `has` and `mentions` arrived.
- **Not allowed in one release:** renaming a field, removing one, or changing
  what a value means.

Anything in the second list is done across two releases:

1. Release A writes both the old and the new shape, and reads either.
2. Release B, once every server has taken A, stops writing the old shape.

If a release ever genuinely cannot be undone, say so in its notes and in
`skycord update`'s confirmation, so the person running it knows the backup is
the only way back.

## Versions

- Tags are `vX.Y.Z` and match the landing changelog.
- A feature release bumps the minor number; fixes bump the patch.
- `latest` follows the newest release that passed the rehearsal, which is what
  a plain `skycord update` installs.
- Pre-releases (`v0.20.0-rc.1`) are ignored by `skycord update` unless the
  version is named explicitly.

## When a release goes wrong

- **A server is already on it:** `sudo skycord rollback`.
- **It has not reached servers yet:** the rehearsal should have stopped it. If
  something got through, publish the fix as a new patch version rather than
  moving a tag — servers remember the version they are on, and a moved tag
  would leave two different builds with the same name.
- **The release never finished:** no release notes, and `latest` still where
  it was. Then nobody could be running it — there was nothing to find and
  nothing to follow — so the tag can be deleted and made again on the fix.
  The rule above protects against two builds answering to one name in the
  hands of people who already pulled one; an image sitting in the registry
  that no release points at is not in anybody’s hands. Overwriting it is
  better than leaving it: a version that exists as an image and not as a
  release is the more confusing of the two.

  Once `latest` has moved or the notes are up, that stops being true, and the
  next number is the only way forward.

## Deploying the public instance (the pm2 host)

The public instance is a manual install, not a container, so `skycord update`
does not apply to it. The sequence is:

```bash
cd ~/sykord && git checkout -- package-lock.json && git pull origin main
npm install --include=dev && npm run build
sudo rsync -a --delete --exclude 'server' ~/sykord/dist/ /var/www/app.<host>/
sudo rsync -a --delete ~/sykord/landing/ /var/www/<host>/
pm2 restart sykord-api && pm2 save
sudo nginx -t && sudo systemctl reload nginx
```

**`--include=dev` is not optional on that host.** It has `NODE_ENV=production`
and `omit=dev` in its npm config, so a plain `npm install` deletes every
devDependency — which is where `vite` and `tsc` live. The build then dies on
`vite: not found`, and because the rsync is a separate command it runs anyway
and ships the `dist/` already sitting there. On 1 October that put a build
several days old back into production while the landing page, which needs no
build, deployed the new changelog alongside it: the site advertised features
the app did not have, and all sixteen smoke checks passed.

**Run the whole thing as one chain, or read the build's output before the
rsync.** A failed build must never reach the copy step.

**`--exclude 'server'` is not optional.** `dist/` contains the compiled
backend; copying it wholesale once published the full server source on the
public web root.

**Use rsync, not `cp` of named paths.** The old step copied `dist/assets` and
`dist/index.html` by name, so every other file Vite emits at the root — the
audio worklet, `licenses.json` — silently never deployed. The worklet 404'd in
production for days while screen sharing degraded quietly to "video without
sound", with nothing in any log to say so.

Then run the smoke check below. Verify by content, never by status code.

## After any deploy or nginx change

```bash
node scripts/smoke.mjs
```

Run it **from `~/sykord` on the deploy host**, where it can compare the bundle
production serves against the one `dist/` holds — that comparison is the only
check here that catches a deploy which copied nothing new. From a developer's
machine pass `--skip-bundle-check`, since your `dist/` is never what
production serves.

It walks the URLs that have actually broken and names the one that is wrong.
Every check in it is a real outage, and each went unnoticed because the surface
being worked on looked fine:

- `/reset-password` 404'd for three days — a `sed` with no line address rewrote
  the SPA fallback in all three nginx server blocks. Reset emails sent
  correctly and every link was dead.
- `/share-audio-worklet.js` 404'd — the deploy copied two paths by name, so
  nothing else at the root of `dist/` shipped. Screen-share audio failed
  silently and degraded to "video without sound".
- `/servers` must be **401, not 200**. A missing nginx proxy prefix falls
  through to the SPA, so the client gets 200 plus index.html — which looks
  exactly like a working API until `res.json()` throws into a catch block.
- `/server/index.js` must be **403**. Copying `dist/*` once published the whole
  compiled backend to the public web root.

**A status code alone is a weak signal on a single-page app**, where every
unknown path returns 200 and the shell. The checks assert on content wherever
that matters. Run it against another host with `--app <url> --landing <url>`.
