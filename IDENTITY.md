# Fabric Identity
This document is intended to be utilized as the specification for the Fabric Identity Protocol.

## Overview
The Fabric Identity Protocol is a decentralized identifier for Fabric-speaking networks.

1. Load a BIP44 HD tree
2. Designate First Identity as Derivation Path: `m/44'/0'/0'/0/0` (same as Bitcoin funds [!!!])
3. `m = sha256(derived_pubkey)`
4. `id = bech32m("id", m) // "id" taken as ASCII bytes`

### Full Specification
`id = bech32m("id", sha256(bip44(derivation_path, hd_tree).public))`

### An Example Fabric Identity:
```
Pubkey:
ID: 
```
