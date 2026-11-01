# Passport v2
How a person signs in to a web service with a Fabric identity.

Passport v2 replaces the earlier site login (`SITE_LOGIN_REQUEST`,
`SITE_LOGIN_RESPONSE`, `FABRIC_SIGN_REQUEST`, `0x4230`–`0x4232`), Hub
delegation signing, and `fabric://login` deep links. Nothing is compatible
with them: the old frames are unknown types and are refused.

Code: `functions/passport` (frames), `functions/accountKeys` (keys),
`@fabric/http` `functions/passportRelyingParty`, `functions/passportHttp`,
`functions/passportPage`, and `functions/fabricDelegate`. A sign-in answered
by another participant (a desktop app, a Hub) is a delegation request:
[DELEGATION.md](DELEGATION.md).

## Parties
- **Relying party (RP).** The website. It pins the origins it serves and
  issues challenges only for them.
- **Signer.** Holds the user's keys and answers challenges. One of:
  - `passport` — the Passport browser extension;
  - `hub` — the Hub desktop app;
  - `gooncitizen` — the GoonCitizen desktop or Android app.
- **Page.** The RP's own page in the user's browser. It carries frames between
  the RP and Passport and learns nothing it could reuse.

## Who vouches for the origin
Every sign-in path answers one question: who says which website is asking?

| Path | Who vouches for the origin |
|---|---|
| Page through Passport | The browser (`sender.origin` in the extension) |
| Page through Passport, signed by a delegate | Passport, which saw the origin. The delegate answers only a requester it granted `passport` scope to (after pairing), for the origins that grant allows; Passport sends requests only to delegates it paired with. |
| Native client (GoonCitizen or Android signing in to its relay; the Hub desktop shell signing in to its own Hub) | The client, because it opened the connection itself |

There is no deep link or QR login: a desktop can't tell which page launched a
link, so a phishing page could get a valid login for another site. No server
signs on anyone's behalf.

## Keys
One seed, held as a master xprv. Each account index `n` on each network
derives three unrelated keys (`functions/accountKeys` `deriveAccount`):

| Key | Path | Used for | Who sees it |
|---|---|---|---|
| Identity | `m/7777'/F'/n'/0/0` | Sign-in, Fabric messages | Every site you sign in to (pubkey only) |
| Wallet, SegWit | `m/84'/B'/n'` | Every new receive and change address | Only a site you agree to share your wallet with |
| Wallet, standard | `m/44'/B'/n'` (watched as `pkh`) | Watched and spendable; never hands out addresses | Same |
| Cosigner | `m/87'/B'/n'/0/0` (BIP87) | Group wallets, escrow, federations | Only a site you agree to share your escrow key with, in an assertion your identity signs |

`F` is 7777 on mainnet and 7778 elsewhere; `B` is 0 on mainnet and 1
elsewhere. The same index on two networks gives unrelated keys. See
[IDENTITY.md](../IDENTITY.md) for storage and the two passwords.

The identity xpub is never sent. A sign-in proves only the identity pubkey.

## Lifetimes
- A challenge lives 2 minutes by default (`PASSPORT_DEFAULT_TTL_MS`).
- No frame may live longer than 3 minutes (`PASSPORT_MAX_TTL_MS`).
- Clocks may differ by up to 30 seconds (`PASSPORT_CLOCK_SKEW_MS`).
- An assertion, or a delegation request carrying a challenge, never outlives
  that challenge.

## Frames
Both are Fabric wire `Message`s with typed bodies, carried as `fabric:`
strings (`functions/fabricUri`). They are never relayed on the mesh: `Peer`
has no handler for them. Every frame carries `v: 2`.

### `PASSPORT_CHALLENGE` (`0x4240`), from the RP

| Field | Meaning |
|---|---|
| `origin` | The RP's origin (`http:` or `https:`, no path or credentials) |
| `nonce` | 32 random bytes, hex |
| `issuedAt`, `expiresAt` | Milliseconds |
| `purpose` | Shown to the user; at most 140 characters |
| `network` | Optional. The network the RP runs on; the signer derives on that network's paths |
| `request` | Optional. `wallet` and/or `cosigner` |

The RP may sign it with its own key but doesn't have to. Its `origin` is only
what the RP claims: the signer compares it with the origin it saw and refuses
a mismatch.

### `PASSPORT_ASSERTION` (`0x4241`), from the signer
Signed by the identity key.

