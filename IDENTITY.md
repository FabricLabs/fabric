# Fabric Identity
This document is intended to be utilized as the specification for the Fabric Identity Protocol.

## Overview
The Fabric Identity Protocol is a decentralized identifier for Fabric-speaking networks.

1. Load a BIP44 HD tree
2. Designate First Identity as Derivation Path: `m/44'/7778'/0'/0/0`
3. `m = sha256(derived_pubkey)`
4. `id = bech32m("id", m) // "id" taken as ASCII bytes`

Additional identities may be loaded by modifying the account index in the derivation path:

```
Identity #1 [0]: m/44'/7778'/0'/0/0
Identity #2 [1]: m/44'/7778'/1'/0/0
...
```

Fabric will encode each transaction using the address index field, as specified in BIP 44:

```
Transaction #1 [1]: m/44'/7778'/0'/1/0
```

### Full Specification
`id = bech32m("id", sha256(bip44(derivation_path, hd_tree).public))`

### An Example Fabric Identity:
```
Pubkey:
ID: 
```

### HTTP Requests
Send authenticated HTTP requests with the following headers:

```
X-Fabric-Identity: <id> # should be in form id
X-Fabric-ECDSA: <public key for identity above>
X-Fabric-Signature: <signature(m)> where m = HTTP Request Body (utf8)
```

## Bridging
Identities from external networks can be "attested" to within Fabric.

### Labels
For example, Discord users may run the `!fabric assert <pubkey>` command in any room [an attestation bot][attestation-bot] is present:

```
martindale: !fabric assert 
ExampleBot: Please run `fabric prove feebadee` and provide the output signature to the command: `!fabric prove <signature>`
martindale: !fabric prove feba3b56b1ebadb3b691b124bb3
ExampleBot: Your Discord identity has been confirmed!
```

[attestation-bot]: https://github.com/FabricLabs/fabric-discord
