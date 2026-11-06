# Core Lightning JSON-RPC compatibility (`services/lightning.js`)

See also **[BOLT_COMPATIBILITY.md](BOLT_COMPATIBILITY.md)** for how BOLT #1–#12 map to delegated `lightningd` behavior vs this RPC surface, and **[FABRIC_LIGHTNING_OFFERS.md](FABRIC_LIGHTNING_OFFERS.md)** for Fabric **markets** vs Lightning BOLT12 **offer** strings.

`Lightning` talks to **lightningd** over the JSON-RPC Unix socket. **`Lightning.Bolt12`** re-exports `functions/lightningBolt12.js` for prefix classification without RPC. Typed wrappers call `_makeRPCRequest(method, params)`; arbitrary methods use **`callRpc(method, params, timeoutMs)`**. The instance field **`rpc`** is reserved for an optional non-socket RPC client (e.g. legacy REST); it is not used by `callRpc` / `_makeRPCRequest`.

## BOLT12 — receive (offers)

| RPC method | Fabric API |
|------------|------------|
| `offer` | `createOffer` |
| `listoffers` | `listOffers` |
| `disableoffer` | `disableOffer` |
| `decode` | `decodeLightning` |

## BOLT12 — pay an offer (`lno1…` → bolt11 → `pay`)

| RPC method | Fabric API |
|------------|------------|
| `fetchinvoice` | `fetchInvoice` |
| `decodepay` | `decodePay` |
| `pay` | `pay` |

## BOLT12 — invoice_request (`lnr1…`, v22.11+)

| RPC method | Fabric API |
|------------|------------|
| `invoicerequest` | `createInvoiceRequest` |
| `listinvoicerequests` | `listInvoiceRequests` |
| `disableinvoicerequest` | `disableInvoiceRequest` |
| `sendinvoice` | `sendInvoice` |

`invoice_request` strings are classified by prefix as **`lnr1…`** (`Lightning.Bolt12`). After **`decode`**, use **`Lightning.Bolt12Semantics.classifyDecodedBolt12`** to tell offers vs `invoice_request` vs bolt12 **invoice**.

## BOLT12 — BIP-340 signatures & recurrence

- **Signatures:** BOLT #12 uses **BIP-340** Schnorr for **invoice_request** and **invoice** Merkle signatures ([§ Signature calculation](https://github.com/lightning/bolts/blob/master/12-offer-encoding.md#signature-calculation)). **Offers** have no signature. Fabric does not reimplement verification — rely on **`decode`** / payment RPCs and Core Lightning.
- **Helpers:** **`functions/bolt12Semantics.js`** (`Lightning.Bolt12Semantics`) documents TLV type constants, **`bip340SignatureApplies(kind)`**, **`summarizeBolt12RecurrenceFromDecode(decode)`** for flat CLN **`decode`** JSON.
- **Recurrence:** **`fetchInvoice`** forwards **`recurrence_counter`**, **`recurrence_start`**, **`recurrence_label`** (and other CLN kwargs) into **`fetchinvoice`** for periodic offers. Response may include **`next_period`** when applicable ([Core Lightning `fetchinvoice`](https://docs.corelightning.org/reference/fetchinvoice)).

## Other methods referenced in code

| RPC method | Fabric API |
|------------|------------|
| `connect` | `connectTo` |
| `fundchannel` | `createChannel` |
| `getinfo` | internal sync / wait |
| `getroute` | `getRoute` |
| `invoice` | `createInvoice` |
| `listchannels` | `_syncChannels` |
| `listfunds` | `listFunds`, `computeLiquidity` |
| `newaddr` | `newDepositAddress` |
| `stop` | `stop` |

BOLT12 flows need **`experimental-offers`** (and a sufficiently new CLN). Use `settings.plugins: { 'experimental-offers': { enabled: true } }` when spawning a managed node.

Keep **`Lightning.CLN_RPC_METHODS`** in sync with every literal method name passed to `_makeRPCRequest` in `services/lightning.js` (see `tests/lightning/lightning.cln.rpc.surface.test.js`).