| Field | Meaning |
|---|---|
| `origin` | The origin the signer saw, never one the page supplied |
| `nonce` | The challenge's nonce |
| `challengeHash` | sha256 of the challenge frame bytes |
| `issuedAt`, `expiresAt` | `expiresAt` is no later than the challenge's |
| `network` | The network whose paths the signer used; equals the challenge's when it named one |
| `pubkey` | The identity pubkey (compressed); must be the frame's author |
| `identityId` | Fabric id of `pubkey` |
| `signer` | `passport`, `hub`, or `gooncitizen` |
| `device` | When a delegate signs: the pubkey of the participant that asked |
| `wallet` | Only when requested and agreed to: both account xpubs for the network (depth, parent fingerprint, and child number zeroed) and their watch descriptors, no key origins, `receive: 'segwit'` |
| `cosigner` | Only when requested and agreed to: `{ pubkey, proof }` |

The cosigner proof is a cosigner-key BIP340 signature under the
`Fabric/PassportCosigner` tag over
`fabric-cosigner:1\n<scope>\n<identity pubkey>\n<cosigner pubkey>`, with scope
`passport:<origin>:<challengeHash>`. It can't be replayed to another site or
another sign-in. Only the cosigner key signs it, so on its own it is just the
cosigner's claim; the identity's signature over the assertion is what ties
the two. Applications use the same proof with their own scope (for example
`group:<contractId>` for GoonCitizen group wallets), always inside a message
the identity key signs.

