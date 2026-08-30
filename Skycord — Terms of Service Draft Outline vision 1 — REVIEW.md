# Review — Terms of Service Draft Outline (vision 1)

Not legal advice; I'm not a lawyer. This is a structural and product review —
what's missing, what's risky, what contradicts the product as it actually
exists, and what order to decide things in.

The draft is genuinely good. It already does the two hardest things: it
separates **the software** from **the hosted service**, and it refuses to
pre-decide the sections that need a real answer first. Most of what follows is
addition, not correction.

---

## 1. The blocking dependency: decide where you operate

Four sections are stubbed, and they are all stubbed on the *same* unknown:

- §1 age requirement
- §9 government and legal requests
- §17 limitation of liability
- §18 governing law and jurisdiction

None of them can be written until you decide **what legal entity, in what
country, operates skycord.xyz**. This isn't a detail to fill in last — it
determines whether GDPR applies, what "18+" even means contractually, whether
you can limit liability at all, and who you'd be responding to in §9.

**Do this first.** Everything else in the document is cheap by comparison.

---

## 2. §6 (E2EE) should not ship yet — it contradicts §5

This is the one thing in the draft I'd call a real risk.

§5 states the right rule:

> *Privacy and encryption claims must describe the actual implementation of the
> version being operated, rather than planned functionality.*

§6 then describes E2EE and Stealth sessions in the present tense — and **neither
exists**. E2EE is a roadmap item whose protocol spec is still being revised
(`docs/superpowers/specs/2026-08-30-e2ee-revision.md`), and writing that spec
found a hole in the design. Stealth mode has no implementation at all.

Publishing security claims ahead of the code is the classic way a project ends
up on the wrong end of a deceptive-practices complaint, and it's exactly the
failure §5 was written to prevent.

**Recommendation:** cut §6 entirely from v1. Replace with one honest line:

> Skycord does not currently offer end-to-end encrypted messaging. Messages on
> the hosted service are encrypted in transit and stored on the server in a form
> the server can read. If and when end-to-end encryption ships, these Terms and
> the Privacy Policy will describe what it actually does.

Then bring §6 back, fully, the day it ships. Keep the drafted text — it's good,
and the metadata caveat and the "we don't claim to stop screenshots" paragraph
are both the right instincts. It's just early.

The same applies to the app's voice UI, which already says
*"Encrypted in transit (DTLS-SRTP)"* rather than "end-to-end encrypted." The
ToS should match that honesty.

---

## 3. Missing sections

Ordered by how much they'd hurt to be without.

### 3.1 Copyright / DMCA-style takedown — **missing entirely**

You host user-uploaded content on a public service. Without a stated
notice-and-takedown process and a designated agent you may forfeit safe-harbour
protection in the jurisdictions that offer it. Needs: how to send a notice, what
it must contain, counter-notice, and repeat-infringer policy.

### 3.2 Trademark and naming — **missing, and it's the tool you actually need**

§2 and §8 work hard to separate "Skycord the software" from "Skycord the
service" — and then give away the only mechanism that enforces that separation.

AGPL-3.0 licenses the **code**. It does not license the **name**, the logo, or
the domain. Right now nothing stops a self-hoster calling their instance
"Skycord" and having users believe it's yours — which is precisely the confusion
§2 exists to prevent, and it's a reputational and legal exposure when their
instance does something you'd never allow.

Add something like: the Skycord name and mark are not licensed under the AGPL;
self-hosted instances may say they are "powered by Skycord" but may not present
themselves as the official Skycord service, use the Skycord logo as their own
mark, or use a confusingly similar domain.

This costs you nothing and is the single highest-value addition to the document.

### 3.3 Donations — **missing, and you have concrete plans**

Donation-supported is the stated model. Once a donate button exists you need
terms: donations are voluntary and non-refundable, they are **not** a purchase
and confer no service level, no features, no priority support and no ownership,
and who the payment processor is. Without this, a donor has a plausible argument
that they bought something.

### 3.4 Prohibited conduct that is legal but unacceptable — **gap in §3**

§3 bans *unlawful* activity in six different phrasings. It doesn't ban anything
that's lawful-but-intolerable, which means you have no contractual footing to
remove someone doing it. Add explicitly:

- harassment, targeted abuse, threats
- spam, mass unsolicited messaging, automated account creation
- malware distribution, phishing
- **CSAM — state this explicitly and separately**, with zero tolerance and
  reporting-to-authorities language; do not leave it inside "unlawful"
- impersonation of others, including of Skycord staff
- scraping, automated bulk collection of user data
- resource abuse: crypto mining, using voice/media infrastructure as a relay,
  deliberate load

Also **apply the draft's own "Wording to reconsider" note.** It's right, and it
should just become the text rather than remaining a note about the text.

### 3.5 User-initiated termination — **missing**

§11 covers *you* terminating *them*. Nothing covers a user deleting their own
account: how they do it, what's deleted, what isn't (messages already delivered
to other people's conversations, which you cannot and should not unilaterally
remove), and how long deletion takes.

### 3.6 Reporting — **missing**

