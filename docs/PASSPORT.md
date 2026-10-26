# Passport v2
How a person signs in to a web service with a Fabric identity.

Passport v2 replaces the earlier site login (`SITE_LOGIN_REQUEST`,
`SITE_LOGIN_RESPONSE`, `FABRIC_SIGN_REQUEST`, `0x4230`–`0x4232`), Hub
delegation signing, and `fabric://login` deep links. Nothing is compatible
with them: the old frames are unknown types and are refused.

Code: `functions/passport` (frames), `functions/accountKeys` (keys),
`@fabric/http` `functions/passportRelyingParty`, `functions/passportHttp`,
`functions/passportPage`, and `functions/fabricLocalSigner`.

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
| Page through Passport, signed by a desktop app | Passport, which saw the origin. The desktop answers only Passport devices in its identity cluster, after pairing; Passport accepts only desktops it pinned when pairing. |
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
- An assertion or sign request never outlives its challenge.

## Frames
All three are Fabric wire `Message`s with typed bodies, carried as `fabric:`
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
| `device` | When a desktop signs: the pubkey of the Passport device that asked |
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

### `PASSPORT_SIGN_REQUEST` (`0x4242`), from Passport to a desktop app
Signed by the Passport device key.

| Field | Meaning |
|---|---|
| `origin` | The origin Passport saw; must equal the challenge's |
| `nonce` | Fresh, 32 bytes hex; the desktop spends it once |
| `issuedAt`, `expiresAt` | No later than the challenge's expiry |
| `challenge` | The RP's challenge frame |
| `account` | The account index the desktop signs with |
| `disclose` | What the user agreed to share in Passport; each item must be requested by the challenge |

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

1. Passport's content script sets `data-fabric-passport="2"` on `<html>`. It
   does not carry the extension id.
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

## Desktop signers
`@fabric/http` `functions/fabricLocalSigner`, mounted by the Hub and
GoonCitizen desktop apps:

- `GET /services/fabric/identity` names the desktop identity; with `?pubkey=`
  it says whether that device is linked, to Passport origins only.
- `POST /services/fabric/sign` takes a `PASSPORT_SIGN_REQUEST` and, once the
  user approves in a native dialog, returns a `PASSPORT_ASSERTION` signed by
  the desktop's own account on the challenge's network.
- `POST /services/fabric/link { sessionId }` accepts a device-link offer made
  on that app, after the user matches a six-digit pairing code
  (`pairingCode(a, b)`, derived from both pubkeys and shown on both devices).

Callers must be a direct loopback socket naming a loopback `Host`, with an
`Origin` that is Passport: a configured `chrome-extension://<id>`, or any
`moz-extension://` origin (Firefox ids are random per install). A sign
request's author must be a device in the app's identity cluster. Nonces are
spent once and forgotten only 30 seconds after their request expires; requests
issued before the process started are refused. Link and sign prompts have
separate slots, and link prompts come at most once every 30 seconds. Wallet
and cosigner keys are included only when `disclose` lists them and the
challenge asked; the dialog lists exactly what is shared.

## Older clients
v2 accepts nothing from v1, and says so instead of failing obscurely:

- `passportStatus(document)` (page helper) is `ready` for marker `2`,
  `outdated` for any other marker value, and `missing` without one. Pages ask
  the user to update Passport when it is `outdated`.
- `POST /sessions` answers 426 `{ error: 'passport_outdated', message }` when
  the body has no assertion, or carries a well-formed Fabric frame that isn't a
  `PASSPORT_ASSERTION` (v1's `SITE_LOGIN_RESPONSE` is `0x4231`), or an older
  `v`. Malformed input gets the usual 400. The challenge isn't spent.
- `POST /services/fabric/sign` answers 426 the same way for anything but a
  `PASSPORT_SIGN_REQUEST` (v1 sent `FABRIC_SIGN_REQUEST`, `0x4232`), before any
  prompt.
- Passport reads a v1 desktop's refusals (403 "web pages cannot call the local
  signer", 400 "unknown message type") and 426 as "update the desktop app".

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
- **A desktop signing for a stranger**: only paired devices in its identity
  cluster, from Passport origins, on loopback, after a native prompt.
- **Server-held signing power**: there is no delegation. A login is a session
  scoped to one site.
