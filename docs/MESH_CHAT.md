# Mesh chat model (gossip-first)

Fabric’s **primary mesh fabric** is the gossip / peering network
(`P2P_PEER_GOSSIP`, `P2P_PEERING_OFFER`, slot fill, NOISE sessions). Chat is a
**layered application** on that fabric — not a replacement for it.

## Surfaces

| Surface | Wire | Who can read | Role |
|---------|------|--------------|------|
| **Gossip / peering** | `P2P_PEER_GOSSIP`, offers | Direct peers + gossip budget | Topology, discovery, WebRTC ids |
| **Public shoutbox** | cleartext `P2P_CHAT_MESSAGE` flood | Every relay hop | Social / public presence (wave 0) |
| **Onion-sealed chat** | `P2P_FORWARD` + `FabricOnionChatSeal` body | Path tip (E2E) | Directed private delivery |
| **Sealed GroupChat** | `CONTRACT_MESSAGE` + participant/tip seal | Group members (v2 hub-blind) | **Wave 1** confidential contract messaging |
| **Cleartext GroupChat** | `CONTRACT_MESSAGE` without seal | Relays + members | Legacy / playnet until seals on |

Classifier: [`functions/fabricChatKind.js`](../functions/fabricChatKind.js)
(also re-exported from `fabricChatText`).

## Product direction

1. Keep gossip/peering budgets and behaviours **first** — do not starve topology
   for chat flood.
2. Keep the global shoutbox **intentionally public** (rate-limited). Do not
   encrypt `P2P_CHAT_MESSAGE` mesh flood by default without a suite migration.
3. Put confidential traffic on **sealed GroupChat** (and future DirectChat /
   registry contract chat) as the **first encrypted wave** for all future
   contract work. Prefer participant seal (`aes-256-gcm-participant-v1`).
4. Use Hub `SendOnion` (encrypt default) for directed private chat when IP
   privacy + E2E matter.

## Related

- [PRIVACY.md](../PRIVACY.md)
- [P2P_FORWARD.md](P2P_FORWARD.md)
- [APPLICATION_NAMESPACES.md](APPLICATION_NAMESPACES.md)
- Hub `PLAN.md` (global messaging → registry contract)
- GoonCitizen `docs/PRIVACY_REMAINING.md`
- [`MESSAGE_COLLECTION.md`](MESSAGE_COLLECTION.md) — collect / store / replay AMP frames (journals, Discord packs, catch-up)
