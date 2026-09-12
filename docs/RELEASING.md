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
lockfile aborting a pull, a forgotten `dist` copy, a stale bundle behind
Cloudflare — cannot happen.

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
