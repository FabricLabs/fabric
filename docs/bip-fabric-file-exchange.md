# BIP: Content-Addressed File Exchange over Peer Channels (Draft)

```
BIP: ????
Title: Content-Addressed File Exchange with Optional Bitcoin Settlement
Author: Fabric Labs <dev@fabric.pub>
Comments-URI: https://github.com/FabricLabs/fabric
Status: Draft
Layer: Applications
Type: Standards Track
Created: 2026-07-24
License: BSD-2-Clause
```

## Abstract

This document describes a peer-to-peer **file exchange** pattern for Bitcoin-adjacent networks: parties discover content by inventory, request delivery, and transfer bytes only after **explicit consent**. Priced content is delivered **sealed**: each chunk is encrypted under a key `K`, and the payment hash is `SHA256(K)`, so a P2TR HTLC atomically trades payment for the key that opens bytes the buyer may already hold.

The goal is a mailing-list-ready sketch that Bitcoin developers can review independently of any particular application stack. A concrete open-source profile is implemented in Fabric; test vectors are in [Appendix A](#appendix-a-test-vectors).

## Motivation

Bitcoin already settles value. Operators still need a **minimal, auditable** way to:

1. Advertise that a peer **holds** a blob (inventory).
2. Ask for that blob (request).
3. Receive bytes only when the holder **approves** (consent).
4. Optionally require an on-chain or HTLC payment keyed to the **same commitment** used in discovery.

Existing approaches (HTTP downloads, LN URL, ad-hoc torrents) do not share a single commitment usable both to identify content and as an HTLC payment hash. This BIP specifies that binding at a protocol level without mandating a particular transport beyond authenticated peer messaging.

## Definitions

- **Chunk** — A wire-sized piece of a file, at most `chunk_bytes` long (see [Chunking](#chunking)).
- **Content key `K_i`** — 32-byte AES-256-GCM key sealing chunk `i`; convergent (derived from the chunk) or random.
- **Chunk id** — `SHA256(ciphertext_i)` for a sealed chunk, `SHA256(plaintext_i)` for an unsealed one. Wire field `blobHashHex`.
- **Payment hash** — The 32-byte value an HTLC locks to. For sealed chunks it is `SHA256(K_i)`. Wire field `contentHashHex` (accepted aliases on ingest: `contentHash`, `paymentHashHex`). This document calls it `payment_hash`.
- **Document id** — The document tree root over the chunk leaves ([Document tree](#document-tree)). Wire field `merkleRootHex`; applications MAY keep a separate catalog id.
- **Inventory** — List of `{ id, size?, mime?, rate_sats?, payment_hash?, blobs? }` a peer is willing to discuss.
- **Consent** — Holder must approve before bytes leave their node (no silent auto-exfil on request alone).

## Specification

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", and "MAY" are to be interpreted as described in RFC 2119. An implementation is conforming when it follows every MUST in this section; sections marked *(informative)* are not normative.

### Messages (logical)

| Step | Message | From → To | Purpose |
|------|---------|-----------|---------|
| 1 | `inventory_request` | Buyer → Seller | Ask for catalog (`kind=documents`) or priced offers |
| 2 | `inventory_response` | Seller → Buyer | Items + optional `rate_sats` + `payment_hash` + chunk list |
| 3 | `document_request` | Buyer → Seller | Ask to receive document `id` (optionally chunk indices) |
| 4 | *(local)* approve/deny | Seller operator/policy | Consent gate |
| 5 | `file_send` | Seller → Buyer | One chunk per message (sealed when priced) |
| 6 *(priced)* | HTLC funding + claim | Buyer ↔ Seller | Claim reveals `K_i`, opening the chunk |

Fabric wire mapping: `P2P_INVENTORY_REQUEST` (`0x57`), `P2P_INVENTORY_RESPONSE` (`0x58`), `DocumentRequest`, `P2P_FILE_SEND`.

Transports MUST authenticate peers (e.g. Noise + static keys). Relays MUST NOT rewrite message bodies when forwarding, except as in [Private paid relay](#private-paid-relay-informative).

### Consent rule

When a seller holds `id` and receives `document_request`:

- **Consent mode (recommended for interactive nodes):** enqueue; send `file_send` only after approve.
- **Auto-fulfill mode (optional for bots):** may send immediately — MUST be explicit in node policy.

### Sealed commitment (primary)

For each chunk `P_i`:

1. **Key.** Convergent (default):
   - public scope: `K_i = taggedHash("Fabric/DocumentConvergentKey", 0x00 ‖ P_i)`
   - community scope with secret `s`: `K_i = taggedHash("Fabric/DocumentConvergentKey", 0x01 ‖ SHA256(s) ‖ P_i)`
   - private document: `K_i` is 32 random bytes per chunk; a seller MAY instead seal the whole document as one chunk under one random key.

   `taggedHash` is the BIP-340 construction `SHA256(SHA256(tag) ‖ SHA256(tag) ‖ msg)`.
2. **IV.** Convergent: `iv_i = taggedHash("Fabric/DocumentConvergentIv", K_i)[0..12]`. Private: 12 random bytes. A convergent key is only ever used for one plaintext, so a derived IV is safe.
3. **Seal.** `ciphertext_i = AES-256-GCM(K_i, iv_i, P_i) ‖ tag16`.
4. **Commit.** `payment_hash_i = SHA256(K_i)`; `chunk_id_i = SHA256(ciphertext_i)`.
5. **Deliver.** Ciphertext MAY be delivered before payment. `K_i` is revealed only by the seller's HTLC claim witness (or a key-reveal message after verified settlement).

Sellers MUST NOT advertise `SHA256(P_i)` or a plaintext file digest: for guessable content it is a confirmation oracle. It travels only with the key reveal.

Because convergent keys depend only on the chunk, identical chunks get identical chunk ids and payment hashes whoever seals them, and identical files the same document id: sellers of the same content meet in one offer book, and a buyer never pays twice for a chunk it already holds. The trade-off is confirmation of a file: anyone holding a candidate file can test whether a root is that file. Private documents (random keys) and community-scoped secrets avoid it.

#### Why `SHA256(K)` and not a tagged hash

The commitment is frozen as plain `SHA256(K_i)`. The claim leaf checks the preimage with a single `OP_SHA256` (see [HTLC template](#p2tr-htlc-template)), and a Lightning payment hash is likewise `SHA256(preimage)`, so the same `payment_hash` locks an on-chain HTLC or an LN payment with no extra opcode. `K_i` is already a domain-separated tagged hash (or 32 random bytes), so a second tag would add no separation, and would cost a second hash in every claim script and break the shared Lightning payment hash.

### Unsealed commitments

Unsealed content (free, or sold without secrecy) uses one of two commitments instead of a key:

- **Envelope (unsealed, single blob).** Build the whitelisted document fields `{ contentBase64, id, mime, name, revision, sha256, size }` as canonical JSON, encode as an **unsigned** AMP `DocumentPublish` message (64-byte signature field all zeros; a signed gossip frame MUST NOT be hashed), then `preimage = SHA256(envelope_bytes)` and `payment_hash = SHA256(preimage)`. The preimage is public to anyone with the document, so this path proves delivery of a known item, not secrecy.
- **Per-blob (unsealed, multi-blob).** `payment_hash = SHA256("Fabric/DocumentBlob" ‖ document_id ‖ 0x00 ‖ decimal(blob_index) ‖ 0x00 ‖ hex(chunk_id))`, with `document_id` and the strings in UTF-8. Note this is a prefix-tagged SHA256, not a BIP-340 tagged hash.

A buyer selects the commitment from the offer: `sealed` (encryption scheme `aes-256-gcm-convergent` for convergent keys or `aes-256-gcm-content` for random keys), else per-blob when the item lists blobs with hashes, else envelope. Any other scheme MUST be refused.

### Chunking

- **Chunk size.** `chunk_bytes = floor((MAX_MESSAGE_SIZE − overhead) × 3/4)` so the base64 body plus JSON fields fits one message. Fabric uses `MAX_MESSAGE_SIZE = 32768` with `overhead = 640` for unsealed chunks (24,096 bytes) and `overhead = 2048` for sealed chunks, which also carry an IV, payment hash, and inclusion proof (23,040 bytes). The chunk size is fixed per document; only the last chunk may be shorter. An empty file is one empty chunk.
- **Limits.** At most `MAX_DOCUMENT_BLOBS = 8192` chunks per document, so about 188.3 MiB at the unsealed chunk size. Receivers SHOULD bound incomplete transfers (Fabric: 64 at once, 8 per origin, 256 MiB total, expired after 10 minutes).
- **`file_send` fields.** `documentId`, `name`, `body` (base64 chunk bytes), `blobIndex` (0-based), `blobTotal`, `blobHashHex` (chunk id), `merkleRootHex` (document id); sealed chunks add `iv`, `scheme`, `paymentHashHex`, and `proof` (the inclusion proof, a hex list). Receivers MUST check `SHA256(body) = blobHashHex` and the proof against `merkleRootHex` before storing a chunk.
- **Resume.** Each chunk is independently addressed, verified, and (when priced) paid. A buyer resumes by sending `document_request` again for the indices it lacks; a seller MUST serve any listed index on its own. No session state is required.

### Document tree

Every document, sealed or not, has one tree, domain-separated and bound to its chunk count:

```
leaf_i = SHA256(0x00 ‖ chunk_id_i ‖ payment_hash_i ‖ iv_i)     // 32 + 32 + 12 bytes
node   = SHA256(0x01 ‖ left ‖ right)
// an odd last node is promoted unchanged to the next layer
root   = SHA256(0x02 ‖ uint32_be(n) ‖ top)                    // n = chunk count, 1..8192
```

For an unsealed chunk, `payment_hash_i` is 32 zero bytes and `iv_i` 12 zero bytes. When one key seals the whole document, every leaf carries that key's `payment_hash`.

Binding `payment_hash_i` and `iv_i` into each leaf means a seller cannot swap the key commitment for one chunk without changing the document id. The distinct prefixes keep a leaf from being read as a node, and the count in the root keeps a chunk list from sharing a root with a padded copy of itself (the CVE-2012-2459 ambiguity of Bitcoin's transaction tree), so repeated chunks are allowed anywhere. The inclusion proof is the list of sibling hashes from leaf to top, skipping levels where the node was promoted; positions follow from `blobIndex` and `blobTotal`. Receivers MUST reject a chunk whose proof does not open to `merkleRootHex`, and an offer whose listed leaves (all of them, or each with its proof) do not.

### P2TR HTLC template

One output, script-path only, BIP-341:

- **Internal key:** the NUMS point `50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0` (no key-path spend).
- **Claim leaf (seller):** `OP_SHA256 <payment_hash> OP_EQUALVERIFY <claim_x> OP_CHECKSIG`
  Witness: `<sig> <K> <claim_script> <control_block>`.
- **Refund leaf (buyer):** `<lock> OP_CHECKLOCKTIMEVERIFY OP_DROP <refund_x> OP_CHECKSIG`
  Witness: `<sig> <refund_script> <control_block>`; the spending transaction's `nLockTime ≥ lock` and a non-final `nSequence` (Fabric uses `0xfffffffe`).
- **Tree:** two leaves at depth 1, in the order `[claim, refund]`, leaf version `0xc0`; each control block is `0xc0|parity ‖ internal_key ‖ sibling_leaf_hash`.
- `lock` MUST be a block height (`< 500000000`). Claim and refund outputs MUST be at least 546 sats.

The buyer builds the script from its own refund key and the advertised `payment_hash` and claim key, and MUST refuse to fund a seller-advertised address that does not match.

**Timelines.** The seller claims only after the funding transaction has the confirmations it requires (`c`). The seller SHOULD refuse to claim when fewer than `d` blocks remain before `lock`, so its claim cannot race the refund. The buyer chooses `lock ≥ funding_height + c + d + margin`. Recommended: `c = 1` and `d = 6` (the values Fabric's swap type already uses), more confirmations on mainnet for large amounts, and `lock` about 144 blocks (one day) past funding. The Fabric document path does not yet enforce these; the lock is a node setting (`inventoryHtlcLocktimeHeight`). A buyer that sees the claim extracts `K` from the witness, even if the seller never sends a key reveal. After `lock`, an unclaimed output is refunded.

### Pay after verify (informative)

Convergent chunks also allow a seller to extend **credit**: it reveals `K_i` before payment, the buyer checks that `K_i` opens ciphertext matching the committed chunk id (and that `K_i` is the convergent key of the plaintext), and only then pays over a pre-existing two-party payment channel by a plain balance transfer naming the request. A wrong key is never paid. The seller bounds its risk with a per-channel credit limit. Small per-chunk prices are then possible, since no HTLC output (and its dust floor) is created per chunk. Private documents are not sold on credit: their key is the only thing being sold.

## Rationale

- Separating **discovery** (inventory) from **delivery** (`file_send`) allows consent and payment gates without encrypting a whole DHT.
- Sealing makes payment buy the **key**, not the bytes: ciphertext can be cached, relayed, and seeded freely, and the HTLC claim is the delivery receipt.
- Binding each chunk's payment hash into the document tree lets a buyer check every offer against the document id before paying anyone.
- Consent-by-default matches operator-run nodes; auto-fulfill remains available for unattended mirrors.
- **No version fields.** Every identifier names a construction, not a revision: the hash tags, the scheme strings, and the tree prefixes. A node never has to trust a peer's claim about which rules apply, so there is nothing to downgrade. A different construction gets a different name, and nodes that don't know it refuse it.

## Backward compatibility

This proposal adds no consensus or relay rules; it uses only standard P2TR outputs and existing opcodes. Free file drops are auto-fulfill with `rate_sats = 0`.

## Multi-peer blobs and ranking (informative)

A buyer assembles an **offer book** from many inventory responses for the same document id and ranks sellers by price, latency, peer score, and how many chunks each holds. Each chunk may be bought from a different seller and is verified against the document tree on arrival. A buyer that holds a whole convergent document may advertise it in turn (seed after download), so the set of sellers for popular content grows with its buyers, as in BitTorrent, but each seeder is paid per chunk delivered.

## Private paid relay (informative)

A `document_request` may carry a budget `maxSats`. A relay forwarding it re-signs it under its own key with a lower `maxSats` and remembers the return route, so the seller sees only the last relay, not the buyer. Each relay keeps `maxSats_in − maxSats_out` as its fee. This is the one case where a relay rewrites a body.

## Reference implementation

- Sealing and key reveal: `@fabric/core` `functions/documentSealedExchange.js`.
- Chunking, document tree, inclusion proofs: `Document` statics in `types/document.js`; buyer reassembly: `types/documentBlobTransferBook.js`.
- Commitment selection: `functions/documentPaymentHash.js`; envelope: `functions/publishedDocumentEnvelope.js`.
- HTLC: `types/htlc.js`. Offer book and private relay: `types/documentBook.js`, `types/peer.js`.
- Interactive CLI: `/import`, `/publish`, `/inventory`, `/offers`, `/buy`, `/confirm`, `/claimwatch`, `/refund`, `/request`, `/pending`, `/approve`, `/relayfees` (`functions/cliDocumentExchange.js`).
- Status tracker: [`docs/L1_DOCUMENT_EXCHANGE.md`](L1_DOCUMENT_EXCHANGE.md).

## Next steps (for Bitcoin ML / BIP process)

Done in this draft: commitment frozen as `SHA256(K)` with test vectors, chunking and document tree specified, HTLC template normative, sealed delivery implemented.

Type decided: Standards Track (Applications layer).

1. Specify the JSON shapes of `inventory_request`, `inventory_response`, and `document_request` field by field. A Standards Track BIP needs these for a second implementation to interoperate.
2. Decide whether pay-after-verify and private relay stay here (as informative sections) or move to a follow-up BIP.
3. Enforce the claim-safety window `d` and a minimum lock in the document HTLC path, as `types/swap.js` already does.
4. Implement explicit resume in the CLI (`/request <id> --missing`); the protocol already supports it.
5. Assign BIP number; post to bitcoin-dev with subject `BIP proposal: content-addressed file exchange`.

## Appendix A: Test vectors

Full vectors: [`tests/vectors/bip-fabric-file-exchange.json`](../tests/vectors/bip-fabric-file-exchange.json), checked by `tests/functions.bipFileExchange.js` both against the library and against the formulas above recomputed from SHA-256 alone. Selected values:

**Convergent seal, plaintext `"hello fabric"`, public scope:** see `convergent[1]`. Empty plaintext:

```
K            3c409b5692fa7546cb8f13e580912df474fe63835c06c778a458c2b2fb90b77b
iv           a940fe790f44840d8c1174f4
payment_hash 7b8f8bb388b7b38af13899f3337225b4468da2ceac664f5f907b5cfbdd0cf616
ciphertext   3ec52709bd59c2e5b4181c77a423b537
chunk_id     79f6d2dc872308e323139de1f66b6eb7be7a4166bace63c1cb582ef6322209c1
```

**Document tree:** `tree[0..3]` cover 1, 2, 3, and 5 chunks (an odd node promoted at two levels). Roots:

```
n=1  5ce271dd9a79fdc2e93e52f9a0ce7cc5d954ec7d9ff5e3c275aac887c4fea8ad
n=2  5625e819336a37eedd6b8440e08e57c330bd52553c9ace1668d2562c30973cee
n=3  af180242fbf323ba9e0828ced2451f62bab4af37eee8bdbfe8c0420aa43ed050
n=5  51ff8d317deb2479c56edd101784f938091d770b34974df1229665d0438facff
```

**HTLC (regtest),** claim key `1·G`, refund key `2·G`, `payment_hash = SHA256(K)` for `"hello fabric"`, `lock = 500`:

```
claim_script  a82091bf81807fca93a4b24343d777bd4526d3dab6b0555e174220f8c610d87c47ee
              882079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ac
refund_script 02f401b17520c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5ac
merkle_root   75fce64d1333421523ff27c221cc1abda74ce7bb19d6c28bd3018df1692c49df
output        51208b1a79941ae8c7f5aed88072a5eb08ad824bd33802a0f1021bfcc8f397c595e2
address       bcrt1p3vd8n9q6arrlttkcspe2t6cg4kpyh5ecq2s0zqsmlny08979jh3qdp3n02
```

## Copyright

This document is dual-licensed under the BSD 2-clause license and the MIT license.
