# CONTRACT_PROPOSAL
Outer AMP type **`ContractProposal`** (`Message.types['ContractProposal']`, opcode **138** / `0x8A`) carries a versioned JSON payload for **contract negotiation**:

- **`messages`** — ordered list of embedded Fabric messages as **`wireBase64`** (full `Message.asRaw()` bytes). Each entry includes a **`leafHash`** = `SHA256(wire)` for display/debug.
- **`chain.merkleRoot`** — binary Merkle root over those leaf hashes (sorted pairwise concatenation then `SHA256`, odd levels duplicate the last hash).
- **`chain.parentRoot`** — optional hex64 root of a prior proposal chain (fork / extension point).
- **`statePatch`** — [RFC 6902](https://datatracker.ietf.org/doc/html/rfc6902) JSON Patch applied to a JSON document representing **global state** (e.g. hub operator state). Use `applyStatePatch` in `functions/contractProposal.js` for a pure preview/apply.
- **`psbt.proposalBase64`** — optional PSBT (e.g. funding); combine/finalize with tooling in **hub** `functions/psbtFabric.js`.

Verification: `verifyContractProposalPayload(payload)` recomputes the Merkle root from `wireBase64` entries.

See also [POLICY.md](../POLICY.md) and [FABRIC_MESSAGE_TYPE_CONSOLIDATION.md](../FABRIC_MESSAGE_TYPE_CONSOLIDATION.md).
