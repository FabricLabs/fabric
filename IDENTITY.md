# Fabric Identity
This document is intended to be utilized as the specification for the Fabric Identity Protocol.

## Overview
The Fabric Identity Protocol is a decentralized identifier for Fabric-speaking networks.

1. Load a BIP32 HD tree from the BIP39 seed (master key)
2. Designate First Identity as Derivation Path:
   - **Bitcoin mainnet:** `m/7777'/7777'/0'/0/0`
   - **All other networks** (testnet, signet, regtest, unspecified): `m/7777'/7778'/0'/0/0`
3. `m = sha256(derived_pubkey)`
4. `id = bech32m("id", m) // "id" taken as ASCII bytes`

**Purpose:** identity paths start at `7777'` (`FABRIC_IDENTITY_PURPOSE`), not
BIP44's `44'`, so no Bitcoin wallet scanning BIP44 accounts ever lands on an
identity key. Earlier Fabric identities used `m/44'/F'/n'/0/0`; the same seed
gives a different identity under v2.

**Coin types:** Fabric protocol identity uses SLIP-44–style coin types **`7777` (Bitcoin mainnet
network name)** and **`7778` (any other network name, or when `network` is omitted)**.
`resolveFabricIdentityCoinType` still honours an **explicit integer** coin type when the
caller passes one (validated); it does not rewrite that integer to 7778. Helpers:
`fabricCoinTypeForNetwork`, `resolveFabricIdentityCoinType` (network name or explicit integer),
`fabricIdentityAccountPath` (`m/7777'/{coin}'/account'`), `fabricIdentityDerivationPath`
(`account path` + `/0/index`) in `constants.js`. Default development / Peer identity
(when `network` is omitted or a non-mainnet name) stays on **7778** so playnet fixtures remain stable.

## Accounts: three keys each
Funds are never tied to the identity. From one master xprv, each account index
`n` on each network derives three unrelated keys (`functions/accountKeys`
`deriveAccount(master, { account, network })`):

| Key | Path | Used for |
|---|---|---|
| Fabric identity | `m/7777'/F'/n'/0/0` | Sign-in, Fabric messages, chat, groups, device links |
| Bitcoin wallet, SegWit (default) | `m/84'/B'/n'` (receive `/0/i`, change `/1/i`, `wpkh`) | Every new receive and change address |
| Bitcoin wallet, standard | `m/44'/B'/n'` (receive `/0/i`, change `/1/i`, `pkh`) | Watched and spendable; never hands out new addresses |
| Multisig cosigner | `m/87'/B'/n'/0/0` (BIP87) | Group wallets, escrow, federation withdrawals |

- `F` is 7777 on mainnet and 7778 elsewhere. `B` is 0 on mainnet and 1
  elsewhere (`bitcoinCoinTypeForNetwork`).
- The same index on two networks gives unrelated keys: regtest account 0 and
  mainnet account 0 share nothing but the seed.
- A wallet watches both accounts (`walletDescriptors`: `wpkh` on 84', `pkh`
  on 44'), receive and change. The gap limit is 20 on each chain of each
  account. `BITCOIN_KEY_DERIVATION_PATH`, `bitcoinReceiveDerivationPath`, and
  `bitcoinChangeDerivationPath` name BIP84 paths; `Wallet` derives and
  watches on its own network's coin type.
- Account xpubs are shared (`shareableAccountXpub`) with the network's version
  bytes (`tpub` off mainnet), depth, parent fingerprint, and child number
  zeroed, and no key origin in descriptors, so xpubs a user shares from two
  accounts can't be linked to one seed. Addresses are unchanged.
- `cosignerProof` is a claim signed by the cosigner key (BIP340 under
  `Fabric/PassportCosigner`) that it acts for an identity, within a scope such
  as one Passport sign-in or one group contract. An identity pubkey is public,
  so the proof alone doesn't show the identity agreed: accept it only inside a
  message the identity key signed, as a `PASSPORT_ASSERTION` is.

## Storage: two passwords
- **Derivation password** (optional). The BIP39 passphrase. With the mnemonic
  it gives the master xprv, once, at import (`importSeed`). Then the mnemonic,
  passphrase, and seed are dropped.
- **Lock password.** Seals the master xprv at rest (`sealMaster`:
  PBKDF2-SHA256 at 210k iterations, AES-256-GCM). Changing it never changes a
  key.

The stored record (`createAccountVault`, type `FabricAccountVault`, `v: 2`)
holds the sealed master xprv, the current `{ account, network }`, and a public
cache per pair (label, identity pubkey and id, both wallet xpubs, cosigner
pubkey), so a locked client can still show its identities and watch-only
balances. The cache sits beside the seal unauthenticated: unlock with
`openAccountVault`, which refuses a vault whose cache doesn't match what the
master derives (`FABRIC_ACCOUNT_VAULT_MISMATCH`), and hand out no receive
address from the cache before that. Unlocked, the master lives in memory only.
Switching account or network re-derives all three keys; while locked, only
cached pairs can be selected (`selectVaultAccount`). A client holds one seed
at a time.

Backups never hold the mnemonic or the passphrase. A vault backup holds the
sealed master xprv. An operator wallet backup (`backupWallet`) copies
`~/.fabric/wallet.json` as stored, sealed when the file is; with no wallet
file it writes the unlocked in-memory wallet, xprv in plaintext (a 0600
file). `revealSecrets` returns the xprv, and the mnemonic when the loaded key
still holds one, in plaintext for the user to see.

Signing in to websites with these keys is [docs/PASSPORT.md](docs/PASSPORT.md).

## Identity paths
Additional identities may be loaded by modifying the account index in the derivation path:

```text
# Non-mainnet (default)
Identity #1 [0]: m/7777'/7778'/0'/0/0
Identity #2 [1]: m/7777'/7778'/1'/0/0

# Mainnet
Identity #1 [0]: m/7777'/7777'/0'/0/0
Identity #2 [1]: m/7777'/7777'/1'/0/0
```

Fabric will encode each identity address index as specified by BIP 44 for the Fabric coin type
(not Bitcoin funds):

```text
Identity account 0, address 1 (regtest): m/7777'/7778'/0'/0/1
Identity account 0, address 1 (mainnet): m/7777'/7777'/0'/0/1
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
