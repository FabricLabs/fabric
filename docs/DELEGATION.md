# Delegation
How one key holder asks another to sign for it.

A *participant* is anything that holds a Fabric key: Passport, a Hub,
GoonCitizen, an Android node. Participants never share keys, seeds, or
storage. Each keeps its own key and records every delegation frame it sends or
receives in its own store, so its history replays as a
`FabricMessageCollection`.

- **Pairing** lets two participants learn each other's key safely: both
  screens show the same six-digit code, fixed by a commit-then-reveal
  exchange.
- A **grant** lets another participant ask you to sign, for the kinds of
  request it lists. Grants run one way. A mutual pair of `identity` grants
  means "the same person".
- A **request** asks the other side to sign one embedded frame. It becomes a
  notification in the recipient's own notification system; the user signs or
  declines, unless one of that participant's own rules answers first (Hub).

Authority comes only from the recipient's own grants. A rendezvous or mailbox
carries frames and decides nothing.

Code: `functions/delegation` (frames, pure), `types/delegation` (one
participant's state), `@fabric/http` `functions/fabricDelegationHttp`
(rendezvous), `functions/fabricDelegationMailbox`, `functions/fabricDelegate`
(loopback answers), and `functions/fabricDelegationClient`.

Delegation replaces `PASSPORT_SIGN_REQUEST` (`0x4242`, retired: no schema,
refused by readers, number reserved), the `IdentityCrossSign` /
`IdentityCrossSignRevoke` strings, and the device-link v2/v3 HTTP protocol.
Nothing is compatible with them.

## Frames
Every frame is a Fabric wire `Message` with a typed body, signed by its author
(BIP340), carried as a `fabric:` string, and never flooded on the mesh. Every
body carries `v: 1`. Link frames and mailbox reads live at most 3 minutes;
requests at most 24 hours (default 10 minutes); grants, revokes, and results
carry only `issuedAt`. Clocks may differ by 30 seconds.

| Type | Code | Fields |
|---|---|---|
| `DELEGATION_LINK_OFFER` | `0x4243` | `pubkey`, `origin` (the rendezvous), `label`, `network`, `commitment`, `issuedAt`, `expiresAt` |
| `DELEGATION_LINK_ANSWER` | `0x4244` | `pubkey`, `offer` (hash), `nonce`, `label`, `issuedAt`, `expiresAt` |
| `DELEGATION_LINK_REVEAL` | `0x4245` | `answer` (hash), `nonce`, `issuedAt`, `expiresAt` |
| `DELEGATION_GRANT` | `0x4246` | `pubkey`, `grantee`, `link`, `scopes`, `origins`, `networks`, `cosigner`, `cosignerProof`, `extensionOrigin`, `label`, `issuedAt` |
| `DELEGATION_REVOKE` | `0x4247` | `grant` (hash), `issuedAt` |
| `DELEGATION_REQUEST` | `0x4248` | `pubkey`, `target`, `grant` (hash), `nonce`, `request` (inner frame), `origin`, `account`, `disclose`, `purpose`, `issuedAt`, `expiresAt` |
| `DELEGATION_RESULT` | `0x4249` | `request` (hash), `answer` (frame) or `refusal`, `rule`, `issuedAt` |
| `DELEGATION_MAILBOX_FETCH` | `0x424A` | `pubkey`, `since`, `nonce`, `issuedAt`, `expiresAt` |

A frame's hash is sha256 of its wire bytes. The link id is the offer's hash.

## Pairing
A (initiator) and B (responder) meet through a rendezvous.

1. A picks a secret nonce `nA` and sends an offer with
   `commitment = sha256("fabric-pairing:2:commit\n" xA "\n" nA)`.
2. B answers with its own nonce `nB`.
3. A reveals `nA`; B checks it against the commitment.
4. Both show `SAS = sha256("fabric-pairing:2:sas\n" xA "\n" xB "\n" nA "\n" nB "\n" linkId)`,
   first four bytes as an unsigned integer, mod 10^6, six digits.

`xA` / `xB` are x-only pubkeys. A commits to `nA` before seeing `nB`, and B
picks `nB` without seeing `nA`, so neither side (nor anyone in the middle) can
grind for a matching code: a man in the middle matches with odds of one in a
million per attempt. The user confirms the codes match; only then does either
side grant anything. Offers and answers carry their author's compressed
`pubkey` (it must match the frame's signer), so each side can address a grant
to the other once the codes match.

## Grants
A grant names its `grantee` and the `link` it came from (the reveal hash, or
empty for a key the user already knew). `scopes` is any of:

| Scope | The grantee may ask for |
|---|---|
| `identity` | Nothing by itself; a mutual pair means "the same person" (actor rollups, profile sync) |
| `passport` | A `PASSPORT_ASSERTION` answering a `PASSPORT_CHALLENGE` |
| `federation` | A signature on a `FederationInvite` or `FederationWithdrawalRequest` |
| `message` | The grantor's signature on an unsigned `GENERIC_MESSAGE`, `P2P_CHAT_MESSAGE`, or `CHAT_MESSAGE` |

`origins` limits Passport sign-ins to those sites; `networks` limits the
network. A grant may disclose the grantor's cosigner key (BIP87) with a core
`cosignerProof` under scope `delegation:<grantee>:<link or ->:<issuedAt>`, so
the grantee can build a shared wallet from it. `extensionOrigin` records
Passport's `chrome-extension://` or `moz-extension://` origin; desktop
delegates accept Passport calls only from origins recorded this way or
configured explicitly.

`DELEGATION_REVOKE` withdraws a grant. Only its grantor may revoke it.

## Requests
A request embeds exactly one frame to sign and names the target's grant to the
requester. The target checks it against its own grants (`authorize`): the
grant exists, was made by the target to this requester, isn't revoked, covers
the scope, and allows the origin and network. A federation withdrawal names
only its federation, so under a network-limited grant the target resolves the
network from its own federation record (`networkOf`), or refuses.

- **Passport.** The inner frame is the site's `PASSPORT_CHALLENGE`. `origin`
  is what the requester (Passport) saw and must equal the challenge's;
  `disclose` may list only what the challenge asked for; the request never
  outlives the challenge. The target answers with `answerPassport`: an
  assertion for that origin naming the requester as `device`.
- **Federation.** The inner frame is a signed federation `CONTRACT_MESSAGE`
  (`FederationInvite` or `FederationWithdrawalRequest`). The target rebuilds
  and checks it like any federation message before signing.
- **Message.** The inner frame is an unsigned chat or generic frame; the
  answer is that frame signed by the target. A request can never obtain a
  signed protocol frame (a grant, an assertion, a federation message) from
  the target's identity key.

The answer goes back in a `DELEGATION_RESULT`, signed by the target, carrying
the signed frame (by the target's identity key, or the cosigner key its grant
disclosed) or a refusal. `rule` names the target's rule when one decided.

## Notifications
`notificationFor(read)` gives the one shape every app renders:

```js
{
  kind: 'DelegationRequest',
  title: 'Sign in to goon.vc',
  summary: 'Passport asks you to sign in to goon.vc for it.',
  from: { pubkey, label },
  scope: 'passport',
  priority: 'high',
  actions: ['sign', 'decline'],
  expiresAt,
  request: '<request hash>'
}
```

Passport stores it as a `notification:DelegationRequest:<hash>` record with a
`chrome.notifications` toast; Hub lists it in Notifications (and a tray toast
opening the native dialog); GoonCitizen adds it to its inbox. Each prompts its
own user.

## One participant's state
`types/delegation` keeps, in the participant's own store (collection
`delegations`): links (the initiator's secret nonce until confirmed), grants
given and received, revocations, the requests it was asked (`inbox`) and
asked (`outbox`), and every frame. `receive(frame)` takes any frame addressed
to it; an authorized request emits `request` with its notification. The app
answers with `sign(hash, frame)` or `decline(hash, reason)` and sends the
returned result wherever the request came from. Writes are serialized.

## Transport
`@fabric/http` serves three things, none of which decide anything:

- **Rendezvous** (`/delegations`): `POST /delegations { frame }` takes an
  offer and returns its link id; `POST /delegations/:id/frames { frame }` the
  next frame in order; `GET /delegations/:id` the frames so far; `DELETE`
  ends it. Each frame is checked with `functions/delegation` and stored until
  it expires.
- **Mailbox** (`/services/delegation/mailbox`): `POST { frame }` takes
  requests, results, grants, and revokes addressed to a pubkey, capped and
  rate-limited per address. `GET` returns them after a fresh
  `DELEGATION_MAILBOX_FETCH` in the `X-Fabric-Mailbox` header, whose nonce is
  spent once.
- **Delegate** (loopback): `POST /services/delegation/requests { frame }` and
  `/services/delegation/links { frame }` for Passport on the same machine. The
  host's `decide(request)` hook answers `sign`, `decline`, or `notify`.

## What this protects against
- **A grinding or relaying man in the middle** during pairing: commit-then-
  reveal SAS.
- **A stolen or relayed request**: the target acts only for the grantee its
  grant names, and the requester's signature covers the inner frame.
- **A request for more than was granted**: scope, origin, and network checks
  against the target's own grants.
- **Signing oracles**: protocol frames can't be delegated; chat frames must
  arrive unsigned.
- **A revoked delegate**: its requests are refused once the revoke arrives.
- **A mailbox reading someone else's frames**: reads need a fresh frame
  signed by the mailbox owner.
