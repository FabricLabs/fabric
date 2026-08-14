# Fabric CLI (terminal)
The Fabric TUI (`types/cli.js`) is a slash-command shell over a local Fabric peer,
optional Bitcoin/Lightning services, and contract-driven workflows (document
exchange, HTLCs, programs, …).

## Setup (environment keys)
`fabric setup` is a **thin** Blessed screen (`types/setup.js`) over
[`functions/fabricSetup.js`](../functions/fabricSetup.js). It does **not** start a
Peer or Bitcoin/Lightning. Use it to inspect the current environment (wallet path,
Fabric identity, XPUB) and to **view / backup / restore / generate** keys.

New wallets default to a **password-sealed JSON** file (`~/.fabric/wallet.json`):
public fields (`id`, `xpub`, identity) sit beside a `seal` blob
(AES-256-GCM + PBKDF2-SHA256). `--password` / `FABRIC_PASSWORD` is the encryption
password (min 8). `--passphrase` remains BIP39 only.

Operator identity in the process environment (process env wins over the wallet file):

- **`FABRIC_XPRV`** — preferred extended private key
- **`FABRIC_SEED`** — raw BIP32 seed **hex** (BIP39 PBKDF2 output is 64 bytes / 128 hex)
- **`FABRIC_MNEMONIC`** — BIP39 word phrase

`~/.fabric/env` fills missing `FABRIC_*` keys. `node scripts/ensure-home-env.js`
writes a Schnorr Hub admin token to `~/.fabric/hub-admin-token` and
`FABRIC_HUB_ADMIN_TOKEN` for later RC1 `AcceptTrackedApplicationContract`.
Generic helpers: [`functions/sealedBlob.js`](../functions/sealedBlob.js) and
[`functions/identityLock.js`](../functions/identityLock.js) (idle auto-lock, default
30 minutes; `0` disables). Legacy plaintext wallets still load; the TUI can encrypt
them in place.

```text
fabric setup                 # TTY: setup TUI (unlock / lock / timeout / encrypt)
fabric setup --json          # public snapshot (no secrets)
fabric setup --backup        # write ~/.fabric/backups/wallet-….json
fabric setup --restore FILE  # restore (needs --force if a wallet exists)
fabric setup --unlock        # decrypt into memory (--password / FABRIC_PASSWORD)
fabric setup --lock          # drop in-memory secrets
fabric setup --timeout MIN   # persist idle auto-lock (0 off)
fabric setup --force         # destroy + generate (no TUI; needs --password)
fabric setup --no-tui        # inspect / first-run generate without a TUI
```

The snapshot never includes seed or xprv. Reveal / generate in the TUI shows the
mnemonic once behind a confirmation. `--force` DESTROYS local key material.

## Shell (chat)
With a wallet configured, `fabric` / `fabric chat` opens the full Blessed shell
(`types/cli.js`) over a local Fabric peer. Setup stays a separate, lighter command.
A sealed wallet may start **locked** (watch-only from the public XPUB). Unlock,
re-lock, and idle timeout:

```text
/unlock <password>           # decrypt secrets; arms idle auto-lock
/lock                        # drop secrets now
/lock timeout [minutes]      # show or set idle auto-lock (0 off)
/wallet status|unlock|lock|timeout
```

Slash commands touch the idle timer while unlocked. After timeout the shell warns
and signing requires `/unlock` again.

## Contracts (universal)
In Fabric, **contracts** means *all* agreements beyond the base peer protocol.
Contracts advertise **interfaces** (capabilities) — they are not tagged with a
single exclusive `kind`. Published contracts for the public network live in the
**Hub registry**; the **Hub contract is published first**. Canonical model:
**[CONTRACTS.md](CONTRACTS.md)**.

```text
/contracts                 # overview: sessions + shell packs + runtime
/contracts interfaces      # capability surfaces
/contracts sessions        # document-exchange / HTLC purchase sessions
/contracts shell           # local cli.shell packs
/contracts enable <id>
/contracts disable <id>
/contracts runtime
```

### Shell packs (`cli.shell` interface)
Composable CLI surfaces live in [`functions/cliContracts.js`](../functions/cliContracts.js)
(`@type: FabricCliContract`, `interfaces: ['cli.shell', …]`). Disabling a pack
only drops slash-commands; it does not cancel HTLCs, open sessions, or Hub
registry publishes.

**Document exchange** (`documents` + `documents-market`) is the Core-standard
operator surface: headless API in
[`functions/cliDocumentExchange.js`](../functions/cliDocumentExchange.js);
the Blessed TUI in `types/cli.js` only adapts results into the log. See
[`L1_DOCUMENT_EXCHANGE.md`](L1_DOCUMENT_EXCHANGE.md).

| Pack | Default | Role |
|------|---------|------|
| `core` | on (required) | help, quit, settings, `/contracts`, `/unlock`, `/lock` |
| `network` | on | peers, connect, disconnect, services |
| `documents` | on | import/publish/request/approve/inventory |
| `documents-market` | on | offers, buy, confirm, claimwatch, **refunds**, refund, relayfees |
| `wallet` | on | wallet / fund / generate / lock |
| `execution` | on | create, deploy, subscribe, accept, state |
| `bitcoin` | on | bitcoin / lightning / sync |
| `explorer` | on | block / tx / address |
| `debug` | **off** | RPC / UI diagnostics |

Settings:

```js
{
  cliContracts: { explorer: false, debug: true },
  cliContractsDisabled: ['wallet']
}
```

Legacy `applications` / `applicationsDisabled` keys are still honored.

## Refunds
```text
/refunds                   # outstanding = mature + failed + pending
/refunds mature
/refunds failed
/refunds pending
/refunds refunded
/refunds all
/refund <settlementId> [addr] [feeSats]
```

See [L1_DOCUMENT_EXCHANGE.md](L1_DOCUMENT_EXCHANGE.md).

## Verbosity (release defaults)
| Setting | Default | Effect |
|---------|---------|--------|
| `debug` | `false` | Peer/CLI debug lines; wallet tx chatter |
| `verbosity` | `1` | `≥3` shows bitcoin sync/log; `≥4` forces `_appendDebug` |

## Related
- [CLI-BINARY.md](CLI-BINARY.md)
- [CONTRACTS.md](CONTRACTS.md)
- [PAYMENTS_DOCUMENT_BINDING.md](PAYMENTS_DOCUMENT_BINDING.md)
- [DEVELOPERS.md](../DEVELOPERS.md)
