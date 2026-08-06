# Fabric Contracts
**Contracts** are Fabric’s unit of agreement and execution beyond the base-layer
peer protocol (identity, NOISE sessions, AMP message relay). Anything that
binds parties, funds, state, or programs is a contract — not a separate “app”
layer.

A contract is **not** classified by a single `kind` field. Instead, a contract
**implements one or more interfaces** (capabilities peers and hubs can discover
and call). The same published object may expose payment/escrow, document
exchange, crowdfunding, program execution, proposal intake, and/or a CLI shell
surface at once.

## Interfaces (capabilities)
Interfaces are named capability surfaces — not mutually exclusive types:

| Interface (examples) | What peers expect | Typical tools |
|----------------------|-------------------|---------------|
| Payment / escrow | Hashlock / timelock / invoice settlement | HTLC builders, `/buy`, `/confirm`, `/claimwatch`, `/refund` |
| Document exchange | Offers, sealed delivery, purchase sessions | `/offers`, `/inventory`, blob plans |
| Crowdfund / federation | Threshold funding, validator rounds | Hub crowdfunds, Beacon federation |
| Program / machine | Deterministic opcode runs | `/create`, `/deploy`, `Machine` + `Program` |
| Proposal / patch | Merkle-batched messages + JSON Patch (+ optional PSBT) | [CONTRACT_PROPOSAL.md](CONTRACT_PROPOSAL.md) |
| CLI shell | Slash-command packs loaded into the TUI | [cliContracts.js](../functions/cliContracts.js) |

Wire publish still uses `CONTRACT_PUBLISH` → namespace id =
`Actor(definition).id` ([APPLICATION_NAMESPACES.md](APPLICATION_NAMESPACES.md)).
Body semantics ride `CONTRACT_MESSAGE` under that id.

## Hub registry (public network)
Published contracts that the public network treats as known are stored in the
**Hub contract registry** (operator-accepted / tracked publishes, Beacon
contracts root, namespace sidechains — see Hub ADR-001 and tracked-application
flows).

**The Hub contract is published first** on the public network: it is the
genesis registry entry other contracts hang from (rendezvous, document market,
federation policy, and later distributed execution). Downstream product
contracts (document exchange, crowdfunds, execution programs, org federations,
…) publish into that registry rather than inventing a parallel product
vocabulary.

Local CLI shell packs and in-flight purchase sessions are still contracts (they
implement interfaces); they are not automatically Hub-registry entries until
published and accepted.

## CLI: `/contracts`
```text
/contracts                 # overview: sessions + shell packs + runtime
/contracts interfaces      # capability surfaces (not exclusive kinds)
/contracts shell           # CLI shell-pack surfaces (enable/disable)
/contracts sessions        # live document-exchange / HTLC sessions
/contracts enable <id>     # enable a shell pack
/contracts disable <id>    # disable a shell pack (not core)
/contracts runtime         # in-memory runtime contract store
```

Shell packs (`core`, `documents-market`, `execution`, …) are local contracts
that advertise the **CLI shell** interface (`@type: FabricCliContract`,
`interfaces: ['cli.shell']`). Disabling a pack only unregisters slash-commands;
it does not cancel on-chain HTLCs, open sessions, or Hub-registry publishes.

## Related modules
- HTLC builders — [`functions/inventoryHtlc.js`](../functions/inventoryHtlc.js)
- Purchase sessions / offer book — [`functions/documentMarket.js`](../functions/documentMarket.js)
- Sealed document sale — [`functions/documentSealedExchange.js`](../functions/documentSealedExchange.js)
- L1 binding — [L1_DOCUMENT_EXCHANGE.md](L1_DOCUMENT_EXCHANGE.md), [PAYMENTS_DOCUMENT_BINDING.md](PAYMENTS_DOCUMENT_BINDING.md)
- Namespaces — [APPLICATION_NAMESPACES.md](APPLICATION_NAMESPACES.md)
- Programs — [PROGRAM.md](PROGRAM.md)
- Proposals — [CONTRACT_PROPOSAL.md](CONTRACT_PROPOSAL.md)
- Terminal shell — [CLI.md](CLI.md)
- Hub Bitcoin / value flows — Hub repo `CONTRACTS.md`