§19 lists abuse reports as a contact reason. There's no statement that users
*can* report, what happens when they do, or any expectation about response.

### 3.7 Standard clauses — **missing**

Severability, entire agreement, no waiver, assignment, and a
no-third-party-beneficiaries clause. Boilerplate, but their absence is noticed
by anyone reviewing the document seriously.

### 3.8 Pre-release status — **missing, and currently true**

Skycord is v0.14. Say so: the service is under active development, features may
change or be removed, and data loss, while not intended, is possible. This is
honest and it does real work for §17.

---

## 4. Scope is now wrong — you're adding tools

The header says:

> Applies to: skycord.xyz hosted service

You're about to launch `share.skycord.xyz`, with more tools after it. Decide now
whether the ToS covers subdomains, and write it as *"skycord.xyz and the
services operated at its subdomains, including app.skycord.xyz and
share.skycord.xyz"* rather than discovering the gap later.

The screen-share tool in particular raises things the current draft doesn't
touch: users sharing content they don't have the right to share, users recording
a session, and whether you retain anything about a session at all. Worth one
clause, and worth deciding the retention answer before launch rather than after.

---

## 5. The 18+ decision

The draft correctly flags this as the thing to lock down. Two things to weigh:

**In favour of 18+:** it removes COPPA, GDPR Article 8 parental-consent
mechanics, and the country-by-country minimum-digital-age patchwork in one line.
For a small project with no legal team, that simplification is worth a great
deal.

**Against:** Discord is 13+, and the audience for a Discord alternative skews
younger than 18. You will turn away real users, and you'll turn away exactly the
educational use-case that's in the product plan — schools and universities are
full of under-18s. **These two goals are in direct conflict and you should
resolve that before writing either.**

**The trap either way:** an age rule you don't enforce is worse than a lower one
you do, because you've made an assertion you can't back. If you say 18+, you
need at minimum a date-of-birth field at signup, a stated process for what
happens when you learn a user is underage, and you must actually act on it. If
that's not something you want to build, choose an age you're willing to enforce.

Also: §1 states the requirement in the body *and* in a sub-block. Say it once.

---

## 6. Section-level notes

**§2 and §8 are the same section.** Both cover self-hosted operator
responsibility, with overlapping lists. Merge into one; the "Skycord software ≠
Skycord hosted service" framing in §2 is the strongest writing in the document
and should lead it.

**§2 should mention AGPL §13.** Self-hosters who modify Skycord and let others
use it over a network are obliged to offer those users the source. Most people
running an AGPL app do not know this. Telling them is both a kindness and
protects the licence.

**§9 — reframe from defensive to committal.** "Skycord does not promise to
ignore lawful requests" is honest but reads like it's bracing for impact. State
what you *will* do: respond only to legally valid requests properly served,
notify affected users where you are legally permitted to, publish a transparency
report if you intend to (and don't say it if you don't). Also decide whether you
want a warrant canary — if yes, it must exist from day one, because starting one
later says nothing.

The "we cannot produce plaintext we don't have" example is good — but see §2 of
this review: it's only true once E2EE exists. Today the server *can* read
messages. Don't imply otherwise.

**§12 — say there's no SLA and the service is free.** Both are true and both
matter for §17.

**§16 — this one is nearly complete.** Just add: material changes get notice
(in-app or email) and an effective date, and continued use after that date is
acceptance. Note that if you keep "we may change the age requirement" in §1,
this section is what makes that fair.

**§13 — correct as written.** The AGPL/ToS distinction is stated better here
than in most projects' documents.

---

## 7. Structure

The "Other stuff" note at the end has the right answer and should be promoted to
a decision:

```
/legal
    TERMS.md
    PRIVACY.md
    SELF_HOSTING.md
    ACCEPTABLE_USE.md      ← split out; it's the section that changes most
    LICENSE.md
```

with `SECURITY.md` (reporting a vulnerability) either here or at the repo root.

Website tabs: **Terms · Privacy · Acceptable Use · Self-hosting · Security ·
Open Source**.

One process suggestion: the draft mixes the terms themselves with notes to self
("Wording to reconsider", "Leave this section for legal review", "This should be
written very carefully after…"). That's exactly right for an outline, but keep
those notes in a separate `DRAFTING-NOTES.md` when the real text is written, so
nothing addressed to you ever ships to users.

---

## Suggested order of work

1. **Decide the operating entity and jurisdiction.** Everything else waits.
2. **Decide the age rule**, and reconcile it with the educational plan.
3. **Cut §6** and replace it with the honest one-liner.
4. **Add trademark/naming** — cheapest, highest value.
5. **Add DMCA/takedown, prohibited conduct, user termination, donations.**
6. **Merge §2 and §8**; apply §3's own wording note.
7. **Widen scope to subdomains** before `share.skycord.xyz` launches.
8. **Then** get the whole thing reviewed by an actual lawyer in the jurisdiction
   from step 1 — with §17 and §18 still blank, so they fill them.

Steps 1–7 are things only you can decide. Step 8 is what a lawyer is for, and
they'll do it faster and cheaper against a document that already made these
decisions.