### Delegated sign-ins
`PASSPORT_SIGN_REQUEST` (`0x4242`) is retired: readers refuse it and the
number stays reserved. Passport asks a delegate to sign in for it with a
`DELEGATION_REQUEST` embedding the challenge, under a `passport` grant from
that delegate ([DELEGATION.md](DELEGATION.md)). The request carries the origin
Passport saw (equal to the challenge's), the account index, and what the user
agreed to `disclose` (each item asked for by the challenge).

## Verification
`verifyAssertion(uri, { origin, nonce, challengeHash, network, allow,
challengeExpiresAt, signers })` refuses:

- a version other than 2, or an unknown frame type (including the old
  `0x4230` series);
- an origin, nonce, or `challengeHash` other than the ones the RP stored;
- a network other than the challenge's;
- a `wallet` or `cosigner` the challenge didn't ask for (`allow`);
- wallet xpubs serialized for another network, or descriptors that don't match
  them;
- a cosigner proof that doesn't verify for this identity and sign-in, or a
  cosigner key equal to the identity key;
- a pubkey that isn't the frame's author, or an `identityId` that doesn't match
  it;
- an expired, future, or overlong lifetime, or an assertion that outlives its
  challenge.

Redeeming each challenge once is the RP's job (below).

## Relying party
`@fabric/http` `createPassportRelyingParty`:

- **Pinned origins.** `pinnedOrigins` is required. Empty in production refuses
  to start; elsewhere it allows loopback origins only. The origin is never
  derived from the `Host` header.
- **Binding secret.** `issueChallenge` returns the challenge plus 32 random
  bytes. The store keeps `sha256(secret) → { nonce, origin, challengeHash,
  network, request, expiresAt }`; the browser keeps the secret in an HttpOnly
  cookie. An assertion lifted from the page is useless without that cookie.
- **Redeem once.** `redeem(secret, assertion)` takes the record out of the
  store atomically before verifying anything, so two concurrent redeems can't
  both succeed. Stores implement `put`, `take`, `get`, and `delete`; an
  in-memory store ships, and a persistent one runs `take` on a serialized
  queue.
- **Sessions.** Random tokens stored as sha256(token), carrying `{ identityId,
  pubkey, network, signer, origin, wallet?, cosigner?, expiresAt }`.

### HTTP routes
`@fabric/http` `createPassportHttp`:

| Route | What it does |
|---|---|
| `POST /sessions/challenges` | Returns `{ challenge, expiresAt }` and sets the `fabric.passport` binding cookie (HttpOnly, `SameSite=Strict`, path `/sessions`) |
| `POST /sessions { assertion }` | Redeems with the binding cookie; sets the `fabric.session` cookie (HttpOnly, `SameSite=Strict`, `Secure` on https) and returns the session |
| `GET /sessions/current` | The current session (cookie or `Authorization: Bearer`) |
| `DELETE /sessions/current` | Ends it |
| `POST /sessions/self` | Optional (`selfSign`). A direct loopback request, without proxy headers, from the host's own loopback origin signs in as the host's own identity. The Hub desktop shell uses it. |

A native client says so with `X-Fabric-Native: 1` and sends no `Origin`
(browsers always send `Origin` on POST and DELETE, and pages can't remove it).
It gets the binding as `binding` in the challenge body, sends it back as
`X-Fabric-Binding`, and receives a Bearer `token` instead of a cookie. A
browser request never receives a token.

Apps may mount the same relying party under other paths (goon.vc uses
`/services/members/passport/*`).

## Page protocol
`@fabric/http` `functions/passportPage` is the page side:

1. The page asks whether Passport is there: it posts `{ source: 'fabric-site',
   type: 'PASSPORT_HELLO', v: 2 }` to its own origin and transfers one end of a
   `MessageChannel`. Passport answers on that port `{ type: 'PASSPORT_HELLO',
   v: 2 }`, in top-level frames only. Nothing marks pages that don't ask, and
   the answer carries no extension id.
2. The page fetches a challenge from its RP.
3. The page posts `{ source: 'fabric-site', type: 'PASSPORT_CHALLENGE',
   challenge }` to its own origin and transfers one end of a `MessageChannel`.
   A request without a port is refused.
4. Passport answers on that port only: `{ type: 'PASSPORT_ASSERTION', ok:
   true, assertion }` or `{ ok: false, error }`. Nothing else on the page can
   see or forge the answer.
5. The page posts the assertion to the RP, which checks it against the binding
   cookie.

Errors Passport may answer with: `rejected`, `timeout`, `expired`, `busy`,
`replaced`, `challenge_replayed`, `passport_unavailable`,
`invalid_challenge`, `origin_mismatch`.

Passport keeps at most one pending request per tab and frame, refuses an
origin of `"null"`, remembers seen nonces for the session, and re-checks
expiry when the user approves. Wallet and cosigner disclosures are checkboxes,
unchecked by default, shown only when the challenge asks.

## Delegates
`@fabric/http` `functions/fabricDelegate`, mounted by the Hub and GoonCitizen
desktop apps, takes `DELEGATION_REQUEST` and pairing frames from Passport on
loopback (`POST /services/delegation/requests`, `/services/delegation/links`).
The host's `decide` hook signs, declines, or turns the request into a
notification its user answers; the result is a `DELEGATION_RESULT` carrying
a `PASSPORT_ASSERTION` signed by the delegate's own account on the challenge's
network.

Callers must be a direct loopback socket naming a loopback `Host`, with an
`Origin` recorded from a grant's `extensionOrigin` or configured explicitly
(a bare `moz-extension://` origin is not enough). Because Firefox extension
ids are random per install, a `moz-extension://` origin may start pairing;
the grant Passport gives after the codes match must name that same origin,
and only then may it send requests. The request's author must hold an
unrevoked `passport` grant from the delegate covering the origin. Each
request is taken once (by frame hash). Wallet and cosigner keys are included only when
`disclose` lists them and the challenge asked; the prompt lists exactly what
is shared. Pairing shows the commit-then-reveal code on both screens before
any grant.

## Older clients
v2 accepts nothing from v1, and says so instead of failing obscurely:

- `probePassport(window)` (page helper) resolves `ready` when Passport answers
  the hello, `outdated` when it doesn't but an older Passport's
  `data-fabric-passport` marker is on the page, and `missing` otherwise. Pages
  ask the user to update Passport when it is `outdated`.
- `POST /sessions` answers 426 `{ error: 'passport_outdated', message }` when
  the body has no assertion, or carries a well-formed Fabric frame that isn't a
  `PASSPORT_ASSERTION` (v1's `SITE_LOGIN_RESPONSE` is `0x4231`), or an older
  `v`. Malformed input gets the usual 400. The challenge isn't spent.
- `POST /services/delegation/requests` answers 426 for anything but a
  `DELEGATION_REQUEST` (including the retired `PASSPORT_SIGN_REQUEST` and v1's
  `FABRIC_SIGN_REQUEST`), before any prompt.
- Passport reads a 404 from an older desktop's delegate routes, and 426, as
  "update the desktop app".

`@fabric/http` `passportOutdated(input, type)` is the check; apps with their
own routes (goon.vc) use it too.

## What this protects against
- **A stolen assertion** (page script, extension leak, log) can't be redeemed
  without the HttpOnly binding cookie.
- **Replay**: each challenge is taken out of the store before it is verified.
- **A spoofed `Host`**: origins are pinned, never derived from the request.
- **A phishing page** gets an assertion for its own origin only; the browser,
  not the page, names the origin.
- **Cross-site tracking through keys**: the identity xpub is never sent, and
  wallet or cosigner keys go only where the user agreed. Shared xpubs carry no
  depth, parent fingerprint, child number, or key origin, so two accounts
  can't be linked to one seed through them.
- **A delegate signing for a stranger**: only for a requester it granted
  `passport` scope to after a matched pairing code, for the origins granted,
  from a recorded Passport origin on loopback, after its user's prompt or one
  of its own rules.
- **Server-held signing power**: a login is a session scoped to one site. A
  delegate signs with its own keys only, under grants its user made.
