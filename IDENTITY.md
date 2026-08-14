# Fabric Identity
This document is intended to be utilized as the specification for the Fabric Identity Protocol.

## Overview
The Fabric Identity Protocol is a decentralized identifier for Fabric-speaking networks.

1. Load a BIP44 HD tree from the BIP39 seed (master key)
2. Designate First Identity as Derivation Path:
   - **Bitcoin mainnet:** `m/44'/7777'/0'/0/0`
   - **All other networks** (testnet, signet, regtest, unspecified): `m/44'/7778'/0'/0/0`
3. `m = sha256(derived_pubkey)`
4. `id = bech32m("id", m) // "id" taken as ASCII bytes`

**Coin types:** Fabric protocol identity uses SLIP-44–style coin types **`7777` (mainnet)** and
**`7778` (everything else)**. Helpers: `fabricCoinTypeForNetwork`, `fabricIdentityDerivationPath`
in `constants.js`. Default development / Peer identity (when `network` is omitted or non-mainnet)
stays on **7778** so playnet fixtures remain stable.

**Funds vs identity:** Bitcoin receive / change keys use BIP44 coin type **`0`** from the
**same master** (`m/44'/0'/account'/change/index`). Never reuse the Fabric `7777`/`7778` identity
node for spendable UTXOs — `@fabric/core` `Identity` signs on the Fabric coin type;
`Wallet` funds on `0`.

Additional identities may be loaded by modifying the account index in the derivation path:

```text
# Non-mainnet (default)
Identity #1 [0]: m/44'/7778'/0'/0/0
Identity #2 [1]: m/44'/7778'/1'/0/0

# Mainnet
Identity #1 [0]: m/44'/7777'/0'/0/0
Identity #2 [1]: m/44'/7777'/1'/0/0
```

Fabric will encode each identity address index as specified by BIP 44 for the Fabric coin type
(not Bitcoin funds):

```text
Identity account 0, address 1 (regtest): m/44'/7778'/0'/0/1
Identity account 0, address 1 (mainnet): m/44'/7777'/0'/0/1
```

**Migration:** operators who previously derived “mainnet” protocol keys under `7778` must
re-derive under `7777` (or keep an explicit `network: 'regtest'`/`'testnet'` coin type) before
treating those keys as mainnet Fabric identities. Documented in [AUDIT.md](AUDIT.md).

### Full Specification
`id = bech32m("id", sha256(bip44(derivation_path, hd_tree).public))`

### An Example Fabric Identity:
```text
Pubkey:
ID: 
```

### HTTP Requests
Send authenticated HTTP requests with the following headers:

```text
X-Fabric-Identity: <id> # should be in form id
X-Fabric-ECDSA: <public key for identity above>
X-Fabric-Signature: <signature(m)> where m = HTTP Request Body (utf8)
```

## Bridging
Identities from external networks can be "attested" to within Fabric.

### Labels
For example, Discord users may run the `!fabric assert <pubkey>` command in any room [an attestation bot][attestation-bot] is present:

```text
martindale: !fabric assert 
ExampleBot: Please run `fabric prove feebadee` and provide the output signature to the command: `!fabric prove <signature>`
martindale: !fabric prove feba3b56b1ebadb3b691b124bb3
ExampleBot: Your Discord identity has been confirmed!
```

[attestation-bot]: https://github.com/FabricLabs/fabric-discord
