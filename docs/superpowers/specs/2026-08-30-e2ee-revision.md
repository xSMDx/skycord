# End-to-End Encryption — revision 2

**Status:** designed, NOT built.
**Supersedes in part:** `2026-08-09-e2ee-design.md`. Everything that document says
and this one does not contradict still stands — the key hierarchy, ECDH P-256,
AES-GCM, WebCrypto-only, the six-number device verification, the lockout policy,
opt-in-and-permanent, the table of what breaks in encrypted conversations, and
the 19 server-side reads of `msg.content` that must change.
**Build gate:** native mobile **and** desktop apps. Not before — see "Why the gate is real".
**Date:** 2026-08-30

---

## What changed

The original design stored ciphertext on the server indefinitely, protected the
identity key with a backup code alone, and supported groups. This revision
narrows the scope and makes the storage model much stronger.

| Area | 2026-08-09 | Now |
|---|---|---|
| Scope | DMs and groups | **DMs only** |
| Server storage | ciphertext, kept forever | **deleted on delivery, 14-day cap** |
| At-rest key protection | backup code | **passkey PRF**, backup code as break-glass |
| Multi-device | server re-delivers | **direct LAN sync between your own devices** |
| Loss recovery | none | **user-held encrypted backup file** |
| Ephemeral mode | none | **stealth sessions**, with forward secrecy |

---

## 1. Scope: DMs only

Groups are out of the first version. This removes more complexity than every
other simplification combined:

- One recipient means one conversation key and **no re-wrapping on membership
  change** — the rotation machinery disappears.
- The original design's **pending-key wait** ("a user cannot enter an encrypted
  conversation until another member is online") collapses from *possibly hours
  in a quiet group* to *seconds in a DM*.
- Delete-on-delivery has one delivery target to reason about instead of
  members × devices, and no message pinned open by one member who never returns.

Groups get designed after DMs ship, with delete-on-delivery already proven.

## 2. At-rest key protection: passkey PRF

The identity private key is wrapped on each device by a secret derived from a
**WebAuthn passkey using the `prf` extension** — Windows Hello, Touch ID, or an
Android biometric. The PRF output is deterministic per credential and salt, so
it reproduces the same wrapping key on every unlock, and the underlying
credential is hardware-backed and non-exportable.

**This replaces the "device password" idea.** An app cannot read the OS login
password on any platform — no such API exists — and a password typed into
Skycord would be low-entropy and would destroy history when changed. The passkey
delivers what the password was reaching for (the device itself is the key,
unlockable only by the person holding it) with hardware backing instead.

**PRF protects the key at rest; it does not transport it.** Getting the identity
key onto a *new* device is still the original design's six-number verification
derived from the two devices' ECDH shared secret — that requirement is unchanged
and remains the single most important property in the whole design. The order is:
six numbers to provision, PRF to store.

**PBKDF2 survives.** The original chose PBKDF2 over Argon2id explicitly
conditional on nothing ever being wrapped with a *user-chosen* password. Choosing
PRF over a password means that tripwire does not fire: the backup code is still
machine-generated and high-entropy, so PBKDF2 remains correct for it.

Browsers without PRF (Firefox at time of writing) fall back to backup-code-only
protection. The native apps use platform APIs directly and always have it.

## 3. Delivery and retention

- The server holds ciphertext until **delivery to the first device**, then
  deletes it.
- Anything undelivered is dropped at **14 days**, hard cap.
- **The 14-day drop must be visible.** At day 14 the message is gone, not
  queued — and the sender has already seen "delivered". The UI must not leave
  that as a silent hole.

Delete-on-delivery is the strongest idea in this revision: it bounds a server
compromise to the delivery window rather than all of history, and it
substantially blunts the design's accepted lack of forward secrecy, because a
stolen key finds almost nothing on the server left to decrypt.

**Retention is not encryption.** Messages are encrypted on the sender's device
before transmission — `useSocket.ts` remains the single chokepoint. Deleting
afterwards shrinks the exposure window; it never substitutes for encrypting, and
plaintext must never touch the server even briefly.

## 4. Multi-device: direct LAN sync

Two devices belonging to the same user, awake on the same local network,
discover each other over mDNS and sync messages directly, authenticated by the
identity key both already hold. Nothing transits the server.

**This is a convenience, not a recovery mechanism, and the docs must not blur
that.** It only runs when both devices are awake on the same network — a phone
that travels and a PC that stays home meet rarely. It covers everything up to
the last sync; everything after that dies with the device. Loss recovery is §5,
and only §5.

## 5. Backup: a user-held encrypted file

The user exports their history to a file encrypted under a key derived from the
backup code. **They keep the file. The server never receives it, at any point.**
Restore is: import the file, enter the backup code.

This is the only thing that squares "the server stores nothing" with "I should
not lose years of conversation when I drop my phone". Without it the honest
product stance would be that loss is permanent — which is defensible, but has to
be said out loud before a user enables encryption, and we chose not to take it.

