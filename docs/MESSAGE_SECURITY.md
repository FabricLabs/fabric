# Message Security
How Fabric keys sign, and what a signature may be used for.

## Wire frames
A Fabric `Message` is signed over `taggedHash('Fabric/Message', header ‖ body)`.
`hash` in the header is double-SHA256 of the body; `Peer` drops a frame whose
body does not match it. `preimage` is single SHA256 of the body for ordinary
frames, zero when `sensitive: true`, or an explicit 32-byte value (HTLCs).

## Signing rules
Every BIP340 signature a Fabric key makes follows five rules. A wallet that
follows them cannot be made to sign something a site chose for it.

1. **The signer builds the bytes.** A request names fields (session, nonce,
   origin, peer key); the signer checks each one and builds the string or frame
   itself. It never signs bytes or a pre-built string handed to it.
2. **Each purpose has its own tag.** `Key#signSchnorr(msg, tag)` signs
   `taggedHash(tag, msg)` (BIP340 tagged hash). There is no untagged form: a
   call without a `Fabric/…` tag throws. A signature for one purpose never
   verifies for another, nor as a plain-SHA256 signature from another protocol
   (Nostr events, Bitcoin signed messages, other apps' raw Schnorr).
3. **Every signature names its audience and session.** Passport assertions
   carry the site origin, the challenge nonce, and the challenge hash; device links and identity cross-signs
   carry the origin, a 48-hex session id, and a 64-hex nonce. A signature for
   one site or session is useless at another.
4. **The key signed for must derive from what the user was shown.** A device
   link or cross-sign is only made for a key that derives from the id or xpub
   on screen, never for a key a server reports.
5. **One click per signature.** A prompt signs one thing. A new request while a
   prompt is open is answered `busy`; it does not replace what the user is
   reading.

## Tags
`functions/signingTags` lists every tag core signs under:

| Tag | Signed string |
|-----|---------------|
| `Fabric/Message` | Wire frame header ‖ body (`types/message`) |
| `Fabric/Sign` | Generic `Key#sign` / `Key#verify` |
| `Fabric/FederationWitness` | Threshold witnesses over canonical JSON naming its `kind` (Beacon epochs, federation blocks, execution runs, `Federation#sign`) |
| `Fabric/ContractState` | Contract-namespace state tip (`functions/contractStateSigning`) |
| `Fabric/SidechainState` | Sidechain state patch proposal (`functions/sidechainState`) |
| `Fabric/BlockAuthor` | Gossip block author signature |
| `Fabric/BLSBinding` | Link from a secp256k1 validator key to its BLS key |
| `Fabric/SessionKey` | Parent key binding a Peer session key |
| `Fabric/MessageReceipt` | `fabric:message-receipt:1:<id>` |
| `Fabric/ContractWithdrawalWitness` | Contract withdrawal witness |
| `Fabric/CircuitDecision` | Blinded-execution accept / reject |
| `Fabric/GroupChange` | GroupChangeProposal vote |
| `Fabric/PassportCosigner` | `fabric-cosigner:1\n<scope>\n<identity>\n<cosigner>` — a cosigner key vouching for its identity within one scope (a Passport sign-in, a delegation grant, a group contract) |
| `Fabric/OracleAttestation` | Oracle attestations (peering capability, price quotes) |
| `Fabric/FederationInvite` | Signed federation contract invites |

Add a tag there for every new purpose; do not reuse one whose strings could be
confused with yours.

## Passport sign-in
A site asks for a sign-in with a `PASSPORT_CHALLENGE` frame for its own pinned
origin (`functions/passport`: `createChallenge`). The signer reads it, takes
the origin from the browser (never from the frame), shows it, and on approval
answers with a `PASSPORT_ASSERTION` signed by the identity key. The assertion
names the origin, the nonce, the sha256 of the challenge, and the network, and
carries wallet or cosigner keys only when the challenge asked and the user
agreed. The site checks it with `verifyAssertion` and redeems the challenge
once, bound to an HttpOnly cookie in the browser that asked. No server signs
on the user's behalf and there is no delegation. Full spec:
[PASSPORT.md](PASSPORT.md).