## 6. Stealth sessions

A stealth session is **started, like a call** — not a setting toggled on a
conversation. It requires both people online, and it ends.

- **Never written to Mongo at all.** Not written-then-deleted: relayed through
  the socket and never stored. Categorically stronger than §3, and less code.
- **Forward secrecy, cheaply.** A fresh ephemeral ECDH keypair per session,
  discarded when it closes. The original design rejected a ratchet as
  disproportionate, and was right — ratchets are expensive because of offline
  delivery, multi-device fan-out and out-of-order messages. A stealth session
  has none of those by construction, so it gets the property the main mode
  cannot have, for very little work.
- **Nothing on disk on either client.** Scrollback dies with the session.
- **If the peer drops, the send fails visibly.** Never queue it — queuing is
  precisely what would make it not stealth.
- **It sidesteps the pending-key problem entirely**, since both parties are
  online by definition.
- **Never claim it prevents screenshots.** It cannot, and products that implied
  otherwise took real damage for it.

---

## Before any crypto code: write the protocol

**The first artefact is a protocol specification, not an implementation.**

Not an academic document — a precise state machine, with every transition, every
message on the wire, and what each side is allowed to believe at each step. It
exists so the design can be attacked on paper, where a mistake costs an
afternoon rather than a migration and a disclosure.

Nearly every real-world failure in systems like this has been a **protocol** flaw
rather than a broken primitive: a key silently substituted, a message replayed,
a revocation quietly dropped. AES and ECDH will not be the weak part. The
sequencing will.

### The state machine to specify

```
Account creation
    ↓
Identity creation
    ↓
DM encryption enabled
    ↓
Conversation-key distribution
    ↓
Message send / receive / delete
    ↓
New device
    ↓
Device verification
    ↓
Device removal
    ↓
Lost device
    ↓
Backup restore
    ↓
Key rotation
```

For each transition the spec must state: what is sent, what is stored, what each
party can verify **without trusting the server**, and what happens when a step
is repeated, arrives out of order, or never arrives at all.

### Then attack it

Assume the server is hostile — not merely compromised later, but adversarial
now. For every transition above, ask whether the server can **lie, replay,
replace, delay, or suppress** without either user noticing. If the answer is
yes, the design is wrong there, however sound the cryptography is.

Known attack surfaces to work through, at minimum:

| Transition | What a hostile server could try |
|---|---|
| Identity creation | Hand your correspondent **its own public key** instead of yours, and sit in the middle. This is the classic break, and it is why the six numbers must derive from the shared secret. |
| Conversation-key distribution | Add a member nobody invited, and wrap the key for them too. Who is authorised to *say* the member list, if not the server? |
| Message send | Replay an old ciphertext. Reorder. Drop one silently. |
| **Message delete** | **Claim delivery that never happened**, so the server-side copy is deleted and the recipient never sees it. This one is created by delete-on-delivery and does not exist in the original design. |
| New device | Register a device the account owner never approved. |
| Device removal | Accept the removal, report success, keep delivering. |
| Lost device | Serve a stale key bundle so a revoked device still decrypts. |
| Key rotation | Suppress the rotation, keeping a removed member able to read what follows. |
| Backup restore | Roll a user back to an older backup to reinstate keys they retired. |

The suppression case in bold deserves its own answer before anything is built.
"Delivered" is currently a claim the server makes to itself, and the entire
retention model hangs off it. **A delivery receipt the recipient signs** is the
obvious direction — the server deletes on proof of receipt rather than on its
own say-so — but it needs specifying, not assuming.

### What the spec must produce

- A wire format for every message, with versioning from day one.
- A statement, per step, of what is verified **locally** versus taken on trust.
- The failure behaviour for each: fail closed, warn, or proceed. Silent
  proceeding is the wrong answer everywhere here.
- A written threat model naming what is explicitly **not** defended against —
  metadata, a compromised endpoint, screenshots.

## Why the gate is real

Shipping this needs the native apps, and not arbitrarily:

- mDNS discovery for §4 **is not available to a browser**.
- With delete-on-delivery, the client is the only copy. Browser IndexedDB, which
  a user can wipe by clearing site data without understanding what they lost, is
  not an acceptable sole home for that.

This resolves the open question in `PRODUCT.md` — *"whether E2EE ships before or
after the desktop shell"* — as **after**, necessarily.

## Still open

Carried from the original: backup code format and length, whether 0–21 means 21
or 22 values (both devices must agree), PBKDF2 iteration count, key bundle
re-wrap on backup-code regeneration, and whether reactions are encrypted.

New here:

- **How "delivered" is proven.** See the protocol section — the retention model
  deletes on it, and today it is the server's unverified claim.
- Backup file format, and whether export is manual or prompted on a schedule.
- Whether LAN sync is automatic or opt-in per device pair.
- What the sender sees when a message hits the 14-day drop.
- Whether a stealth session can be started from an already-encrypted DM, or is
  always its own surface.
