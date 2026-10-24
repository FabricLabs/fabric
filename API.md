## Modules

<dl>
<dt><a href="#types/ecc.module_selftest">types/ecc.selftest</a></dt>
<dd><p>Lightweight ECC sanity check for real browsers (see types/ecc.js).</p>
</dd>
<dt><del><a href="#module_types/typetree">types/typetree</a></del></dt>
<dd><p>Quarantined TypeTree scaffold (not shipped).</p>
</dd>
</dl>

## Classes

<dl>
<dt><a href="#Actor">Actor</a> ⇐ <code>EventEmitter</code></dt>
<dd><p>Base <strong>Actor</strong>: JSON-shaped <code>_state.content</code> observed with
<code>fast-json-patch</code>; <a href="#Actor+commit">commit</a> turns diffs into <a href="Actor#history">Actor#history</a> and emits
<code>commit</code> plus <code>message</code> (<code>type: 'ActorMessage'</code>, <code>data.type: 'Changes'</code>).
<strong>Identity</strong> — <a href="Actor#id">Actor#id</a> is SHA256(hex) of the 32-byte preimage buffer; <a href="Actor#preimage">Actor#preimage</a> is
SHA256(UTF-8) of pretty-printed <a href="#Actor+toGenericMessage">toGenericMessage</a> <code>{ type, object }</code> with sorted keys
(<a href="#Actor+toObject">toObject</a>); uses <a href="Hash256.compute">Hash256.compute</a>. Treat <code>id</code> as a <strong>content address</strong>, not an
arbitrary app string hash. <strong>Wire traffic</strong> — see <a href="#Message">Message</a> (extends Actor, AMP). Same narrative as
<strong>DEVELOPERS.md</strong> (<em>Actor and Message</em>) and <code>@fileoverview</code> above (also on
<code>types_actor.js.html</code> source page).</p>
</dd>
<dt><a href="#Actor">Actor</a></dt>
<dd></dd>
<dt><a href="#Beacon">Beacon</a></dt>
<dd></dd>
<dt><a href="#Block">Block</a></dt>
<dd></dd>
<dt><a href="#Bond">Bond</a> ⇐ <code><a href="#Contract">Contract</a></code></dt>
<dd></dd>
<dt><a href="#Chain">Chain</a></dt>
<dd><p>Chain.</p>
</dd>
<dt><a href="#Challenge">Challenge</a></dt>
<dd><p>Merkle-leaf availability challenge for a sealed blob tree.</p>
<p>A <strong>commitment</strong> is the provider&#39;s signed promise to hold a tree until an
epoch (optionally naming the deposit output that backs it). A <strong>challenge</strong>
is the publisher&#39;s signed, Beacon-epoch stamped request for one leaf; the
leaf index is derived from the challenge nonce so neither party picks it.
A <strong>response</strong> is the provider&#39;s signed inclusion proof plus a nonce-bound
digest of the blob bytes (proof of possession for a verifier holding the
bytes). All three are plain JSON artifacts carried as <code>CONTRACT_MESSAGE</code>
bodies — no new opcodes — and feed <a href="Witness.FraudProof">Witness.FraudProof</a>.</p>
<p>Response deadlines are expressed in <strong>epochs</strong> (default two) so a lagging
Hub view cannot make an honest provider provably late.</p>
</dd>
<dt><a href="#Channel">Channel</a> ⇐ <code><a href="#State">State</a></code></dt>
<dd><p><strong>Payment / capacity channel</strong> between peers: balances (<code>incoming</code> /
<code>outgoing</code>), counterparty handle, optional asset caps (<code>MAX_CHANNEL_VALUE</code>). Extends
<a href="#State">State</a> → <a href="#Actor">Actor</a>. Wording below is product-oriented;
wire safety still depends on the Lightning/Bitcoin services you attach, not this object alone.</p>
</dd>
<dt><a href="#Channel">Channel</a></dt>
<dd></dd>
<dt><a href="#ChannelSession">ChannelSession</a></dt>
<dd><p>Off-chain state of one Fabric payment channel from the local
party&#39;s perspective: balances, pending HTLCs (one per chunk), each party&#39;s
current commitment and the counterparty&#39;s signature on <strong>ours</strong>. Updates are
exchanged as signed <code>CONTRACT_MESSAGE</code> bodies (<a href="Channel.BODY_TYPES">Channel.BODY_TYPES</a>):</p>
<ol>
<li>proposer → <code>ChannelCommitment n</code> (signature on the <em>counterparty&#39;s</em>
commitment <code>n</code>, next per-commitment point);</li>
<li>counterparty → <code>ChannelCommitment n</code> reply (signature on the proposer&#39;s
commitment <code>n</code>, inline <code>revoke</code> of its own state <code>n-1</code>, next point);</li>
<li>proposer → <code>ChannelRevoke n-1</code>.</li>
</ol>
<p>A party that broadcasts a revoked commitment loses everything on it
(<a href="#Channel.prepareJusticeSpend">prepareJusticeSpend</a>); the latest commitment pays the
holder only after <code>toSelfDelay</code>. Open is three messages (<code>ChannelOpen</code>,
reply, ack) because the funder cannot sign the counterparty&#39;s commitment
before learning its first per-commitment point.</p>
</dd>
<dt><a href="#ChannelSession">ChannelSession</a></dt>
<dd></dd>
<dt><a href="#ChannelBook">ChannelBook</a></dt>
<dd><p>Local registry of <a href="#ChannelSession">ChannelSession</a>s for a host (Hub,
GoonCitizen, Passport): looks a channel up by counterparty, routes inbound
<code>Channel*</code> <code>CONTRACT_MESSAGE</code> bodies to the right session, forwards
multi-hop HTLCs, ticks sessions on new chain tips, and returns the bodies
the host must publish back. Shape expected by the market agent&#39;s
<code>attach({ channels })</code>.</p>
<p><strong>Seller-fulfills (Lightning shape):</strong> when the host supplies
<code>preimageFor(paymentHashHex)</code> the book fulfills every received HTLC whose
preimage the host knows as soon as the round that committed it completes;
the payer learns the preimage from the resulting <code>ChannelHtlcFulfill</code>.</p>
<p>Events: <code>htlcCommitted</code> (a received HTLC is irrevocably committed),
<code>htlcFulfilled</code> (a counterparty revealed a preimage to us), and
<code>htlcSettled</code> (any HTLC left the channel; <code>outcome</code> is <code>fulfilled</code> or
<code>failed</code>). Payloads are <code>{ channelId, session, htlcId, paymentHashHex, blobHashHex, amountSats, direction, preimageHex?, outcome?, reason? }</code>.</p>
</dd>
<dt><a href="#ChannelBook">ChannelBook</a></dt>
<dd></dd>
<dt><a href="#Circuit">Circuit</a></dt>
<dd><p>The <a href="#Circuit">Circuit</a> is the mechanism through which <a href="#Fabric">Fabric</a>
operates, a computable directed graph describing a network of
<a href="#Peer">Peer</a> components and their interactions (side effects).
See also <a href="Swarm">Swarm</a> for deeper inspection of <a href="#Machine">Machine</a>
mechanics.</p>
</dd>
<dt><a href="#Collection">Collection</a></dt>
<dd><p>The <a href="#Collection">Collection</a> type maintains an ordered list of <a href="#State">State</a> items.</p>
</dd>
<dt><a href="#Component">Component</a></dt>
<dd><p>Dead stub. Page composition lives in <code>@fabric/http</code> (<code>types/component.js</code>,
<code>functions/compose.js</code>). This module stays out of the published package.</p>
</dd>
<dt><a href="#Contract">Contract</a> ⇐ <code><a href="#Service">Service</a></code></dt>
<dd></dd>
<dt><a href="#Disk">Disk</a></dt>
<dd></dd>
<dt><a href="#Document">Document</a></dt>
<dd></dd>
<dt><a href="#Entity">Entity</a> ⇐ <code>EventEmitter</code></dt>
<dd><p><strong>Structured document</strong> type: extends <a href="EventEmitter">EventEmitter</a> (not <a href="#Actor">Actor</a>) with
<code>@type</code> / <code>@data</code> shape, JSON serialization, and <code>id</code> = SHA256(<code>toJSON()</code>).
<strong>Different model from <a href="Actor#id">Actor#id</a></strong> (sorted generic envelope). <code>Entity.Transition</code> (JSON Patch
between entity states) is the supported migration path — see <strong>DEVELOPERS.md</strong> (<em>Consolidated prototypes</em>).</p>
</dd>
<dt><a href="#Environment">Environment</a></dt>
<dd><p>Interact with the user&#39;s Environment.</p>
</dd>
<dt><a href="#Fabric">Fabric</a> ⇐ <code><a href="#Service">Service</a></code></dt>
<dd><p>Facade <a href="#Service">Service</a> that bundles <a href="#Chain">Chain</a>, <a href="#Machine">Machine</a>, <a href="#Store">Store</a>, <a href="#Peer">Peer</a>, and related
types for experiments and apps. Prefer importing <strong>leaf</strong> types in production; this class re-exports many of them as statics.</p>
</dd>
<dt><a href="#Fabric">Fabric</a></dt>
<dd></dd>
<dt><a href="#Federation">Federation</a></dt>
<dd><p>Create and manage sets of {Signer} instances with the Federation class.</p>
</dd>
<dt><a href="#Filesystem">Filesystem</a></dt>
<dd><p>Interact with a local filesystem.</p>
</dd>
<dt><a href="#Hash256">Hash256</a></dt>
<dd><p>Simple interaction with 256-bit spaces.</p>
</dd>
<dt><a href="#HKDF">HKDF</a></dt>
<dd><p>Provides an HMAC-based Extract-and-Expand Key Derivation Function (HKDF), compatible with
RFC 5869.  Defaults to 32 byte output, matching Bitcoin&#39;s implementaton.</p>
</dd>
<dt><a href="#Identity">Identity</a> ⇐ <code><a href="#Actor">Actor</a></code></dt>
<dd><p><strong>BIP32/BIP39 identity</strong> wrapping <a href="#Key">Key</a>: mnemonic / xprv / passphrase.
Protocol identity (pubkey / Schnorr sign / Bech32 id) uses the Fabric derivation path
<code>m/44'/{7777|7778}'/account'/0/index</code> — coin type <strong>7777</strong> on Bitcoin
mainnet, <strong>7778</strong> on all other networks (see <a href="Identity#derivation">Identity#derivation</a> and
IDENTITY.md). The HD <strong>master</strong> remains available as <a href="#Identity+master">master</a> /
<a href="Identity#key">Identity#key</a> so Bitcoin funds can derive under BIP44 coin type <code>0</code> (see
<code>BITCOIN_KEY_DERIVATION_PATH</code> in <code>constants.js</code>
/ Wallet) without mixing protocol identity keys with spend keys.
<strong>Important:</strong> this class overrides <a href="Actor#id">Actor#id</a> with <code>toString()</code>
(human-facing / Bech32-style identity), <strong>not</strong> the content-addressed
<code>Actor#id</code> / <code>preimage</code> chain from <a href="#Actor+toGenericMessage">toGenericMessage</a>. Use
<code>pubkey</code>, <code>pubkeyhash</code>, or explicit hashing when you need stable bytes.</p>
</dd>
<dt><a href="#Identity">Identity</a></dt>
<dd></dd>
<dt><a href="#Interface">Interface</a> ⇐ <code>EventEmitter</code></dt>
<dd><p>Interfaces compile abstract contract code into <a href="#Chain">Chain</a>-executable transactions, or &quot;chaincode&quot;. For example, the &quot;Bitcoin&quot; interface might compile a Swap contract into Script, preparing a valid Bitcoin transaction for broadcast which executes the swap contract.</p>
</dd>
<dt><a href="#Key">Key</a></dt>
<dd><p>Represents a cryptographic key.</p>
</dd>
<dt><a href="#Ledger">Ledger</a> ⇐ <code><a href="#State">State</a></code></dt>
<dd><p>An ordered stack of pages.</p>
</dd>
<dt><a href="#LiquidityBook">LiquidityBook</a></dt>
<dd></dd>
<dt><a href="#LiquiditySwap">LiquiditySwap</a></dt>
<dd></dd>
<dt><a href="#Logger">Logger</a> ⇐ <code><a href="#Actor">Actor</a></code></dt>
<dd><p>A basic logger that writes logs to the local file system</p>
</dd>
<dt><a href="#Machine">Machine</a> ⇐ <code><a href="#Actor">Actor</a></code></dt>
<dd><p>Deterministic <strong>virtual machine</strong> layer extending <a href="#Actor">Actor</a>: script/stack, fixed memory buffer,
clock, and a <a href="#Key">Key</a>-backed generator for reproducible “random” bits (<code>sip</code>). Consumes <a href="#State">State</a>-signed
instruction entries from <a href="#Fabric+push">push</a> — not the same as P2P <a href="#Message">Message</a> dispatch (see
<code>types/message.js</code>).</p>
</dd>
<dt><a href="#Machine">Machine</a></dt>
<dd></dd>
<dt><a href="#Message">Message</a> ⇐ <code><a href="#Actor">Actor</a></code></dt>
<dd><p><strong>Application Messaging Protocol (AMP)</strong> — binary envelope for what <a href="#Peer">Peer</a>,
<a href="#Service">Service</a>, and bridges actually exchange. Extends <a href="#Actor">Actor</a> for construction and state helpers, but on the wire
you think in <strong>opcodes</strong>, <strong>headers</strong> (parent, author as x-only pubkey, hash, preimage,
64-byte Schnorr signature), and <strong>payload</strong>.</p>
<p><strong>Signing</strong> — [signWithKey](#Message+signWithKey) / [verifyWithKey](#Message+verifyWithKey) use BIP-340 Schnorr on tagged
hash <code>Fabric/Message</code> over header (signature field zeroed) + body. This is <strong>not</strong> Bitcoin Signed
Message (ECDSA + Core prefix).</p>

<p><strong>Type names</strong> — [wireType](#Message+wireType) / [Message#type](Message#type) use SCREAMING_SNAKE wire labels from
opcode decode; [friendlyType](#Message+friendlyType) and [toObject](#Actor+toObject)'s <code>type</code> use PascalCase (or legacy)
JSON names. [Message.wireTypeFromFriendly](Message.wireTypeFromFriendly) / [Message.friendlyTypeFromWire](Message.friendlyTypeFromWire) bridge the two. See file header
maps (<code>WIRE_TYPE_DECODE_ORDER</code>, <code>LEGACY_MESSAGE_TYPE_ALIASES</code>) when aligning <strong>@fabric/http</strong>
or Hub.</p>

<p><strong>Body (V1)</strong> — Prefer [fromFields](#Message.fromFields) / [toFields](#Message+toFields) with a
registered body schema (see body codec helpers on this module). Bodies are C-like typed fields, not JSON;
JSON bridging is <strong>@fabric/http</strong>. See <code>docs/MESSAGE_BODY.md</code>.</p>

<p><strong>Narrative</strong> — See <strong>DEVELOPERS.md</strong> (<em>Actor and Message</em>) and [Actor](#Actor)
<code>@fileoverview</code>; home HTML is generated from DEVELOPERS.md, while this page comes from
<code>types/message.js</code>.</p></dd>
<dt><a href="#Message">Message</a></dt>
<dd></dd>
<dt><a href="#Book">Book</a></dt>
<dd></dd>
<dt><a href="#Peer">Peer</a> ⇐ <code><a href="#Service">Service</a></code></dt>
<dd><p>P2P node: TCP/NOISE sessions, gossip, and relay of <a href="#Message">Message</a> (AMP) frames. Extends <a href="#Service">Service</a>
(hence <a href="#Actor">Actor</a>). Opcode and receipt semantics must stay aligned with <strong>@fabric/http</strong> and Hub when you add types —
see <a href="#Message">Message</a> wire vs friendly names and <code>constants</code> opcodes.</p>
</dd>
<dt><a href="#Peer">Peer</a></dt>
<dd></dd>
<dt><a href="#Program">Program</a></dt>
<dd></dd>
<dt><a href="#EncryptedPromise">EncryptedPromise</a></dt>
<dd><p>A value that can be sealed with a password.  Sealing uses
<code>functions/sealedBlob</code> (AES-256-GCM, PBKDF2-SHA256, random salt and IV);
<a href="#EncryptedPromise+state">state</a> and <a href="#EncryptedPromise+toString">toString</a> only
ever expose the sealed envelope, never the plaintext or the password.</p>
</dd>
<dt><del><a href="#Reader">Reader</a></del></dt>
<dd></dd>
<dt><a href="#Remote">Remote</a> ⇐ <code><a href="#Actor">Actor</a></code></dt>
<dd><p><strong>WebSocket client</strong> to a remote Fabric/Hub-style host (extends <a href="#Actor">Actor</a>). Per comment in
source, prefer moving richer HTTP to <code>@fabric/http</code>; this type stays for minimal <a href="#Message">Message</a>-oriented
bridging. Uses browser/Node <code>WebSocket</code> with JSON <a href="#Message">Message</a> payloads where applicable.</p>
</dd>
<dt><a href="#Remote">Remote</a></dt>
<dd></dd>
<dt><a href="#Resolutions">Resolutions</a> ⇐ <code><a href="#Actor">Actor</a></code></dt>
<dd></dd>
<dt><a href="#Resolutions">Resolutions</a></dt>
<dd></dd>
<dt><a href="#Resource">Resource</a> ⇐ <code><a href="#Store">Store</a></code></dt>
<dd><p>Declarative <strong>application resource</strong> (routes, components, roles) persisted via <a href="#Store">Store</a>. Pairs with
a <a href="#Service">Service</a> implementation that honors the definition — see <strong>DEVELOPERS.md</strong> (<em>Resources</em> / ARCs). Extends <a href="#Store">Store</a>
so commits and encryption options match the rest of the stack.</p>
</dd>
<dt><a href="#RoundRobin">RoundRobin</a> ⇐ <code><a href="#Circuit">Circuit</a></code></dt>
<dd></dd>
<dt><a href="#Script">Script</a></dt>
<dd></dd>
<dt><a href="#Secret">Secret</a></dt>
<dd><p>Secret material held as an <a href="#EncryptedPromise">EncryptedPromise</a>: 32 random bytes (hex)
unless a value is supplied.</p>
</dd>
<dt><a href="#Service">Service</a> ⇐ <code><a href="#Actor">Actor</a></code></dt>
<dd><p>Long-lived application surface extending <a href="#Actor">Actor</a>. Integrates external systems and the Fabric
network: peers consume and produce <a href="#Message">Message</a> (AMP) instances, not ad-hoc JSON. Subclasses implement routing,
resources, and lifecycle (<code>start</code>/<code>stop</code> patterns — see <strong>AGENTS.md</strong>). The CLI/browser shell is <a href="Service.FabricShell">Service.FabricShell</a>.</p>
</dd>
<dt><a href="#Service">Service</a></dt>
<dd></dd>
<dt><a href="#Session">Session</a></dt>
<dd><p>The <a href="#Session">Session</a> type describes a connection between <a href="#Peer">Peer</a> objects, and includes its own lifecycle.</p>
</dd>
<dt><a href="#SetupTui">SetupTui</a></dt>
<dd></dd>
<dt><a href="#State">State</a> ⇐ <code><a href="#Actor">Actor</a></code></dt>
<dd><p><strong>Named snapshot</strong> of application data extending <a href="#Actor">Actor</a> — <code>@type</code>,
<code>@data</code>, <code>@id</code>, JSON Patch
flows. Absorbs former <strong>Scribe</strong> behavior: <code>verbose</code> / <code>verbosity</code>, <code>now</code>,
<code>trust</code>, <code>start</code>/<code>stop</code>, and structured <code>log</code> / <code>error</code> /
<code>warn</code> / <code>debug</code> (console + events). <a href="#Channel">Channel</a>, <a href="#Document">Document</a>, <a href="#Ledger">Ledger</a>,
<a href="Router">Router</a>, and <a href="Instruction">Instruction</a> extend <code>State</code> directly. <a href="#Vector">Vector</a> is an <a href="EventEmitter">EventEmitter</a> only.
Sibling concept to <a href="#Entity">Entity</a>.</p>
</dd>
<dt><a href="#State">State</a></dt>
<dd></dd>
<dt><a href="#Store">Store</a> ⇐ <code><a href="#Actor">Actor</a></code></dt>
<dd><p>Level-backed persistence extending <a href="#Actor">Actor</a>. Use optional <a href="Codec">Codec</a> in <code>settings.codec</code> for
encrypted values; <a href="#Store.openEncrypted">openEncrypted</a> matches Hub/shell keystore defaults. Commit/history behavior follows <a href="#Actor">Actor</a>.</p>
</dd>
<dt><a href="#Store">Store</a></dt>
<dd></dd>
<dt><a href="#Token">Token</a></dt>
<dd><p>Implements a capability-based security token.</p>
</dd>
<dt><a href="#Tree">Tree</a></dt>
<dd><p>Class implementing a Bitcoin Merkle Tree in display (RPC) byte order:
SHA256d parents over byte-reversed children, and an odd last node paired
with itself. Txid leaves in block order give the block header&#39;s
<code>merkle_root</code>; one leaf is its own root and no leaves give an empty root.
Leaf encoding, proofs, and verification match <code>merkletreejs</code>
<code>isBitcoinTree</code> (which this replaced), so earlier roots are unchanged.
Optional <code>sortLeaves</code> makes the leaf order lexicographic so adjacent-leaf
<strong>non-inclusion</strong> proofs are well-defined (inclusion proofs work either way).</p>
</dd>
<dt><a href="#Vector">Vector</a> ⇐ <code>EventEmitter</code></dt>
<dd><p>Lightweight <strong>event sink</strong> for instruction-stream and VM-adjacent signals.
Former <a href="#State">State</a>-backed fields (<code>script</code>, <code>stack</code>, <code>known</code>, serialization helpers)
live on <a href="#Machine">Machine</a> and <a href="#State">State</a> / <a href="#Fabric+push">push</a> instead.</p>
</dd>
<dt><a href="#Vector">Vector</a></dt>
<dd></dd>
<dt><a href="#Wallet">Wallet</a> : <code>Object</code></dt>
<dd><p>Manage keys and track their balances.</p>
</dd>
<dt><a href="#FraudProof">FraudProof</a></dt>
<dd><p>Self-contained proof that a market counterparty broke a signed obligation.
Shape: <code>{ type: &#39;FraudProof&#39;, kind, artifacts, claim }</code>. <code>verify()</code> is pure
over the artifacts; the few kinds that assert an <strong>on-chain fact</strong> (a
broadcast happened, an outpoint is still unspent, the tip passed a height)
take that fact from <code>ctx</code> — the verifier&#39;s own chain view — and refuse to
conclude without it. No kind ever infers fraud from a <em>missing</em> message
alone: absence is always anchored to a timelock (decision 6).</p>
<p>Kinds:</p>
<ul>
<li><code>wrong-leaf</code>: signed challenge + provider-signed response whose leaf does
not belong to the committed root (or names the wrong blob hash).</li>
<li><code>non-response</code>: signed challenge + provider&#39;s signed availability
commitment and either (a) a response signed after the deadline epoch, or
(b) <strong>timelock evidence</strong>: the challenge names <code>deadlineHeight</code> + the
deposit outpoint, the provider&#39;s <code>DepositPenaltyPreSig</code> on a penalty
transaction with <code>nLockTime = deadlineHeight</code>, and the verifier&#39;s chain
view shows the tip past the deadline with the outpoint <strong>unspent</strong> (no
check-in). The pre-signed penalty is itself the enforcement.</li>
<li><code>wrong-bytes</code>: seller-signed offer row (with <code>paymentHashHex</code>) + the
claim preimage that opens that payment hash + the seller-signed AMP
<code>P2P_FILE_SEND</code> frame whose delivered bytes miss the offered
<code>blobHashHex</code>. The frame author must be the offer signer.</li>
<li><code>wrongful-penalty</code>: publisher-signed challenge + the provider&#39;s valid,
Merkle-proven, in-time response + the penalty transaction that spent
the deposit outpoint anyway — publisher fraud. The penalty&#39;s spent
outputs (<code>prevouts</code>) let the verifier check that the penalty leaf is
committed to the deposit output and signed by both parties.</li>
<li><code>stale-commitment</code>: a payment-channel party&#39;s own signed <code>ChannelRevoke</code>
(naming the commitment txid it revoked) plus that very transaction and
evidence it was broadcast: an SPV <code>inclusion</code> artifact
(<code>functions/bitcoinTxInclusion.js</code>) or <code>ctx.txConfirmed(txid)</code>.</li>
</ul>
</dd>
<dt><a href="#Worker">Worker</a></dt>
<dd><p>Workers are arbitrary containers for processing data.  They can be thought of
almost like &quot;threads&quot;, as they run asynchronously over the duration of a
contract&#39;s lifetime as &quot;fulfillment conditions&quot; for its closure.</p>
</dd>
<dt><a href="#Bitcoin">Bitcoin</a> ⇐ <code><a href="#Service">Service</a></code></dt>
<dd><p>Manages interaction with the Bitcoin network.</p>
</dd>
<dt><a href="#Lightning">Lightning</a></dt>
<dd><p>Manage a Lightning node (Core Lightning JSON-RPC over Unix socket).</p>
<p>BOLT checklist: <code>docs/BOLT_COMPATIBILITY.md</code>. RPC map: <code>docs/LIGHTNING_COMPAT.md</code>.</p>
</dd>
<dt><a href="#Market">Market</a></dt>
<dd></dd>
<dt><a href="#Redis">Redis</a></dt>
<dd><p>Connect and subscribe to Redis servers (node-redis v6).</p>
</dd>
<dt><a href="#Text">Text</a> ⇐ <code><a href="#Service">Service</a></code></dt>
<dd></dd>
<dt><a href="#ZMQ">ZMQ</a></dt>
<dd><p>Connect and subscribe to ZeroMQ publishers.</p>
</dd>
<dt><del><a href="#Scribe">Scribe</a></del></dt>
<dd><p>Deprecated 2021-11-06 — use <a href="FabricState">FabricState</a> (<code>types/state</code>). <code>Scribe</code> was merged into <code>State</code>.</p>
</dd>
</dl>

## Constants

<dl>
<dt><a href="#CHANNEL_BODY_TYPES">CHANNEL_BODY_TYPES</a></dt>
<dd><p>CONTRACT_MESSAGE body types for the Fabric payment channel flow. These ride
the existing <code>CONTRACT_MESSAGE</code> opcode as signed artifacts
(<a href="#Witness.signArtifact">signArtifact</a>); <strong>no channel opcode is introduced</strong> — a
dedicated opcode is a separate, later protocol decision.</p>
</dd>
<dt><a href="#CHANNEL_DEFAULTS">CHANNEL_DEFAULTS</a></dt>
<dd><p>Channel defaults (Lightning-derived). Policy fields are negotiated at
<code>ChannelOpen</code> — the stricter value wins. HTLCs are never trimmed: every one
carries at least <code>HTLC_MINIMUM_SATS</code>, so it has a commitment output its
receiver can claim on-chain.</p>
</dd>
<dt><a href="#GCM_TAG_BYTES">GCM_TAG_BYTES</a></dt>
<dd><p>AES-GCM tag appended to each sealed blob.</p>
</dd>
<dt><a href="#DEFAULT_WEIGHTS">DEFAULT_WEIGHTS</a></dt>
<dd><p>Default ranking weights (sum to 1).</p>
</dd>
<dt><a href="#TELEMETRY_VERSION">TELEMETRY_VERSION</a></dt>
<dd><p>Telemetry record schema version.</p>
</dd>
<dt><a href="#TELEMETRY_TYPE">TELEMETRY_TYPE</a></dt>
<dd><p>Canonical <code>type</code> for an exported telemetry record.</p>
</dd>
<dt><a href="#SCORE_UNKNOWN">SCORE_UNKNOWN</a></dt>
<dd><p>Neutral score for a provider with no observations.</p>
</dd>
<dt><a href="#SCORE_MAX">SCORE_MAX</a></dt>
<dd><p>Maximum provider score.</p>
</dd>
<dt><a href="#HOP_PENALTY_MS">HOP_PENALTY_MS</a></dt>
<dd><p>Each extra gossip hop counts as this many milliseconds of latency.</p>
</dd>
<dt><a href="#EXIT_KINDS">EXIT_KINDS</a></dt>
<dd><p>Exit kinds.</p>
</dd>
<dt><a href="#EXIT_SIGNATURE_TYPE">EXIT_SIGNATURE_TYPE</a></dt>
<dd><p><code>CONTRACT_MESSAGE</code> body carrying one exit signature.</p>
</dd>
<dt><del><a href="#Text">Text</a></del></dt>
<dd></dd>
</dl>

## Functions

<dl>
<dt><a href="#lockFrom">lockFrom()</a></dt>
<dd><p>Accept a block height, a <code>{ type, height|unix|blocks }</code> lock, or a normalized lock. @private</p>
</dd>
<dt><a href="#offerKey">offerKey(row)</a> ⇒ <code>string</code></dt>
<dd><p>Stable key for one offer row.</p>
</dd>
<dt><a href="#toIntegerSats">toIntegerSats(value)</a> ⇒ <code>bigint</code></dt>
<dd><p>PSBT output values are integer satoshis. Reject float BTC leftovers.</p>
</dd>
<dt><a href="#weightsForProximity">weightsForProximity(proximityWeight)</a> ⇒ <code>Object</code></dt>
<dd><p>Translate <code>proximityWeight</code> (0..1) into offer-book ranking weights: higher
proximity shifts weight from price toward measured latency + hops.</p>
</dd>
</dl>

## Typedefs

<dl>
<dt><a href="#BitcoinCookieProbeConstraints">BitcoinCookieProbeConstraints</a> : <code>Object</code></dt>
<dd><p>Constraints hint for cookie / store probe paths (e.g. pruned mainnet).</p>
</dd>
<dt><a href="#BitcoinLocalCookieProbeOpts">BitcoinLocalCookieProbeOpts</a> : <code>Object</code></dt>
<dd><p>Options for <a href="#Bitcoin.buildLocalCookieProbePaths">buildLocalCookieProbePaths</a>.</p>
</dd>
<dt><a href="#BitcoinRegtestCookieOpts">BitcoinRegtestCookieOpts</a> : <code>Object</code></dt>
<dd><p>Options for <a href="#Bitcoin.buildRegtestCookiePathList">buildRegtestCookiePathList</a>.</p>
</dd>
</dl>

<a name="types/ecc.module_selftest"></a>

## types/ecc.selftest
Lightweight ECC sanity check for real browsers (see types/ecc.js).

<a name="exp_types/ecc.module_selftest--module.exports"></a>

### .module.exports(ecc) ⏏
Run a small sign/verify round-trip against an `ecc` binding.

**Kind**: static method of [<code>types/ecc.selftest</code>](#types/ecc.module_selftest)  

| Param | Type | Description |
| --- | --- | --- |
| ecc | <code>object</code> | exports from types/ecc.js |

<a name="module_types/typetree"></a>

## ~~types/typetree~~
***Prefer PRODUCTION_MARCH keep/remove inventory over this helper.***

Quarantined TypeTree scaffold (not shipped).

<a name="Actor"></a>

## Actor ⇐ <code>EventEmitter</code>
Base <strong>Actor</strong>: JSON-shaped <code>_state.content</code> observed with
<code>fast-json-patch</code>; [commit](#Actor+commit) turns diffs into [Actor#history](Actor#history) and emits
<code>commit</code> plus <code>message</code> (<code>type: 'ActorMessage'</code>, <code>data.type: 'Changes'</code>).
<strong>Identity</strong> — [Actor#id](Actor#id) is SHA256(hex) of the 32-byte preimage buffer; [Actor#preimage](Actor#preimage) is
SHA256(UTF-8) of pretty-printed [toGenericMessage](#Actor+toGenericMessage) <code>{ type, object }</code> with sorted keys
([toObject](#Actor+toObject)); uses [Hash256.compute](Hash256.compute). Treat <code>id</code> as a <strong>content address</strong>, not an
arbitrary app string hash. <strong>Wire traffic</strong> — see [Message](#Message) (extends Actor, AMP). Same narrative as
<strong>DEVELOPERS.md</strong> (<em>Actor and Message</em>) and <code>@fileoverview</code> above (also on
<code>types_actor.js.html</code> source page).

**Kind**: global class  
**Extends**: <code>EventEmitter</code>  
**Emits**: <code>Actor#event:commit</code>, <code>message Emits structured objects; on {@link Actor#commit},event: &lt;code&gt;type: &#x27;ActorMessage&#x27;&lt;/code&gt; with patch metadata (not necessarily a {@link Message} AMP instance).</code>  
**Access**: protected  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | 64-char hex: SHA256 of the 32-byte digest represented by [Actor#preimage](Actor#preimage). |
| preimage | <code>String</code> | 64-char hex: SHA256 of UTF-8 pretty JSON of [toGenericMessage](#Actor+toGenericMessage). |


* [Actor](#Actor) ⇐ <code>EventEmitter</code>
    * [new Actor([actor])](#new_Actor_new)
    * _instance_
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.commit()](#Actor+commit) ⇒ <code>String</code>
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.get(path)](#Actor+get) ⇒ <code>Object</code>
        * [.set(path, value)](#Actor+set) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * [.fromAny(input)](#Actor.fromAny) ⇒ [<code>Actor</code>](#Actor)
        * [.randomBytes([count])](#Actor.randomBytes) ⇒ <code>Buffer</code>

<a name="new_Actor_new"></a>

### new Actor([actor])
Creates an [Actor](#Actor), which emits messages for other
Actors to subscribe to.  You can supply certain parameters
for the actor, including key material [!!!] — be mindful of
what you share with others!

**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  Call [sign](#Actor+sign) to emit a [Signature](Signature).  

| Param | Type | Description |
| --- | --- | --- |
| [actor] | <code>Object</code> | Object to use as the actor. |
| [actor.seed] | <code>String</code> | Optional mnemonic or seed string stored into state (see BIP39 / wallet docs — not validated here). |
| [actor.public] | <code>Buffer</code> | Public key. |
| [actor.private] | <code>Buffer</code> | Private key. |

<a name="Actor+adopt"></a>

### actor.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### actor.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+export"></a>

### actor.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+get"></a>

### actor.get(path) ⇒ <code>Object</code>
Retrieve a value from the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to retrieve using [JSONPointer](JSONPointer). |

<a name="Actor+set"></a>

### actor.set(path, value) ⇒ <code>Object</code>
Set a value in the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to set using [JSONPointer](JSONPointer). |
| value | <code>Object</code> | Value to set. |

<a name="Actor+stream"></a>

### actor.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### actor.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
<a name="Actor+toGenericMessage"></a>

### actor.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### actor.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Actor</code>](#Actor)  
<a name="Actor+pause"></a>

### actor.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### actor.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
<a name="Actor+sign"></a>

### actor.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
<a name="Actor+unpause"></a>

### actor.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### actor.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### actor.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Actor.fromAny"></a>

### Actor.fromAny(input) ⇒ [<code>Actor</code>](#Actor)
Create an [Actor](#Actor) from a variety of formats.

**Kind**: static method of [<code>Actor</code>](#Actor)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the [Actor](#Actor).  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Target [Object](Object) to create. |

<a name="Actor.randomBytes"></a>

### Actor.randomBytes([count]) ⇒ <code>Buffer</code>
Get a number of random bytes from the runtime environment.

**Kind**: static method of [<code>Actor</code>](#Actor)  
**Returns**: <code>Buffer</code> - The random bytes.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [count] | <code>Number</code> | <code>32</code> | Number of random bytes to retrieve. |

<a name="Actor"></a>

## Actor
**Kind**: global class  

* [Actor](#Actor)
    * [new Actor([actor])](#new_Actor_new)
    * _instance_
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.commit()](#Actor+commit) ⇒ <code>String</code>
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.get(path)](#Actor+get) ⇒ <code>Object</code>
        * [.set(path, value)](#Actor+set) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * [.fromAny(input)](#Actor.fromAny) ⇒ [<code>Actor</code>](#Actor)
        * [.randomBytes([count])](#Actor.randomBytes) ⇒ <code>Buffer</code>

<a name="new_Actor_new"></a>

### new Actor([actor])
Creates an [Actor](#Actor), which emits messages for other
Actors to subscribe to.  You can supply certain parameters
for the actor, including key material [!!!] — be mindful of
what you share with others!

**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  Call [sign](#Actor+sign) to emit a [Signature](Signature).  

| Param | Type | Description |
| --- | --- | --- |
| [actor] | <code>Object</code> | Object to use as the actor. |
| [actor.seed] | <code>String</code> | Optional mnemonic or seed string stored into state (see BIP39 / wallet docs — not validated here). |
| [actor.public] | <code>Buffer</code> | Public key. |
| [actor.private] | <code>Buffer</code> | Private key. |

<a name="Actor+adopt"></a>

### actor.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### actor.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+export"></a>

### actor.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+get"></a>

### actor.get(path) ⇒ <code>Object</code>
Retrieve a value from the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to retrieve using [JSONPointer](JSONPointer). |

<a name="Actor+set"></a>

### actor.set(path, value) ⇒ <code>Object</code>
Set a value in the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to set using [JSONPointer](JSONPointer). |
| value | <code>Object</code> | Value to set. |

<a name="Actor+stream"></a>

### actor.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### actor.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
<a name="Actor+toGenericMessage"></a>

### actor.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### actor.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Actor</code>](#Actor)  
<a name="Actor+pause"></a>

### actor.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### actor.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
<a name="Actor+sign"></a>

### actor.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
<a name="Actor+unpause"></a>

### actor.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### actor.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### actor.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Actor.fromAny"></a>

### Actor.fromAny(input) ⇒ [<code>Actor</code>](#Actor)
Create an [Actor](#Actor) from a variety of formats.

**Kind**: static method of [<code>Actor</code>](#Actor)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the [Actor](#Actor).  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Target [Object](Object) to create. |

<a name="Actor.randomBytes"></a>

### Actor.randomBytes([count]) ⇒ <code>Buffer</code>
Get a number of random bytes from the runtime environment.

**Kind**: static method of [<code>Actor</code>](#Actor)  
**Returns**: <code>Buffer</code> - The random bytes.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [count] | <code>Number</code> | <code>32</code> | Number of random bytes to retrieve. |

<a name="Beacon"></a>

## Beacon
**Kind**: global class  

* [Beacon](#Beacon)
    * [new Beacon([settings])](#new_Beacon_new)
    * _instance_
        * [.state](#Beacon+state) : <code>Object</code>
        * [.attach([deps])](#Beacon+attach)
        * ~~[._hubCompressedPubkeyHex()](#Beacon+_hubCompressedPubkeyHex)~~
        * [.listPendingFederationEpochRounds()](#Beacon+listPendingFederationEpochRounds) ⇒ <code>Array.&lt;Object&gt;</code>
        * [.adoptFederationSignRequest(signRequest)](#Beacon+adoptFederationSignRequest) ⇒ [<code>Promise.&lt;FederationRoundAdoption&gt;</code>](#Beacon.FederationRoundAdoption)
        * [.signPendingFederationRoundAsLocalValidator(commitmentDigest)](#Beacon+signPendingFederationRoundAsLocalValidator) ⇒ [<code>Promise.&lt;FederationRoundSignature&gt;</code>](#Beacon.FederationRoundSignature)
        * [.start()](#Beacon+start) ⇒ [<code>Promise.&lt;Beacon&gt;</code>](#Beacon)
        * [.stop()](#Beacon+stop) ⇒ [<code>Promise.&lt;Beacon&gt;</code>](#Beacon)
    * _static_
        * [.FederationRoundAdoption](#Beacon.FederationRoundAdoption) : <code>Object</code>
        * [.FederationRoundSignature](#Beacon.FederationRoundSignature) : <code>Object</code>

<a name="new_Beacon_new"></a>

### new Beacon([settings])

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  |  |
| [settings.interval] | <code>number</code> | <code>60000</code> | regtest epoch interval in ms (0 = none) |
| [settings.regtest] | <code>boolean</code> | <code>true</code> | mine epochs; false follows L1 tips only |
| [settings.mineOnStart] | <code>boolean</code> | <code>true</code> | mine one epoch on start (regtest) |
| [settings.federationValidators] | <code>Array.&lt;string&gt;</code> |  | x-only hex pubkeys that witness epochs |
| [settings.federationThreshold] | <code>number</code> \| <code>null</code> | <code></code> | k; null = strict majority of validators |
| [settings.federationSignatureScheme] | <code>string</code> | <code>&quot;&#x27;schnorr&#x27;&quot;</code> | `schnorr` or `bls` |
| [settings.federationWitnessFailClosed] | <code>boolean</code> | <code>true</code> | truncate the stored chain at the first epoch without k valid witnesses |
| [settings.followBlocks] | <code>boolean</code> | <code>false</code> | follow bitcoind `block` events on regtest |

<a name="Beacon+state"></a>

### beacon.state : <code>Object</code>
Live epoch state: `clock`, `status`, `lastBlockHash`, `height`, `balance`, `balanceSats`.

**Kind**: instance property of [<code>Beacon</code>](#Beacon)  
<a name="Beacon+attach"></a>

### beacon.attach([deps])
**Kind**: instance method of [<code>Beacon</code>](#Beacon)  

| Param | Type | Description |
| --- | --- | --- |
| [deps] | <code>Object</code> |  |
| [deps.bitcoin] | <code>Object</code> |  |
| [deps.fs] | <code>Object</code> |  |
| [deps.key] | <code>Object</code> |  |
| [deps.federationValidators] | <code>Array.&lt;string&gt;</code> |  |
| [deps.federationThreshold] | <code>number</code> |  |
| [deps.federationSignatureScheme] | <code>string</code> | `schnorr` (default) or `bls` |
| [deps.getSidechainSnapshotForEpoch] | <code>function</code> |  |
| [deps.getContractsSnapshotForEpoch] | <code>function</code> |  |

<a name="Beacon+_hubCompressedPubkeyHex"></a>

### ~~beacon.\_hubCompressedPubkeyHex()~~
***Hub alias — use [Beacon#_compressedPubkeyHex](Beacon#_compressedPubkeyHex)***

**Kind**: instance method of [<code>Beacon</code>](#Beacon)  
<a name="Beacon+listPendingFederationEpochRounds"></a>

### beacon.listPendingFederationEpochRounds() ⇒ <code>Array.&lt;Object&gt;</code>
Summaries of the epoch rounds still collecting witnesses.

**Kind**: instance method of [<code>Beacon</code>](#Beacon)  
**Returns**: <code>Array.&lt;Object&gt;</code> - `commitmentDigest`, `clock`, `blockHash`, `signatureCount`,
`threshold`, `validators`, `status`, `createdAt` per round  
<a name="Beacon+adoptFederationSignRequest"></a>

### beacon.adoptFederationSignRequest(signRequest) ⇒ [<code>Promise.&lt;FederationRoundAdoption&gt;</code>](#Beacon.FederationRoundAdoption)
Adopt a peer [FederationSignRequest](FederationSignRequest) into the pending map when the
commitment digest matches the epoch body. Validators use this so each node
can accumulate BIP340 signatures over the same deterministic payload.

**Kind**: instance method of [<code>Beacon</code>](#Beacon)  

| Param | Type |
| --- | --- |
| signRequest | <code>object</code> | 

<a name="Beacon+signPendingFederationRoundAsLocalValidator"></a>

### beacon.signPendingFederationRoundAsLocalValidator(commitmentDigest) ⇒ [<code>Promise.&lt;FederationRoundSignature&gt;</code>](#Beacon.FederationRoundSignature)
Sign the pending round as this Beacon's identity key (must be a validator).
Returns a [FederationSignResponse](FederationSignResponse) body ready to gossip.

**Kind**: instance method of [<code>Beacon</code>](#Beacon)  

| Param | Type |
| --- | --- |
| commitmentDigest | <code>string</code> | 

<a name="Beacon+start"></a>

### beacon.start() ⇒ [<code>Promise.&lt;Beacon&gt;</code>](#Beacon)
Restore the epoch chain, then mine on the interval (regtest) and/or follow L1 tips.
Idempotent while running.

**Kind**: instance method of [<code>Beacon</code>](#Beacon)  
<a name="Beacon+stop"></a>

### beacon.stop() ⇒ [<code>Promise.&lt;Beacon&gt;</code>](#Beacon)
Stop mining and block following, drain queued blocks, and persist the epoch chain.

**Kind**: instance method of [<code>Beacon</code>](#Beacon)  
<a name="Beacon.FederationRoundAdoption"></a>

### Beacon.FederationRoundAdoption : <code>Object</code>
Result of [adoptFederationSignRequest](#Beacon+adoptFederationSignRequest).

**Kind**: static typedef of [<code>Beacon</code>](#Beacon)  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| ok | <code>boolean</code> |  |
| [round] | <code>Object</code> | the pending round (adopted or already held) |
| [created] | <code>boolean</code> | whether this call created the round |
| [error] | <code>string</code> | why the request was refused |

<a name="Beacon.FederationRoundSignature"></a>

### Beacon.FederationRoundSignature : <code>Object</code>
Result of [signPendingFederationRoundAsLocalValidator](#Beacon+signPendingFederationRoundAsLocalValidator).

**Kind**: static typedef of [<code>Beacon</code>](#Beacon)  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| ok | <code>boolean</code> |  |
| [response] | <code>Object</code> | `FederationSignResponse` body to gossip |
| [submit] | <code>Object</code> | result of submitting the signature locally |
| [error] | <code>string</code> | why the round could not be signed |

<a name="Block"></a>

## Block
**Kind**: global class  

* [Block](#Block)
    * [new Block([input])](#new_Block_new)
    * _instance_
        * [.clock](#Block+clock)
        * [.payload](#Block+payload)
        * [.toRecord()](#Block+toRecord) ⇒ <code>object</code>
        * [.sign(key)](#Block+sign) ⇒ <code>string</code>
        * [.addSignature(pubkey, sig)](#Block+addSignature) ⇒ [<code>Block</code>](#Block)
        * [.validate([opts])](#Block+validate) ⇒ <code>Object</code>
    * _static_
        * [.fromRecord(record)](#Block.fromRecord) ⇒ [<code>Block</code>](#Block)

<a name="new_Block_new"></a>

### new Block([input])

| Param | Type |
| --- | --- |
| [input] | <code>object</code> | 

<a name="Block+clock"></a>

### block.clock
Alias used by Beacon codecs / tests.

**Kind**: instance property of [<code>Block</code>](#Block)  
<a name="Block+payload"></a>

### block.payload
Beacon / legacy entry alias for `data`.

**Kind**: instance property of [<code>Block</code>](#Block)  
<a name="Block+toRecord"></a>

### block.toRecord() ⇒ <code>object</code>
JSON-safe ledger record.

**Kind**: instance method of [<code>Block</code>](#Block)  
<a name="Block+sign"></a>

### block.sign(key) ⇒ <code>string</code>
Author Schnorr over signingString (gossip).

**Kind**: instance method of [<code>Block</code>](#Block)  
**Returns**: <code>string</code> - signature hex  

| Param | Type |
| --- | --- |
| key | [<code>Key</code>](#Key) | 

<a name="Block+addSignature"></a>

### block.addSignature(pubkey, sig) ⇒ [<code>Block</code>](#Block)
**Kind**: instance method of [<code>Block</code>](#Block)  

| Param | Type |
| --- | --- |
| pubkey | <code>string</code> | 
| sig | <code>string</code> \| <code>Buffer</code> | 

<a name="Block+validate"></a>

### block.validate([opts]) ⇒ <code>Object</code>
**Kind**: instance method of [<code>Block</code>](#Block)  

| Param | Type |
| --- | --- |
| [opts] | <code>Object</code> | 
| [opts.consensus] | <code>string</code> | 
| [opts.validators] | <code>Array.&lt;string&gt;</code> | 
| [opts.threshold] | <code>number</code> | 
| [opts.bits] | <code>number</code> \| <code>null</code> | 
| [opts.requireParent] | <code>string</code> \| <code>null</code> | 

<a name="Block.fromRecord"></a>

### Block.fromRecord(record) ⇒ [<code>Block</code>](#Block)
**Kind**: static method of [<code>Block</code>](#Block)  

| Param | Type |
| --- | --- |
| record | <code>object</code> | 

<a name="Bond"></a>

## Bond ⇐ [<code>Contract</code>](#Contract)
**Kind**: global class  
**Extends**: [<code>Contract</code>](#Contract)  

* [Bond](#Bond) ⇐ [<code>Contract</code>](#Contract)
    * [new Bond()](#new_Bond_new)
    * _instance_
        * [.resolutions](#Contract+resolutions) : [<code>Resolutions</code>](#Resolutions)
        * [.recordRound(round, opts)](#Bond+recordRound) ⇒ <code>Object</code>
        * [.advance(stateId)](#Contract+advance) ⇒ [<code>Contract</code>](#Contract)
        * [.deploy()](#Contract+deploy) ⇒ <code>String</code>
        * [.start()](#Contract+start) ⇒ [<code>Contract</code>](#Contract)
        * [._handleBitcoinTransaction(txInput, [opts])](#Contract+_handleBitcoinTransaction) ⇒ <code>object</code>
        * [.toTaprootContract([overrides])](#Contract+toTaprootContract) ⇒ <code>object</code>
        * [.toAddress([network])](#Contract+toAddress) ⇒ <code>string</code>
        * [.resolveSpend([opts])](#Contract+resolveSpend) ⇒ <code>object</code>
        * [._appendWarning(msg)](#Service+_appendWarning) ⇒ [<code>Service</code>](#Service)
        * [.init()](#Service+init)
        * [.tick()](#Service+tick) ⇒ <code>Number</code>
        * [.beat()](#Service+beat) ⇒ [<code>Service</code>](#Service)
        * [.get(path)](#Service+get) ⇒ <code>Mixed</code>
        * [.set(path)](#Service+set) ⇒ <code>Mixed</code>
        * [.trust(source)](#Service+trust) ⇒ [<code>Service</code>](#Service)
        * [.handler(message)](#Service+handler) ⇒ [<code>Service</code>](#Service)
        * [.lock([duration])](#Service+lock) ⇒ <code>Boolean</code>
        * [.when(event, method)](#Service+when) ⇒ <code>EventEmitter</code>
        * [.defineOpcode(name, [definition])](#Service+defineOpcode) ⇒ <code>Object</code>
        * [.defineBitcoinOpcode(name, [definition])](#Service+defineBitcoinOpcode) ⇒ <code>Object</code>
        * [.defineFabricOpcode(name, [definition])](#Service+defineFabricOpcode) ⇒ <code>Object</code>
        * [.defineOpcodeContract(name, body, [meta])](#Service+defineOpcodeContract) ⇒ <code>Object</code>
        * [.listOpcodes()](#Service+listOpcodes) ⇒ <code>Array.&lt;Object&gt;</code>
        * [.route(msg)](#Service+route) ⇒ <code>Promise</code>
        * [._GET(path)](#Service+_GET) ⇒ <code>Promise</code>
        * [._PUT(path, value, [commit])](#Service+_PUT) ⇒ <code>Promise</code>
        * [.connect(notify)](#Service+connect) ⇒ <code>Promise</code>
        * [.send(channel, message)](#Service+send) ⇒ [<code>Service</code>](#Service)
        * [.commit()](#Service+commit) ⇒ <code>String</code>
        * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
        * [._send(message)](#Service+_send)
    * _static_
        * [.deriveEpochPreimage(seed, epoch, providerPubkey)](#Bond.deriveEpochPreimage) ⇒ <code>string</code>
        * [.commitmentFor(preimageHex)](#Bond.commitmentFor)
        * [.leafIdClaim(epoch, providerPubkey)](#Bond.leafIdClaim) ⇒ <code>string</code>
        * [.buildBounty(opts)](#Bond.buildBounty) ⇒ <code>object</code>
        * [.toRecord(bond)](#Bond.toRecord) ⇒ <code>object</code>
        * [.fromRecord(record)](#Bond.fromRecord) ⇒ <code>object</code>
        * [.buildDeposit(opts)](#Bond.buildDeposit) ⇒ <code>object</code>
        * [.prepareBountyClaim(bounty, opts)](#Bond.prepareBountyClaim) ⇒ <code>object</code>
        * [.prepareBountyRefund(bounty, opts)](#Bond.prepareBountyRefund) ⇒ <code>object</code>
        * [.prepareDepositPenalty(deposit, opts)](#Bond.prepareDepositPenalty) ⇒ <code>object</code>
        * [.signPenaltyAsProvider(deposit, penalty, providerPrivateKey)](#Bond.signPenaltyAsProvider) ⇒ <code>object</code>
        * [.finalizePreSignedPenalty(deposit, preSig, publisherPrivateKey, [ctx])](#Bond.finalizePreSignedPenalty) ⇒ <code>Object</code>
        * [.prepareDepositCheckIn(deposit, opts)](#Bond.prepareDepositCheckIn) ⇒ <code>object</code>
        * [.preparePenaltySpend(deposit, opts)](#Bond.preparePenaltySpend) ⇒ <code>object</code>
        * [.prepareDepositWithdraw(deposit, opts)](#Bond.prepareDepositWithdraw) ⇒ <code>object</code>
        * [.finalizeClaim()](#Bond.finalizeClaim)
        * [.finalizeSpend()](#Bond.finalizeSpend)

<a name="new_Bond_new"></a>

### new Bond()
Publisher bounty and provider deposit terms as Taproot outputs
(`functions/contractTaproot.js` leaves) layered on [Contract](#Contract).

**Bounty** (decision 1): one P2TR output per epoch. Leaves: for every
eligible provider a hashlock `SHA256(R_{epoch,provider})` + `CHECKSIG
provider` claim, and a publisher `CHECKSIG` refund after `refundAfter`.
The publisher reveals `R_{epoch,provider}` only to a provider that passed
that epoch's [Challenge](#Challenge); the preimage is derived from a publisher
seed so nothing per-epoch has to be stored. No custodian.

**Deposit** (decision 2): one P2TR output per provider commitment. Leaves:
a 2-of-2 `{ publisher, provider }` penalty leaf and a provider-only
withdraw after `withdrawAfter`. The provider pre-signs the penalty spend
(LN-justice style) alongside its availability commitment; the publisher can
complete it only with a verifying [Witness.FraudProof](Witness.FraudProof) attached —
`Bond.preparePenaltySpend` refuses otherwise (decision 6).

<a name="Contract+resolutions"></a>

### bond.resolutions : [<code>Resolutions</code>](#Resolutions)
Pre-signed, timelocked exits per off-chain state (see [Resolutions](#Resolutions)).
A state may only be treated as live once `resolutions.resolvable(stateId)`.

**Kind**: instance property of [<code>Bond</code>](#Bond)  
<a name="Bond+recordRound"></a>

### bond.recordRound(round, opts) ⇒ <code>Object</code>
Record one check-in round in this bond's [Contract.Resolutions](Contract.Resolutions):
round `n` is **resolvable** only when the provider's pre-signed penalty
for round `n + 1` (spending the post-check-in outpoint) is held. The
publisher must call this (and see `resolvable`) before co-signing the
round-`n` check-in — `P_{n+1}` before `C_n`.

**Kind**: instance method of [<code>Bond</code>](#Bond)  

| Param | Type | Description |
| --- | --- | --- |
| round | <code>number</code> |  |
| opts | <code>object</code> | `{ penaltyPreSig, checkInPsbtBase64?, deposit, penaltyAddress?, minPenaltySats? }` — the pre-signed penalty must pay `penaltyAddress` (else `deposit.penaltyAddress`) |

<a name="Contract+advance"></a>

### bond.advance(stateId) ⇒ [<code>Contract</code>](#Contract)
Gate an off-chain state transition on its resolution set: every exit the
state depends on must hold all required signatures, otherwise a counterparty
that stops responding would leave funds unrecoverable.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Throws**:

- <code>Error</code> when exits are still missing signatures


| Param | Type |
| --- | --- |
| stateId | <code>string</code> | 

<a name="Contract+deploy"></a>

### bond.deploy() ⇒ <code>String</code>
Deploys the contract.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: <code>String</code> - Message ID.  
<a name="Contract+start"></a>

### bond.start() ⇒ [<code>Contract</code>](#Contract)
Start the Contract.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: [<code>Contract</code>](#Contract) - State "STARTED" iteration of the Contract.  
<a name="Contract+_handleBitcoinTransaction"></a>

### bond.\_handleBitcoinTransaction(txInput, [opts]) ⇒ <code>object</code>
Observe an on-chain transaction for payments to this contract's spend address.
On success (and when `apply` is not false), folds matched sats into tip balances.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: <code>object</code> - observation from [module:functions/contractPaymentObserve.observePaymentToAddress](module:functions/contractPaymentObserve.observePaymentToAddress)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| txInput | <code>string</code> \| <code>object</code> |  | raw tx hex or bitcoin.Transaction |
| [opts] | <code>object</code> |  |  |
| [opts.network] | <code>string</code> |  |  |
| [opts.address] | <code>string</code> |  | override spend address |
| [opts.amountSats] | <code>number</code> |  | minimum matched sats |
| [opts.apply] | <code>boolean</code> | <code>true</code> | fold into `_state.content` on success |

<a name="Contract+toTaprootContract"></a>

### bond.toTaprootContract([overrides]) ⇒ <code>object</code>
Build deterministic P2TR spend tree from settings.spendLadder or synthesized
validators / publisher policy.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: <code>object</code> - [module:functions/contractTaproot.buildContractTaproot](module:functions/contractTaproot.buildContractTaproot)  

| Param | Type |
| --- | --- |
| [overrides] | <code>object</code> | 

<a name="Contract+toAddress"></a>

### bond.toAddress([network]) ⇒ <code>string</code>
Bech32m P2TR address for this contract's spend policy.

**Kind**: instance method of [<code>Bond</code>](#Bond)  

| Param | Type |
| --- | --- |
| [network] | <code>string</code> | 

<a name="Contract+resolveSpend"></a>

### bond.resolveSpend([opts]) ⇒ <code>object</code>
Resolve tip + genesis spend policy to the public P2TR surface (ARC).

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: <code>object</code> - [module:functions/contractSpend.resolveSpend](module:functions/contractSpend.resolveSpend)  

| Param | Type | Description |
| --- | --- | --- |
| [opts] | <code>object</code> |  |
| [opts.tip] | <code>object</code> |  |
| [opts.genesis] | <code>object</code> | defaults to this.settings |
| [opts.overrides] | <code>object</code> |  |

<a name="Service+_appendWarning"></a>

### bond.\_appendWarning(msg) ⇒ [<code>Service</code>](#Service)
**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: [<code>Service</code>](#Service) - This instance.  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>String</code> | Warning text (used by [Service#_registerService](Service#_registerService) duplicate guard). |

<a name="Service+init"></a>

### bond.init()
Called by Web Components.
TODO: move to @fabric/http/types/spa

**Kind**: instance method of [<code>Bond</code>](#Bond)  
<a name="Service+tick"></a>

### bond.tick() ⇒ <code>Number</code>
Move forward one clock cycle.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
<a name="Service+beat"></a>

### bond.beat() ⇒ [<code>Service</code>](#Service)
Compute latest state.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Emits**: <code>Message#event:beat</code>  
<a name="Service+get"></a>

### bond.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: <code>Mixed</code> - Returns the target value if found, otherwise null.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+set"></a>

### bond.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Bond</code>](#Bond)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+trust"></a>

### bond.trust(source) ⇒ [<code>Service</code>](#Service)
Explicitly trust all events from a known source.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: [<code>Service</code>](#Service) - Instance of Service after binding events.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Emitter of events. |

<a name="Service+handler"></a>

### bond.handler(message) ⇒ [<code>Service</code>](#Service)
Default route handler for an incoming message.  Follows the Activity
Streams 2.0 spec: https://www.w3.org/TR/activitystreams-core/

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Activity</code> | Message object. |

<a name="Service+lock"></a>

### bond.lock([duration]) ⇒ <code>Boolean</code>
Attempt to acquire a lock for `duration` seconds.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: <code>Boolean</code> - true if locked, false if unable to lock.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [duration] | <code>Number</code> | <code>1000</code> | Number of milliseconds to hold lock. |

<a name="Service+when"></a>

### bond.when(event, method) ⇒ <code>EventEmitter</code>
Bind a method to an event, with current state as the immutable context.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: <code>EventEmitter</code> - Instance of EventEmitter.  

| Param | Type | Description |
| --- | --- | --- |
| event | <code>String</code> | Name of the event upon which to execute `method` as a function. |
| method | <code>function</code> | Function to execute when named [Event](Event) `event` is encountered. |

<a name="Service+defineOpcode"></a>

### bond.defineOpcode(name, [definition]) ⇒ <code>Object</code>
Register a single opcode entry in the service registry.

**Kind**: instance method of [<code>Bond</code>](#Bond)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Opcode symbol (e.g. `OP_SHA256`, `P2P_FLUSH_CHAIN`) |
| [definition] | <code>Object</code> |  |

<a name="Service+defineBitcoinOpcode"></a>

### bond.defineBitcoinOpcode(name, [definition]) ⇒ <code>Object</code>
Register Bitcoin-style primitive opcode metadata.

**Kind**: instance method of [<code>Bond</code>](#Bond)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineFabricOpcode"></a>

### bond.defineFabricOpcode(name, [definition]) ⇒ <code>Object</code>
Register Fabric opcode metadata.

**Kind**: instance method of [<code>Bond</code>](#Bond)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineOpcodeContract"></a>

### bond.defineOpcodeContract(name, body, [meta]) ⇒ <code>Object</code>
Register a newline-delimited opcode contract.
Contract body example:
`OP_DUP\nOP_HASH160\nP2P_FLUSH_CHAIN`

**Kind**: instance method of [<code>Bond</code>](#Bond)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Contract label |
| body | <code>string</code> | Newline-delimited opcode list |
| [meta] | <code>Object</code> |  |

<a name="Service+listOpcodes"></a>

### bond.listOpcodes() ⇒ <code>Array.&lt;Object&gt;</code>
Snapshot opcode registry for UI / API use.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
<a name="Service+route"></a>

### bond.route(msg) ⇒ <code>Promise</code>
Resolve a [State](#State) from a particular [Message](#Message) object.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: <code>Promise</code> - Resolves with resulting [State](#State).  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | Explicit Fabric [Message](#Message). |

<a name="Service+_GET"></a>

### bond.\_GET(path) ⇒ <code>Promise</code>
Retrieve a value from the Service's state.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: <code>Promise</code> - Resolves with the result.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path of the value to retrieve. |

<a name="Service+_PUT"></a>

### bond.\_PUT(path, value, [commit]) ⇒ <code>Promise</code>
Store a value in the Service's state.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: <code>Promise</code> - Resolves with with stored document.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>String</code> |  | Path to store the value at. |
| value | <code>Object</code> |  | Document to store. |
| [commit] | <code>Boolean</code> | <code>false</code> | Sign the resulting state. |

<a name="Service+connect"></a>

### bond.connect(notify) ⇒ <code>Promise</code>
Attach to network.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: <code>Promise</code> - Resolves to [Fabric](#Fabric).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| notify | <code>Boolean</code> | <code>true</code> | Commit to changes. |

<a name="Service+send"></a>

### bond.send(channel, message) ⇒ [<code>Service</code>](#Service)
Send a message to a channel.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| channel | <code>String</code> | Channel name to which the message will be sent. |
| message | <code>String</code> | Content of the message to send. |

<a name="Service+commit"></a>

### bond.commit() ⇒ <code>String</code>
Record outstanding JSON Patch deltas and emit a compact commitment id.
Does **not** wrap [Service#state](Service#state) in a new [Actor](#Actor) — that
JSON-cloned the entire tree on every write/connect and OOMed Hub.

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: <code>String</code> - 32-byte commitment id  
<a name="Service+_registerActor"></a>

### bond.\_registerActor(actor) ⇒ <code>Promise</code>
Register an [Actor](#Actor) with the [Service](#Service).

**Kind**: instance method of [<code>Bond</code>](#Bond)  
**Returns**: <code>Promise</code> - Resolves upon successful registration.  

| Param | Type | Description |
| --- | --- | --- |
| actor | <code>Object</code> | Instance of the [Actor](#Actor). |

<a name="Service+_send"></a>

### bond.\_send(message)
Sends a message.

**Kind**: instance method of [<code>Bond</code>](#Bond)  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Mixed</code> | Message to send. |

<a name="Bond.deriveEpochPreimage"></a>

### Bond.deriveEpochPreimage(seed, epoch, providerPubkey) ⇒ <code>string</code>
`R_{epoch,provider} = SHA256(seed || epoch || providerPubkey)`.

**Kind**: static method of [<code>Bond</code>](#Bond)  
**Returns**: <code>string</code> - 32-byte hex preimage  

| Param | Type | Description |
| --- | --- | --- |
| seed | <code>Buffer</code> \| <code>string</code> | 32-byte publisher secret |
| epoch | <code>number</code> |  |
| providerPubkey | <code>string</code> | compressed hex |

<a name="Bond.commitmentFor"></a>

### Bond.commitmentFor(preimageHex)
**Kind**: static method of [<code>Bond</code>](#Bond)  

| Param | Type | Description |
| --- | --- | --- |
| preimageHex | <code>string</code> | @returns {string} |

<a name="Bond.leafIdClaim"></a>

### Bond.leafIdClaim(epoch, providerPubkey) ⇒ <code>string</code>
Deterministic leaf id for a provider's bounty claim at an epoch.

**Kind**: static method of [<code>Bond</code>](#Bond)  

| Param | Type | Description |
| --- | --- | --- |
| epoch | <code>number</code> |  |
| providerPubkey | <code>string</code> | compressed hex |

<a name="Bond.buildBounty"></a>

### Bond.buildBounty(opts) ⇒ <code>object</code>
Build the per-epoch bounty outputs.

**Kind**: static method of [<code>Bond</code>](#Bond)  
**Returns**: <code>object</code> - `BountyBond` record (JSON-safe except `_leaves`)  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> |  |
| opts.network | <code>string</code> | `regtest` | `signet` | `testnet` |
| opts.publisherPubkey | <code>string</code> | compressed hex (refund key) |
| opts.providerPubkeys | <code>Array.&lt;string&gt;</code> | compressed hex, eligible claimants |
| [opts.seed] | <code>Buffer</code> \| <code>string</code> | publisher secret (preimages derived) |
| opts.epochs | <code>Array.&lt;{epoch: number, amountSats: number, commitments: (object\|undefined)}&gt;</code> | when `seed` is absent each epoch supplies `commitments[providerPubkey] = SHA256(R)` |
| opts.refundAfter | <code>object</code> \| <code>number</code> | lock (`{ type: 'cltv', value }` or block height) |
| [opts.merkleRootHex] | <code>string</code> | the tree this bounty rewards |

<a name="Bond.toRecord"></a>

### Bond.toRecord(bond) ⇒ <code>object</code>
JSON view (drops Buffer-backed leaves) for persistence / `CONTRACT_MESSAGE`.

**Kind**: static method of [<code>Bond</code>](#Bond)  

| Param | Type |
| --- | --- |
| bond | <code>object</code> | 

<a name="Bond.fromRecord"></a>

### Bond.fromRecord(record) ⇒ <code>object</code>
Rebuild Buffer-backed leaves from a stored record (deterministic).

**Kind**: static method of [<code>Bond</code>](#Bond)  

| Param | Type | Description |
| --- | --- | --- |
| record | <code>object</code> | from [toRecord](#Bond.toRecord) |

<a name="Bond.buildDeposit"></a>

### Bond.buildDeposit(opts) ⇒ <code>object</code>
Provider deposit output.

**Kind**: static method of [<code>Bond</code>](#Bond)  
**Returns**: <code>object</code> - `DepositBond`  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> |  |
| opts.network | <code>string</code> |  |
| opts.providerPubkey | <code>string</code> | compressed hex |
| opts.publisherPubkey | <code>string</code> | compressed hex (penalty co-signer / adjudicator) |
| opts.withdrawAfter | <code>object</code> \| <code>number</code> | lock for the provider's unilateral exit |
| [opts.amountSats] | <code>number</code> |  |
| [opts.merkleRootHex] | <code>string</code> |  |

<a name="Bond.prepareBountyClaim"></a>

### Bond.prepareBountyClaim(bounty, opts) ⇒ <code>object</code>
Provider claims an epoch slice with the revealed preimage.

**Kind**: static method of [<code>Bond</code>](#Bond)  
**Returns**: <code>object</code> - `{ psbtBase64, leafId, witnessShape, … }`  

| Param | Type | Description |
| --- | --- | --- |
| bounty | <code>object</code> | from [buildBounty](#Bond.buildBounty) / [fromRecord](#Bond.fromRecord) |
| opts | <code>object</code> | `{ epoch, providerPubkey, preimageHex, fundedTxHex, destinationAddress, feeSats }` |

<a name="Bond.prepareBountyRefund"></a>

### Bond.prepareBountyRefund(bounty, opts) ⇒ <code>object</code>
Publisher refund after the bounty locktime.

**Kind**: static method of [<code>Bond</code>](#Bond)  

| Param | Type | Description |
| --- | --- | --- |
| bounty | <code>object</code> |  |
| opts | <code>object</code> | `{ epoch, fundedTxHex, destinationAddress, feeSats }` |

<a name="Bond.prepareDepositPenalty"></a>

### Bond.prepareDepositPenalty(deposit, opts) ⇒ <code>object</code>
Unsigned, **timelocked** penalty spend of a provider deposit for one
challenge round: `nLockTime = deadlineHeight`. The provider pre-signs it
([signPenaltyAsProvider](#Bond.signPenaltyAsProvider)) before the publisher co-signs that
round's check-in; if the provider never checks in, the publisher adds its
own signature after the deadline and broadcasts. No fraud proof is needed
to *build* it — the timelock is the evidence (decision 6, timelock form).

**Kind**: static method of [<code>Bond</code>](#Bond)  
**Returns**: <code>object</code> - `{ psbtBase64, txid, deadlineHeight, deposit: { txid, vout }, leafId: 'penalty' }`  

| Param | Type | Description |
| --- | --- | --- |
| deposit | <code>object</code> | from [buildDeposit](#Bond.buildDeposit) |
| opts | <code>object</code> | `{ fundedTxHex, deadlineHeight, destinationAddress, feeSats }` |

<a name="Bond.signPenaltyAsProvider"></a>

### Bond.signPenaltyAsProvider(deposit, penalty, providerPrivateKey) ⇒ <code>object</code>
Provider pre-signs a [prepareDepositPenalty](#Bond.prepareDepositPenalty) PSBT and wraps it
as a signed `DepositPenaltyPreSig` artifact (a `CONTRACT_MESSAGE` body).
Verifiers use [Witness.verifyPenaltyPreSig](Witness.verifyPenaltyPreSig).

**Kind**: static method of [<code>Bond</code>](#Bond)  
**Returns**: <code>object</code> - signed artifact  

| Param | Type | Description |
| --- | --- | --- |
| deposit | <code>object</code> |  |
| penalty | <code>object</code> | from [prepareDepositPenalty](#Bond.prepareDepositPenalty) |
| providerPrivateKey | <code>Buffer</code> \| <code>string</code> | 32 bytes |

<a name="Bond.finalizePreSignedPenalty"></a>

### Bond.finalizePreSignedPenalty(deposit, preSig, publisherPrivateKey, [ctx]) ⇒ <code>Object</code>
Publisher completes a pre-signed penalty after the deadline: verifies the
provider's artifact, adds the publisher signature, finalizes.

**Kind**: static method of [<code>Bond</code>](#Bond)  

| Param | Type | Description |
| --- | --- | --- |
| deposit | <code>object</code> |  |
| preSig | <code>object</code> | `DepositPenaltyPreSig` |
| publisherPrivateKey | <code>Buffer</code> \| <code>string</code> |  |
| [ctx] | <code>object</code> | `{ tipHeight, penaltyAddress?, minPenaltySats? }` — refuses before `deadlineHeight` when supplied; the destination (else `deposit.penaltyAddress`) must be paid |

<a name="Bond.prepareDepositCheckIn"></a>

### Bond.prepareDepositCheckIn(deposit, opts) ⇒ <code>object</code>
Check-in transaction for one round: re-deposits the output to the same
deposit address through the `checkin` leaf, which invalidates every
pre-signed penalty on the old outpoint. Both parties sign (publisher only
after holding the provider's pre-signature for the **next** round).

**Kind**: static method of [<code>Bond</code>](#Bond)  
**Returns**: <code>object</code> - `{ psbtBase64, txid, leafId: 'checkin', nextDeposit: { txid, vout } }`  

| Param | Type | Description |
| --- | --- | --- |
| deposit | <code>object</code> |  |
| opts | <code>object</code> | `{ fundedTxHex, feeSats }` |

<a name="Bond.preparePenaltySpend"></a>

### Bond.preparePenaltySpend(deposit, opts) ⇒ <code>object</code>
Penalty spend of a provider deposit. **Requires a verifying fraud proof**
naming this provider as offender; the proof hash is recorded on the result
so the spend always travels with its evidence. `ctx` is the verifier's
chain view (`tipHeight`, `outpointUnspent`, `txConfirmed`) — kinds that
assert on-chain facts refuse to verify without it.

**Kind**: static method of [<code>Bond</code>](#Bond)  

| Param | Type | Description |
| --- | --- | --- |
| deposit | <code>object</code> | from [buildDeposit](#Bond.buildDeposit) |
| opts | <code>object</code> | `{ fraudProof, fundedTxHex, destinationAddress, feeSats, ctx? }` |

<a name="Bond.prepareDepositWithdraw"></a>

### Bond.prepareDepositWithdraw(deposit, opts) ⇒ <code>object</code>
Provider's unilateral deposit exit after `withdrawAfter`.

**Kind**: static method of [<code>Bond</code>](#Bond)  

| Param | Type | Description |
| --- | --- | --- |
| deposit | <code>object</code> |  |
| opts | <code>object</code> | `{ fundedTxHex, destinationAddress, feeSats }` |

<a name="Bond.finalizeClaim"></a>

### Bond.finalizeClaim()
Finalize a signed hashlock (claim) PSBT.

**Kind**: static method of [<code>Bond</code>](#Bond)  
<a name="Bond.finalizeSpend"></a>

### Bond.finalizeSpend()
Finalize a signed spend (refund / penalty / withdraw) PSBT.

**Kind**: static method of [<code>Bond</code>](#Bond)  
<a name="Chain"></a>

## Chain
Chain.

**Kind**: global class  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| consensus | <code>String</code> | `pow` | `federation` | `gossip` |


* [Chain](#Chain)
    * [new Chain([origin])](#new_Chain_new)
    * _instance_
        * ~~[.seal](#Chain+seal)~~
        * [.entries](#Chain+entries)
        * ~~[._isEntrySeal()](#Chain+_isEntrySeal)~~
        * [.append()](#Chain+append) ⇒ [<code>Promise.&lt;Chain&gt;</code>](#Chain) \| <code>object</code>
    * _static_
        * [.create([opts])](#Chain.create) ⇒ [<code>Chain</code>](#Chain)

<a name="new_Chain_new"></a>

### new Chain([origin])

| Param | Type | Description |
| --- | --- | --- |
| [origin] | <code>Object</code> |  |
| [origin.consensus] | <code>String</code> | `pow` (default), `federation`, or `gossip` |
| [origin.seal] | <code>String</code> | Deprecated alias for consensus (`block`→`pow`) |
| [origin.entries] | <code>Array</code> | Seed block records (federation/gossip) |
| [origin.blocks] | <code>Array</code> | Seed block records |

<a name="Chain+seal"></a>

### ~~chain.seal~~
***Use consensusMode***

**Kind**: instance property of [<code>Chain</code>](#Chain)  
<a name="Chain+entries"></a>

### chain.entries
Cloned block records (federation/gossip).

**Kind**: instance property of [<code>Chain</code>](#Chain)  
<a name="Chain+_isEntrySeal"></a>

### ~~chain.\_isEntrySeal()~~
***Deprecated***

**Kind**: instance method of [<code>Chain</code>](#Chain)  
<a name="Chain+append"></a>

### chain.append() ⇒ [<code>Promise.&lt;Chain&gt;</code>](#Chain) \| <code>object</code>
Append a Block (or Block-shaped object).
Policy chains return the tip view synchronously; pow returns a Promise.

**Kind**: instance method of [<code>Chain</code>](#Chain)  
<a name="Chain.create"></a>

### Chain.create([opts]) ⇒ [<code>Chain</code>](#Chain)
**Kind**: static method of [<code>Chain</code>](#Chain)  

| Param | Type |
| --- | --- |
| [opts] | <code>Object</code> | 
| [opts.consensus] | <code>string</code> | 
| [opts.seal] | <code>string</code> | 
| [opts.genesis] | <code>Object</code> | 
| [opts.entries] | <code>Array.&lt;Object&gt;</code> | 
| [opts.blocks] | <code>Array.&lt;Object&gt;</code> | 

<a name="Challenge"></a>

## Challenge
Merkle-leaf availability challenge for a sealed blob tree.

A **commitment** is the provider's signed promise to hold a tree until an
epoch (optionally naming the deposit output that backs it). A **challenge**
is the publisher's signed, Beacon-epoch stamped request for one leaf; the
leaf index is derived from the challenge nonce so neither party picks it.
A **response** is the provider's signed inclusion proof plus a nonce-bound
digest of the blob bytes (proof of possession for a verifier holding the
bytes). All three are plain JSON artifacts carried as `CONTRACT_MESSAGE`
bodies — no new opcodes — and feed [Witness.FraudProof](Witness.FraudProof).

Response deadlines are expressed in **epochs** (default two) so a lagging
Hub view cannot make an honest provider provably late.

**Kind**: global class  

* [Challenge](#Challenge)
    * _instance_
        * [.issue(opts)](#Challenge+issue) ⇒ <code>object</code>
        * [.respond(challenge, source)](#Challenge+respond) ⇒ <code>object</code>
        * [.validate(challenge, response, [ctx])](#Challenge+validate) ⇒ <code>Object</code>
        * [.proofFor(challenge, response, [extra])](#Challenge+proofFor) ⇒ [<code>FraudProof</code>](#FraudProof) \| <code>null</code>
    * _static_
        * [.TYPES](#Challenge.TYPES) : <code>Object</code>
        * [.leafIndexFor(merkleRootHex, epoch, nonceHex, blobTotal)](#Challenge.leafIndexFor) ⇒ <code>number</code>
        * [.commit(opts)](#Challenge.commit) ⇒ <code>object</code>
        * [.wrongfulPenaltyProof(challenge, response, [penalty])](#Challenge.wrongfulPenaltyProof) ⇒ [<code>FraudProof</code>](#FraudProof)

<a name="Challenge+issue"></a>

### challenge.issue(opts) ⇒ <code>object</code>
Publisher issues one leaf challenge for `epoch`.

**Kind**: instance method of [<code>Challenge</code>](#Challenge)  
**Returns**: <code>object</code> - signed artifact  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> |  |
| opts.merkleRootHex | <code>string</code> |  |
| opts.blobTotal | <code>number</code> |  |
| opts.epoch | <code>number</code> | Beacon epoch (clock) the challenge is issued in |
| opts.providerPubkey | <code>string</code> | x-only hex the challenge is addressed to |
| [opts.blobHashes] | <code>Array.&lt;string&gt;</code> | leaf hashes (pins `blobHashHex` for the chosen index) |
| [opts.nonceHex] | <code>string</code> | 32-byte hex (random when omitted) |
| [opts.deadlineEpochs] | <code>number</code> |  |
| [opts.deadlineHeight] | <code>number</code> | block height after which silence is enforceable (timelocked non-response); or derive from `tipHeight` + `deadlineBlocks` |
| [opts.tipHeight] | <code>number</code> | current block height (with `deadlineBlocks`) |
| [opts.deadlineBlocks] | <code>number</code> | blocks after `tipHeight` for the deadline |
| [opts.deposit] | <code>object</code> | `{ txid, vout, penaltyAddress?, minPenaltySats? }` the provider's deposit outpoint the pre-signed penalty must spend, and where / how much it must pay the publisher |
| opts.publisherPrivateKey | <code>Buffer</code> \| <code>string</code> |  |

<a name="Challenge+respond"></a>

### challenge.respond(challenge, source) ⇒ <code>object</code>
Provider answers a challenge from its local tree.

**Kind**: instance method of [<code>Challenge</code>](#Challenge)  
**Returns**: <code>object</code> - signed artifact  

| Param | Type | Description |
| --- | --- | --- |
| challenge | <code>object</code> | signed artifact from [issue](#Challenge+issue) |
| source | <code>object</code> |  |
| source.blobHashes | <code>Array.&lt;string&gt;</code> | every leaf hash of the tree, in order |
| [source.bytes] | <code>Buffer</code> | the challenged blob's bytes (enables possession digest) |
| source.epoch | <code>number</code> | epoch the response is signed in |
| source.providerPrivateKey | <code>Buffer</code> \| <code>string</code> |  |

<a name="Challenge+validate"></a>

### challenge.validate(challenge, response, [ctx]) ⇒ <code>Object</code>
Publisher / third party validates a response. Pure.

**Kind**: instance method of [<code>Challenge</code>](#Challenge)  

| Param | Type | Description |
| --- | --- | --- |
| challenge | <code>object</code> |  |
| response | <code>object</code> |  |
| [ctx] | <code>object</code> |  |
| [ctx.bytes] | <code>Buffer</code> | blob bytes to check the possession digest against |
| [ctx.epoch] | <code>number</code> | current epoch (absence check) |

<a name="Challenge+proofFor"></a>

### challenge.proofFor(challenge, response, [extra]) ⇒ [<code>FraudProof</code>](#FraudProof) \| <code>null</code>
Build the matching [Witness.FraudProof](Witness.FraudProof) for a failed validation.

**Kind**: instance method of [<code>Challenge</code>](#Challenge)  

| Param | Type | Description |
| --- | --- | --- |
| challenge | <code>object</code> |  |
| response | <code>object</code> \| <code>null</code> |  |
| [extra] | <code>object</code> | `{ commitment }` for non-response |

<a name="Challenge.TYPES"></a>

### Challenge.TYPES : <code>Object</code>
Body `type` strings used on the wire.

**Kind**: static property of [<code>Challenge</code>](#Challenge)  
<a name="Challenge.leafIndexFor"></a>

### Challenge.leafIndexFor(merkleRootHex, epoch, nonceHex, blobTotal) ⇒ <code>number</code>
Deterministic leaf selection: `SHA256(root || epoch || nonce) mod blobTotal`.

**Kind**: static method of [<code>Challenge</code>](#Challenge)  

| Param | Type |
| --- | --- |
| merkleRootHex | <code>string</code> | 
| epoch | <code>number</code> | 
| nonceHex | <code>string</code> | 
| blobTotal | <code>number</code> | 

<a name="Challenge.commit"></a>

### Challenge.commit(opts) ⇒ <code>object</code>
Provider's signed availability commitment.

**Kind**: static method of [<code>Challenge</code>](#Challenge)  
**Returns**: <code>object</code> - signed artifact  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> |  |
| opts.merkleRootHex | <code>string</code> |  |
| [opts.blobTotal] | <code>number</code> |  |
| opts.fromEpoch | <code>number</code> |  |
| opts.untilEpoch | <code>number</code> |  |
| [opts.depositAddress] | <code>string</code> | deposit Bond address backing this promise |
| [opts.depositTxid] | <code>string</code> |  |
| [opts.publisherPubkey] | <code>string</code> | penalty co-signer |
| opts.providerPrivateKey | <code>Buffer</code> \| <code>string</code> |  |

<a name="Challenge.wrongfulPenaltyProof"></a>

### Challenge.wrongfulPenaltyProof(challenge, response, [penalty]) ⇒ [<code>FraudProof</code>](#FraudProof)
Provider's counter-proof when penalized despite a valid response. The
penalty transaction that spent the deposit outpoint **is** the evidence;
without it the proof does not verify.

**Kind**: static method of [<code>Challenge</code>](#Challenge)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| challenge | <code>object</code> |  |  |
| response | <code>object</code> |  |  |
| [penalty] | <code>object</code> | <code></code> | `{ txHex, txid?, prevouts? }` the penalty spend as seen on-chain; `prevouts` are its spent outputs `[{ scriptHex, valueSats }]` in input order |

<a name="Channel"></a>

## Channel ⇐ [<code>State</code>](#State)
<strong>Payment / capacity channel</strong> between peers: balances (<code>incoming</code> /
<code>outgoing</code>), counterparty handle, optional asset caps (<code>MAX_CHANNEL_VALUE</code>). Extends
[State](#State) → [Actor](#Actor). Wording below is product-oriented;
wire safety still depends on the Lightning/Bitcoin services you attach, not this object alone.

**Kind**: global class  
**Extends**: [<code>State</code>](#State)  

* [Channel](#Channel) ⇐ [<code>State</code>](#State)
    * [new Channel([settings])](#new_Channel_new)
    * _instance_
        * [.add(amount)](#Channel+add)
        * [.fund(input)](#Channel+fund)
        * [.open(channel)](#Channel+open)
        * [.trust(source)](#State+trust) ⇒ [<code>State</code>](#State)
        * [.inherits(other)](#State+inherits) ⇒ <code>Number</code>
        * [.toHTML()](#State+toHTML)
        * [.toString()](#State+toString) ⇒ <code>String</code>
        * [.serialize([input])](#State+serialize) ⇒ <code>Buffer</code>
        * [.deserialize(input)](#State+deserialize) ⇒ [<code>State</code>](#State)
        * [.fork()](#State+fork) ⇒ [<code>State</code>](#State)
        * [.get(path)](#State+get) ⇒ <code>Mixed</code>
        * [.set(path)](#State+set) ⇒ <code>Mixed</code>
        * [.commit()](#State+commit)
        * [.render()](#State+render) ⇒ <code>String</code>
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * [.commitmentSecret(seed, n)](#Channel.commitmentSecret) ⇒ <code>string</code>
        * [.commitmentPoint(secretHex)](#Channel.commitmentPoint) ⇒ <code>string</code>
        * [.revocationPubkey(basepointHex, perCommitmentPointHex)](#Channel.revocationPubkey) ⇒ <code>string</code>
        * [.revocationPrivkey(basepointSecret32, perCommitmentSecretHex)](#Channel.revocationPrivkey) ⇒ <code>Buffer</code>
        * [.negotiatePolicy([a], [b], [capacitySats])](#Channel.negotiatePolicy) ⇒ <code>object</code>
        * [.idFor(funding)](#Channel.idFor) ⇒ <code>string</code>
        * [.buildFunding(opts)](#Channel.buildFunding) ⇒ <code>object</code>
        * [.fundingFromRecord(record)](#Channel.fundingFromRecord) ⇒ <code>object</code>
        * [.buildToLocalOutput(opts)](#Channel.buildToLocalOutput) ⇒ <code>object</code>
        * [.buildAnchorOutput(opts)](#Channel.buildAnchorOutput) ⇒ <code>object</code>
        * [.buildHtlcOutput(opts)](#Channel.buildHtlcOutput) ⇒ <code>object</code>
        * [.buildCommitment(funding, state, opts)](#Channel.buildCommitment) ⇒ <code>object</code>
        * [.signCommitment(psbtBase64, priv32, network)](#Channel.signCommitment) ⇒ <code>string</code>
        * [.verifyCommitmentSignature(commitmentPsbtBase64, signedPsbtBase64, signerPubkeyHex, network)](#Channel.verifyCommitmentSignature) ⇒ <code>Object</code>
        * [.finalizeCommitment(psbtA, psbtB, network)](#Channel.finalizeCommitment) ⇒ <code>object</code>
        * [.prepareHtlcClaim(commitment, opts)](#Channel.prepareHtlcClaim) ⇒ <code>object</code>
        * [.prepareHtlcTimeout(commitment, opts)](#Channel.prepareHtlcTimeout) ⇒ <code>object</code>
        * [.finalizeHtlcClaim(psbtBase64)](#Channel.finalizeHtlcClaim)
        * [.prepareJusticeSpend(opts)](#Channel.prepareJusticeSpend) ⇒ <code>object</code>
        * [.planRoute(opts)](#Channel.planRoute) ⇒ <code>object</code>
        * [.checkForward(upstream, downstream, policy)](#Channel.checkForward) ⇒ <code>Object</code>
        * [.harvestPreimages(txHexOrTx, paymentHashes)](#Channel.harvestPreimages) ⇒ <code>Array.&lt;{paymentHashHex: string, preimageHex: string, vin: number}&gt;</code>
        * [.exchange(from, to, body)](#Channel.exchange) ⇒ <code>Array.&lt;object&gt;</code>

<a name="new_Channel_new"></a>

### new Channel([settings])
Creates a channel between two peers (bidirectional by default; <code>settings.mode</code>, <code>settings.asset</code>, …).


| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Configuration for the channel. |

<a name="Channel+add"></a>

### channel.add(amount)
Add an amount to the channel's balance.

**Kind**: instance method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| amount | <code>Number</code> | Amount value to add to current outgoing balance. |

<a name="Channel+fund"></a>

### channel.fund(input)
Fund the channel.

**Kind**: instance method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Mixed</code> | Instance of a [Transaction](Transaction). |

<a name="Channel+open"></a>

### channel.open(channel)
Opens a [Channel](#Channel) with a [Peer](#Peer).

**Kind**: instance method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| channel | <code>Object</code> | Channel settings. |

<a name="State+trust"></a>

### channel.trust(source) ⇒ [<code>State</code>](#State)
**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: [<code>State</code>](#State) - this  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Event stream. |

<a name="State+inherits"></a>

### channel.inherits(other) ⇒ <code>Number</code>
**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Number</code> - New length of `settings.tags`.  

| Param | Type | Description |
| --- | --- | --- |
| other | [<code>State</code>](#State) | Peer [State](#State) whose `settings.namespace` is appended to `settings.tags`. |

<a name="State+toHTML"></a>

### channel.toHTML()
Converts the State to an HTML document.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
<a name="State+toString"></a>

### channel.toString() ⇒ <code>String</code>
Unmarshall an existing state to an instance of a [Blob](Blob).

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>String</code> - Serialized [Blob](Blob).  
<a name="State+serialize"></a>

### channel.serialize([input]) ⇒ <code>Buffer</code>
Convert to [Buffer](Buffer).

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Buffer</code> - [Store](#Store)-able blob.  

| Param | Type | Description |
| --- | --- | --- |
| [input] | <code>Mixed</code> | Input to serialize. |

<a name="State+deserialize"></a>

### channel.deserialize(input) ⇒ [<code>State</code>](#State)
Take a hex-encoded input and convert to a [State](#State) object.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: [<code>State</code>](#State) - [description]  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | [description] |

<a name="State+fork"></a>

### channel.fork() ⇒ [<code>State</code>](#State)
Creates a new child [State](#State), with `@parent` set to
the current [State](#State) by immutable identifier.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
<a name="State+get"></a>

### channel.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="State+set"></a>

### channel.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="State+commit"></a>

### channel.commit()
Increment the vector clock, broadcast all changes as a transaction.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Overrides**: [<code>commit</code>](#State+commit)  
<a name="State+render"></a>

### channel.render() ⇒ <code>String</code>
Compose a JSON string for network consumption.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>String</code> - JSON-encoded [String](String).  
<a name="Actor+adopt"></a>

### channel.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+export"></a>

### channel.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### channel.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### channel.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
<a name="Actor+toGenericMessage"></a>

### channel.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### channel.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Channel</code>](#Channel)  
<a name="Actor+pause"></a>

### channel.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+sign"></a>

### channel.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
<a name="Actor+unpause"></a>

### channel.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### channel.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### channel.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Channel.commitmentSecret"></a>

### Channel.commitmentSecret(seed, n) ⇒ <code>string</code>
Per-commitment secret for state `n` (BOLT 3 shape; a plain hash chain over
a per-channel seed — shachain compaction is out of scope).

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>string</code> - 32-byte hex  

| Param | Type | Description |
| --- | --- | --- |
| seed | <code>Buffer</code> | 32 bytes |
| n | <code>number</code> | commitment number |

<a name="Channel.commitmentPoint"></a>

### Channel.commitmentPoint(secretHex) ⇒ <code>string</code>
Per-commitment point `secret * G`.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>string</code> - compressed pubkey hex  

| Param | Type |
| --- | --- |
| secretHex | <code>string</code> | 

<a name="Channel.revocationPubkey"></a>

### Channel.revocationPubkey(basepointHex, perCommitmentPointHex) ⇒ <code>string</code>
BOLT 3 revocation pubkey: `basepoint * H(basepoint || point) + point * H(point || basepoint)`.
The basepoint is the *non-holder's* channel key, the point is the holder's
per-commitment point; only the non-holder can derive the private key, and
only once the holder reveals that commitment's secret.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>string</code> - compressed pubkey hex  

| Param | Type | Description |
| --- | --- | --- |
| basepointHex | <code>string</code> | compressed |
| perCommitmentPointHex | <code>string</code> | compressed |

<a name="Channel.revocationPrivkey"></a>

### Channel.revocationPrivkey(basepointSecret32, perCommitmentSecretHex) ⇒ <code>Buffer</code>
Revocation private key once the holder's per-commitment secret is known.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Buffer</code> - 32-byte private key for [revocationPubkey](#Channel.revocationPubkey)  

| Param | Type | Description |
| --- | --- | --- |
| basepointSecret32 | <code>Buffer</code> | non-holder's channel private key |
| perCommitmentSecretHex | <code>string</code> | holder's revealed secret |

<a name="Channel.negotiatePolicy"></a>

### Channel.negotiatePolicy([a], [b], [capacitySats]) ⇒ <code>object</code>
Negotiate two channel policies: the stricter value wins on every field.

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| [a] | <code>object</code> |  |
| [b] | <code>object</code> |  |
| [capacitySats] | <code>number</code> | for the default reserve (1 % of capacity, min dust) |

<a name="Channel.idFor"></a>

### Channel.idFor(funding) ⇒ <code>string</code>
Deterministic channel id over the funding address, both keys and the
negotiated `toSelfDelay` (so neither party can re-interpret the delay).

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type |
| --- | --- |
| funding | <code>object</code> | 

<a name="Channel.buildFunding"></a>

### Channel.buildFunding(opts) ⇒ <code>object</code>
P2TR funding output: `cooperative` 2-of-2 leaf (every commitment and the
cooperative close spend through it) plus a `refund` leaf for the funder
after `expireAfter` (block height) so funds never strand.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>object</code> - `ChannelFunding` record (`_leaves` carries scripts; drop before gossip)  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ network, localPubkey, remotePubkey, expireAfter, capacitySats, funder?, toSelfDelay? }` |

<a name="Channel.fundingFromRecord"></a>

### Channel.fundingFromRecord(record) ⇒ <code>object</code>
Rebuild a funding record (with leaf scripts) from its public fields.

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type |
| --- | --- |
| record | <code>object</code> | 

<a name="Channel.buildToLocalOutput"></a>

### Channel.buildToLocalOutput(opts) ⇒ <code>object</code>
Holder's balance output on their own commitment: `delayed` leaf (holder key
after `toSelfDelay` CSV) and `revocation` leaf (immediate, revocation key).

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ network, holderPubkey, revocationPubkey, toSelfDelay }` |

<a name="Channel.buildAnchorOutput"></a>

### Channel.buildAnchorOutput(opts) ⇒ <code>object</code>
Anchor output (CPFP handle) for one party: single-key leaf, no delay.

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ network, pubkey }` |

<a name="Channel.buildHtlcOutput"></a>

### Channel.buildHtlcOutput(opts) ⇒ <code>object</code>
Per-HTLC P2TR output on a commitment. Symmetric form (no `revocationPubkey`):
`claim` hashlock leaf for the receiver and `timeout` leaf for the sender
after `expireAfter`. Holder-aware form adds a `revocation` leaf and a
`toSelfDelay` CSV on whichever leaf pays the commitment *holder* (BOLT 3):
the holder is punished for a stale broadcast and must wait on their own tx,
the counterparty spends immediately.

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ network, paymentHashHex, receiverPubkey, senderPubkey, expireAfter, holder?: 'receiver'|'sender', toSelfDelay?, revocationPubkey? }` |

<a name="Channel.buildCommitment"></a>

### Channel.buildCommitment(funding, state, opts) ⇒ <code>object</code>
Build the (unsigned) commitment transaction **held by one party** for a
channel state (asymmetric, BOLT 3 shape): spends the funding output through
the `cooperative` leaf into the holder's delayed/revocable `toLocal`, the
counterparty's plain `toRemote`, one output per pending HTLC (holder leaves
CSV-delayed and revocable), and two anchor outputs. Deterministic for
identical inputs, so both peers derive the same `txid` and only exchange
tapscript signatures on *each other's* commitment.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>object</code> - `{ psbtBase64, txid, outputs, feeSats, number, holder, revocationPubkey }`  

| Param | Type | Description |
| --- | --- | --- |
| funding | <code>object</code> | from [buildFunding](#Channel.buildFunding) |
| state | <code>object</code> | `{ number, fundedTxHex, localSats, remoteSats, localAddress, remoteAddress, htlcs:[{ id, amountSats, paymentHashHex, direction:'offered'|'received', expireAfter }], feeSats }` (all from the *local* party's view) |
| opts | <code>object</code> | `{ holder: 'local'|'remote', holderPoint }` whose commitment, and that party's per-commitment point |

<a name="Channel.signCommitment"></a>

### Channel.signCommitment(psbtBase64, priv32, network) ⇒ <code>string</code>
Sign the cooperative input of a commitment / close PSBT.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>string</code> - psbt base64 carrying this party's tapscript signature  

| Param | Type |
| --- | --- |
| psbtBase64 | <code>string</code> | 
| priv32 | <code>Buffer</code> \| <code>string</code> | 
| network | <code>string</code> | 

<a name="Channel.verifyCommitmentSignature"></a>

### Channel.verifyCommitmentSignature(commitmentPsbtBase64, signedPsbtBase64, signerPubkeyHex, network) ⇒ <code>Object</code>
Verify a counterparty's tapscript signature on *our* commitment.

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| commitmentPsbtBase64 | <code>string</code> | unsigned (ours) |
| signedPsbtBase64 | <code>string</code> | counterparty partial |
| signerPubkeyHex | <code>string</code> | compressed |
| network | <code>string</code> |  |

<a name="Channel.finalizeCommitment"></a>

### Channel.finalizeCommitment(psbtA, psbtB, network) ⇒ <code>object</code>
Merge both parties' partial signatures and extract the broadcastable tx.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>object</code> - `{ txHex, txid }`  

| Param | Type | Description |
| --- | --- | --- |
| psbtA | <code>string</code> | base64 |
| psbtB | <code>string</code> | base64 |
| network | <code>string</code> |  |

<a name="Channel.prepareHtlcClaim"></a>

### Channel.prepareHtlcClaim(commitment, opts) ⇒ <code>object</code>
Receiver claims an HTLC output of a broadcast commitment with the preimage.
On the receiver's own commitment the claim leaf is CSV-delayed (`sequence`
is set accordingly).

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>object</code> - `{ psbtBase64, … }` — sign with receiver key, then [finalizeHtlcClaim](#Channel.finalizeHtlcClaim)  

| Param | Type | Description |
| --- | --- | --- |
| commitment | <code>object</code> | from [buildCommitment](#Channel.buildCommitment) |
| opts | <code>object</code> | `{ htlcId, commitmentTxHex, preimageHex, destinationAddress, feeSats, network }` |

<a name="Channel.prepareHtlcTimeout"></a>

### Channel.prepareHtlcTimeout(commitment, opts) ⇒ <code>object</code>
Sender reclaims an expired HTLC output of a broadcast commitment. On the
sender's own commitment the timeout leaf is additionally CSV-delayed.

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| commitment | <code>object</code> |  |
| opts | <code>object</code> | `{ htlcId, commitmentTxHex, destinationAddress, feeSats, network }` |

<a name="Channel.finalizeHtlcClaim"></a>

### Channel.finalizeHtlcClaim(psbtBase64)
**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| psbtBase64 | <code>string</code> | signed @param {string} preimageHex @returns {object} |

<a name="Channel.prepareJusticeSpend"></a>

### Channel.prepareJusticeSpend(opts) ⇒ <code>object</code>
Justice transaction: sweep every revocable output of a counterparty's
**stale** commitment (their `toLocal` plus every HTLC output) through the
`revocation` leaves, signed with the revocation key derived from the
secret they revealed when revoking that state.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>object</code> - `{ txHex, txid, sweptSats, inputs:[{ vout, kind, amountSats }] }`  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ funding, state, holderPoint, perCommitmentSecretHex, staleTxHex, localPrivateKey, destinationAddress, feeSats, network? }` — `state` is the revoked state (local view) |

<a name="Channel.planRoute"></a>

### Channel.planRoute(opts) ⇒ <code>object</code>
Multi-hop atomic HTLC plan: same payment hash on every hop, amounts grow by
each hop's fee toward the source, expiries shrink toward the destination so
every intermediary can claim upstream after it is paid downstream.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>object</code> - `{ paymentHashHex, hops:[{ amountSats, expireAfter }] , totalFeeSats }`  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ paymentHashHex, amountSats, finalExpireHeight, hops:[{ feeSats, cltvDelta }] }` hops listed source → destination |

<a name="Channel.checkForward"></a>

### Channel.checkForward(upstream, downstream, policy) ⇒ <code>Object</code>
Check a received multi-hop offer is consistent with the plan the forwarder
holds on the downstream hop (atomicity preconditions).

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| upstream | <code>object</code> | `{ amountSats, expireAfter }` HTLC received |
| downstream | <code>object</code> | `{ amountSats, expireAfter }` HTLC to offer |
| policy | <code>object</code> | `{ feeSats, cltvDelta }` |

<a name="Channel.harvestPreimages"></a>

### Channel.harvestPreimages(txHexOrTx, paymentHashes) ⇒ <code>Array.&lt;{paymentHashHex: string, preimageHex: string, vin: number}&gt;</code>
Harvest HTLC preimages from any transaction spending known HTLC outputs
(claim witnesses carry the 32-byte preimage).

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| txHexOrTx | <code>string</code> \| <code>object</code> |  |
| paymentHashes | <code>Array.&lt;string&gt;</code> | hex |

<a name="Channel.exchange"></a>

### Channel.exchange(from, to, body) ⇒ <code>Array.&lt;object&gt;</code>
Drive one update round between two in-process sessions (tests / loopback):
proposal → reply → revoke.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Array.&lt;object&gt;</code> - every body exchanged  

| Param | Type | Description |
| --- | --- | --- |
| from | [<code>ChannelSession</code>](#ChannelSession) | proposer |
| to | [<code>ChannelSession</code>](#ChannelSession) | counterparty |
| body | <code>object</code> | proposal from `from` |

<a name="Channel"></a>

## Channel
**Kind**: global class  

* [Channel](#Channel)
    * [new Channel([settings])](#new_Channel_new)
    * _instance_
        * [.add(amount)](#Channel+add)
        * [.fund(input)](#Channel+fund)
        * [.open(channel)](#Channel+open)
        * [.trust(source)](#State+trust) ⇒ [<code>State</code>](#State)
        * [.inherits(other)](#State+inherits) ⇒ <code>Number</code>
        * [.toHTML()](#State+toHTML)
        * [.toString()](#State+toString) ⇒ <code>String</code>
        * [.serialize([input])](#State+serialize) ⇒ <code>Buffer</code>
        * [.deserialize(input)](#State+deserialize) ⇒ [<code>State</code>](#State)
        * [.fork()](#State+fork) ⇒ [<code>State</code>](#State)
        * [.get(path)](#State+get) ⇒ <code>Mixed</code>
        * [.set(path)](#State+set) ⇒ <code>Mixed</code>
        * [.commit()](#State+commit)
        * [.render()](#State+render) ⇒ <code>String</code>
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * [.commitmentSecret(seed, n)](#Channel.commitmentSecret) ⇒ <code>string</code>
        * [.commitmentPoint(secretHex)](#Channel.commitmentPoint) ⇒ <code>string</code>
        * [.revocationPubkey(basepointHex, perCommitmentPointHex)](#Channel.revocationPubkey) ⇒ <code>string</code>
        * [.revocationPrivkey(basepointSecret32, perCommitmentSecretHex)](#Channel.revocationPrivkey) ⇒ <code>Buffer</code>
        * [.negotiatePolicy([a], [b], [capacitySats])](#Channel.negotiatePolicy) ⇒ <code>object</code>
        * [.idFor(funding)](#Channel.idFor) ⇒ <code>string</code>
        * [.buildFunding(opts)](#Channel.buildFunding) ⇒ <code>object</code>
        * [.fundingFromRecord(record)](#Channel.fundingFromRecord) ⇒ <code>object</code>
        * [.buildToLocalOutput(opts)](#Channel.buildToLocalOutput) ⇒ <code>object</code>
        * [.buildAnchorOutput(opts)](#Channel.buildAnchorOutput) ⇒ <code>object</code>
        * [.buildHtlcOutput(opts)](#Channel.buildHtlcOutput) ⇒ <code>object</code>
        * [.buildCommitment(funding, state, opts)](#Channel.buildCommitment) ⇒ <code>object</code>
        * [.signCommitment(psbtBase64, priv32, network)](#Channel.signCommitment) ⇒ <code>string</code>
        * [.verifyCommitmentSignature(commitmentPsbtBase64, signedPsbtBase64, signerPubkeyHex, network)](#Channel.verifyCommitmentSignature) ⇒ <code>Object</code>
        * [.finalizeCommitment(psbtA, psbtB, network)](#Channel.finalizeCommitment) ⇒ <code>object</code>
        * [.prepareHtlcClaim(commitment, opts)](#Channel.prepareHtlcClaim) ⇒ <code>object</code>
        * [.prepareHtlcTimeout(commitment, opts)](#Channel.prepareHtlcTimeout) ⇒ <code>object</code>
        * [.finalizeHtlcClaim(psbtBase64)](#Channel.finalizeHtlcClaim)
        * [.prepareJusticeSpend(opts)](#Channel.prepareJusticeSpend) ⇒ <code>object</code>
        * [.planRoute(opts)](#Channel.planRoute) ⇒ <code>object</code>
        * [.checkForward(upstream, downstream, policy)](#Channel.checkForward) ⇒ <code>Object</code>
        * [.harvestPreimages(txHexOrTx, paymentHashes)](#Channel.harvestPreimages) ⇒ <code>Array.&lt;{paymentHashHex: string, preimageHex: string, vin: number}&gt;</code>
        * [.exchange(from, to, body)](#Channel.exchange) ⇒ <code>Array.&lt;object&gt;</code>

<a name="new_Channel_new"></a>

### new Channel([settings])
Creates a channel between two peers (bidirectional by default; <code>settings.mode</code>, <code>settings.asset</code>, …).


| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Configuration for the channel. |

<a name="Channel+add"></a>

### channel.add(amount)
Add an amount to the channel's balance.

**Kind**: instance method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| amount | <code>Number</code> | Amount value to add to current outgoing balance. |

<a name="Channel+fund"></a>

### channel.fund(input)
Fund the channel.

**Kind**: instance method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Mixed</code> | Instance of a [Transaction](Transaction). |

<a name="Channel+open"></a>

### channel.open(channel)
Opens a [Channel](#Channel) with a [Peer](#Peer).

**Kind**: instance method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| channel | <code>Object</code> | Channel settings. |

<a name="State+trust"></a>

### channel.trust(source) ⇒ [<code>State</code>](#State)
**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: [<code>State</code>](#State) - this  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Event stream. |

<a name="State+inherits"></a>

### channel.inherits(other) ⇒ <code>Number</code>
**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Number</code> - New length of `settings.tags`.  

| Param | Type | Description |
| --- | --- | --- |
| other | [<code>State</code>](#State) | Peer [State](#State) whose `settings.namespace` is appended to `settings.tags`. |

<a name="State+toHTML"></a>

### channel.toHTML()
Converts the State to an HTML document.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
<a name="State+toString"></a>

### channel.toString() ⇒ <code>String</code>
Unmarshall an existing state to an instance of a [Blob](Blob).

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>String</code> - Serialized [Blob](Blob).  
<a name="State+serialize"></a>

### channel.serialize([input]) ⇒ <code>Buffer</code>
Convert to [Buffer](Buffer).

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Buffer</code> - [Store](#Store)-able blob.  

| Param | Type | Description |
| --- | --- | --- |
| [input] | <code>Mixed</code> | Input to serialize. |

<a name="State+deserialize"></a>

### channel.deserialize(input) ⇒ [<code>State</code>](#State)
Take a hex-encoded input and convert to a [State](#State) object.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: [<code>State</code>](#State) - [description]  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | [description] |

<a name="State+fork"></a>

### channel.fork() ⇒ [<code>State</code>](#State)
Creates a new child [State](#State), with `@parent` set to
the current [State](#State) by immutable identifier.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
<a name="State+get"></a>

### channel.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="State+set"></a>

### channel.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="State+commit"></a>

### channel.commit()
Increment the vector clock, broadcast all changes as a transaction.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Overrides**: [<code>commit</code>](#State+commit)  
<a name="State+render"></a>

### channel.render() ⇒ <code>String</code>
Compose a JSON string for network consumption.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>String</code> - JSON-encoded [String](String).  
<a name="Actor+adopt"></a>

### channel.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+export"></a>

### channel.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### channel.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### channel.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
<a name="Actor+toGenericMessage"></a>

### channel.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### channel.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Channel</code>](#Channel)  
<a name="Actor+pause"></a>

### channel.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+sign"></a>

### channel.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
<a name="Actor+unpause"></a>

### channel.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### channel.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### channel.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Channel.commitmentSecret"></a>

### Channel.commitmentSecret(seed, n) ⇒ <code>string</code>
Per-commitment secret for state `n` (BOLT 3 shape; a plain hash chain over
a per-channel seed — shachain compaction is out of scope).

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>string</code> - 32-byte hex  

| Param | Type | Description |
| --- | --- | --- |
| seed | <code>Buffer</code> | 32 bytes |
| n | <code>number</code> | commitment number |

<a name="Channel.commitmentPoint"></a>

### Channel.commitmentPoint(secretHex) ⇒ <code>string</code>
Per-commitment point `secret * G`.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>string</code> - compressed pubkey hex  

| Param | Type |
| --- | --- |
| secretHex | <code>string</code> | 

<a name="Channel.revocationPubkey"></a>

### Channel.revocationPubkey(basepointHex, perCommitmentPointHex) ⇒ <code>string</code>
BOLT 3 revocation pubkey: `basepoint * H(basepoint || point) + point * H(point || basepoint)`.
The basepoint is the *non-holder's* channel key, the point is the holder's
per-commitment point; only the non-holder can derive the private key, and
only once the holder reveals that commitment's secret.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>string</code> - compressed pubkey hex  

| Param | Type | Description |
| --- | --- | --- |
| basepointHex | <code>string</code> | compressed |
| perCommitmentPointHex | <code>string</code> | compressed |

<a name="Channel.revocationPrivkey"></a>

### Channel.revocationPrivkey(basepointSecret32, perCommitmentSecretHex) ⇒ <code>Buffer</code>
Revocation private key once the holder's per-commitment secret is known.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Buffer</code> - 32-byte private key for [revocationPubkey](#Channel.revocationPubkey)  

| Param | Type | Description |
| --- | --- | --- |
| basepointSecret32 | <code>Buffer</code> | non-holder's channel private key |
| perCommitmentSecretHex | <code>string</code> | holder's revealed secret |

<a name="Channel.negotiatePolicy"></a>

### Channel.negotiatePolicy([a], [b], [capacitySats]) ⇒ <code>object</code>
Negotiate two channel policies: the stricter value wins on every field.

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| [a] | <code>object</code> |  |
| [b] | <code>object</code> |  |
| [capacitySats] | <code>number</code> | for the default reserve (1 % of capacity, min dust) |

<a name="Channel.idFor"></a>

### Channel.idFor(funding) ⇒ <code>string</code>
Deterministic channel id over the funding address, both keys and the
negotiated `toSelfDelay` (so neither party can re-interpret the delay).

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type |
| --- | --- |
| funding | <code>object</code> | 

<a name="Channel.buildFunding"></a>

### Channel.buildFunding(opts) ⇒ <code>object</code>
P2TR funding output: `cooperative` 2-of-2 leaf (every commitment and the
cooperative close spend through it) plus a `refund` leaf for the funder
after `expireAfter` (block height) so funds never strand.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>object</code> - `ChannelFunding` record (`_leaves` carries scripts; drop before gossip)  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ network, localPubkey, remotePubkey, expireAfter, capacitySats, funder?, toSelfDelay? }` |

<a name="Channel.fundingFromRecord"></a>

### Channel.fundingFromRecord(record) ⇒ <code>object</code>
Rebuild a funding record (with leaf scripts) from its public fields.

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type |
| --- | --- |
| record | <code>object</code> | 

<a name="Channel.buildToLocalOutput"></a>

### Channel.buildToLocalOutput(opts) ⇒ <code>object</code>
Holder's balance output on their own commitment: `delayed` leaf (holder key
after `toSelfDelay` CSV) and `revocation` leaf (immediate, revocation key).

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ network, holderPubkey, revocationPubkey, toSelfDelay }` |

<a name="Channel.buildAnchorOutput"></a>

### Channel.buildAnchorOutput(opts) ⇒ <code>object</code>
Anchor output (CPFP handle) for one party: single-key leaf, no delay.

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ network, pubkey }` |

<a name="Channel.buildHtlcOutput"></a>

### Channel.buildHtlcOutput(opts) ⇒ <code>object</code>
Per-HTLC P2TR output on a commitment. Symmetric form (no `revocationPubkey`):
`claim` hashlock leaf for the receiver and `timeout` leaf for the sender
after `expireAfter`. Holder-aware form adds a `revocation` leaf and a
`toSelfDelay` CSV on whichever leaf pays the commitment *holder* (BOLT 3):
the holder is punished for a stale broadcast and must wait on their own tx,
the counterparty spends immediately.

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ network, paymentHashHex, receiverPubkey, senderPubkey, expireAfter, holder?: 'receiver'|'sender', toSelfDelay?, revocationPubkey? }` |

<a name="Channel.buildCommitment"></a>

### Channel.buildCommitment(funding, state, opts) ⇒ <code>object</code>
Build the (unsigned) commitment transaction **held by one party** for a
channel state (asymmetric, BOLT 3 shape): spends the funding output through
the `cooperative` leaf into the holder's delayed/revocable `toLocal`, the
counterparty's plain `toRemote`, one output per pending HTLC (holder leaves
CSV-delayed and revocable), and two anchor outputs. Deterministic for
identical inputs, so both peers derive the same `txid` and only exchange
tapscript signatures on *each other's* commitment.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>object</code> - `{ psbtBase64, txid, outputs, feeSats, number, holder, revocationPubkey }`  

| Param | Type | Description |
| --- | --- | --- |
| funding | <code>object</code> | from [buildFunding](#Channel.buildFunding) |
| state | <code>object</code> | `{ number, fundedTxHex, localSats, remoteSats, localAddress, remoteAddress, htlcs:[{ id, amountSats, paymentHashHex, direction:'offered'|'received', expireAfter }], feeSats }` (all from the *local* party's view) |
| opts | <code>object</code> | `{ holder: 'local'|'remote', holderPoint }` whose commitment, and that party's per-commitment point |

<a name="Channel.signCommitment"></a>

### Channel.signCommitment(psbtBase64, priv32, network) ⇒ <code>string</code>
Sign the cooperative input of a commitment / close PSBT.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>string</code> - psbt base64 carrying this party's tapscript signature  

| Param | Type |
| --- | --- |
| psbtBase64 | <code>string</code> | 
| priv32 | <code>Buffer</code> \| <code>string</code> | 
| network | <code>string</code> | 

<a name="Channel.verifyCommitmentSignature"></a>

### Channel.verifyCommitmentSignature(commitmentPsbtBase64, signedPsbtBase64, signerPubkeyHex, network) ⇒ <code>Object</code>
Verify a counterparty's tapscript signature on *our* commitment.

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| commitmentPsbtBase64 | <code>string</code> | unsigned (ours) |
| signedPsbtBase64 | <code>string</code> | counterparty partial |
| signerPubkeyHex | <code>string</code> | compressed |
| network | <code>string</code> |  |

<a name="Channel.finalizeCommitment"></a>

### Channel.finalizeCommitment(psbtA, psbtB, network) ⇒ <code>object</code>
Merge both parties' partial signatures and extract the broadcastable tx.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>object</code> - `{ txHex, txid }`  

| Param | Type | Description |
| --- | --- | --- |
| psbtA | <code>string</code> | base64 |
| psbtB | <code>string</code> | base64 |
| network | <code>string</code> |  |

<a name="Channel.prepareHtlcClaim"></a>

### Channel.prepareHtlcClaim(commitment, opts) ⇒ <code>object</code>
Receiver claims an HTLC output of a broadcast commitment with the preimage.
On the receiver's own commitment the claim leaf is CSV-delayed (`sequence`
is set accordingly).

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>object</code> - `{ psbtBase64, … }` — sign with receiver key, then [finalizeHtlcClaim](#Channel.finalizeHtlcClaim)  

| Param | Type | Description |
| --- | --- | --- |
| commitment | <code>object</code> | from [buildCommitment](#Channel.buildCommitment) |
| opts | <code>object</code> | `{ htlcId, commitmentTxHex, preimageHex, destinationAddress, feeSats, network }` |

<a name="Channel.prepareHtlcTimeout"></a>

### Channel.prepareHtlcTimeout(commitment, opts) ⇒ <code>object</code>
Sender reclaims an expired HTLC output of a broadcast commitment. On the
sender's own commitment the timeout leaf is additionally CSV-delayed.

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| commitment | <code>object</code> |  |
| opts | <code>object</code> | `{ htlcId, commitmentTxHex, destinationAddress, feeSats, network }` |

<a name="Channel.finalizeHtlcClaim"></a>

### Channel.finalizeHtlcClaim(psbtBase64)
**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| psbtBase64 | <code>string</code> | signed @param {string} preimageHex @returns {object} |

<a name="Channel.prepareJusticeSpend"></a>

### Channel.prepareJusticeSpend(opts) ⇒ <code>object</code>
Justice transaction: sweep every revocable output of a counterparty's
**stale** commitment (their `toLocal` plus every HTLC output) through the
`revocation` leaves, signed with the revocation key derived from the
secret they revealed when revoking that state.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>object</code> - `{ txHex, txid, sweptSats, inputs:[{ vout, kind, amountSats }] }`  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ funding, state, holderPoint, perCommitmentSecretHex, staleTxHex, localPrivateKey, destinationAddress, feeSats, network? }` — `state` is the revoked state (local view) |

<a name="Channel.planRoute"></a>

### Channel.planRoute(opts) ⇒ <code>object</code>
Multi-hop atomic HTLC plan: same payment hash on every hop, amounts grow by
each hop's fee toward the source, expiries shrink toward the destination so
every intermediary can claim upstream after it is paid downstream.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>object</code> - `{ paymentHashHex, hops:[{ amountSats, expireAfter }] , totalFeeSats }`  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ paymentHashHex, amountSats, finalExpireHeight, hops:[{ feeSats, cltvDelta }] }` hops listed source → destination |

<a name="Channel.checkForward"></a>

### Channel.checkForward(upstream, downstream, policy) ⇒ <code>Object</code>
Check a received multi-hop offer is consistent with the plan the forwarder
holds on the downstream hop (atomicity preconditions).

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| upstream | <code>object</code> | `{ amountSats, expireAfter }` HTLC received |
| downstream | <code>object</code> | `{ amountSats, expireAfter }` HTLC to offer |
| policy | <code>object</code> | `{ feeSats, cltvDelta }` |

<a name="Channel.harvestPreimages"></a>

### Channel.harvestPreimages(txHexOrTx, paymentHashes) ⇒ <code>Array.&lt;{paymentHashHex: string, preimageHex: string, vin: number}&gt;</code>
Harvest HTLC preimages from any transaction spending known HTLC outputs
(claim witnesses carry the 32-byte preimage).

**Kind**: static method of [<code>Channel</code>](#Channel)  

| Param | Type | Description |
| --- | --- | --- |
| txHexOrTx | <code>string</code> \| <code>object</code> |  |
| paymentHashes | <code>Array.&lt;string&gt;</code> | hex |

<a name="Channel.exchange"></a>

### Channel.exchange(from, to, body) ⇒ <code>Array.&lt;object&gt;</code>
Drive one update round between two in-process sessions (tests / loopback):
proposal → reply → revoke.

**Kind**: static method of [<code>Channel</code>](#Channel)  
**Returns**: <code>Array.&lt;object&gt;</code> - every body exchanged  

| Param | Type | Description |
| --- | --- | --- |
| from | [<code>ChannelSession</code>](#ChannelSession) | proposer |
| to | [<code>ChannelSession</code>](#ChannelSession) | counterparty |
| body | <code>object</code> | proposal from `from` |

<a name="ChannelSession"></a>

## ChannelSession
Off-chain state of one Fabric payment channel from the local
party's perspective: balances, pending HTLCs (one per chunk), each party's
current commitment and the counterparty's signature on **ours**. Updates are
exchanged as signed `CONTRACT_MESSAGE` bodies ([Channel.BODY_TYPES](Channel.BODY_TYPES)):

1. proposer → `ChannelCommitment n` (signature on the *counterparty's*
   commitment `n`, next per-commitment point);
2. counterparty → `ChannelCommitment n` reply (signature on the proposer's
   commitment `n`, inline `revoke` of its own state `n-1`, next point);
3. proposer → `ChannelRevoke n-1`.

A party that broadcasts a revoked commitment loses everything on it
([prepareJusticeSpend](#Channel.prepareJusticeSpend)); the latest commitment pays the
holder only after `toSelfDelay`. Open is three messages (`ChannelOpen`,
reply, ack) because the funder cannot sign the counterparty's commitment
before learning its first per-commitment point.

**Kind**: global class  

* [ChannelSession](#ChannelSession)
    * [new ChannelSession(opts)](#new_ChannelSession_new)
    * _instance_
        * [.resolvable](#ChannelSession+resolvable) ⇒ <code>boolean</code>
        * [.commitment](#ChannelSession+commitment) ⇒ <code>object</code> \| <code>null</code>
        * [.fullySigned](#ChannelSession+fullySigned) ⇒ <code>boolean</code>
        * [.busy](#ChannelSession+busy) ⇒ <code>boolean</code>
        * [.open()](#ChannelSession+open) ⇒ <code>object</code>
        * [.offerHtlc(htlc)](#ChannelSession+offerHtlc) ⇒ <code>object</code>
        * [.updateFee(feeSats)](#ChannelSession+updateFee) ⇒ <code>object</code>
        * [.receive(body, [ctx])](#ChannelSession+receive) ⇒ <code>object</code> \| <code>null</code>
        * [.fulfillHtlc(id, preimageHex)](#ChannelSession+fulfillHtlc) ⇒ <code>object</code>
        * [.failHtlc(id, [reason])](#ChannelSession+failHtlc) ⇒ <code>object</code>
        * [.receiveSettlement(body)](#ChannelSession+receiveSettlement) ⇒ <code>object</code> \| <code>null</code>
        * [.ingest(body, [ctx])](#ChannelSession+ingest) ⇒ <code>object</code> \| <code>null</code>
        * [.tick(tipHeight)](#ChannelSession+tick) ⇒ <code>Object</code>
        * [.observe(txHex, [opts])](#ChannelSession+observe) ⇒ <code>object</code>
        * [.preimageFor(paymentHashHex)](#ChannelSession+preimageFor)
        * [.finalize()](#ChannelSession+finalize) ⇒ <code>object</code>
        * [.close()](#ChannelSession+close) ⇒ <code>object</code>
        * [.export()](#ChannelSession+export) ⇒ <code>object</code>
    * _static_
        * [.import(snapshot, localPrivateKey, [deps])](#ChannelSession.import) ⇒ [<code>ChannelSession</code>](#ChannelSession)

<a name="new_ChannelSession_new"></a>

### new ChannelSession(opts)

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ funding, fundedTxHex, localPrivateKey, localSats, remoteSats, localAddress, remoteAddress, feeSats, policy?, tipHeight?, confirmations?, minFundingConfirmations? }` |

<a name="ChannelSession+resolvable"></a>

### channelSession.resolvable ⇒ <code>boolean</code>
**Kind**: instance property of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>boolean</code> - the current state has a counterparty-signed unilateral exit  
<a name="ChannelSession+commitment"></a>

### channelSession.commitment ⇒ <code>object</code> \| <code>null</code>
**Kind**: instance property of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> \| <code>null</code> - our latest commitment (holder = local)  
<a name="ChannelSession+fullySigned"></a>

### channelSession.fullySigned ⇒ <code>boolean</code>
**Kind**: instance property of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>boolean</code> - both signatures held on the current state  
<a name="ChannelSession+busy"></a>

### channelSession.busy ⇒ <code>boolean</code>
**Kind**: instance property of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>boolean</code> - an update round is mid-flight (proposal unanswered or revocation outstanding)  
<a name="ChannelSession+open"></a>

### channelSession.open() ⇒ <code>object</code>
Initial `ChannelOpen` body (funder): the funding record (public fields),
balances, our policy proposal and first two per-commitment points. No
commitment signature yet — see the class description.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
<a name="ChannelSession+offerHtlc"></a>

### channelSession.offerHtlc(htlc) ⇒ <code>object</code>
Offer an HTLC (pay for one chunk): moves `amountSats` from our balance
into a pending HTLC and returns the `ChannelCommitment` proposal.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  

| Param | Type | Description |
| --- | --- | --- |
| htlc | <code>object</code> | `{ id?, amountSats, paymentHashHex, blobHashHex?, expireAfter, forwardOf? }` |

<a name="ChannelSession+updateFee"></a>

### channelSession.updateFee(feeSats) ⇒ <code>object</code>
Propose a new commitment fee (bounded by the negotiated policy; the
funder's balance absorbs the difference).

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> - `ChannelCommitment` proposal  

| Param | Type |
| --- | --- |
| feeSats | <code>number</code> | 

<a name="ChannelSession+receive"></a>

### channelSession.receive(body, [ctx]) ⇒ <code>object</code> \| <code>null</code>
Ingest a counterparty `ChannelOpen` / `ChannelCommitment` / `ChannelClose`
/ `ChannelRevoke`. Returns the body we must send back (countersignature
with inline revoke, `ChannelRevoke`, or `null`).

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  

| Param | Type | Description |
| --- | --- | --- |
| body | <code>object</code> | signed artifact from the peer |
| [ctx] | <code>object</code> | `{ settlement }` from [receiveSettlement](#ChannelSession+receiveSettlement) |

<a name="ChannelSession+fulfillHtlc"></a>

### channelSession.fulfillHtlc(id, preimageHex) ⇒ <code>object</code>
Settle an HTLC with its preimage: the amount moves to the **receiver's**
balance and the proposal carries the preimage. Normally the receiver
reveals; the sender may also settle an HTLC it offered once it learned
the preimage elsewhere (e.g. the seller's public key reveal) — that only
ever pays the counterparty.

Revealing the preimage before the peer countersigns is safe because no
HTLC is trimmed: each one carries at least `HTLC_MINIMUM_SATS` and has a
commitment output the receiver can claim with the preimage
([prepareHtlcClaim](#Channel.prepareHtlcClaim)) if the peer stalls.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> - `ChannelHtlcFulfill` body (+ the new commitment via `commitment`)  

| Param | Type |
| --- | --- |
| id | <code>string</code> | 
| preimageHex | <code>string</code> | 

<a name="ChannelSession+failHtlc"></a>

### channelSession.failHtlc(id, [reason]) ⇒ <code>object</code>
Fail an HTLC: the receiver may fail a received HTLC at any time; the
sender may fail its own offered HTLC only once expired at the known tip.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> - `ChannelHtlcFail` body  

| Param | Type | Default |
| --- | --- | --- |
| id | <code>string</code> |  | 
| [reason] | <code>string</code> | <code>&quot;failed&quot;</code> | 

<a name="ChannelSession+receiveSettlement"></a>

### channelSession.receiveSettlement(body) ⇒ <code>object</code> \| <code>null</code>
Apply a counterparty `ChannelHtlcFulfill` / `ChannelHtlcFail` body.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> \| <code>null</code> - our countersignature body  

| Param | Type |
| --- | --- |
| body | <code>object</code> | 

<a name="ChannelSession+ingest"></a>

### channelSession.ingest(body, [ctx]) ⇒ <code>object</code> \| <code>null</code>
Dispatch any inbound `Channel*` body to the right handler.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> \| <code>null</code> - reply body  

| Param | Type |
| --- | --- |
| body | <code>object</code> | 
| [ctx] | <code>object</code> | 

<a name="ChannelSession+tick"></a>

### channelSession.tick(tipHeight) ⇒ <code>Object</code>
Chain-time housekeeping: funding confirmation gating, auto-fail of expired
received HTLCs, and timeout flags on expired offered HTLCs.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  

| Param | Type |
| --- | --- |
| tipHeight | <code>number</code> | 

<a name="ChannelSession+observe"></a>

### channelSession.observe(txHex, [opts]) ⇒ <code>object</code>
Classify an observed on-chain transaction: our/their latest commitment,
a **stale** (revoked) counterparty commitment — returning a signed
justice transaction and a `FraudProof` — or an HTLC spend whose witness
reveals preimages we are owed.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> - `{ kind, txid, justice?, fraudProof?, preimages? }`  

| Param | Type | Description |
| --- | --- | --- |
| txHex | <code>string</code> |  |
| [opts] | <code>object</code> | `{ destinationAddress?, feeSats?, inclusion?: { blockHeaderHex, txids } }` — `inclusion` lets a stale-commitment proof carry an SPV branch binding the broadcast to a block header |

<a name="ChannelSession+preimageFor"></a>

### channelSession.preimageFor(paymentHashHex)
**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  

| Param | Type | Description |
| --- | --- | --- |
| paymentHashHex | <code>string</code> | @returns {string|null} preimage learned on this channel |

<a name="ChannelSession+finalize"></a>

### channelSession.finalize() ⇒ <code>object</code>
Broadcastable latest commitment (ours; requires the counterparty's signature).

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> - `{ txHex, txid }`  
<a name="ChannelSession+close"></a>

### channelSession.close() ⇒ <code>object</code>
Cooperative close: no HTLCs pending, latest balances. Returns a
`ChannelClose` proposal; the reply countersigns and both finalize.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
<a name="ChannelSession+export"></a>

### channelSession.export() ⇒ <code>object</code>
**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> - persistence snapshot (no private key)  
<a name="ChannelSession.import"></a>

### ChannelSession.import(snapshot, localPrivateKey, [deps]) ⇒ [<code>ChannelSession</code>](#ChannelSession)
**Kind**: static method of [<code>ChannelSession</code>](#ChannelSession)  

| Param | Type | Description |
| --- | --- | --- |
| snapshot | <code>object</code> | from [export](#ChannelSession+export) |
| localPrivateKey | <code>Buffer</code> \| <code>string</code> |  |
| [deps] | <code>object</code> | `{ tipHeight?, confirmations? }` |

<a name="ChannelSession"></a>

## ChannelSession
**Kind**: global class  

* [ChannelSession](#ChannelSession)
    * [new ChannelSession(opts)](#new_ChannelSession_new)
    * _instance_
        * [.resolvable](#ChannelSession+resolvable) ⇒ <code>boolean</code>
        * [.commitment](#ChannelSession+commitment) ⇒ <code>object</code> \| <code>null</code>
        * [.fullySigned](#ChannelSession+fullySigned) ⇒ <code>boolean</code>
        * [.busy](#ChannelSession+busy) ⇒ <code>boolean</code>
        * [.open()](#ChannelSession+open) ⇒ <code>object</code>
        * [.offerHtlc(htlc)](#ChannelSession+offerHtlc) ⇒ <code>object</code>
        * [.updateFee(feeSats)](#ChannelSession+updateFee) ⇒ <code>object</code>
        * [.receive(body, [ctx])](#ChannelSession+receive) ⇒ <code>object</code> \| <code>null</code>
        * [.fulfillHtlc(id, preimageHex)](#ChannelSession+fulfillHtlc) ⇒ <code>object</code>
        * [.failHtlc(id, [reason])](#ChannelSession+failHtlc) ⇒ <code>object</code>
        * [.receiveSettlement(body)](#ChannelSession+receiveSettlement) ⇒ <code>object</code> \| <code>null</code>
        * [.ingest(body, [ctx])](#ChannelSession+ingest) ⇒ <code>object</code> \| <code>null</code>
        * [.tick(tipHeight)](#ChannelSession+tick) ⇒ <code>Object</code>
        * [.observe(txHex, [opts])](#ChannelSession+observe) ⇒ <code>object</code>
        * [.preimageFor(paymentHashHex)](#ChannelSession+preimageFor)
        * [.finalize()](#ChannelSession+finalize) ⇒ <code>object</code>
        * [.close()](#ChannelSession+close) ⇒ <code>object</code>
        * [.export()](#ChannelSession+export) ⇒ <code>object</code>
    * _static_
        * [.import(snapshot, localPrivateKey, [deps])](#ChannelSession.import) ⇒ [<code>ChannelSession</code>](#ChannelSession)

<a name="new_ChannelSession_new"></a>

### new ChannelSession(opts)

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ funding, fundedTxHex, localPrivateKey, localSats, remoteSats, localAddress, remoteAddress, feeSats, policy?, tipHeight?, confirmations?, minFundingConfirmations? }` |

<a name="ChannelSession+resolvable"></a>

### channelSession.resolvable ⇒ <code>boolean</code>
**Kind**: instance property of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>boolean</code> - the current state has a counterparty-signed unilateral exit  
<a name="ChannelSession+commitment"></a>

### channelSession.commitment ⇒ <code>object</code> \| <code>null</code>
**Kind**: instance property of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> \| <code>null</code> - our latest commitment (holder = local)  
<a name="ChannelSession+fullySigned"></a>

### channelSession.fullySigned ⇒ <code>boolean</code>
**Kind**: instance property of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>boolean</code> - both signatures held on the current state  
<a name="ChannelSession+busy"></a>

### channelSession.busy ⇒ <code>boolean</code>
**Kind**: instance property of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>boolean</code> - an update round is mid-flight (proposal unanswered or revocation outstanding)  
<a name="ChannelSession+open"></a>

### channelSession.open() ⇒ <code>object</code>
Initial `ChannelOpen` body (funder): the funding record (public fields),
balances, our policy proposal and first two per-commitment points. No
commitment signature yet — see the class description.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
<a name="ChannelSession+offerHtlc"></a>

### channelSession.offerHtlc(htlc) ⇒ <code>object</code>
Offer an HTLC (pay for one chunk): moves `amountSats` from our balance
into a pending HTLC and returns the `ChannelCommitment` proposal.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  

| Param | Type | Description |
| --- | --- | --- |
| htlc | <code>object</code> | `{ id?, amountSats, paymentHashHex, blobHashHex?, expireAfter, forwardOf? }` |

<a name="ChannelSession+updateFee"></a>

### channelSession.updateFee(feeSats) ⇒ <code>object</code>
Propose a new commitment fee (bounded by the negotiated policy; the
funder's balance absorbs the difference).

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> - `ChannelCommitment` proposal  

| Param | Type |
| --- | --- |
| feeSats | <code>number</code> | 

<a name="ChannelSession+receive"></a>

### channelSession.receive(body, [ctx]) ⇒ <code>object</code> \| <code>null</code>
Ingest a counterparty `ChannelOpen` / `ChannelCommitment` / `ChannelClose`
/ `ChannelRevoke`. Returns the body we must send back (countersignature
with inline revoke, `ChannelRevoke`, or `null`).

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  

| Param | Type | Description |
| --- | --- | --- |
| body | <code>object</code> | signed artifact from the peer |
| [ctx] | <code>object</code> | `{ settlement }` from [receiveSettlement](#ChannelSession+receiveSettlement) |

<a name="ChannelSession+fulfillHtlc"></a>

### channelSession.fulfillHtlc(id, preimageHex) ⇒ <code>object</code>
Settle an HTLC with its preimage: the amount moves to the **receiver's**
balance and the proposal carries the preimage. Normally the receiver
reveals; the sender may also settle an HTLC it offered once it learned
the preimage elsewhere (e.g. the seller's public key reveal) — that only
ever pays the counterparty.

Revealing the preimage before the peer countersigns is safe because no
HTLC is trimmed: each one carries at least `HTLC_MINIMUM_SATS` and has a
commitment output the receiver can claim with the preimage
([prepareHtlcClaim](#Channel.prepareHtlcClaim)) if the peer stalls.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> - `ChannelHtlcFulfill` body (+ the new commitment via `commitment`)  

| Param | Type |
| --- | --- |
| id | <code>string</code> | 
| preimageHex | <code>string</code> | 

<a name="ChannelSession+failHtlc"></a>

### channelSession.failHtlc(id, [reason]) ⇒ <code>object</code>
Fail an HTLC: the receiver may fail a received HTLC at any time; the
sender may fail its own offered HTLC only once expired at the known tip.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> - `ChannelHtlcFail` body  

| Param | Type | Default |
| --- | --- | --- |
| id | <code>string</code> |  | 
| [reason] | <code>string</code> | <code>&quot;failed&quot;</code> | 

<a name="ChannelSession+receiveSettlement"></a>

### channelSession.receiveSettlement(body) ⇒ <code>object</code> \| <code>null</code>
Apply a counterparty `ChannelHtlcFulfill` / `ChannelHtlcFail` body.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> \| <code>null</code> - our countersignature body  

| Param | Type |
| --- | --- |
| body | <code>object</code> | 

<a name="ChannelSession+ingest"></a>

### channelSession.ingest(body, [ctx]) ⇒ <code>object</code> \| <code>null</code>
Dispatch any inbound `Channel*` body to the right handler.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> \| <code>null</code> - reply body  

| Param | Type |
| --- | --- |
| body | <code>object</code> | 
| [ctx] | <code>object</code> | 

<a name="ChannelSession+tick"></a>

### channelSession.tick(tipHeight) ⇒ <code>Object</code>
Chain-time housekeeping: funding confirmation gating, auto-fail of expired
received HTLCs, and timeout flags on expired offered HTLCs.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  

| Param | Type |
| --- | --- |
| tipHeight | <code>number</code> | 

<a name="ChannelSession+observe"></a>

### channelSession.observe(txHex, [opts]) ⇒ <code>object</code>
Classify an observed on-chain transaction: our/their latest commitment,
a **stale** (revoked) counterparty commitment — returning a signed
justice transaction and a `FraudProof` — or an HTLC spend whose witness
reveals preimages we are owed.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> - `{ kind, txid, justice?, fraudProof?, preimages? }`  

| Param | Type | Description |
| --- | --- | --- |
| txHex | <code>string</code> |  |
| [opts] | <code>object</code> | `{ destinationAddress?, feeSats?, inclusion?: { blockHeaderHex, txids } }` — `inclusion` lets a stale-commitment proof carry an SPV branch binding the broadcast to a block header |

<a name="ChannelSession+preimageFor"></a>

### channelSession.preimageFor(paymentHashHex)
**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  

| Param | Type | Description |
| --- | --- | --- |
| paymentHashHex | <code>string</code> | @returns {string|null} preimage learned on this channel |

<a name="ChannelSession+finalize"></a>

### channelSession.finalize() ⇒ <code>object</code>
Broadcastable latest commitment (ours; requires the counterparty's signature).

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> - `{ txHex, txid }`  
<a name="ChannelSession+close"></a>

### channelSession.close() ⇒ <code>object</code>
Cooperative close: no HTLCs pending, latest balances. Returns a
`ChannelClose` proposal; the reply countersigns and both finalize.

**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
<a name="ChannelSession+export"></a>

### channelSession.export() ⇒ <code>object</code>
**Kind**: instance method of [<code>ChannelSession</code>](#ChannelSession)  
**Returns**: <code>object</code> - persistence snapshot (no private key)  
<a name="ChannelSession.import"></a>

### ChannelSession.import(snapshot, localPrivateKey, [deps]) ⇒ [<code>ChannelSession</code>](#ChannelSession)
**Kind**: static method of [<code>ChannelSession</code>](#ChannelSession)  

| Param | Type | Description |
| --- | --- | --- |
| snapshot | <code>object</code> | from [export](#ChannelSession+export) |
| localPrivateKey | <code>Buffer</code> \| <code>string</code> |  |
| [deps] | <code>object</code> | `{ tipHeight?, confirmations? }` |

<a name="ChannelBook"></a>

## ChannelBook
Local registry of [ChannelSession](#ChannelSession)s for a host (Hub,
GoonCitizen, Passport): looks a channel up by counterparty, routes inbound
`Channel*` `CONTRACT_MESSAGE` bodies to the right session, forwards
multi-hop HTLCs, ticks sessions on new chain tips, and returns the bodies
the host must publish back. Shape expected by the market agent's
`attach({ channels })`.

**Seller-fulfills (Lightning shape):** when the host supplies
`preimageFor(paymentHashHex)` the book fulfills every received HTLC whose
preimage the host knows as soon as the round that committed it completes;
the payer learns the preimage from the resulting `ChannelHtlcFulfill`.

Events: `htlcCommitted` (a received HTLC is irrevocably committed),
`htlcFulfilled` (a counterparty revealed a preimage to us), and
`htlcSettled` (any HTLC left the channel; `outcome` is `fulfilled` or
`failed`). Payloads are `{ channelId, session, htlcId, paymentHashHex,
blobHashHex, amountSats, direction, preimageHex?, outcome?, reason? }`.

**Kind**: global class  

* [ChannelBook](#ChannelBook)
    * [new ChannelBook(opts)](#new_ChannelBook_new)
    * [.tipFresh](#ChannelBook+tipFresh) ⇒ <code>boolean</code>
    * [.setTip(height)](#ChannelBook+setTip) ⇒ <code>Array.&lt;object&gt;</code>
    * [.setConfirmations(txid, confirmations)](#ChannelBook+setConfirmations)
    * [.pendingFundingTxids()](#ChannelBook+pendingFundingTxids) ⇒ <code>Array.&lt;string&gt;</code>
    * [.onBlock(opts)](#ChannelBook+onBlock) ⇒ <code>Object</code>
    * [.tipHeight()](#ChannelBook+tipHeight) ⇒ <code>number</code> \| <code>null</code>
    * [.preimageFor(paymentHashHex)](#ChannelBook+preimageFor) ⇒ <code>string</code> \| <code>null</code>
    * [.add(session, [aliases])](#ChannelBook+add) ⇒ [<code>ChannelSession</code>](#ChannelSession)
    * [.sessionFor(sellerId, [pubkeyHex])](#ChannelBook+sessionFor) ⇒ [<code>ChannelSession</code>](#ChannelSession) \| <code>null</code>
    * [.publish(body, [session])](#ChannelBook+publish)
    * [.open(opts)](#ChannelBook+open) ⇒ <code>Object</code>
    * [.ingest(body, [meta])](#ChannelBook+ingest) ⇒ <code>object</code> \| <code>null</code>
    * [.forward(upstream, upstreamHtlcId, downstream, [policy])](#ChannelBook+forward) ⇒ <code>object</code>
    * [.tick()](#ChannelBook+tick) ⇒ <code>Array.&lt;object&gt;</code>
    * [.observe(txHex, [opts])](#ChannelBook+observe) ⇒ <code>Array.&lt;object&gt;</code>
    * [.export()](#ChannelBook+export) ⇒ <code>object</code>
    * [.import(snapshot)](#ChannelBook+import)
    * [.list()](#ChannelBook+list) ⇒ <code>Array.&lt;object&gt;</code>

<a name="new_ChannelBook_new"></a>

### new ChannelBook(opts)

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ localPrivateKey, network, tipHeight?: function, confirmations?: function(txid), publish?: function(body), preimageFor?: function(paymentHashHex), policy?, staleTipMs?, forwardPolicy?: { feeSats, cltvDelta } }` |

<a name="ChannelBook+tipFresh"></a>

### channelBook.tipFresh ⇒ <code>boolean</code>
**Kind**: instance property of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>boolean</code> - chain view is usable for expiry decisions  
<a name="ChannelBook+setTip"></a>

### channelBook.setTip(height) ⇒ <code>Array.&lt;object&gt;</code>
Record a fresh chain tip (hosts call on every block) and tick sessions.

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>Array.&lt;object&gt;</code> - bodies published by the tick  

| Param | Type |
| --- | --- |
| height | <code>number</code> | 

<a name="ChannelBook+setConfirmations"></a>

### channelBook.setConfirmations(txid, confirmations)
Host-fed confirmation count for a funding txid (see `confirmations: true`).

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  

| Param | Type |
| --- | --- |
| txid | <code>string</code> | 
| confirmations | <code>number</code> | 

<a name="ChannelBook+pendingFundingTxids"></a>

### channelBook.pendingFundingTxids() ⇒ <code>Array.&lt;string&gt;</code>
**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>Array.&lt;string&gt;</code> - funding txids of sessions still waiting on confirmations  
<a name="ChannelBook+onBlock"></a>

### channelBook.onBlock(opts) ⇒ <code>Object</code>
New-block hook for hosts: record the tip, tick sessions, and classify any
transactions the host hands over (mempool / block bodies).

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ height, txHexes?, blockHeaderHex?, txids?, destinationAddress?, feeSats? }` — `blockHeaderHex` + `txids` (block order) let stale-commitment proofs carry an inclusion branch |

<a name="ChannelBook+tipHeight"></a>

### channelBook.tipHeight() ⇒ <code>number</code> \| <code>null</code>
**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>number</code> \| <code>null</code> - tip height, or `null` when unknown / stale (refuses new HTLCs)  
<a name="ChannelBook+preimageFor"></a>

### channelBook.preimageFor(paymentHashHex) ⇒ <code>string</code> \| <code>null</code>
Host-side preimage lookup (seller-fulfills). Falls back to preimages any
session on this book has already learned.

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  

| Param | Type |
| --- | --- |
| paymentHashHex | <code>string</code> | 

<a name="ChannelBook+add"></a>

### channelBook.add(session, [aliases]) ⇒ [<code>ChannelSession</code>](#ChannelSession)
Register a session under a channel id plus any peer aliases (Fabric id,
`pubkey@host:port`, connection name) used by offers.

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  

| Param | Type |
| --- | --- |
| session | [<code>ChannelSession</code>](#ChannelSession) | 
| [aliases] | <code>Array.&lt;string&gt;</code> | 

<a name="ChannelBook+sessionFor"></a>

### channelBook.sessionFor(sellerId, [pubkeyHex]) ⇒ [<code>ChannelSession</code>](#ChannelSession) \| <code>null</code>
**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| sellerId | <code>string</code> |  | offer `sellerId` / `sellerAddress` |
| [pubkeyHex] | <code>string</code> \| <code>null</code> | <code>null</code> | compressed counterparty key when known |

<a name="ChannelBook+publish"></a>

### channelBook.publish(body, [session])
Publish hook used by the market agent (`channels.publish(body, session)`).

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  

| Param | Type | Default |
| --- | --- | --- |
| body | <code>object</code> |  | 
| [session] | [<code>ChannelSession</code>](#ChannelSession) | <code></code> | 

<a name="ChannelBook+open"></a>

### channelBook.open(opts) ⇒ <code>Object</code>
Open a channel toward a counterparty as the funder. The funder's opening
balance is `capacity − fee − anchors`.

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>Object</code> - `ChannelOpen` body to publish  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ remotePubkey, fundedTxHex, capacitySats, expireAfter, localAddress, remoteAddress, feeSats?, toSelfDelay?, policy?, aliases? }` |

<a name="ChannelBook+ingest"></a>

### channelBook.ingest(body, [meta]) ⇒ <code>object</code> \| <code>null</code>
Route an inbound `Channel*` body. Unknown channels are accepted only on
`ChannelOpen` addressed to our key (we become the non-funding side).
Settlements on a forwarded downstream HTLC propagate upstream.

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>object</code> \| <code>null</code> - reply body (already published through the hook)  

| Param | Type | Description |
| --- | --- | --- |
| body | <code>object</code> | signed artifact |
| [meta] | <code>object</code> | `{ sellerId? }` alias for the counterparty |

<a name="ChannelBook+forward"></a>

### channelBook.forward(upstream, upstreamHtlcId, downstream, [policy]) ⇒ <code>object</code>
Forward a received HTLC onto another channel (multi-hop): enforces
[checkForward](#Channel.checkForward) with this node's policy, offers the
downstream HTLC with `forwardOf`, and links the two for settlement.

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>object</code> - downstream `ChannelCommitment` body (published)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| upstream | [<code>ChannelSession</code>](#ChannelSession) |  |  |
| upstreamHtlcId | <code>string</code> |  |  |
| downstream | [<code>ChannelSession</code>](#ChannelSession) |  |  |
| [policy] | <code>object</code> | <code></code> | `{ feeSats, cltvDelta }` (defaults to `forwardPolicy`) |

<a name="ChannelBook+tick"></a>

### channelBook.tick() ⇒ <code>Array.&lt;object&gt;</code>
Tick every session with the current tip; publishes auto-fail bodies.

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>Array.&lt;object&gt;</code> - bodies published  
<a name="ChannelBook+observe"></a>

### channelBook.observe(txHex, [opts]) ⇒ <code>Array.&lt;object&gt;</code>
Hand an observed transaction to every session (mempool / block hook).

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>Array.&lt;object&gt;</code> - non-`unknown` observations  

| Param | Type | Description |
| --- | --- | --- |
| txHex | <code>string</code> |  |
| [opts] | <code>object</code> | `{ destinationAddress?, feeSats? }` |

<a name="ChannelBook+export"></a>

### channelBook.export() ⇒ <code>object</code>
**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>object</code> - persistence snapshot (no private key)  
<a name="ChannelBook+import"></a>

### channelBook.import(snapshot)
**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  

| Param | Type | Description |
| --- | --- | --- |
| snapshot | <code>object</code> | @returns {ChannelBook} |

<a name="ChannelBook+list"></a>

### channelBook.list() ⇒ <code>Array.&lt;object&gt;</code>
**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>Array.&lt;object&gt;</code> - public summaries  
<a name="ChannelBook"></a>

## ChannelBook
**Kind**: global class  

* [ChannelBook](#ChannelBook)
    * [new ChannelBook(opts)](#new_ChannelBook_new)
    * [.tipFresh](#ChannelBook+tipFresh) ⇒ <code>boolean</code>
    * [.setTip(height)](#ChannelBook+setTip) ⇒ <code>Array.&lt;object&gt;</code>
    * [.setConfirmations(txid, confirmations)](#ChannelBook+setConfirmations)
    * [.pendingFundingTxids()](#ChannelBook+pendingFundingTxids) ⇒ <code>Array.&lt;string&gt;</code>
    * [.onBlock(opts)](#ChannelBook+onBlock) ⇒ <code>Object</code>
    * [.tipHeight()](#ChannelBook+tipHeight) ⇒ <code>number</code> \| <code>null</code>
    * [.preimageFor(paymentHashHex)](#ChannelBook+preimageFor) ⇒ <code>string</code> \| <code>null</code>
    * [.add(session, [aliases])](#ChannelBook+add) ⇒ [<code>ChannelSession</code>](#ChannelSession)
    * [.sessionFor(sellerId, [pubkeyHex])](#ChannelBook+sessionFor) ⇒ [<code>ChannelSession</code>](#ChannelSession) \| <code>null</code>
    * [.publish(body, [session])](#ChannelBook+publish)
    * [.open(opts)](#ChannelBook+open) ⇒ <code>Object</code>
    * [.ingest(body, [meta])](#ChannelBook+ingest) ⇒ <code>object</code> \| <code>null</code>
    * [.forward(upstream, upstreamHtlcId, downstream, [policy])](#ChannelBook+forward) ⇒ <code>object</code>
    * [.tick()](#ChannelBook+tick) ⇒ <code>Array.&lt;object&gt;</code>
    * [.observe(txHex, [opts])](#ChannelBook+observe) ⇒ <code>Array.&lt;object&gt;</code>
    * [.export()](#ChannelBook+export) ⇒ <code>object</code>
    * [.import(snapshot)](#ChannelBook+import)
    * [.list()](#ChannelBook+list) ⇒ <code>Array.&lt;object&gt;</code>

<a name="new_ChannelBook_new"></a>

### new ChannelBook(opts)

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ localPrivateKey, network, tipHeight?: function, confirmations?: function(txid), publish?: function(body), preimageFor?: function(paymentHashHex), policy?, staleTipMs?, forwardPolicy?: { feeSats, cltvDelta } }` |

<a name="ChannelBook+tipFresh"></a>

### channelBook.tipFresh ⇒ <code>boolean</code>
**Kind**: instance property of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>boolean</code> - chain view is usable for expiry decisions  
<a name="ChannelBook+setTip"></a>

### channelBook.setTip(height) ⇒ <code>Array.&lt;object&gt;</code>
Record a fresh chain tip (hosts call on every block) and tick sessions.

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>Array.&lt;object&gt;</code> - bodies published by the tick  

| Param | Type |
| --- | --- |
| height | <code>number</code> | 

<a name="ChannelBook+setConfirmations"></a>

### channelBook.setConfirmations(txid, confirmations)
Host-fed confirmation count for a funding txid (see `confirmations: true`).

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  

| Param | Type |
| --- | --- |
| txid | <code>string</code> | 
| confirmations | <code>number</code> | 

<a name="ChannelBook+pendingFundingTxids"></a>

### channelBook.pendingFundingTxids() ⇒ <code>Array.&lt;string&gt;</code>
**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>Array.&lt;string&gt;</code> - funding txids of sessions still waiting on confirmations  
<a name="ChannelBook+onBlock"></a>

### channelBook.onBlock(opts) ⇒ <code>Object</code>
New-block hook for hosts: record the tip, tick sessions, and classify any
transactions the host hands over (mempool / block bodies).

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ height, txHexes?, blockHeaderHex?, txids?, destinationAddress?, feeSats? }` — `blockHeaderHex` + `txids` (block order) let stale-commitment proofs carry an inclusion branch |

<a name="ChannelBook+tipHeight"></a>

### channelBook.tipHeight() ⇒ <code>number</code> \| <code>null</code>
**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>number</code> \| <code>null</code> - tip height, or `null` when unknown / stale (refuses new HTLCs)  
<a name="ChannelBook+preimageFor"></a>

### channelBook.preimageFor(paymentHashHex) ⇒ <code>string</code> \| <code>null</code>
Host-side preimage lookup (seller-fulfills). Falls back to preimages any
session on this book has already learned.

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  

| Param | Type |
| --- | --- |
| paymentHashHex | <code>string</code> | 

<a name="ChannelBook+add"></a>

### channelBook.add(session, [aliases]) ⇒ [<code>ChannelSession</code>](#ChannelSession)
Register a session under a channel id plus any peer aliases (Fabric id,
`pubkey@host:port`, connection name) used by offers.

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  

| Param | Type |
| --- | --- |
| session | [<code>ChannelSession</code>](#ChannelSession) | 
| [aliases] | <code>Array.&lt;string&gt;</code> | 

<a name="ChannelBook+sessionFor"></a>

### channelBook.sessionFor(sellerId, [pubkeyHex]) ⇒ [<code>ChannelSession</code>](#ChannelSession) \| <code>null</code>
**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| sellerId | <code>string</code> |  | offer `sellerId` / `sellerAddress` |
| [pubkeyHex] | <code>string</code> \| <code>null</code> | <code>null</code> | compressed counterparty key when known |

<a name="ChannelBook+publish"></a>

### channelBook.publish(body, [session])
Publish hook used by the market agent (`channels.publish(body, session)`).

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  

| Param | Type | Default |
| --- | --- | --- |
| body | <code>object</code> |  | 
| [session] | [<code>ChannelSession</code>](#ChannelSession) | <code></code> | 

<a name="ChannelBook+open"></a>

### channelBook.open(opts) ⇒ <code>Object</code>
Open a channel toward a counterparty as the funder. The funder's opening
balance is `capacity − fee − anchors`.

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>Object</code> - `ChannelOpen` body to publish  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | `{ remotePubkey, fundedTxHex, capacitySats, expireAfter, localAddress, remoteAddress, feeSats?, toSelfDelay?, policy?, aliases? }` |

<a name="ChannelBook+ingest"></a>

### channelBook.ingest(body, [meta]) ⇒ <code>object</code> \| <code>null</code>
Route an inbound `Channel*` body. Unknown channels are accepted only on
`ChannelOpen` addressed to our key (we become the non-funding side).
Settlements on a forwarded downstream HTLC propagate upstream.

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>object</code> \| <code>null</code> - reply body (already published through the hook)  

| Param | Type | Description |
| --- | --- | --- |
| body | <code>object</code> | signed artifact |
| [meta] | <code>object</code> | `{ sellerId? }` alias for the counterparty |

<a name="ChannelBook+forward"></a>

### channelBook.forward(upstream, upstreamHtlcId, downstream, [policy]) ⇒ <code>object</code>
Forward a received HTLC onto another channel (multi-hop): enforces
[checkForward](#Channel.checkForward) with this node's policy, offers the
downstream HTLC with `forwardOf`, and links the two for settlement.

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>object</code> - downstream `ChannelCommitment` body (published)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| upstream | [<code>ChannelSession</code>](#ChannelSession) |  |  |
| upstreamHtlcId | <code>string</code> |  |  |
| downstream | [<code>ChannelSession</code>](#ChannelSession) |  |  |
| [policy] | <code>object</code> | <code></code> | `{ feeSats, cltvDelta }` (defaults to `forwardPolicy`) |

<a name="ChannelBook+tick"></a>

### channelBook.tick() ⇒ <code>Array.&lt;object&gt;</code>
Tick every session with the current tip; publishes auto-fail bodies.

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>Array.&lt;object&gt;</code> - bodies published  
<a name="ChannelBook+observe"></a>

### channelBook.observe(txHex, [opts]) ⇒ <code>Array.&lt;object&gt;</code>
Hand an observed transaction to every session (mempool / block hook).

**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>Array.&lt;object&gt;</code> - non-`unknown` observations  

| Param | Type | Description |
| --- | --- | --- |
| txHex | <code>string</code> |  |
| [opts] | <code>object</code> | `{ destinationAddress?, feeSats? }` |

<a name="ChannelBook+export"></a>

### channelBook.export() ⇒ <code>object</code>
**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>object</code> - persistence snapshot (no private key)  
<a name="ChannelBook+import"></a>

### channelBook.import(snapshot)
**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  

| Param | Type | Description |
| --- | --- | --- |
| snapshot | <code>object</code> | @returns {ChannelBook} |

<a name="ChannelBook+list"></a>

### channelBook.list() ⇒ <code>Array.&lt;object&gt;</code>
**Kind**: instance method of [<code>ChannelBook</code>](#ChannelBook)  
**Returns**: <code>Array.&lt;object&gt;</code> - public summaries  
<a name="Circuit"></a>

## Circuit
The [Circuit](#Circuit) is the mechanism through which [Fabric](#Fabric)
operates, a computable directed graph describing a network of
[Peer](#Peer) components and their interactions (side effects).
See also [Swarm](Swarm) for deeper inspection of [Machine](#Machine)
mechanics.

**Kind**: global class  
<a name="Collection"></a>

## Collection
The [Collection](#Collection) type maintains an ordered list of [State](#State) items.

**Kind**: global class  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| @entity | <code>Object</code> | Fabric-bound entity object. |


* [Collection](#Collection)
    * [new Collection([configuration])](#new_Collection_new)
    * [.routes](#Collection+routes) : <code>Object</code>
    * [.path](#Collection+path) : <code>string</code>
    * [.asMerkleTree()](#Collection+asMerkleTree) ⇒ [<code>Tree</code>](#Tree)
    * [._setKey(name)](#Collection+_setKey)
    * [.getByID(id)](#Collection+getByID)
    * [.getLatest()](#Collection+getLatest)
    * [.findByField(name, value)](#Collection+findByField)
    * [.findByName(name)](#Collection+findByName)
    * [.findBySymbol(symbol)](#Collection+findBySymbol)
    * [._patchTarget(path, patches)](#Collection+_patchTarget)
    * [.push(data)](#Collection+push) ⇒ <code>Number</code>
    * [.get(path)](#Collection+get) ⇒ <code>Mixed</code>
    * [.set(path)](#Collection+set) ⇒ <code>Mixed</code>
    * ~~[.list()](#Collection+list) ⇒ <code>Array</code>~~
    * [.toTypedArray()](#Collection+toTypedArray)
    * [.map()](#Collection+map) ⇒ <code>Array</code>
    * [.create(entity)](#Collection+create) ⇒ <code>Promise</code>
    * [.import(state, commit)](#Collection+import)

<a name="new_Collection_new"></a>

### new Collection([configuration])
Create a list of [Entity](#Entity)-like objects for later retrieval.

**Returns**: [<code>Collection</code>](#Collection) - Configured instance of the the [Collection](#Collection).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [configuration] | <code>Object</code> | <code>{}</code> | Configuration object. |

<a name="Collection+routes"></a>

### collection.routes : <code>Object</code>
Route templates from `settings.routes`.

**Kind**: instance property of [<code>Collection</code>](#Collection)  
<a name="Collection+path"></a>

### collection.path : <code>string</code>
Store path the collection is kept under.

**Kind**: instance property of [<code>Collection</code>](#Collection)  
<a name="Collection+asMerkleTree"></a>

### collection.asMerkleTree() ⇒ [<code>Tree</code>](#Tree)
Current elements of the collection as a [Tree](#Tree).

**Kind**: instance method of [<code>Collection</code>](#Collection)  
<a name="Collection+_setKey"></a>

### collection.\_setKey(name)
Sets the `key` property of collection settings.

**Kind**: instance method of [<code>Collection</code>](#Collection)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | Value to set the `key` setting to. |

<a name="Collection+getByID"></a>

### collection.getByID(id)
Retrieve an element from the collection by ID.

**Kind**: instance method of [<code>Collection</code>](#Collection)  

| Param | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Document identifier. |

<a name="Collection+getLatest"></a>

### collection.getLatest()
Retrieve the most recent element in the collection.

**Kind**: instance method of [<code>Collection</code>](#Collection)  
<a name="Collection+findByField"></a>

### collection.findByField(name, value)
Find a document by specific field.

**Kind**: instance method of [<code>Collection</code>](#Collection)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | Name of field to search. |
| value | <code>String</code> | Value to match. |

<a name="Collection+findByName"></a>

### collection.findByName(name)
Find a document by the "name" field.

**Kind**: instance method of [<code>Collection</code>](#Collection)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | Name to search for. |

<a name="Collection+findBySymbol"></a>

### collection.findBySymbol(symbol)
Find a document by the "symbol" field.

**Kind**: instance method of [<code>Collection</code>](#Collection)  

| Param | Type | Description |
| --- | --- | --- |
| symbol | <code>String</code> | Value to search for. |

<a name="Collection+_patchTarget"></a>

### collection.\_patchTarget(path, patches)
Modify a target document using an array of atomic updates.

**Kind**: instance method of [<code>Collection</code>](#Collection)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to the document to modify. |
| patches | <code>Array</code> | List of operations to apply. |

<a name="Collection+push"></a>

### collection.push(data) ⇒ <code>Number</code>
Adds an [Entity](#Entity) to the [Collection](#Collection).

**Kind**: instance method of [<code>Collection</code>](#Collection)  
**Returns**: <code>Number</code> - Length of the collection.  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>Mixed</code> | [Entity](#Entity) to add. |

<a name="Collection+get"></a>

### collection.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Collection</code>](#Collection)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Collection+set"></a>

### collection.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Collection</code>](#Collection)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Collection+list"></a>

### ~~collection.list() ⇒ <code>Array</code>~~
***Deprecated***

Generate a list of elements in the collection.

**Kind**: instance method of [<code>Collection</code>](#Collection)  
<a name="Collection+toTypedArray"></a>

### collection.toTypedArray()
Provides the [Collection](#Collection) as an [Array](Array) of typed
elements.  The type of these elments are defined by the collection's
type, supplied in the constructor.

**Kind**: instance method of [<code>Collection</code>](#Collection)  
<a name="Collection+map"></a>

### collection.map() ⇒ <code>Array</code>
Generate a hashtable of elements in the collection.

**Kind**: instance method of [<code>Collection</code>](#Collection)  
<a name="Collection+create"></a>

### collection.create(entity) ⇒ <code>Promise</code>
Create an instance of an [Entity](#Entity).

**Kind**: instance method of [<code>Collection</code>](#Collection)  
**Returns**: <code>Promise</code> - Resolves with instantiated [Entity](#Entity).  

| Param | Type | Description |
| --- | --- | --- |
| entity | <code>Object</code> | Object with properties. |

<a name="Collection+import"></a>

### collection.import(state, commit)
Loads [State](#State) into memory.

**Kind**: instance method of [<code>Collection</code>](#Collection)  
**Emits**: <code>event:message Will emit one &#x60;CollectionSnapshot&#x60; message (not the removed Snapshot type).</code>  

| Param | Type | Description |
| --- | --- | --- |
| state | [<code>State</code>](#State) | State to import. |
| commit | <code>Boolean</code> | Whether or not to commit the result. |

<a name="Component"></a>

## Component
Dead stub. Page composition lives in `@fabric/http` (`types/component.js`,
`functions/compose.js`). This module stays out of the published package.

**Kind**: global class  
<a name="Contract"></a>

## Contract ⇐ [<code>Service</code>](#Service)
**Kind**: global class  
**Extends**: [<code>Service</code>](#Service)  

* [Contract](#Contract) ⇐ [<code>Service</code>](#Service)
    * [new Contract()](#new_Contract_new)
    * [.resolutions](#Contract+resolutions) : [<code>Resolutions</code>](#Resolutions)
    * [.advance(stateId)](#Contract+advance) ⇒ [<code>Contract</code>](#Contract)
    * [.deploy()](#Contract+deploy) ⇒ <code>String</code>
    * [.start()](#Contract+start) ⇒ [<code>Contract</code>](#Contract)
    * [._handleBitcoinTransaction(txInput, [opts])](#Contract+_handleBitcoinTransaction) ⇒ <code>object</code>
    * [.toTaprootContract([overrides])](#Contract+toTaprootContract) ⇒ <code>object</code>
    * [.toAddress([network])](#Contract+toAddress) ⇒ <code>string</code>
    * [.resolveSpend([opts])](#Contract+resolveSpend) ⇒ <code>object</code>
    * [._appendWarning(msg)](#Service+_appendWarning) ⇒ [<code>Service</code>](#Service)
    * [.init()](#Service+init)
    * [.tick()](#Service+tick) ⇒ <code>Number</code>
    * [.beat()](#Service+beat) ⇒ [<code>Service</code>](#Service)
    * [.get(path)](#Service+get) ⇒ <code>Mixed</code>
    * [.set(path)](#Service+set) ⇒ <code>Mixed</code>
    * [.trust(source)](#Service+trust) ⇒ [<code>Service</code>](#Service)
    * [.handler(message)](#Service+handler) ⇒ [<code>Service</code>](#Service)
    * [.lock([duration])](#Service+lock) ⇒ <code>Boolean</code>
    * [.when(event, method)](#Service+when) ⇒ <code>EventEmitter</code>
    * [.defineOpcode(name, [definition])](#Service+defineOpcode) ⇒ <code>Object</code>
    * [.defineBitcoinOpcode(name, [definition])](#Service+defineBitcoinOpcode) ⇒ <code>Object</code>
    * [.defineFabricOpcode(name, [definition])](#Service+defineFabricOpcode) ⇒ <code>Object</code>
    * [.defineOpcodeContract(name, body, [meta])](#Service+defineOpcodeContract) ⇒ <code>Object</code>
    * [.listOpcodes()](#Service+listOpcodes) ⇒ <code>Array.&lt;Object&gt;</code>
    * [.route(msg)](#Service+route) ⇒ <code>Promise</code>
    * [._GET(path)](#Service+_GET) ⇒ <code>Promise</code>
    * [._PUT(path, value, [commit])](#Service+_PUT) ⇒ <code>Promise</code>
    * [.connect(notify)](#Service+connect) ⇒ <code>Promise</code>
    * [.send(channel, message)](#Service+send) ⇒ [<code>Service</code>](#Service)
    * [.commit()](#Service+commit) ⇒ <code>String</code>
    * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
    * [._send(message)](#Service+_send)

<a name="new_Contract_new"></a>

### new Contract()
Service-backed agreement template: DOT graphs, a derived circuit structure, deploy/genesis/publish flows,
and JSON-Patch–observed commits. Specialized by [Bond](#Bond), [Federation](#Federation), and [Distribution](Distribution).

<a name="Contract+resolutions"></a>

### contract.resolutions : [<code>Resolutions</code>](#Resolutions)
Pre-signed, timelocked exits per off-chain state (see [Resolutions](#Resolutions)).
A state may only be treated as live once `resolutions.resolvable(stateId)`.

**Kind**: instance property of [<code>Contract</code>](#Contract)  
<a name="Contract+advance"></a>

### contract.advance(stateId) ⇒ [<code>Contract</code>](#Contract)
Gate an off-chain state transition on its resolution set: every exit the
state depends on must hold all required signatures, otherwise a counterparty
that stops responding would leave funds unrecoverable.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Throws**:

- <code>Error</code> when exits are still missing signatures


| Param | Type |
| --- | --- |
| stateId | <code>string</code> | 

<a name="Contract+deploy"></a>

### contract.deploy() ⇒ <code>String</code>
Deploys the contract.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: <code>String</code> - Message ID.  
<a name="Contract+start"></a>

### contract.start() ⇒ [<code>Contract</code>](#Contract)
Start the Contract.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Overrides**: [<code>start</code>](#Service+start)  
**Returns**: [<code>Contract</code>](#Contract) - State "STARTED" iteration of the Contract.  
<a name="Contract+_handleBitcoinTransaction"></a>

### contract.\_handleBitcoinTransaction(txInput, [opts]) ⇒ <code>object</code>
Observe an on-chain transaction for payments to this contract's spend address.
On success (and when `apply` is not false), folds matched sats into tip balances.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: <code>object</code> - observation from [module:functions/contractPaymentObserve.observePaymentToAddress](module:functions/contractPaymentObserve.observePaymentToAddress)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| txInput | <code>string</code> \| <code>object</code> |  | raw tx hex or bitcoin.Transaction |
| [opts] | <code>object</code> |  |  |
| [opts.network] | <code>string</code> |  |  |
| [opts.address] | <code>string</code> |  | override spend address |
| [opts.amountSats] | <code>number</code> |  | minimum matched sats |
| [opts.apply] | <code>boolean</code> | <code>true</code> | fold into `_state.content` on success |

<a name="Contract+toTaprootContract"></a>

### contract.toTaprootContract([overrides]) ⇒ <code>object</code>
Build deterministic P2TR spend tree from settings.spendLadder or synthesized
validators / publisher policy.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: <code>object</code> - [module:functions/contractTaproot.buildContractTaproot](module:functions/contractTaproot.buildContractTaproot)  

| Param | Type |
| --- | --- |
| [overrides] | <code>object</code> | 

<a name="Contract+toAddress"></a>

### contract.toAddress([network]) ⇒ <code>string</code>
Bech32m P2TR address for this contract's spend policy.

**Kind**: instance method of [<code>Contract</code>](#Contract)  

| Param | Type |
| --- | --- |
| [network] | <code>string</code> | 

<a name="Contract+resolveSpend"></a>

### contract.resolveSpend([opts]) ⇒ <code>object</code>
Resolve tip + genesis spend policy to the public P2TR surface (ARC).

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: <code>object</code> - [module:functions/contractSpend.resolveSpend](module:functions/contractSpend.resolveSpend)  

| Param | Type | Description |
| --- | --- | --- |
| [opts] | <code>object</code> |  |
| [opts.tip] | <code>object</code> |  |
| [opts.genesis] | <code>object</code> | defaults to this.settings |
| [opts.overrides] | <code>object</code> |  |

<a name="Service+_appendWarning"></a>

### contract.\_appendWarning(msg) ⇒ [<code>Service</code>](#Service)
**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: [<code>Service</code>](#Service) - This instance.  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>String</code> | Warning text (used by [Service#_registerService](Service#_registerService) duplicate guard). |

<a name="Service+init"></a>

### contract.init()
Called by Web Components.
TODO: move to @fabric/http/types/spa

**Kind**: instance method of [<code>Contract</code>](#Contract)  
<a name="Service+tick"></a>

### contract.tick() ⇒ <code>Number</code>
Move forward one clock cycle.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
<a name="Service+beat"></a>

### contract.beat() ⇒ [<code>Service</code>](#Service)
Compute latest state.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Emits**: <code>Message#event:beat</code>  
<a name="Service+get"></a>

### contract.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: <code>Mixed</code> - Returns the target value if found, otherwise null.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+set"></a>

### contract.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Contract</code>](#Contract)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+trust"></a>

### contract.trust(source) ⇒ [<code>Service</code>](#Service)
Explicitly trust all events from a known source.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: [<code>Service</code>](#Service) - Instance of Service after binding events.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Emitter of events. |

<a name="Service+handler"></a>

### contract.handler(message) ⇒ [<code>Service</code>](#Service)
Default route handler for an incoming message.  Follows the Activity
Streams 2.0 spec: https://www.w3.org/TR/activitystreams-core/

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Activity</code> | Message object. |

<a name="Service+lock"></a>

### contract.lock([duration]) ⇒ <code>Boolean</code>
Attempt to acquire a lock for `duration` seconds.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: <code>Boolean</code> - true if locked, false if unable to lock.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [duration] | <code>Number</code> | <code>1000</code> | Number of milliseconds to hold lock. |

<a name="Service+when"></a>

### contract.when(event, method) ⇒ <code>EventEmitter</code>
Bind a method to an event, with current state as the immutable context.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: <code>EventEmitter</code> - Instance of EventEmitter.  

| Param | Type | Description |
| --- | --- | --- |
| event | <code>String</code> | Name of the event upon which to execute `method` as a function. |
| method | <code>function</code> | Function to execute when named [Event](Event) `event` is encountered. |

<a name="Service+defineOpcode"></a>

### contract.defineOpcode(name, [definition]) ⇒ <code>Object</code>
Register a single opcode entry in the service registry.

**Kind**: instance method of [<code>Contract</code>](#Contract)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Opcode symbol (e.g. `OP_SHA256`, `P2P_FLUSH_CHAIN`) |
| [definition] | <code>Object</code> |  |

<a name="Service+defineBitcoinOpcode"></a>

### contract.defineBitcoinOpcode(name, [definition]) ⇒ <code>Object</code>
Register Bitcoin-style primitive opcode metadata.

**Kind**: instance method of [<code>Contract</code>](#Contract)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineFabricOpcode"></a>

### contract.defineFabricOpcode(name, [definition]) ⇒ <code>Object</code>
Register Fabric opcode metadata.

**Kind**: instance method of [<code>Contract</code>](#Contract)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineOpcodeContract"></a>

### contract.defineOpcodeContract(name, body, [meta]) ⇒ <code>Object</code>
Register a newline-delimited opcode contract.
Contract body example:
`OP_DUP\nOP_HASH160\nP2P_FLUSH_CHAIN`

**Kind**: instance method of [<code>Contract</code>](#Contract)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Contract label |
| body | <code>string</code> | Newline-delimited opcode list |
| [meta] | <code>Object</code> |  |

<a name="Service+listOpcodes"></a>

### contract.listOpcodes() ⇒ <code>Array.&lt;Object&gt;</code>
Snapshot opcode registry for UI / API use.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
<a name="Service+route"></a>

### contract.route(msg) ⇒ <code>Promise</code>
Resolve a [State](#State) from a particular [Message](#Message) object.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: <code>Promise</code> - Resolves with resulting [State](#State).  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | Explicit Fabric [Message](#Message). |

<a name="Service+_GET"></a>

### contract.\_GET(path) ⇒ <code>Promise</code>
Retrieve a value from the Service's state.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: <code>Promise</code> - Resolves with the result.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path of the value to retrieve. |

<a name="Service+_PUT"></a>

### contract.\_PUT(path, value, [commit]) ⇒ <code>Promise</code>
Store a value in the Service's state.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: <code>Promise</code> - Resolves with with stored document.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>String</code> |  | Path to store the value at. |
| value | <code>Object</code> |  | Document to store. |
| [commit] | <code>Boolean</code> | <code>false</code> | Sign the resulting state. |

<a name="Service+connect"></a>

### contract.connect(notify) ⇒ <code>Promise</code>
Attach to network.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: <code>Promise</code> - Resolves to [Fabric](#Fabric).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| notify | <code>Boolean</code> | <code>true</code> | Commit to changes. |

<a name="Service+send"></a>

### contract.send(channel, message) ⇒ [<code>Service</code>](#Service)
Send a message to a channel.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| channel | <code>String</code> | Channel name to which the message will be sent. |
| message | <code>String</code> | Content of the message to send. |

<a name="Service+commit"></a>

### contract.commit() ⇒ <code>String</code>
Record outstanding JSON Patch deltas and emit a compact commitment id.
Does **not** wrap [Service#state](Service#state) in a new [Actor](#Actor) — that
JSON-cloned the entire tree on every write/connect and OOMed Hub.

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Overrides**: [<code>commit</code>](#Service+commit)  
**Returns**: <code>String</code> - 32-byte commitment id  
<a name="Service+_registerActor"></a>

### contract.\_registerActor(actor) ⇒ <code>Promise</code>
Register an [Actor](#Actor) with the [Service](#Service).

**Kind**: instance method of [<code>Contract</code>](#Contract)  
**Returns**: <code>Promise</code> - Resolves upon successful registration.  

| Param | Type | Description |
| --- | --- | --- |
| actor | <code>Object</code> | Instance of the [Actor](#Actor). |

<a name="Service+_send"></a>

### contract.\_send(message)
Sends a message.

**Kind**: instance method of [<code>Contract</code>](#Contract)  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Mixed</code> | Message to send. |

<a name="Disk"></a>

## Disk
**Kind**: global class  
<a name="new_Disk_new"></a>

### new Disk()
Minimal host-path file accessor. Roadmap: align with virtual-node / overlay filesystem
work (namespaces, lazy mounts, remote-backed paths) once that stack lands — no behavioral
change here until then.

<a name="Document"></a>

## Document
**Kind**: global class  

* [Document](#Document)
    * [new Document([doc])](#new_Document_new)
    * _instance_
        * [.hash](#Document+hash)
        * [.contentSize](#Document+contentSize) : <code>number</code> \| <code>null</code>
        * [.blobs](#Document+blobs)
        * [.complete](#Document+complete)
        * [.record()](#Document+record) ⇒ <code>Object</code>
        * [.blob(index)](#Document+blob) ⇒ <code>Object</code> \| <code>null</code>
        * [.paymentHashFor(index)](#Document+paymentHashFor) ⇒ <code>string</code> \| <code>null</code>
        * [.keyFor(index)](#Document+keyFor) ⇒ <code>string</code> \| <code>null</code>
        * [.bytesFor(index)](#Document+bytesFor) ⇒ <code>Buffer</code> \| <code>null</code>
        * [.verify(blob)](#Document+verify) ⇒ <code>boolean</code>
        * [.acceptBytes(index, bytes)](#Document+acceptBytes) ⇒ <code>boolean</code>
        * [.openBlob(index, keyHex, [ciphertext])](#Document+openBlob) ⇒ <code>Object</code>
        * [.content()](#Document+content) ⇒ <code>Buffer</code> \| <code>null</code>
        * [.inventoryItem([opts])](#Document+inventoryItem) ⇒ <code>Object</code>
        * [.fileSendObjects([opts])](#Document+fileSendObjects) ⇒ <code>Array.&lt;Object&gt;</code>
        * [.keyRevealFor(index, [opts])](#Document+keyRevealFor) ⇒ <code>Object</code>
        * [.compile(input)](#Document+compile) ⇒ <code>Promise</code>
    * _static_
        * [.seal(plaintext, [opts])](#Document.seal) ⇒ [<code>Document</code>](#Document)
        * [.fromPlain(content, [opts])](#Document.fromPlain) ⇒ [<code>Document</code>](#Document)
        * [.fromRecord(record)](#Document.fromRecord) ⇒ [<code>Document</code>](#Document)
        * [.encodeManifest(meta)](#Document.encodeManifest) ⇒ <code>Buffer</code>
        * [.decodeManifest(bytes)](#Document.decodeManifest) ⇒ <code>Object</code> \| <code>null</code>

<a name="new_Document_new"></a>

### new Document([doc])
Create a Document from a hash-only record (as received from the network)
or from arbitrary State input (legacy behaviour). Use [seal](#Document.seal)
or [fromPlain](#Document.fromPlain) to build one from content.


| Param | Type | Description |
| --- | --- | --- |
| [doc] | <code>Object</code> | Record `{ blobs, merkleRootHex, blobTotal, chunkBytes, sealed, documentId, publisher }`. |

<a name="Document+hash"></a>

### document.hash
Tree root over blob hashes (hex) — the document's identity.

**Kind**: instance property of [<code>Document</code>](#Document)  
<a name="Document+contentSize"></a>

### document.contentSize : <code>number</code> \| <code>null</code>
Plaintext byte length of the whole document. Named `contentSize` (not
`size`) because `State` already defines an own `size` property.

**Kind**: instance property of [<code>Document</code>](#Document)  
<a name="Document+blobs"></a>

### document.blobs
Hash-only blob leaves (copies).

**Kind**: instance property of [<code>Document</code>](#Document)  
<a name="Document+complete"></a>

### document.complete
True when this instance holds every blob key (publisher / full buyer).

**Kind**: instance property of [<code>Document</code>](#Document)  
<a name="Document+record"></a>

### document.record() ⇒ <code>Object</code>
Hash-only record: safe to publish, index, and sign. No names, no bytes.

**Kind**: instance method of [<code>Document</code>](#Document)  
<a name="Document+blob"></a>

### document.blob(index) ⇒ <code>Object</code> \| <code>null</code>
**Kind**: instance method of [<code>Document</code>](#Document)  

| Param | Type |
| --- | --- |
| index | <code>number</code> | 

<a name="Document+paymentHashFor"></a>

### document.paymentHashFor(index) ⇒ <code>string</code> \| <code>null</code>
Payment hash for one blob: `SHA256(K_i)` when sealed, the blob hash when not.

**Kind**: instance method of [<code>Document</code>](#Document)  

| Param | Type |
| --- | --- |
| index | <code>number</code> | 

<a name="Document+keyFor"></a>

### document.keyFor(index) ⇒ <code>string</code> \| <code>null</code>
**Kind**: instance method of [<code>Document</code>](#Document)  
**Returns**: <code>string</code> \| <code>null</code> - `K_i` hex when held  

| Param | Type |
| --- | --- |
| index | <code>number</code> | 

<a name="Document+bytesFor"></a>

### document.bytesFor(index) ⇒ <code>Buffer</code> \| <code>null</code>
**Kind**: instance method of [<code>Document</code>](#Document)  
**Returns**: <code>Buffer</code> \| <code>null</code> - wire bytes (ciphertext when sealed, plaintext otherwise)  

| Param | Type |
| --- | --- |
| index | <code>number</code> | 

<a name="Document+verify"></a>

### document.verify(blob) ⇒ <code>boolean</code>
Blob-hash and root check for received wire bytes.

**Kind**: instance method of [<code>Document</code>](#Document)  

| Param | Type | Description |
| --- | --- | --- |
| blob | <code>Object</code> | `{ index, bytes }` |

<a name="Document+acceptBytes"></a>

### document.acceptBytes(index, bytes) ⇒ <code>boolean</code>
Accept verified wire bytes for one blob (ciphertext when sealed).

**Kind**: instance method of [<code>Document</code>](#Document)  

| Param | Type |
| --- | --- |
| index | <code>number</code> | 
| bytes | <code>Buffer</code> | 

<a name="Document+openBlob"></a>

### document.openBlob(index, keyHex, [ciphertext]) ⇒ <code>Object</code>
Open one sealed blob with its key (checks `SHA256(K_i)` and the plaintext hash).

**Kind**: instance method of [<code>Document</code>](#Document)  

| Param | Type | Description |
| --- | --- | --- |
| index | <code>number</code> |  |
| keyHex | <code>string</code> \| <code>Buffer</code> |  |
| [ciphertext] | <code>Buffer</code> | Defaults to bytes accepted earlier. |

<a name="Document+content"></a>

### document.content() ⇒ <code>Buffer</code> \| <code>null</code>
Reassembled plaintext when every blob has been opened.

**Kind**: instance method of [<code>Document</code>](#Document)  
<a name="Document+inventoryItem"></a>

### document.inventoryItem([opts]) ⇒ <code>Object</code>
`P2P_INVENTORY_RESPONSE` item — hash-only. `contentHashHex` on each blob is
the per-blob payment hash so one HTLC per blob (and multi-seller plans) work
with the existing `Book`.

**Kind**: instance method of [<code>Document</code>](#Document)  

| Param | Type | Description |
| --- | --- | --- |
| [opts] | <code>Object</code> |  |
| [opts.rateSats] | <code>number</code> | Per-blob ask. |
| [opts.documentId] | <code>string</code> |  |

<a name="Document+fileSendObjects"></a>

### document.fileSendObjects([opts]) ⇒ <code>Array.&lt;Object&gt;</code>
`P2P_FILE_SEND` bodies, one per blob (ciphertext when sealed). The
`perBlob` flag tells receivers each blob opens with its own key reveal.

**Kind**: instance method of [<code>Document</code>](#Document)  

| Param | Type | Description |
| --- | --- | --- |
| [opts] | <code>Object</code> |  |
| [opts.documentId] | <code>string</code> |  |
| [opts.indexes] | <code>Array.&lt;number&gt;</code> | Subset of blob indexes. |

<a name="Document+keyRevealFor"></a>

### document.keyRevealFor(index, [opts]) ⇒ <code>Object</code>
Existing `DocumentContentKeyReveal` body for one blob (`K_i`).

**Kind**: instance method of [<code>Document</code>](#Document)  
**Returns**: <code>Object</code> - GenericMessage-shaped `{ type, object }`  

| Param | Type |
| --- | --- |
| index | <code>number</code> | 
| [opts] | <code>Object</code> | 
| [opts.documentId] | <code>string</code> | 
| [opts.settlementId] | <code>string</code> | 

<a name="Document+compile"></a>

### document.compile(input) ⇒ <code>Promise</code>
Compiles an `input` [State](#State) snapshot (signed instruction payload).
ENV provides the name of a parent type (e.g., "scaffold" or "0xDEADBEEF...")
UI provides the name of the desired component

**Kind**: instance method of [<code>Document</code>](#Document)  
**Returns**: <code>Promise</code> - Promise which resolves on compilation.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Array</code> \| <code>Object</code> | [env, ui] |

<a name="Document.seal"></a>

### Document.seal(plaintext, [opts]) ⇒ [<code>Document</code>](#Document)
Seal plaintext as a blob tree with one key per blob.

**Kind**: static method of [<code>Document</code>](#Document)  

| Param | Type | Description |
| --- | --- | --- |
| plaintext | <code>Buffer</code> \| <code>string</code> |  |
| [opts] | <code>Object</code> |  |
| [opts.chunkBytes] | <code>number</code> | Ciphertext blob size (default AMP-sized); plaintext chunks are 16 bytes smaller. |
| [opts.documentId] | <code>string</code> | Catalog id (defaults to the Tree root). |
| [opts.publisher] | <code>string</code> | Publisher public key (hex). |

<a name="Document.fromPlain"></a>

### Document.fromPlain(content, [opts]) ⇒ [<code>Document</code>](#Document)
Unsealed blob tree over raw content (same leaves as `splitBlobs`).

**Kind**: static method of [<code>Document</code>](#Document)  

| Param | Type |
| --- | --- |
| content | <code>Buffer</code> \| <code>string</code> | 
| [opts] | <code>Object</code> | 
| [opts.chunkBytes] | <code>number</code> | 
| [opts.documentId] | <code>string</code> | 
| [opts.publisher] | <code>string</code> | 

<a name="Document.fromRecord"></a>

### Document.fromRecord(record) ⇒ [<code>Document</code>](#Document)
Rehydrate from a record previously produced by [record](#Document+record).

**Kind**: static method of [<code>Document</code>](#Document)  

| Param | Type |
| --- | --- |
| record | <code>Object</code> | 

<a name="Document.encodeManifest"></a>

### Document.encodeManifest(meta) ⇒ <code>Buffer</code>
Canonical bytes for a manifest blob — the one place human-readable
metadata lives. Seal it as its own one-blob Document.

**Kind**: static method of [<code>Document</code>](#Document)  

| Param | Type | Description |
| --- | --- | --- |
| meta | <code>Object</code> | `{ title, url, mime, size, merkleRootHex, ... }` |

<a name="Document.decodeManifest"></a>

### Document.decodeManifest(bytes) ⇒ <code>Object</code> \| <code>null</code>
**Kind**: static method of [<code>Document</code>](#Document)  
**Returns**: <code>Object</code> \| <code>null</code> - manifest, or null when not a `DocumentManifest`  

| Param | Type |
| --- | --- |
| bytes | <code>Buffer</code> \| <code>string</code> | 

<a name="Entity"></a>

## Entity ⇐ <code>EventEmitter</code>
<strong>Structured document</strong> type: extends [EventEmitter](EventEmitter) (not [Actor](#Actor)) with
<code>@type</code> / <code>@data</code> shape, JSON serialization, and <code>id</code> = SHA256(<code>toJSON()</code>).
<strong>Different model from [Actor#id](Actor#id)</strong> (sorted generic envelope). <code>Entity.Transition</code> (JSON Patch
between entity states) is the supported migration path — see <strong>DEVELOPERS.md</strong> (<em>Consolidated prototypes</em>).

**Kind**: global class  
**Extends**: <code>EventEmitter</code>  

* [Entity](#Entity) ⇐ <code>EventEmitter</code>
    * _instance_
        * [.toJSON()](#Entity+toJSON) ⇒ <code>String</code>
        * [.toRaw()](#Entity+toRaw) ⇒ <code>Buffer</code>
        * [._downsample([input])](#Entity+_downsample)
    * _static_
        * [.Transition](#Entity.Transition) ⇐ [<code>Entity</code>](#Entity)
            * [.toJSON()](#Entity+toJSON) ⇒ <code>String</code>
            * [.toRaw()](#Entity+toRaw) ⇒ <code>Buffer</code>
            * [._downsample([input])](#Entity+_downsample)

<a name="Entity+toJSON"></a>

### entity.toJSON() ⇒ <code>String</code>
Produces a string of JSON, representing the entity.

**Kind**: instance method of [<code>Entity</code>](#Entity)  
**Returns**: <code>String</code> - JSON-encoded object.  
<a name="Entity+toRaw"></a>

### entity.toRaw() ⇒ <code>Buffer</code>
As a [Buffer](Buffer).

**Kind**: instance method of [<code>Entity</code>](#Entity)  
**Returns**: <code>Buffer</code> - Slice of memory.  
<a name="Entity+_downsample"></a>

### entity.\_downsample([input])
Return a [Fabric](#Fabric)-labeled [Object](Object) for this [Entity](#Entity).

**Kind**: instance method of [<code>Entity</code>](#Entity)  

| Param | Type | Description |
| --- | --- | --- |
| [input] | <code>Mixed</code> | Input to downsample.  If not provided, current Entity will be used. |

<a name="Entity.Transition"></a>

### Entity.Transition ⇐ [<code>Entity</code>](#Entity)
JSON Patch <strong>diff</strong> between two [Entity](#Entity) snapshots (<code>origin</code>,
<code>target</code>, <code>changes</code>). Built via [Transition.between](Transition.between), [Transition#fromTarget](Transition#fromTarget), or manual
<code>changes</code>; uses <code>fast-json-patch</code> observe/generate.

**Kind**: static class of [<code>Entity</code>](#Entity)  
**Extends**: [<code>Entity</code>](#Entity)  

* [.Transition](#Entity.Transition) ⇐ [<code>Entity</code>](#Entity)
    * [.toJSON()](#Entity+toJSON) ⇒ <code>String</code>
    * [.toRaw()](#Entity+toRaw) ⇒ <code>Buffer</code>
    * [._downsample([input])](#Entity+_downsample)

<a name="Entity+toJSON"></a>

#### transition.toJSON() ⇒ <code>String</code>
Produces a string of JSON, representing the entity.

**Kind**: instance method of [<code>Transition</code>](#Entity.Transition)  
**Returns**: <code>String</code> - JSON-encoded object.  
<a name="Entity+toRaw"></a>

#### transition.toRaw() ⇒ <code>Buffer</code>
As a [Buffer](Buffer).

**Kind**: instance method of [<code>Transition</code>](#Entity.Transition)  
**Returns**: <code>Buffer</code> - Slice of memory.  
<a name="Entity+_downsample"></a>

#### transition.\_downsample([input])
Return a [Fabric](#Fabric)-labeled [Object](Object) for this [Entity](#Entity).

**Kind**: instance method of [<code>Transition</code>](#Entity.Transition)  

| Param | Type | Description |
| --- | --- | --- |
| [input] | <code>Mixed</code> | Input to downsample.  If not provided, current Entity will be used. |

<a name="Environment"></a>

## Environment
Interact with the user's Environment.

**Kind**: global class  

* [Environment](#Environment)
    * [new Environment([settings])](#new_Environment_new)
    * [.readWalletDocument()](#Environment+readWalletDocument) ⇒ <code>object</code> \| <code>null</code>
    * [.lockWallet()](#Environment+lockWallet) ⇒ [<code>Environment</code>](#Environment)
    * [.unlockWallet(password)](#Environment+unlockWallet) ⇒ [<code>Environment</code>](#Environment)
    * [.setLockTimeoutMinutes(minutes)](#Environment+setLockTimeoutMinutes) ⇒ [<code>Environment</code>](#Environment)
    * [.encryptWallet(password)](#Environment+encryptWallet) ⇒ [<code>Environment</code>](#Environment)
    * [._getDefaultBitcoinDatadir([configPath])](#Environment+_getDefaultBitcoinDatadir) ⇒ <code>Object</code>
    * [._parseConfigValue(value)](#Environment+_parseConfigValue) ⇒ <code>\*</code>
    * [._hasSingleNumericPortSuffix(host)](#Environment+_hasSingleNumericPortSuffix) ⇒ <code>boolean</code>
    * [._toFabricSettings(bitcoinConf)](#Environment+_toFabricSettings) ⇒ <code>Object</code>
    * [.loadWallet([opts])](#Environment+loadWallet) ⇒ [<code>Environment</code>](#Environment)
    * [.readVariable(name)](#Environment+readVariable) ⇒ <code>String</code>
    * [.setWallet(wallet, force, [opts])](#Environment+setWallet) ⇒ [<code>Environment</code>](#Environment)
    * [.start()](#Environment+start) ⇒ [<code>Environment</code>](#Environment)

<a name="new_Environment_new"></a>

### new Environment([settings])
Create an instance of [Environment](#Environment).

**Returns**: [<code>Environment</code>](#Environment) - Instance of the Environment.  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Settings for the Fabric environment. |

<a name="Environment+readWalletDocument"></a>

### environment.readWalletDocument() ⇒ <code>object</code> \| <code>null</code>
**Kind**: instance method of [<code>Environment</code>](#Environment)  
<a name="Environment+lockWallet"></a>

### environment.lockWallet() ⇒ [<code>Environment</code>](#Environment)
Drop in-memory secrets; public snapshot remains.

**Kind**: instance method of [<code>Environment</code>](#Environment)  
<a name="Environment+unlockWallet"></a>

### environment.unlockWallet(password) ⇒ [<code>Environment</code>](#Environment)
Decrypt a password-protected wallet into memory and start the idle timer.

**Kind**: instance method of [<code>Environment</code>](#Environment)  

| Param | Type |
| --- | --- |
| password | <code>string</code> | 

<a name="Environment+setLockTimeoutMinutes"></a>

### environment.setLockTimeoutMinutes(minutes) ⇒ [<code>Environment</code>](#Environment)
Persist idle-lock timeout on the wallet document (public field).

**Kind**: instance method of [<code>Environment</code>](#Environment)  

| Param | Type |
| --- | --- |
| minutes | <code>number</code> | 

<a name="Environment+encryptWallet"></a>

### environment.encryptWallet(password) ⇒ [<code>Environment</code>](#Environment)
Encrypt a legacy plaintext wallet file in place.

**Kind**: instance method of [<code>Environment</code>](#Environment)  

| Param | Type |
| --- | --- |
| password | <code>string</code> | 

<a name="Environment+_getDefaultBitcoinDatadir"></a>

### environment.\_getDefaultBitcoinDatadir([configPath]) ⇒ <code>Object</code>
Read and parse Bitcoin configuration from bitcoin.conf file

**Kind**: instance method of [<code>Environment</code>](#Environment)  
**Returns**: <code>Object</code> - Parsed Bitcoin configuration object  

| Param | Type | Description |
| --- | --- | --- |
| [configPath] | <code>String</code> | Optional path to bitcoin.conf, defaults to ~/.bitcoin/bitcoin.conf |

<a name="Environment+_parseConfigValue"></a>

### environment.\_parseConfigValue(value) ⇒ <code>\*</code>
Parse configuration value to appropriate type

**Kind**: instance method of [<code>Environment</code>](#Environment)  
**Returns**: <code>\*</code> - Parsed value (string, number, or boolean)  

| Param | Type | Description |
| --- | --- | --- |
| value | <code>String</code> | The raw configuration value |

<a name="Environment+_hasSingleNumericPortSuffix"></a>

### environment.\_hasSingleNumericPortSuffix(host) ⇒ <code>boolean</code>
True when `host` is `name:port` with exactly one colon and a numeric port (IPv4 or hostname).
Bare IPv6 literals (`::1`, `2001:db8::1`) have multiple colons — do not treat as host:port.

**Kind**: instance method of [<code>Environment</code>](#Environment)  

| Param | Type |
| --- | --- |
| host | <code>string</code> | 

<a name="Environment+_toFabricSettings"></a>

### environment.\_toFabricSettings(bitcoinConf) ⇒ <code>Object</code>
Convert bitcoin.conf configuration to Fabric Bitcoin service settings

**Kind**: instance method of [<code>Environment</code>](#Environment)  
**Returns**: <code>Object</code> - Settings object compatible with Fabric Bitcoin service  

| Param | Type | Description |
| --- | --- | --- |
| bitcoinConf | <code>Object</code> | The parsed bitcoin.conf configuration |

<a name="Environment+loadWallet"></a>

### environment.loadWallet([opts]) ⇒ [<code>Environment</code>](#Environment)
Load identity from env, fixture (`NODE_ENV=test`), or `wallet.json`.

**Kind**: instance method of [<code>Environment</code>](#Environment)  

| Param | Type | Description |
| --- | --- | --- |
| [opts] | <code>Object</code> |  |
| [opts.password] | <code>string</code> | unlocks a sealed wallet.json |
| [opts.fromFile] | <code>boolean</code> | skip env/fixture identity; read wallet.json only |

<a name="Environment+readVariable"></a>

### environment.readVariable(name) ⇒ <code>String</code>
Read a variable from the environment.

**Kind**: instance method of [<code>Environment</code>](#Environment)  
**Returns**: <code>String</code> - Value of the variable (or an empty string).  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | Variable name to read. |

<a name="Environment+setWallet"></a>

### environment.setWallet(wallet, force, [opts]) ⇒ [<code>Environment</code>](#Environment)
Configure the Environment to use a Fabric [Wallet](#Wallet).
New wallets default to a password-sealed JSON document (`seal` blob).
Pass `{ encrypt: false }` only for tests / explicit plaintext.

**Kind**: instance method of [<code>Environment</code>](#Environment)  
**Returns**: [<code>Environment</code>](#Environment) - The Fabric Environment.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| wallet | [<code>Wallet</code>](#Wallet) |  | Wallet to attach. |
| force | <code>Boolean</code> | <code>false</code> | Force existing wallets to be destroyed. |
| [opts] | <code>Object</code> |  |  |
| [opts.password] | <code>string</code> |  | Encryption password (required unless `encrypt` is false). |
| [opts.encrypt] | <code>boolean</code> | <code>true</code> |  |

<a name="Environment+start"></a>

### environment.start() ⇒ [<code>Environment</code>](#Environment)
Start the Environment.

**Kind**: instance method of [<code>Environment</code>](#Environment)  
**Returns**: [<code>Environment</code>](#Environment) - The Fabric Environment.  
<a name="Fabric"></a>

## Fabric ⇐ [<code>Service</code>](#Service)
Facade [Service](#Service) that bundles [Chain](#Chain), [Machine](#Machine), [Store](#Store), [Peer](#Peer), and related
types for experiments and apps. Prefer importing <strong>leaf</strong> types in production; this class re-exports many of them as statics.

**Kind**: global class  
**Extends**: [<code>Service</code>](#Service)  

* [Fabric](#Fabric) ⇐ [<code>Service</code>](#Service)
    * [new Fabric([settings])](#new_Fabric_new)
    * _instance_
        * [.register(service)](#Fabric+register)
        * [.push(value)](#Fabric+push) ⇒ <code>Stack</code>
        * [.trust(source)](#Fabric+trust) ⇒ [<code>Fabric</code>](#Fabric)
        * [.compute()](#Fabric+compute) ⇒ [<code>Fabric</code>](#Fabric)
        * [._appendWarning(msg)](#Service+_appendWarning) ⇒ [<code>Service</code>](#Service)
        * [.init()](#Service+init)
        * [.tick()](#Service+tick) ⇒ <code>Number</code>
        * [.beat()](#Service+beat) ⇒ [<code>Service</code>](#Service)
        * [.get(path)](#Service+get) ⇒ <code>Mixed</code>
        * [.set(path)](#Service+set) ⇒ <code>Mixed</code>
        * [.handler(message)](#Service+handler) ⇒ [<code>Service</code>](#Service)
        * [.lock([duration])](#Service+lock) ⇒ <code>Boolean</code>
        * [.when(event, method)](#Service+when) ⇒ <code>EventEmitter</code>
        * [.defineOpcode(name, [definition])](#Service+defineOpcode) ⇒ <code>Object</code>
        * [.defineBitcoinOpcode(name, [definition])](#Service+defineBitcoinOpcode) ⇒ <code>Object</code>
        * [.defineFabricOpcode(name, [definition])](#Service+defineFabricOpcode) ⇒ <code>Object</code>
        * [.defineOpcodeContract(name, body, [meta])](#Service+defineOpcodeContract) ⇒ <code>Object</code>
        * [.listOpcodes()](#Service+listOpcodes) ⇒ <code>Array.&lt;Object&gt;</code>
        * [.route(msg)](#Service+route) ⇒ <code>Promise</code>
        * [.start()](#Service+start)
        * [._GET(path)](#Service+_GET) ⇒ <code>Promise</code>
        * [._PUT(path, value, [commit])](#Service+_PUT) ⇒ <code>Promise</code>
        * [.connect(notify)](#Service+connect) ⇒ <code>Promise</code>
        * [.send(channel, message)](#Service+send) ⇒ [<code>Service</code>](#Service)
        * [.commit()](#Service+commit) ⇒ <code>String</code>
        * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
        * [._send(message)](#Service+_send)
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * ~~[.Scribe](#Fabric.Scribe)~~
        * [.Vector](#Fabric.Vector) ⇒ <code>function</code>
        * [.Federation](#Fabric.Federation) ⇒ <code>function</code>
        * ~~[.DistributedExecution](#Fabric.DistributedExecution) ⇒ <code>object</code>~~

<a name="new_Fabric_new"></a>

### new Fabric([settings])
The [Fabric](#Fabric) type implements a peer-to-peer protocol for establishing and settling mutually agreed proofs of work.
Contract execution runs locally first, then may be shared with the network.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | Engine settings (merged into <code>this.settings</code>); typically includes <code>path</code>, <code>persistent</code>, and <code>state</code> (initial [Actor](#Actor) content). |

<a name="Fabric+register"></a>

### fabric.register(service)
Register an available [Service](#Service) using an ES6 [Class](Class).

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type | Description |
| --- | --- | --- |
| service | <code>Class</code> | The ES6 [Class](Class). |

<a name="Fabric+push"></a>

### fabric.push(value) ⇒ <code>Stack</code>
Push an instruction onto the stack.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type |
| --- | --- |
| value | <code>Instruction</code> | 

<a name="Fabric+trust"></a>

### fabric.trust(source) ⇒ [<code>Fabric</code>](#Fabric)
Blindly consume messages from a [Source](Source), relying on `this.chain` to
verify results.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Overrides**: [<code>trust</code>](#Service+trust)  
**Returns**: [<code>Fabric</code>](#Fabric) - Returns itself.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Any object which implements the `EventEmitter` pattern. |

<a name="Fabric+compute"></a>

### fabric.compute() ⇒ [<code>Fabric</code>](#Fabric)
Process the current stack.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: [<code>Fabric</code>](#Fabric) - Resulting instance of the stack.  
<a name="Service+_appendWarning"></a>

### fabric.\_appendWarning(msg) ⇒ [<code>Service</code>](#Service)
**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: [<code>Service</code>](#Service) - This instance.  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>String</code> | Warning text (used by [Service#_registerService](Service#_registerService) duplicate guard). |

<a name="Service+init"></a>

### fabric.init()
Called by Web Components.
TODO: move to @fabric/http/types/spa

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Service+tick"></a>

### fabric.tick() ⇒ <code>Number</code>
Move forward one clock cycle.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Service+beat"></a>

### fabric.beat() ⇒ [<code>Service</code>](#Service)
Compute latest state.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Emits**: <code>Message#event:beat</code>  
<a name="Service+get"></a>

### fabric.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Overrides**: [<code>get</code>](#Service+get)  
**Returns**: <code>Mixed</code> - Returns the target value if found, otherwise null.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+set"></a>

### fabric.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Overrides**: [<code>set</code>](#Service+set)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+handler"></a>

### fabric.handler(message) ⇒ [<code>Service</code>](#Service)
Default route handler for an incoming message.  Follows the Activity
Streams 2.0 spec: https://www.w3.org/TR/activitystreams-core/

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Activity</code> | Message object. |

<a name="Service+lock"></a>

### fabric.lock([duration]) ⇒ <code>Boolean</code>
Attempt to acquire a lock for `duration` seconds.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Boolean</code> - true if locked, false if unable to lock.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [duration] | <code>Number</code> | <code>1000</code> | Number of milliseconds to hold lock. |

<a name="Service+when"></a>

### fabric.when(event, method) ⇒ <code>EventEmitter</code>
Bind a method to an event, with current state as the immutable context.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>EventEmitter</code> - Instance of EventEmitter.  

| Param | Type | Description |
| --- | --- | --- |
| event | <code>String</code> | Name of the event upon which to execute `method` as a function. |
| method | <code>function</code> | Function to execute when named [Event](Event) `event` is encountered. |

<a name="Service+defineOpcode"></a>

### fabric.defineOpcode(name, [definition]) ⇒ <code>Object</code>
Register a single opcode entry in the service registry.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Opcode symbol (e.g. `OP_SHA256`, `P2P_FLUSH_CHAIN`) |
| [definition] | <code>Object</code> |  |

<a name="Service+defineBitcoinOpcode"></a>

### fabric.defineBitcoinOpcode(name, [definition]) ⇒ <code>Object</code>
Register Bitcoin-style primitive opcode metadata.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineFabricOpcode"></a>

### fabric.defineFabricOpcode(name, [definition]) ⇒ <code>Object</code>
Register Fabric opcode metadata.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineOpcodeContract"></a>

### fabric.defineOpcodeContract(name, body, [meta]) ⇒ <code>Object</code>
Register a newline-delimited opcode contract.
Contract body example:
`OP_DUP\nOP_HASH160\nP2P_FLUSH_CHAIN`

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Contract label |
| body | <code>string</code> | Newline-delimited opcode list |
| [meta] | <code>Object</code> |  |

<a name="Service+listOpcodes"></a>

### fabric.listOpcodes() ⇒ <code>Array.&lt;Object&gt;</code>
Snapshot opcode registry for UI / API use.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Service+route"></a>

### fabric.route(msg) ⇒ <code>Promise</code>
Resolve a [State](#State) from a particular [Message](#Message) object.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Promise</code> - Resolves with resulting [State](#State).  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | Explicit Fabric [Message](#Message). |

<a name="Service+start"></a>

### fabric.start()
Start the service, including the initiation of an outbound connection
to any peers designated in the service's configuration.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Service+_GET"></a>

### fabric.\_GET(path) ⇒ <code>Promise</code>
Retrieve a value from the Service's state.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Overrides**: [<code>\_GET</code>](#Service+_GET)  
**Returns**: <code>Promise</code> - Resolves with the result.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path of the value to retrieve. |

<a name="Service+_PUT"></a>

### fabric.\_PUT(path, value, [commit]) ⇒ <code>Promise</code>
Store a value in the Service's state.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Overrides**: [<code>\_PUT</code>](#Service+_PUT)  
**Returns**: <code>Promise</code> - Resolves with with stored document.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>String</code> |  | Path to store the value at. |
| value | <code>Object</code> |  | Document to store. |
| [commit] | <code>Boolean</code> | <code>false</code> | Sign the resulting state. |

<a name="Service+connect"></a>

### fabric.connect(notify) ⇒ <code>Promise</code>
Attach to network.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Promise</code> - Resolves to [Fabric](#Fabric).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| notify | <code>Boolean</code> | <code>true</code> | Commit to changes. |

<a name="Service+send"></a>

### fabric.send(channel, message) ⇒ [<code>Service</code>](#Service)
Send a message to a channel.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Overrides**: [<code>send</code>](#Service+send)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| channel | <code>String</code> | Channel name to which the message will be sent. |
| message | <code>String</code> | Content of the message to send. |

<a name="Service+commit"></a>

### fabric.commit() ⇒ <code>String</code>
Record outstanding JSON Patch deltas and emit a compact commitment id.
Does **not** wrap [Service#state](Service#state) in a new [Actor](#Actor) — that
JSON-cloned the entire tree on every write/connect and OOMed Hub.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>String</code> - 32-byte commitment id  
<a name="Service+_registerActor"></a>

### fabric.\_registerActor(actor) ⇒ <code>Promise</code>
Register an [Actor](#Actor) with the [Service](#Service).

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Promise</code> - Resolves upon successful registration.  

| Param | Type | Description |
| --- | --- | --- |
| actor | <code>Object</code> | Instance of the [Actor](#Actor). |

<a name="Service+_send"></a>

### fabric.\_send(message)
Sends a message.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Mixed</code> | Message to send. |

<a name="Actor+adopt"></a>

### fabric.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+export"></a>

### fabric.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### fabric.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### fabric.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Actor+toGenericMessage"></a>

### fabric.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### fabric.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Actor+pause"></a>

### fabric.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### fabric.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Actor+sign"></a>

### fabric.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Actor+unpause"></a>

### fabric.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### fabric.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### fabric.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Fabric.Scribe"></a>

### ~~Fabric.Scribe~~
***Use [State](#State). Alias for backward compatibility.***

**Kind**: static property of [<code>Fabric</code>](#Fabric)  
<a name="Fabric.Vector"></a>

### Fabric.Vector ⇒ <code>function</code>
EventEmitter-only instruction handle; use [State](#State) / [Machine](#Machine) for signed payloads.

**Kind**: static property of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>function</code> - The [module:types/vector~Vector](module:types/vector~Vector) constructor.  
<a name="Fabric.Federation"></a>

### Fabric.Federation ⇒ <code>function</code>
**Kind**: static property of [<code>Fabric</code>](#Fabric)  
<a name="Fabric.DistributedExecution"></a>

### ~~Fabric.DistributedExecution ⇒ <code>object</code>~~
***Not a Fabric type. Use [Machine](#Machine), [Program](#Program),
`functions/beaconFederationSigning`, and `functions/fabricCanonicalJson`.***

**Kind**: static property of [<code>Fabric</code>](#Fabric)  
<a name="Fabric"></a>

## Fabric
**Kind**: global class  
**Emits**: <code>Fabric#event:thread</code>, <code>Fabric#event:step Emitted on a &lt;code&gt;compute&lt;/code&gt; step.</code>  

* [Fabric](#Fabric)
    * [new Fabric([settings])](#new_Fabric_new)
    * _instance_
        * [.register(service)](#Fabric+register)
        * [.push(value)](#Fabric+push) ⇒ <code>Stack</code>
        * [.trust(source)](#Fabric+trust) ⇒ [<code>Fabric</code>](#Fabric)
        * [.compute()](#Fabric+compute) ⇒ [<code>Fabric</code>](#Fabric)
        * [._appendWarning(msg)](#Service+_appendWarning) ⇒ [<code>Service</code>](#Service)
        * [.init()](#Service+init)
        * [.tick()](#Service+tick) ⇒ <code>Number</code>
        * [.beat()](#Service+beat) ⇒ [<code>Service</code>](#Service)
        * [.get(path)](#Service+get) ⇒ <code>Mixed</code>
        * [.set(path)](#Service+set) ⇒ <code>Mixed</code>
        * [.handler(message)](#Service+handler) ⇒ [<code>Service</code>](#Service)
        * [.lock([duration])](#Service+lock) ⇒ <code>Boolean</code>
        * [.when(event, method)](#Service+when) ⇒ <code>EventEmitter</code>
        * [.defineOpcode(name, [definition])](#Service+defineOpcode) ⇒ <code>Object</code>
        * [.defineBitcoinOpcode(name, [definition])](#Service+defineBitcoinOpcode) ⇒ <code>Object</code>
        * [.defineFabricOpcode(name, [definition])](#Service+defineFabricOpcode) ⇒ <code>Object</code>
        * [.defineOpcodeContract(name, body, [meta])](#Service+defineOpcodeContract) ⇒ <code>Object</code>
        * [.listOpcodes()](#Service+listOpcodes) ⇒ <code>Array.&lt;Object&gt;</code>
        * [.route(msg)](#Service+route) ⇒ <code>Promise</code>
        * [.start()](#Service+start)
        * [._GET(path)](#Service+_GET) ⇒ <code>Promise</code>
        * [._PUT(path, value, [commit])](#Service+_PUT) ⇒ <code>Promise</code>
        * [.connect(notify)](#Service+connect) ⇒ <code>Promise</code>
        * [.send(channel, message)](#Service+send) ⇒ [<code>Service</code>](#Service)
        * [.commit()](#Service+commit) ⇒ <code>String</code>
        * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
        * [._send(message)](#Service+_send)
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * ~~[.Scribe](#Fabric.Scribe)~~
        * [.Vector](#Fabric.Vector) ⇒ <code>function</code>
        * [.Federation](#Fabric.Federation) ⇒ <code>function</code>
        * ~~[.DistributedExecution](#Fabric.DistributedExecution) ⇒ <code>object</code>~~

<a name="new_Fabric_new"></a>

### new Fabric([settings])
The [Fabric](#Fabric) type implements a peer-to-peer protocol for establishing and settling mutually agreed proofs of work.
Contract execution runs locally first, then may be shared with the network.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | Engine settings (merged into <code>this.settings</code>); typically includes <code>path</code>, <code>persistent</code>, and <code>state</code> (initial [Actor](#Actor) content). |

<a name="Fabric+register"></a>

### fabric.register(service)
Register an available [Service](#Service) using an ES6 [Class](Class).

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type | Description |
| --- | --- | --- |
| service | <code>Class</code> | The ES6 [Class](Class). |

<a name="Fabric+push"></a>

### fabric.push(value) ⇒ <code>Stack</code>
Push an instruction onto the stack.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type |
| --- | --- |
| value | <code>Instruction</code> | 

<a name="Fabric+trust"></a>

### fabric.trust(source) ⇒ [<code>Fabric</code>](#Fabric)
Blindly consume messages from a [Source](Source), relying on `this.chain` to
verify results.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Overrides**: [<code>trust</code>](#Service+trust)  
**Returns**: [<code>Fabric</code>](#Fabric) - Returns itself.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Any object which implements the `EventEmitter` pattern. |

<a name="Fabric+compute"></a>

### fabric.compute() ⇒ [<code>Fabric</code>](#Fabric)
Process the current stack.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: [<code>Fabric</code>](#Fabric) - Resulting instance of the stack.  
<a name="Service+_appendWarning"></a>

### fabric.\_appendWarning(msg) ⇒ [<code>Service</code>](#Service)
**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: [<code>Service</code>](#Service) - This instance.  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>String</code> | Warning text (used by [Service#_registerService](Service#_registerService) duplicate guard). |

<a name="Service+init"></a>

### fabric.init()
Called by Web Components.
TODO: move to @fabric/http/types/spa

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Service+tick"></a>

### fabric.tick() ⇒ <code>Number</code>
Move forward one clock cycle.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Service+beat"></a>

### fabric.beat() ⇒ [<code>Service</code>](#Service)
Compute latest state.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Emits**: <code>Message#event:beat</code>  
<a name="Service+get"></a>

### fabric.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Overrides**: [<code>get</code>](#Service+get)  
**Returns**: <code>Mixed</code> - Returns the target value if found, otherwise null.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+set"></a>

### fabric.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Overrides**: [<code>set</code>](#Service+set)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+handler"></a>

### fabric.handler(message) ⇒ [<code>Service</code>](#Service)
Default route handler for an incoming message.  Follows the Activity
Streams 2.0 spec: https://www.w3.org/TR/activitystreams-core/

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Activity</code> | Message object. |

<a name="Service+lock"></a>

### fabric.lock([duration]) ⇒ <code>Boolean</code>
Attempt to acquire a lock for `duration` seconds.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Boolean</code> - true if locked, false if unable to lock.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [duration] | <code>Number</code> | <code>1000</code> | Number of milliseconds to hold lock. |

<a name="Service+when"></a>

### fabric.when(event, method) ⇒ <code>EventEmitter</code>
Bind a method to an event, with current state as the immutable context.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>EventEmitter</code> - Instance of EventEmitter.  

| Param | Type | Description |
| --- | --- | --- |
| event | <code>String</code> | Name of the event upon which to execute `method` as a function. |
| method | <code>function</code> | Function to execute when named [Event](Event) `event` is encountered. |

<a name="Service+defineOpcode"></a>

### fabric.defineOpcode(name, [definition]) ⇒ <code>Object</code>
Register a single opcode entry in the service registry.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Opcode symbol (e.g. `OP_SHA256`, `P2P_FLUSH_CHAIN`) |
| [definition] | <code>Object</code> |  |

<a name="Service+defineBitcoinOpcode"></a>

### fabric.defineBitcoinOpcode(name, [definition]) ⇒ <code>Object</code>
Register Bitcoin-style primitive opcode metadata.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineFabricOpcode"></a>

### fabric.defineFabricOpcode(name, [definition]) ⇒ <code>Object</code>
Register Fabric opcode metadata.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineOpcodeContract"></a>

### fabric.defineOpcodeContract(name, body, [meta]) ⇒ <code>Object</code>
Register a newline-delimited opcode contract.
Contract body example:
`OP_DUP\nOP_HASH160\nP2P_FLUSH_CHAIN`

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Contract label |
| body | <code>string</code> | Newline-delimited opcode list |
| [meta] | <code>Object</code> |  |

<a name="Service+listOpcodes"></a>

### fabric.listOpcodes() ⇒ <code>Array.&lt;Object&gt;</code>
Snapshot opcode registry for UI / API use.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Service+route"></a>

### fabric.route(msg) ⇒ <code>Promise</code>
Resolve a [State](#State) from a particular [Message](#Message) object.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Promise</code> - Resolves with resulting [State](#State).  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | Explicit Fabric [Message](#Message). |

<a name="Service+start"></a>

### fabric.start()
Start the service, including the initiation of an outbound connection
to any peers designated in the service's configuration.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Service+_GET"></a>

### fabric.\_GET(path) ⇒ <code>Promise</code>
Retrieve a value from the Service's state.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Overrides**: [<code>\_GET</code>](#Service+_GET)  
**Returns**: <code>Promise</code> - Resolves with the result.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path of the value to retrieve. |

<a name="Service+_PUT"></a>

### fabric.\_PUT(path, value, [commit]) ⇒ <code>Promise</code>
Store a value in the Service's state.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Overrides**: [<code>\_PUT</code>](#Service+_PUT)  
**Returns**: <code>Promise</code> - Resolves with with stored document.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>String</code> |  | Path to store the value at. |
| value | <code>Object</code> |  | Document to store. |
| [commit] | <code>Boolean</code> | <code>false</code> | Sign the resulting state. |

<a name="Service+connect"></a>

### fabric.connect(notify) ⇒ <code>Promise</code>
Attach to network.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Promise</code> - Resolves to [Fabric](#Fabric).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| notify | <code>Boolean</code> | <code>true</code> | Commit to changes. |

<a name="Service+send"></a>

### fabric.send(channel, message) ⇒ [<code>Service</code>](#Service)
Send a message to a channel.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Overrides**: [<code>send</code>](#Service+send)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| channel | <code>String</code> | Channel name to which the message will be sent. |
| message | <code>String</code> | Content of the message to send. |

<a name="Service+commit"></a>

### fabric.commit() ⇒ <code>String</code>
Record outstanding JSON Patch deltas and emit a compact commitment id.
Does **not** wrap [Service#state](Service#state) in a new [Actor](#Actor) — that
JSON-cloned the entire tree on every write/connect and OOMed Hub.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>String</code> - 32-byte commitment id  
<a name="Service+_registerActor"></a>

### fabric.\_registerActor(actor) ⇒ <code>Promise</code>
Register an [Actor](#Actor) with the [Service](#Service).

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Promise</code> - Resolves upon successful registration.  

| Param | Type | Description |
| --- | --- | --- |
| actor | <code>Object</code> | Instance of the [Actor](#Actor). |

<a name="Service+_send"></a>

### fabric.\_send(message)
Sends a message.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Mixed</code> | Message to send. |

<a name="Actor+adopt"></a>

### fabric.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+export"></a>

### fabric.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### fabric.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### fabric.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Actor+toGenericMessage"></a>

### fabric.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### fabric.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Actor+pause"></a>

### fabric.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### fabric.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Actor+sign"></a>

### fabric.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
<a name="Actor+unpause"></a>

### fabric.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### fabric.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### fabric.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Fabric.Scribe"></a>

### ~~Fabric.Scribe~~
***Use [State](#State). Alias for backward compatibility.***

**Kind**: static property of [<code>Fabric</code>](#Fabric)  
<a name="Fabric.Vector"></a>

### Fabric.Vector ⇒ <code>function</code>
EventEmitter-only instruction handle; use [State](#State) / [Machine](#Machine) for signed payloads.

**Kind**: static property of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>function</code> - The [module:types/vector~Vector](module:types/vector~Vector) constructor.  
<a name="Fabric.Federation"></a>

### Fabric.Federation ⇒ <code>function</code>
**Kind**: static property of [<code>Fabric</code>](#Fabric)  
<a name="Fabric.DistributedExecution"></a>

### ~~Fabric.DistributedExecution ⇒ <code>object</code>~~
***Not a Fabric type. Use [Machine](#Machine), [Program](#Program),
`functions/beaconFederationSigning`, and `functions/fabricCanonicalJson`.***

**Kind**: static property of [<code>Fabric</code>](#Fabric)  
<a name="Federation"></a>

## Federation
Create and manage sets of {Signer} instances with the Federation class.

**Kind**: global class  

* [Federation](#Federation)
    * [new Federation([settings])](#new_Federation_new)
    * [.signatureScheme](#Federation+signatureScheme) ⇒ <code>&#x27;schnorr&#x27;</code> \| <code>&#x27;bls&#x27;</code>
    * [.start()](#Federation+start) ⇒ [<code>Federation</code>](#Federation)
    * [.sign(msg, [pubkey])](#Federation+sign) ⇒ <code>Buffer</code>
    * [.verify(msg, sig)](#Federation+verify) ⇒ <code>Boolean</code>
    * [.createMultiSignature(msg)](#Federation+createMultiSignature) ⇒ <code>Object</code>
    * [.verifyMultiSignature(multiSig, threshold)](#Federation+verifyMultiSignature) ⇒ <code>Boolean</code>
    * [._taprootPolicyInputs([overrides])](#Federation+_taprootPolicyInputs) ⇒ <code>object</code>

<a name="new_Federation_new"></a>

### new Federation([settings])
Create an instance of a federation.

**Returns**: [<code>Federation</code>](#Federation) - Instance of the federation.  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Settings. |

<a name="Federation+signatureScheme"></a>

### federation.signatureScheme ⇒ <code>&#x27;schnorr&#x27;</code> \| <code>&#x27;bls&#x27;</code>
Witness scheme for this federation. Bitcoin vault spends stay BIP340.

**Kind**: instance property of [<code>Federation</code>](#Federation)  
<a name="Federation+start"></a>

### federation.start() ⇒ [<code>Federation</code>](#Federation)
Start tracking state (i.e., ready to receive events).

**Kind**: instance method of [<code>Federation</code>](#Federation)  
**Returns**: [<code>Federation</code>](#Federation) - Instance of the Federation.  
<a name="Federation+sign"></a>

### federation.sign(msg, [pubkey]) ⇒ <code>Buffer</code>
Signs a message using the federation's key.

**Kind**: instance method of [<code>Federation</code>](#Federation)  
**Returns**: <code>Buffer</code> - The signature  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>Buffer</code> \| <code>String</code> \| [<code>Message</code>](#Message) | The message to sign |
| [pubkey] | <code>String</code> | Optional public key of the member to sign with |

<a name="Federation+verify"></a>

### federation.verify(msg, sig) ⇒ <code>Boolean</code>
Verifies a signature against a message.

**Kind**: instance method of [<code>Federation</code>](#Federation)  
**Returns**: <code>Boolean</code> - Whether the signature is valid  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>Buffer</code> \| <code>String</code> \| [<code>Message</code>](#Message) | The message that was signed |
| sig | <code>Buffer</code> | The signature to verify |

<a name="Federation+createMultiSignature"></a>

### federation.createMultiSignature(msg) ⇒ <code>Object</code>
Creates a multi-signature for a message.

**Kind**: instance method of [<code>Federation</code>](#Federation)  
**Returns**: <code>Object</code> - The multi-signature object containing signatures from all validators  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>Buffer</code> \| <code>String</code> \| [<code>Message</code>](#Message) | The message to sign |

<a name="Federation+verifyMultiSignature"></a>

### federation.verifyMultiSignature(multiSig, threshold) ⇒ <code>Boolean</code>
Verifies a multi-signature against a message.

**Kind**: instance method of [<code>Federation</code>](#Federation)  
**Returns**: <code>Boolean</code> - Whether the multi-signature is valid  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| multiSig | <code>Object</code> |  | The multi-signature object |
| threshold | <code>Number</code> | <code>1</code> | Number of valid signatures required |

<a name="Federation+_taprootPolicyInputs"></a>

### federation.\_taprootPolicyInputs([overrides]) ⇒ <code>object</code>
Federation validators live on consensus state, not only constructor settings.

**Kind**: instance method of [<code>Federation</code>](#Federation)  

| Param | Type |
| --- | --- |
| [overrides] | <code>object</code> | 

<a name="Filesystem"></a>

## Filesystem
Interact with a local filesystem.

**Kind**: global class  

* [Filesystem](#Filesystem)
    * [new Filesystem([settings])](#new_Filesystem_new)
    * [.ls()](#Filesystem+ls) ⇒ <code>Array</code>
    * [.readFile(name)](#Filesystem+readFile) ⇒ <code>Buffer</code>
    * [.writeFile(name, content)](#Filesystem+writeFile) ⇒ <code>Boolean</code>
    * [._loadFromDisk()](#Filesystem+_loadFromDisk) ⇒ <code>Promise</code>
    * [._notePublishedName(name)](#Filesystem+_notePublishedName) ⇒ <code>void</code>
    * [.synchronize()](#Filesystem+synchronize) ⇒ [<code>Filesystem</code>](#Filesystem)
    * [.sync()](#Filesystem+sync) ⇒ <code>Promise</code>

<a name="new_Filesystem_new"></a>

### new Filesystem([settings])
Synchronize an [Actor](#Actor) with a local filesystem.

**Returns**: [<code>Filesystem</code>](#Filesystem) - Instance of the Fabric filesystem.  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Configuration for the Fabric filesystem. |
| [settings.path] | <code>Object</code> | Path of the local filesystem. |
| [settings.key] | <code>Object</code> | Signing key for the filesystem. |

<a name="Filesystem+ls"></a>

### filesystem.ls() ⇒ <code>Array</code>
Get the list of files.

**Kind**: instance method of [<code>Filesystem</code>](#Filesystem)  
**Returns**: <code>Array</code> - List of files.  
<a name="Filesystem+readFile"></a>

### filesystem.readFile(name) ⇒ <code>Buffer</code>
Read a file by name.

**Kind**: instance method of [<code>Filesystem</code>](#Filesystem)  
**Returns**: <code>Buffer</code> - Contents of the file.  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | Name of the file to read. |

<a name="Filesystem+writeFile"></a>

### filesystem.writeFile(name, content) ⇒ <code>Boolean</code>
Write a file by name.

**Kind**: instance method of [<code>Filesystem</code>](#Filesystem)  
**Returns**: <code>Boolean</code> - `true` if the write succeeded, `false` if it did not.  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | Name of the file to write. |
| content | <code>Buffer</code> | Content of the file. |

<a name="Filesystem+_loadFromDisk"></a>

### filesystem.\_loadFromDisk() ⇒ <code>Promise</code>
Load Filesystem state from disk.

**Kind**: instance method of [<code>Filesystem</code>](#Filesystem)  
**Returns**: <code>Promise</code> - Resolves with Filesystem instance.  
<a name="Filesystem+_notePublishedName"></a>

### filesystem.\_notePublishedName(name) ⇒ <code>void</code>
Remember a published path in the top-level file list without re-reading the tree.
Nested paths only add the first segment (same as `readdir` of `this.path`).

**Kind**: instance method of [<code>Filesystem</code>](#Filesystem)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 

<a name="Filesystem+synchronize"></a>

### filesystem.synchronize() ⇒ [<code>Filesystem</code>](#Filesystem)
Synchronize state from the local filesystem.

**Kind**: instance method of [<code>Filesystem</code>](#Filesystem)  
**Returns**: [<code>Filesystem</code>](#Filesystem) - Instance of the Fabric filesystem.  
<a name="Filesystem+sync"></a>

### filesystem.sync() ⇒ <code>Promise</code>
Synchronize the filesystem with the local state.

**Kind**: instance method of [<code>Filesystem</code>](#Filesystem)  
**Returns**: <code>Promise</code> - Resolves with Filesystem instance.  
<a name="Hash256"></a>

## Hash256
Simple interaction with 256-bit spaces.

**Kind**: global class  

* [Hash256](#Hash256)
    * [new Hash256(settings)](#new_Hash256_new)
    * [.doubleDigest(input)](#Hash256.doubleDigest) ⇒ <code>String</code>
    * [.digest(input)](#Hash256.digest) ⇒ <code>String</code>
    * [.reverse()](#Hash256.reverse)

<a name="new_Hash256_new"></a>

### new Hash256(settings)
Create an instance of a `Hash256` object by calling `new Hash256()`,
where `settings` can be provided to supply a particular input object.

If the `settings` is not a string, `input` must be provided.


| Param | Type | Description |
| --- | --- | --- |
| settings | <code>Object</code> |  |
| settings.input | <code>String</code> | Input string to map as 256-bit hash. |

<a name="Hash256.doubleDigest"></a>

### Hash256.doubleDigest(input) ⇒ <code>String</code>
Double-SHA256 digest (Bitcoin-style). Matches C message body hash.

**Kind**: static method of [<code>Hash256</code>](#Hash256)  
**Returns**: <code>String</code> - SHA256(SHA256(input)) as hexadecimal string.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> \| <code>Buffer</code> | Content to digest. |

<a name="Hash256.digest"></a>

### Hash256.digest(input) ⇒ <code>String</code>
Produce a SHA256 digest of some input data.

**Kind**: static method of [<code>Hash256</code>](#Hash256)  
**Returns**: <code>String</code> - `SHA256(input)` as a hexadecimal string.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> \| <code>Buffer</code> | Content to digest. |

<a name="Hash256.reverse"></a>

### Hash256.reverse()
Reverses the bytes of the digest.

**Kind**: static method of [<code>Hash256</code>](#Hash256)  
<a name="HKDF"></a>

## HKDF
Provides an HMAC-based Extract-and-Expand Key Derivation Function (HKDF), compatible with
RFC 5869.  Defaults to 32 byte output, matching Bitcoin's implementaton.

**Kind**: global class  

* [HKDF](#HKDF)
    * [new HKDF(settings)](#new_HKDF_new)
    * [.derive([info], [size])](#HKDF+derive)

<a name="new_HKDF_new"></a>

### new HKDF(settings)
Create an HKDF instance.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| settings | <code>Object</code> |  | List of settings. |
| settings.initial | <code>String</code> |  | Input keying material. |
| [settings.algorithm] | <code>String</code> | <code>sha256</code> | Name of the hashing algorithm to use. |
| [settings.salt] | <code>String</code> |  | Salt value (a non-secret random value). |

<a name="HKDF+derive"></a>

### hkdF.derive([info], [size])
Derive a new output.

**Kind**: instance method of [<code>HKDF</code>](#HKDF)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [info] | <code>Buffer</code> |  | Context and application specific information. |
| [size] | <code>Number</code> | <code>32</code> | Length of output. |

<a name="Identity"></a>

## Identity ⇐ [<code>Actor</code>](#Actor)
<strong>BIP32/BIP39 identity</strong> wrapping [Key](#Key): mnemonic / xprv / passphrase.
Protocol identity (pubkey / Schnorr sign / Bech32 id) uses the Fabric derivation path
<code>m/44'/{7777|7778}'/account'/0/index</code> — coin type <strong>7777</strong> on Bitcoin
mainnet, <strong>7778</strong> on all other networks (see [Identity#derivation](Identity#derivation) and
IDENTITY.md). The HD <strong>master</strong> remains available as [master](#Identity+master) /
[Identity#key](Identity#key) so Bitcoin funds can derive under BIP44 coin type <code>0</code> (see
<code>BITCOIN_KEY_DERIVATION_PATH</code> in <code>constants.js</code>
/ Wallet) without mixing protocol identity keys with spend keys.
<strong>Important:</strong> this class overrides [Actor#id](Actor#id) with <code>toString()</code>
(human-facing / Bech32-style identity), <strong>not</strong> the content-addressed
<code>Actor#id</code> / <code>preimage</code> chain from [toGenericMessage](#Actor+toGenericMessage). Use
<code>pubkey</code>, <code>pubkeyhash</code>, or explicit hashing when you need stable bytes.

**Kind**: global class  
**Extends**: [<code>Actor</code>](#Actor)  

* [Identity](#Identity) ⇐ [<code>Actor</code>](#Actor)
    * [new Identity([settings])](#new_Identity_new)
    * [.master](#Identity+master)
    * [.fabricKey](#Identity+fabricKey) ⇒ [<code>Key</code>](#Key)
    * [.toString()](#Identity+toString) ⇒ <code>String</code>
    * [._verifyKeyIsChild(key, [parent], [path])](#Identity+_verifyKeyIsChild) ⇒ <code>boolean</code>
    * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
    * [.commit()](#Actor+commit) ⇒ <code>String</code>
    * [.export()](#Actor+export) ⇒ <code>Object</code>
    * [.get(path)](#Actor+get) ⇒ <code>Object</code>
    * [.set(path, value)](#Actor+set) ⇒ <code>Object</code>
    * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
    * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
    * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
    * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
    * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
    * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
    * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
    * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
    * [.value([format])](#Actor+value) ⇒ <code>Object</code>
    * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>

<a name="new_Identity_new"></a>

### new Identity([settings])
Create an instance of an Identity.

**Returns**: [<code>Identity</code>](#Identity) - Instance of the identity.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  | Settings for the Identity. |
| [settings.seed] | <code>String</code> |  | Raw BIP32 seed hex, or a legacy BIP39 mnemonic. |
| [settings.mnemonic] | <code>String</code> |  | BIP39 mnemonic (preferred over putting words in `seed`). |
| [settings.xprv] | <code>String</code> |  | Serialized BIP 32 master private key. |
| [settings.xpub] | <code>String</code> |  | Serialized BIP 32 master public key. |
| [settings.account] | <code>Number</code> | <code>0</code> | BIP 44 account index (Fabric coin type 7777/7778). |
| [settings.index] | <code>Number</code> | <code>0</code> | BIP 44 address index. |
| [settings.network] | <code>String</code> | <code>regtest</code> | Bitcoin network name; selects Fabric coin type   (`mainnet` → 7777, otherwise → 7778). |
| [settings.passphrase] | <code>String</code> |  | Passphrase for the key. |

<a name="Identity+master"></a>

### identity.master
HD master key — use for Bitcoin BIP44 coin-type-0 fund derivation only.

**Kind**: instance property of [<code>Identity</code>](#Identity)  
<a name="Identity+fabricKey"></a>

### identity.fabricKey ⇒ [<code>Key</code>](#Key)
Fabric-protocol signing key at [Identity#derivation](Identity#derivation).
When this.key is already a protocol account/signing node (or public-only),
derivation may be impossible — use the key as-is.

**Kind**: instance property of [<code>Identity</code>](#Identity)  
<a name="Identity+toString"></a>

### identity.toString() ⇒ <code>String</code>
Retrieve the bech32m-encoded identity.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>String</code> - Public identity.  
<a name="Identity+_verifyKeyIsChild"></a>

### identity.\_verifyKeyIsChild(key, [parent], [path]) ⇒ <code>boolean</code>
True when `key` matches the BIP32 child of `parent` at this identity's
Fabric derivation path (or an explicit `path`).

**Kind**: instance method of [<code>Identity</code>](#Identity)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| key | [<code>Key</code>](#Key) \| <code>string</code> \| <code>Object</code> |  | Candidate key or pubkey hex. |
| [parent] | [<code>Key</code>](#Key) | <code>this.master</code> | Parent HD key. |
| [path] | <code>string</code> | <code>null</code> | Override derivation path (default [Identity#derivation](Identity#derivation)). |

<a name="Actor+adopt"></a>

### identity.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### identity.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+export"></a>

### identity.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+get"></a>

### identity.get(path) ⇒ <code>Object</code>
Retrieve a value from the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to retrieve using [JSONPointer](JSONPointer). |

<a name="Actor+set"></a>

### identity.set(path, value) ⇒ <code>Object</code>
Set a value in the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to set using [JSONPointer](JSONPointer). |
| value | <code>Object</code> | Value to set. |

<a name="Actor+stream"></a>

### identity.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### identity.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
<a name="Actor+toGenericMessage"></a>

### identity.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### identity.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Identity</code>](#Identity)  
<a name="Actor+pause"></a>

### identity.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### identity.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
<a name="Actor+sign"></a>

### identity.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Overrides**: [<code>sign</code>](#Actor+sign)  
<a name="Actor+unpause"></a>

### identity.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### identity.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### identity.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Identity"></a>

## Identity
**Kind**: global class  

* [Identity](#Identity)
    * [new Identity([settings])](#new_Identity_new)
    * [.master](#Identity+master)
    * [.fabricKey](#Identity+fabricKey) ⇒ [<code>Key</code>](#Key)
    * [.toString()](#Identity+toString) ⇒ <code>String</code>
    * [._verifyKeyIsChild(key, [parent], [path])](#Identity+_verifyKeyIsChild) ⇒ <code>boolean</code>
    * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
    * [.commit()](#Actor+commit) ⇒ <code>String</code>
    * [.export()](#Actor+export) ⇒ <code>Object</code>
    * [.get(path)](#Actor+get) ⇒ <code>Object</code>
    * [.set(path, value)](#Actor+set) ⇒ <code>Object</code>
    * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
    * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
    * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
    * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
    * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
    * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
    * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
    * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
    * [.value([format])](#Actor+value) ⇒ <code>Object</code>
    * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>

<a name="new_Identity_new"></a>

### new Identity([settings])
Create an instance of an Identity.

**Returns**: [<code>Identity</code>](#Identity) - Instance of the identity.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  | Settings for the Identity. |
| [settings.seed] | <code>String</code> |  | Raw BIP32 seed hex, or a legacy BIP39 mnemonic. |
| [settings.mnemonic] | <code>String</code> |  | BIP39 mnemonic (preferred over putting words in `seed`). |
| [settings.xprv] | <code>String</code> |  | Serialized BIP 32 master private key. |
| [settings.xpub] | <code>String</code> |  | Serialized BIP 32 master public key. |
| [settings.account] | <code>Number</code> | <code>0</code> | BIP 44 account index (Fabric coin type 7777/7778). |
| [settings.index] | <code>Number</code> | <code>0</code> | BIP 44 address index. |
| [settings.network] | <code>String</code> | <code>regtest</code> | Bitcoin network name; selects Fabric coin type   (`mainnet` → 7777, otherwise → 7778). |
| [settings.passphrase] | <code>String</code> |  | Passphrase for the key. |

<a name="Identity+master"></a>

### identity.master
HD master key — use for Bitcoin BIP44 coin-type-0 fund derivation only.

**Kind**: instance property of [<code>Identity</code>](#Identity)  
<a name="Identity+fabricKey"></a>

### identity.fabricKey ⇒ [<code>Key</code>](#Key)
Fabric-protocol signing key at [Identity#derivation](Identity#derivation).
When this.key is already a protocol account/signing node (or public-only),
derivation may be impossible — use the key as-is.

**Kind**: instance property of [<code>Identity</code>](#Identity)  
<a name="Identity+toString"></a>

### identity.toString() ⇒ <code>String</code>
Retrieve the bech32m-encoded identity.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>String</code> - Public identity.  
<a name="Identity+_verifyKeyIsChild"></a>

### identity.\_verifyKeyIsChild(key, [parent], [path]) ⇒ <code>boolean</code>
True when `key` matches the BIP32 child of `parent` at this identity's
Fabric derivation path (or an explicit `path`).

**Kind**: instance method of [<code>Identity</code>](#Identity)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| key | [<code>Key</code>](#Key) \| <code>string</code> \| <code>Object</code> |  | Candidate key or pubkey hex. |
| [parent] | [<code>Key</code>](#Key) | <code>this.master</code> | Parent HD key. |
| [path] | <code>string</code> | <code>null</code> | Override derivation path (default [Identity#derivation](Identity#derivation)). |

<a name="Actor+adopt"></a>

### identity.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### identity.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+export"></a>

### identity.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+get"></a>

### identity.get(path) ⇒ <code>Object</code>
Retrieve a value from the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to retrieve using [JSONPointer](JSONPointer). |

<a name="Actor+set"></a>

### identity.set(path, value) ⇒ <code>Object</code>
Set a value in the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to set using [JSONPointer](JSONPointer). |
| value | <code>Object</code> | Value to set. |

<a name="Actor+stream"></a>

### identity.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### identity.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
<a name="Actor+toGenericMessage"></a>

### identity.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### identity.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Identity</code>](#Identity)  
<a name="Actor+pause"></a>

### identity.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### identity.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
<a name="Actor+sign"></a>

### identity.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Overrides**: [<code>sign</code>](#Actor+sign)  
<a name="Actor+unpause"></a>

### identity.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### identity.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### identity.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Interface"></a>

## Interface ⇐ <code>EventEmitter</code>
Interfaces compile abstract contract code into [Chain](#Chain)-executable transactions, or "chaincode". For example, the "Bitcoin" interface might compile a Swap contract into Script, preparing a valid Bitcoin transaction for broadcast which executes the swap contract.

**Kind**: global class  
**Extends**: <code>EventEmitter</code>  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| status | <code>String</code> | Human-friendly value representing the Interface's current [State](#State). |


* [Interface](#Interface) ⇐ <code>EventEmitter</code>
    * [new Interface(settings)](#new_Interface_new)
    * [.log(...inputs)](#Interface+log)
    * [.now()](#Interface+now) ⇒ <code>Number</code>
    * [.start()](#Interface+start)
    * [.stop()](#Interface+stop)
    * [.cycle(val)](#Interface+cycle)

<a name="new_Interface_new"></a>

### new Interface(settings)
Define an [Interface](#Interface) by creating an instance of this class.

**Returns**: [<code>Interface</code>](#Interface) - Instance of the [Interface](#Interface).  

| Param | Type | Description |
| --- | --- | --- |
| settings | <code>Object</code> | Configuration values. |

<a name="Interface+log"></a>

### interface.log(...inputs)
Log some output to the console.

**Kind**: instance method of [<code>Interface</code>](#Interface)  

| Param | Type | Description |
| --- | --- | --- |
| ...inputs | <code>any</code> | Components of the message to long.  Can be a single {@link} String, many [String](String) objects, or anything else. |

<a name="Interface+now"></a>

### interface.now() ⇒ <code>Number</code>
Returns current timestamp.

**Kind**: instance method of [<code>Interface</code>](#Interface)  
<a name="Interface+start"></a>

### interface.start()
Start the [Interface](#Interface).

**Kind**: instance method of [<code>Interface</code>](#Interface)  
<a name="Interface+stop"></a>

### interface.stop()
Stop the Interface.

**Kind**: instance method of [<code>Interface</code>](#Interface)  
<a name="Interface+cycle"></a>

### interface.cycle(val)
Ticks the clock with a named [Cycle](Cycle).

**Kind**: instance method of [<code>Interface</code>](#Interface)  

| Param | Type | Description |
| --- | --- | --- |
| val | <code>String</code> | Name of cycle to scribe. |

<a name="Key"></a>

## Key
Represents a cryptographic key.

**Kind**: global class  

* [Key](#Key)
    * [new Key([settings])](#new_Key_new)
    * _instance_
        * ~~[.iv](#Key+iv)~~
        * [.verify(msg, sig)](#Key+verify) ⇒ <code>Boolean</code>
        * [.signSchnorr(msg)](#Key+signSchnorr) ⇒ <code>Buffer</code>
        * [.signSchnorrHash(messageHash)](#Key+signSchnorrHash) ⇒ <code>Buffer</code>
        * [.verifySchnorr(msg, sig)](#Key+verifySchnorr) ⇒ <code>Boolean</code>
        * [.verifySchnorrHash(messageHash, sig)](#Key+verifySchnorrHash) ⇒ <code>Boolean</code>
        * [.sign(data)](#Key+sign) ⇒ <code>Buffer</code>
        * [.secure()](#Key+secure)
        * [.toWIF()](#Key+toWIF) ⇒ <code>String</code>
    * _static_
        * [.fromWIF(wif, [options])](#Key.fromWIF) ⇒ [<code>Key</code>](#Key)

<a name="new_Key_new"></a>

### new Key([settings])
Create an instance of a Fabric Key, either restoring from some known
values or from prior knowledge.  For instance, you can call `new Key()`
to create a fresh keypair, or `new Key({ public: 'deadbeef...' })` to
create it from a known public key.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  | Initialization for the key. |
| [settings.network] | <code>String</code> |  | Network string. |
| [settings.seed] | <code>String</code> |  | Raw BIP32 seed hex (16–64 bytes) or a legacy BIP39 mnemonic. |
| [settings.mnemonic] | <code>String</code> |  | BIP39 mnemonic (preferred over putting words in `seed`). |
| [settings.public] | <code>String</code> |  | Public key in hex. |
| [settings.private] | <code>String</code> |  | Private key in hex. |
| [settings.wif] | <code>String</code> |  | WIF-encoded private key. |
| [settings.purpose] | <code>String</code> | <code>44</code> | Constrains derivations to this space. |

<a name="Key+iv"></a>

### ~~key.iv~~
***Per-message IVs are generated in [Key#encrypt](Key#encrypt). Do not rely on this getter.***

**Kind**: instance property of [<code>Key</code>](#Key)  
<a name="Key+verify"></a>

### key.verify(msg, sig) ⇒ <code>Boolean</code>
Verify a message's signature.

**Kind**: instance method of [<code>Key</code>](#Key)  
**Returns**: <code>Boolean</code> - Whether the signature is valid  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>Buffer</code> \| <code>String</code> | The message that was signed |
| sig | <code>Buffer</code> \| <code>String</code> | The signature to verify |

<a name="Key+signSchnorr"></a>

### key.signSchnorr(msg) ⇒ <code>Buffer</code>
Signs a message using Schnorr signatures (BIP340).

**Kind**: instance method of [<code>Key</code>](#Key)  
**Returns**: <code>Buffer</code> - The signature  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>Buffer</code> \| <code>String</code> | The message to sign |

<a name="Key+signSchnorrHash"></a>

### key.signSchnorrHash(messageHash) ⇒ <code>Buffer</code>
Signs a pre-computed hash using Schnorr signatures (BIP340).
This is useful when the message has already been hashed (e.g., with a tagged hash).

**Kind**: instance method of [<code>Key</code>](#Key)  
**Returns**: <code>Buffer</code> - The signature (64 bytes)  

| Param | Type | Description |
| --- | --- | --- |
| messageHash | <code>Buffer</code> | The pre-computed message hash (32 bytes) |

<a name="Key+verifySchnorr"></a>

### key.verifySchnorr(msg, sig) ⇒ <code>Boolean</code>
Verifies a Schnorr signature (BIP340).

**Kind**: instance method of [<code>Key</code>](#Key)  
**Returns**: <code>Boolean</code> - Whether the signature is valid  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>Buffer</code> \| <code>String</code> | The message that was signed |
| sig | <code>Buffer</code> | The signature to verify |

<a name="Key+verifySchnorrHash"></a>

### key.verifySchnorrHash(messageHash, sig) ⇒ <code>Boolean</code>
Verifies a Schnorr signature with a pre-computed hash (BIP340).
This is useful when the message has already been hashed (e.g., with a tagged hash).

**Kind**: instance method of [<code>Key</code>](#Key)  
**Returns**: <code>Boolean</code> - Whether the signature is valid  

| Param | Type | Description |
| --- | --- | --- |
| messageHash | <code>Buffer</code> | The pre-computed message hash (32 bytes) |
| sig | <code>Buffer</code> | The signature to verify (64 bytes) |

<a name="Key+sign"></a>

### key.sign(data) ⇒ <code>Buffer</code>
Sign a buffer of data using BIP 340: https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki

**Kind**: instance method of [<code>Key</code>](#Key)  
**Returns**: <code>Buffer</code> - Resulting signature (64 bytes).  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>Buffer</code> | Buffer of data to sign. |

<a name="Key+secure"></a>

### key.secure()
Secures the key by clearing sensitive information from memory.
This method should be called when the key is no longer needed
to prevent sensitive data from remaining in memory.

**Kind**: instance method of [<code>Key</code>](#Key)  
<a name="Key+toWIF"></a>

### key.toWIF() ⇒ <code>String</code>
Exports the private key in Wallet Import Format (WIF)

**Kind**: instance method of [<code>Key</code>](#Key)  
**Returns**: <code>String</code> - The private key encoded in WIF format  
**Throws**:

- <code>Error</code> If the key doesn't have a private component

<a name="Key.fromWIF"></a>

### Key.fromWIF(wif, [options]) ⇒ [<code>Key</code>](#Key)
Create a Key instance from a WIF-encoded private key.

**Kind**: static method of [<code>Key</code>](#Key)  
**Returns**: [<code>Key</code>](#Key) - A new Key instance  

| Param | Type | Description |
| --- | --- | --- |
| wif | <code>String</code> | The WIF-encoded private key |
| [options] | <code>Object</code> | Additional options for key creation |

<a name="Ledger"></a>

## Ledger ⇐ [<code>State</code>](#State)
An ordered stack of pages.

**Kind**: global class  
**Extends**: [<code>State</code>](#State)  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| memory | <code>Buffer</code> | The ledger's memory (4096 bytes). |
| stack | <code>Stack</code> | The ledger's stack. |
| tip | <code>Mixed</code> | The most recent page in the ledger. |


* [Ledger](#Ledger) ⇐ [<code>State</code>](#State)
    * [.append(item)](#Ledger+append) ⇒ <code>Promise</code>
    * [.trust(source)](#State+trust) ⇒ [<code>State</code>](#State)
    * [.inherits(other)](#State+inherits) ⇒ <code>Number</code>
    * [.toHTML()](#State+toHTML)
    * [.toString()](#State+toString) ⇒ <code>String</code>
    * [.serialize([input])](#State+serialize) ⇒ <code>Buffer</code>
    * [.deserialize(input)](#State+deserialize) ⇒ [<code>State</code>](#State)
    * [.fork()](#State+fork) ⇒ [<code>State</code>](#State)
    * [.get(path)](#State+get) ⇒ <code>Mixed</code>
    * [.set(path)](#State+set) ⇒ <code>Mixed</code>
    * [.commit()](#State+commit)
    * [.render()](#State+render) ⇒ <code>String</code>
    * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
    * [.export()](#Actor+export) ⇒ <code>Object</code>
    * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
    * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
    * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
    * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
    * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
    * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
    * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
    * [.value([format])](#Actor+value) ⇒ <code>Object</code>
    * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>

<a name="Ledger+append"></a>

### ledger.append(item) ⇒ <code>Promise</code>
Attempts to append a [Page](Page) to the ledger.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Returns**: <code>Promise</code> - Resolves after the change has been committed.  

| Param | Type | Description |
| --- | --- | --- |
| item | <code>Mixed</code> | Item to store. |

<a name="State+trust"></a>

### ledger.trust(source) ⇒ [<code>State</code>](#State)
**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>trust</code>](#State+trust)  
**Returns**: [<code>State</code>](#State) - this  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Event stream. |

<a name="State+inherits"></a>

### ledger.inherits(other) ⇒ <code>Number</code>
**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>inherits</code>](#State+inherits)  
**Returns**: <code>Number</code> - New length of `settings.tags`.  

| Param | Type | Description |
| --- | --- | --- |
| other | [<code>State</code>](#State) | Peer [State](#State) whose `settings.namespace` is appended to `settings.tags`. |

<a name="State+toHTML"></a>

### ledger.toHTML()
Converts the State to an HTML document.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>toHTML</code>](#State+toHTML)  
<a name="State+toString"></a>

### ledger.toString() ⇒ <code>String</code>
Unmarshall an existing state to an instance of a [Blob](Blob).

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>toString</code>](#State+toString)  
**Returns**: <code>String</code> - Serialized [Blob](Blob).  
<a name="State+serialize"></a>

### ledger.serialize([input]) ⇒ <code>Buffer</code>
Convert to [Buffer](Buffer).

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>serialize</code>](#State+serialize)  
**Returns**: <code>Buffer</code> - [Store](#Store)-able blob.  

| Param | Type | Description |
| --- | --- | --- |
| [input] | <code>Mixed</code> | Input to serialize. |

<a name="State+deserialize"></a>

### ledger.deserialize(input) ⇒ [<code>State</code>](#State)
Take a hex-encoded input and convert to a [State](#State) object.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>deserialize</code>](#State+deserialize)  
**Returns**: [<code>State</code>](#State) - [description]  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | [description] |

<a name="State+fork"></a>

### ledger.fork() ⇒ [<code>State</code>](#State)
Creates a new child [State](#State), with `@parent` set to
the current [State](#State) by immutable identifier.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>fork</code>](#State+fork)  
<a name="State+get"></a>

### ledger.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>get</code>](#State+get)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="State+set"></a>

### ledger.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>set</code>](#State+set)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="State+commit"></a>

### ledger.commit()
Increment the vector clock, broadcast all changes as a transaction.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>commit</code>](#State+commit)  
<a name="State+render"></a>

### ledger.render() ⇒ <code>String</code>
Compose a JSON string for network consumption.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>render</code>](#State+render)  
**Returns**: <code>String</code> - JSON-encoded [String](String).  
<a name="Actor+adopt"></a>

### ledger.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>adopt</code>](#Actor+adopt)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+export"></a>

### ledger.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>export</code>](#Actor+export)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### ledger.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>stream</code>](#Actor+stream)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### ledger.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>toBuffer</code>](#Actor+toBuffer)  
<a name="Actor+toGenericMessage"></a>

### ledger.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>toGenericMessage</code>](#Actor+toGenericMessage)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### ledger.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>toObject</code>](#Actor+toObject)  
<a name="Actor+pause"></a>

### ledger.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>pause</code>](#Actor+pause)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+sign"></a>

### ledger.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>sign</code>](#Actor+sign)  
<a name="Actor+unpause"></a>

### ledger.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>unpause</code>](#Actor+unpause)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### ledger.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>value</code>](#Actor+value)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### ledger.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>\_readObject</code>](#Actor+_readObject)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="LiquidityBook"></a>

## LiquidityBook
**Kind**: global class  

* [LiquidityBook](#LiquidityBook)
    * [new LiquidityBook([settings])](#new_LiquidityBook_new)
    * [.size](#LiquidityBook+size) ⇒ <code>number</code>
    * [.ingestOrder(body)](#LiquidityBook+ingestOrder) ⇒ <code>Object</code>
    * [.cancel(body)](#LiquidityBook+cancel) ⇒ <code>Object</code>
    * [.prune()](#LiquidityBook+prune) ⇒ <code>number</code>
    * [.forgetMaker(makerPubkey)](#LiquidityBook+forgetMaker) ⇒ <code>number</code>
    * [.get(id)](#LiquidityBook+get) ⇒ <code>Object</code> \| <code>null</code>
    * [.listOrders([filter])](#LiquidityBook+listOrders) ⇒ <code>Array.&lt;Object&gt;</code>
    * [.bestBid()](#LiquidityBook+bestBid) ⇒ <code>Object</code> \| <code>null</code>
    * [.bestAsk()](#LiquidityBook+bestAsk) ⇒ <code>Object</code> \| <code>null</code>
    * [.depth(side)](#LiquidityBook+depth) ⇒ <code>Array.&lt;Object&gt;</code>
    * [.index()](#LiquidityBook+index) ⇒ <code>Object</code>
    * [.fill(side, amountSats, [opts])](#LiquidityBook+fill) ⇒ <code>Object</code>

<a name="new_LiquidityBook_new"></a>

### new LiquidityBook([settings])

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  |  |
| [settings.network] | <code>string</code> | <code>&quot;&#x27;regtest&#x27;&quot;</code> | only orders for this network are held |
| [settings.maxOrders] | <code>number</code> | <code>10000</code> |  |
| [settings.maxCancelled] | <code>number</code> | <code>10000</code> |  |
| [settings.maxPendingCancelsPerMaker] | <code>number</code> | <code>100</code> | cancels per key for orders not held |
| [settings.now] | <code>function</code> |  | clock in ms (tests) |

<a name="LiquidityBook+size"></a>

### liquidityBook.size ⇒ <code>number</code>
**Kind**: instance property of [<code>LiquidityBook</code>](#LiquidityBook)  
**Returns**: <code>number</code> - orders held  
<a name="LiquidityBook+ingestOrder"></a>

### liquidityBook.ingestOrder(body) ⇒ <code>Object</code>
Verify and hold a signed `LiquidityOrder` body.

**Kind**: instance method of [<code>LiquidityBook</code>](#LiquidityBook)  

| Param | Type |
| --- | --- |
| body | <code>Object</code> | 

<a name="LiquidityBook+cancel"></a>

### liquidityBook.cancel(body) ⇒ <code>Object</code>
Apply a signed `LiquidityOrderCancel` from the order's maker. A cancel
for an order not held yet is remembered with its signer, so the order
cannot arrive later from that maker; another key's cancel never blocks it.

**Kind**: instance method of [<code>LiquidityBook</code>](#LiquidityBook)  

| Param | Type |
| --- | --- |
| body | <code>Object</code> | 

<a name="LiquidityBook+prune"></a>

### liquidityBook.prune() ⇒ <code>number</code>
Drop expired orders.

**Kind**: instance method of [<code>LiquidityBook</code>](#LiquidityBook)  
**Returns**: <code>number</code> - orders removed  
<a name="LiquidityBook+forgetMaker"></a>

### liquidityBook.forgetMaker(makerPubkey) ⇒ <code>number</code>
Drop every order from one maker (disconnect, fraud, failed settlement).

**Kind**: instance method of [<code>LiquidityBook</code>](#LiquidityBook)  
**Returns**: <code>number</code> - orders removed  

| Param | Type |
| --- | --- |
| makerPubkey | <code>string</code> | 

<a name="LiquidityBook+get"></a>

### liquidityBook.get(id) ⇒ <code>Object</code> \| <code>null</code>
**Kind**: instance method of [<code>LiquidityBook</code>](#LiquidityBook)  
**Returns**: <code>Object</code> \| <code>null</code> - the order body  

| Param | Type |
| --- | --- |
| id | <code>string</code> | 

<a name="LiquidityBook+listOrders"></a>

### liquidityBook.listOrders([filter]) ⇒ <code>Array.&lt;Object&gt;</code>
Live orders, best first within each side (bids by highest premium, asks
by lowest; ties by arrival).

**Kind**: instance method of [<code>LiquidityBook</code>](#LiquidityBook)  
**Returns**: <code>Array.&lt;Object&gt;</code> - `{ id, ...order }`  

| Param | Type |
| --- | --- |
| [filter] | <code>Object</code> | 
| [filter.side] | <code>string</code> | 
| [filter.makerPubkey] | <code>string</code> | 

<a name="LiquidityBook+bestBid"></a>

### liquidityBook.bestBid() ⇒ <code>Object</code> \| <code>null</code>
**Kind**: instance method of [<code>LiquidityBook</code>](#LiquidityBook)  
**Returns**: <code>Object</code> \| <code>null</code> - highest-premium live bid  
<a name="LiquidityBook+bestAsk"></a>

### liquidityBook.bestAsk() ⇒ <code>Object</code> \| <code>null</code>
**Kind**: instance method of [<code>LiquidityBook</code>](#LiquidityBook)  
**Returns**: <code>Object</code> \| <code>null</code> - lowest-premium live ask  
<a name="LiquidityBook+depth"></a>

### liquidityBook.depth(side) ⇒ <code>Array.&lt;Object&gt;</code>
Price levels for one side, best first.

**Kind**: instance method of [<code>LiquidityBook</code>](#LiquidityBook)  
**Returns**: <code>Array.&lt;Object&gt;</code> - `{ premiumPpm, sats, orders }` (`sats` sums `maxSats`)  

| Param | Type | Description |
| --- | --- | --- |
| side | <code>string</code> | `bid` or `ask` |

<a name="LiquidityBook+index"></a>

### liquidityBook.index() ⇒ <code>Object</code>
The market's view of L1 vs. L2 liquidity.

**Kind**: instance method of [<code>LiquidityBook</code>](#LiquidityBook)  
<a name="LiquidityBook+fill"></a>

### liquidityBook.fill(side, amountSats, [opts]) ⇒ <code>Object</code>
Walk one side of the book for `amountSats` of L1, best price first, then
earliest order. Each fill respects the order's `minSats` / `maxSats`; an
order whose minimum exceeds what is left, or whose fee leaves nothing to
pay on L2 for that amount, is skipped. Nothing is reserved — the taker
settles each fill with its maker.

**Kind**: instance method of [<code>LiquidityBook</code>](#LiquidityBook)  

| Param | Type | Description |
| --- | --- | --- |
| side | <code>string</code> | the side being taken: `ask` buys L1, `bid` sells it |
| amountSats | <code>number</code> |  |
| [opts] | <code>Object</code> |  |
| [opts.excludeMakers] | <code>Array.&lt;string&gt;</code> |  |
| [opts.limitPpm] | <code>number</code> | worst premium accepted (max for asks, min for bids) |

<a name="LiquiditySwap"></a>

## LiquiditySwap
**Kind**: global class  

* [LiquiditySwap](#LiquiditySwap)
    * [new LiquiditySwap(settings)](#new_LiquiditySwap_new)
    * _instance_
        * [.status](#LiquiditySwap+status) ⇒ <code>string</code>
        * [.isL1Giver](#LiquiditySwap+isL1Giver) ⇒ <code>boolean</code>
        * [.take](#LiquiditySwap+take) ⇒ <code>Object</code> \| <code>null</code>
        * [.takeId](#LiquiditySwap+takeId) ⇒ <code>string</code> \| <code>null</code>
        * [.accept](#LiquiditySwap+accept) ⇒ <code>Object</code> \| <code>null</code>
        * [.funded](#LiquiditySwap+funded) ⇒ <code>Object</code> \| <code>null</code>
        * [.quote](#LiquiditySwap+quote) ⇒ <code>Object</code> \| <code>null</code>
        * [.terms](#LiquiditySwap+terms) ⇒ <code>Object</code> \| <code>null</code>
        * [.escrow](#LiquiditySwap+escrow) ⇒ <code>Object</code> \| <code>null</code>
        * [.createTake(opts)](#LiquiditySwap+createTake) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.acceptTake(takeBody)](#LiquiditySwap+acceptTake) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.applyAccept(acceptBody)](#LiquiditySwap+applyAccept) ⇒ [<code>Promise.&lt;LiquiditySwap&gt;</code>](#LiquiditySwap)
        * [.prepay()](#LiquiditySwap+prepay) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.fund()](#LiquiditySwap+fund) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.applyFunded(fundedBody)](#LiquiditySwap+applyFunded) ⇒ <code>Promise.&lt;{ok: boolean, pending: (boolean\|undefined), confirmations: number}&gt;</code>
        * [.payInvoice()](#LiquiditySwap+payInvoice) ⇒ <code>Promise.&lt;string&gt;</code>
        * [.claim([opts])](#LiquiditySwap+claim) ⇒ <code>Promise.&lt;string&gt;</code>
        * [.checkPaid()](#LiquiditySwap+checkPaid) ⇒ <code>Promise.&lt;boolean&gt;</code>
        * [.observeClaim(txHex)](#LiquiditySwap+observeClaim) ⇒ <code>boolean</code>
        * [.refund([opts])](#LiquiditySwap+refund) ⇒ <code>Promise.&lt;string&gt;</code>
        * [.abort([reason])](#LiquiditySwap+abort)
        * [.toJSON([opts])](#LiquiditySwap+toJSON) ⇒ <code>Object</code>
    * _static_
        * [.fromJSON(json, settings)](#LiquiditySwap.fromJSON) ⇒ [<code>LiquiditySwap</code>](#LiquiditySwap)
        * [.lightningAdapter(lightning)](#LiquiditySwap.lightningAdapter) ⇒ <code>Object</code>
        * [.bitcoinAdapter(service, [options])](#LiquiditySwap.bitcoinAdapter) ⇒ <code>Object</code>

<a name="new_LiquiditySwap_new"></a>

### new LiquiditySwap(settings)

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| settings | <code>Object</code> |  |  |
| settings.order | <code>Object</code> |  | signed `LiquidityOrder` body |
| settings.role | <code>string</code> |  | `maker` or `taker` |
| settings.identityKey | <code>Buffer</code> \| <code>string</code> |  | private key that signs this side's bodies (maker: the order's `makerPubkey`) |
| settings.htlcKey | <code>Buffer</code> \| <code>string</code> |  | private key for this side's HTLC leaf |
| [settings.lightningNodeId] | <code>string</code> |  | this side's node id (required for takers) |
| settings.adapters | <code>Object</code> |  | `{ bitcoin, lightning }` |
| [settings.secondsPerBlock] | <code>number</code> | <code>600</code> |  |
| [settings.marginSeconds] | <code>number</code> | <code>3600</code> | invoice must expire this long before the refund lock opens |
| [settings.minClaimBlocks] | <code>number</code> | <code>6</code> |  |
| [settings.minConfirmations] | <code>number</code> | <code>1</code> | HTLC confirmations before the L2 giver pays |
| [settings.invoiceExpirySeconds] | <code>number</code> | <code>3600</code> | upper bound on the swap invoice's expiry |
| [settings.now] | <code>function</code> |  | clock in ms (tests) |

<a name="LiquiditySwap+status"></a>

### liquiditySwap.status ⇒ <code>string</code>
**Kind**: instance property of [<code>LiquiditySwap</code>](#LiquiditySwap)  
**Returns**: <code>string</code> - current state  
<a name="LiquiditySwap+isL1Giver"></a>

### liquiditySwap.isL1Giver ⇒ <code>boolean</code>
**Kind**: instance property of [<code>LiquiditySwap</code>](#LiquiditySwap)  
<a name="LiquiditySwap+take"></a>

### liquiditySwap.take ⇒ <code>Object</code> \| <code>null</code>
**Kind**: instance property of [<code>LiquiditySwap</code>](#LiquiditySwap)  
<a name="LiquiditySwap+takeId"></a>

### liquiditySwap.takeId ⇒ <code>string</code> \| <code>null</code>
**Kind**: instance property of [<code>LiquiditySwap</code>](#LiquiditySwap)  
<a name="LiquiditySwap+accept"></a>

### liquiditySwap.accept ⇒ <code>Object</code> \| <code>null</code>
**Kind**: instance property of [<code>LiquiditySwap</code>](#LiquiditySwap)  
<a name="LiquiditySwap+funded"></a>

### liquiditySwap.funded ⇒ <code>Object</code> \| <code>null</code>
**Kind**: instance property of [<code>LiquiditySwap</code>](#LiquiditySwap)  
<a name="LiquiditySwap+quote"></a>

### liquiditySwap.quote ⇒ <code>Object</code> \| <code>null</code>
**Kind**: instance property of [<code>LiquiditySwap</code>](#LiquiditySwap)  
**Returns**: <code>Object</code> \| <code>null</code> - amounts for this fill  
<a name="LiquiditySwap+terms"></a>

### liquiditySwap.terms ⇒ <code>Object</code> \| <code>null</code>
**Kind**: instance property of [<code>LiquiditySwap</code>](#LiquiditySwap)  
**Returns**: <code>Object</code> \| <code>null</code> - L1 giver's `{ paymentHashHex, invoice, refundLockHeight, prepayInvoice? }`  
<a name="LiquiditySwap+escrow"></a>

### liquiditySwap.escrow ⇒ <code>Object</code> \| <code>null</code>
**Kind**: instance property of [<code>LiquiditySwap</code>](#LiquiditySwap)  
**Returns**: <code>Object</code> \| <code>null</code> - swap HTLC (`buildSwapEscrow`)  
<a name="LiquiditySwap+createTake"></a>

### liquiditySwap.createTake(opts) ⇒ <code>Promise.&lt;Object&gt;</code>
Taker: propose filling `amountSats` of the order.

**Kind**: instance method of [<code>LiquiditySwap</code>](#LiquiditySwap)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - signed `LiquidityTake` body to send to the maker  

| Param | Type |
| --- | --- |
| opts | <code>Object</code> | 
| opts.amountSats | <code>number</code> | 

<a name="LiquiditySwap+acceptTake"></a>

### liquiditySwap.acceptTake(takeBody) ⇒ <code>Promise.&lt;Object&gt;</code>
Maker: accept a taker's signed take.

**Kind**: instance method of [<code>LiquiditySwap</code>](#LiquiditySwap)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - signed `LiquidityTakeAccept` body to send back  

| Param | Type |
| --- | --- |
| takeBody | <code>Object</code> | 

<a name="LiquiditySwap+applyAccept"></a>

### liquiditySwap.applyAccept(acceptBody) ⇒ [<code>Promise.&lt;LiquiditySwap&gt;</code>](#LiquiditySwap)
Taker: apply the maker's signed acceptance.

**Kind**: instance method of [<code>LiquiditySwap</code>](#LiquiditySwap)  

| Param | Type |
| --- | --- |
| acceptBody | <code>Object</code> | 

<a name="LiquiditySwap+prepay"></a>

### liquiditySwap.prepay() ⇒ <code>Promise.&lt;Object&gt;</code>
L2 giver: pay the maker's prepay invoice (orders with `prepaySats`).

**Kind**: instance method of [<code>LiquiditySwap</code>](#LiquiditySwap)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - payment result  
<a name="LiquiditySwap+fund"></a>

### liquiditySwap.fund() ⇒ <code>Promise.&lt;Object&gt;</code>
L1 giver: fund the HTLC. A maker that asked for a prepay funds only once
its node reports the prepay invoice paid. Funding happens at most once:
the escrow is recorded before the send, and once the send returns the
swap is `l1Funded` (refundable, no longer abortable) even if the funding
notice cannot be built — that error is thrown after the transition.

**Kind**: instance method of [<code>LiquiditySwap</code>](#LiquiditySwap)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - signed `LiquiditySwapFunded` body to send  
<a name="LiquiditySwap+applyFunded"></a>

### liquiditySwap.applyFunded(fundedBody) ⇒ <code>Promise.&lt;{ok: boolean, pending: (boolean\|undefined), confirmations: number}&gt;</code>
L2 giver: check the L1 giver's funding notice against the chain. Returns
`{ ok: false, pending: true }` until the HTLC has `minConfirmations`
(call again later); throws when the funding is wrong.

**Kind**: instance method of [<code>LiquiditySwap</code>](#LiquiditySwap)  

| Param | Type |
| --- | --- |
| fundedBody | <code>Object</code> | 

<a name="LiquiditySwap+payInvoice"></a>

### liquiditySwap.payInvoice() ⇒ <code>Promise.&lt;string&gt;</code>
L2 giver: pay the swap invoice and keep the revealed preimage.

**Kind**: instance method of [<code>LiquiditySwap</code>](#LiquiditySwap)  
**Returns**: <code>Promise.&lt;string&gt;</code> - preimage hex  
<a name="LiquiditySwap+claim"></a>

### liquiditySwap.claim([opts]) ⇒ <code>Promise.&lt;string&gt;</code>
L2 giver: claim the HTLC with the preimage.

**Kind**: instance method of [<code>LiquiditySwap</code>](#LiquiditySwap)  
**Returns**: <code>Promise.&lt;string&gt;</code> - claim txid  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [opts] | <code>Object</code> |  |  |
| [opts.destinationAddress] | <code>string</code> |  | defaults to `bitcoin.getNewAddress()` |
| [opts.feeSats] | <code>number</code> | <code>1000</code> |  |

<a name="LiquiditySwap+checkPaid"></a>

### liquiditySwap.checkPaid() ⇒ <code>Promise.&lt;boolean&gt;</code>
L1 giver: ask the node whether the swap invoice was paid.

**Kind**: instance method of [<code>LiquiditySwap</code>](#LiquiditySwap)  
<a name="LiquiditySwap+observeClaim"></a>

### liquiditySwap.observeClaim(txHex) ⇒ <code>boolean</code>
L1 giver: note the counterparty's claim transaction (it carries the
preimage) and finish.

**Kind**: instance method of [<code>LiquiditySwap</code>](#LiquiditySwap)  
**Returns**: <code>boolean</code> - whether the transaction claims this swap's HTLC  

| Param | Type |
| --- | --- |
| txHex | <code>string</code> | 

<a name="LiquiditySwap+refund"></a>

### liquiditySwap.refund([opts]) ⇒ <code>Promise.&lt;string&gt;</code>
L1 giver: take the HTLC back after the refund lock when the invoice was
never paid.

**Kind**: instance method of [<code>LiquiditySwap</code>](#LiquiditySwap)  
**Returns**: <code>Promise.&lt;string&gt;</code> - refund txid  

| Param | Type | Default |
| --- | --- | --- |
| [opts] | <code>Object</code> |  | 
| [opts.destinationAddress] | <code>string</code> |  | 
| [opts.feeSats] | <code>number</code> | <code>1000</code> | 

<a name="LiquiditySwap+abort"></a>

### liquiditySwap.abort([reason])
Walk away before any L1 funds move.

**Kind**: instance method of [<code>LiquiditySwap</code>](#LiquiditySwap)  

| Param | Type | Default |
| --- | --- | --- |
| [reason] | <code>string</code> | <code>&quot;aborted&quot;</code> | 

<a name="LiquiditySwap+toJSON"></a>

### liquiditySwap.toJSON([opts]) ⇒ <code>Object</code>
JSON for persistence. The preimage is a secret until the invoice is paid;
it is included only with `includeSecrets` (the L1 giver needs it back
after a restart). Private keys are never included.

**Kind**: instance method of [<code>LiquiditySwap</code>](#LiquiditySwap)  

| Param | Type | Default |
| --- | --- | --- |
| [opts] | <code>Object</code> |  | 
| [opts.includeSecrets] | <code>boolean</code> | <code>false</code> | 

<a name="LiquiditySwap.fromJSON"></a>

### LiquiditySwap.fromJSON(json, settings) ⇒ [<code>LiquiditySwap</code>](#LiquiditySwap)
Restore a swap saved with [toJSON](#LiquiditySwap+toJSON). The keys must be
the ones the saved take / accept were made with, or the swap could not
fund, claim, or refund its HTLC.

**Kind**: static method of [<code>LiquiditySwap</code>](#LiquiditySwap)  

| Param | Type | Description |
| --- | --- | --- |
| json | <code>Object</code> |  |
| settings | <code>Object</code> | constructor settings (keys, adapters, …) without `order` / `role` |

<a name="LiquiditySwap.lightningAdapter"></a>

### LiquiditySwap.lightningAdapter(lightning) ⇒ <code>Object</code>
Lightning adapter over `services/lightning` (Core Lightning).

**Kind**: static method of [<code>LiquiditySwap</code>](#LiquiditySwap)  
**Returns**: <code>Object</code> - `{ createInvoice, decodeInvoice, pay, isInvoicePaid }`  

| Param | Type | Description |
| --- | --- | --- |
| lightning | <code>Object</code> | a `Lightning` service instance |

<a name="LiquiditySwap.bitcoinAdapter"></a>

### LiquiditySwap.bitcoinAdapter(service, [options]) ⇒ <code>Object</code>
Bitcoin adapter over `services/bitcoin` (bitcoind JSON-RPC, wallet
loaded). Reading the counterparty's funding transaction needs it in the
mempool or `txindex=1`.

**Kind**: static method of [<code>LiquiditySwap</code>](#LiquiditySwap)  
**Returns**: <code>Object</code> - `{ getTipHeight, fundAddress, getTransaction, broadcast, getNewAddress }`  

| Param | Type | Description |
| --- | --- | --- |
| service | <code>Object</code> | a `Bitcoin` service instance |
| [options] | <code>Object</code> |  |
| [options.wallet] | <code>String</code> | named bitcoind wallet for funding and addresses (default: the node's default wallet) |

<a name="Logger"></a>

## Logger ⇐ [<code>Actor</code>](#Actor)
A basic logger that writes logs to the local file system

**Kind**: global class  
**Extends**: [<code>Actor</code>](#Actor)  

* [Logger](#Logger) ⇐ [<code>Actor</code>](#Actor)
    * [.path](#Logger+path) ⇒ <code>String</code>
    * [.log(msg)](#Logger+log) ⇒ <code>Boolean</code>
    * [.start()](#Logger+start) ⇒ <code>Promise</code>
    * [.stop()](#Logger+stop) ⇒ <code>Promise</code>
    * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
    * [.commit()](#Actor+commit) ⇒ <code>String</code>
    * [.export()](#Actor+export) ⇒ <code>Object</code>
    * [.get(path)](#Actor+get) ⇒ <code>Object</code>
    * [.set(path, value)](#Actor+set) ⇒ <code>Object</code>
    * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
    * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
    * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
    * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
    * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
    * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
    * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
    * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
    * [.value([format])](#Actor+value) ⇒ <code>Object</code>
    * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>

<a name="Logger+path"></a>

### logger.path ⇒ <code>String</code>
Returns the path to the log file

**Kind**: instance property of [<code>Logger</code>](#Logger)  
<a name="Logger+log"></a>

### logger.log(msg) ⇒ <code>Boolean</code>
Writes the specified log to the log file

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Returns**: <code>Boolean</code> - true, if msg was successfully written; false otherwise  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>String</code> \| <code>Object</code> | The message to log |

<a name="Logger+start"></a>

### logger.start() ⇒ <code>Promise</code>
Starts the logger

This method creates the required directories for writing the log file.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
<a name="Logger+stop"></a>

### logger.stop() ⇒ <code>Promise</code>
Stops the logger

This method closes the log file and returns after it has been closed. Any
errors on close would cause the return promise to be rejected.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
<a name="Actor+adopt"></a>

### logger.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>adopt</code>](#Actor+adopt)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### logger.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>commit</code>](#Actor+commit)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+export"></a>

### logger.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>export</code>](#Actor+export)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+get"></a>

### logger.get(path) ⇒ <code>Object</code>
Retrieve a value from the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>get</code>](#Actor+get)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to retrieve using [JSONPointer](JSONPointer). |

<a name="Actor+set"></a>

### logger.set(path, value) ⇒ <code>Object</code>
Set a value in the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>set</code>](#Actor+set)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to set using [JSONPointer](JSONPointer). |
| value | <code>Object</code> | Value to set. |

<a name="Actor+stream"></a>

### logger.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>stream</code>](#Actor+stream)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### logger.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>toBuffer</code>](#Actor+toBuffer)  
<a name="Actor+toGenericMessage"></a>

### logger.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>toGenericMessage</code>](#Actor+toGenericMessage)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### logger.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>toObject</code>](#Actor+toObject)  
<a name="Actor+pause"></a>

### logger.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>pause</code>](#Actor+pause)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### logger.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>serialize</code>](#Actor+serialize)  
<a name="Actor+sign"></a>

### logger.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>sign</code>](#Actor+sign)  
<a name="Actor+unpause"></a>

### logger.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>unpause</code>](#Actor+unpause)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### logger.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>value</code>](#Actor+value)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### logger.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>\_readObject</code>](#Actor+_readObject)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Machine"></a>

## Machine ⇐ [<code>Actor</code>](#Actor)
Deterministic <strong>virtual machine</strong> layer extending [Actor](#Actor): script/stack, fixed memory buffer,
clock, and a [Key](#Key)-backed generator for reproducible “random” bits (<code>sip</code>). Consumes [State](#State)-signed
instruction entries from [push](#Fabric+push) — not the same as P2P [Message](#Message) dispatch (see
<code>types/message.js</code>).

**Kind**: global class  
**Extends**: [<code>Actor</code>](#Actor)  

* [Machine](#Machine) ⇐ [<code>Actor</code>](#Actor)
    * [new Machine(settings)](#new_Machine_new)
    * _instance_
        * [.allowedOpcodes](#Machine+allowedOpcodes) ⇒ <code>Array.&lt;string&gt;</code>
        * [.setAllowedOpcodes(list)](#Machine+setAllowedOpcodes) ⇒ [<code>Machine</code>](#Machine)
        * [.applyGenesisOpcodes([genesis])](#Machine+applyGenesisOpcodes) ⇒ [<code>Machine</code>](#Machine)
        * [.sip([n])](#Machine+sip) ⇒ <code>Number</code>
        * [.slurp([n])](#Machine+slurp) ⇒ <code>Number</code>
        * [.compute(input)](#Machine+compute) ⇒ [<code>Machine</code>](#Machine)
        * [.parseManifest(raw, [program])](#Machine+parseManifest) ⇒ <code>Object</code>
        * [.loadProgram(program, [opts])](#Machine+loadProgram) ⇒ [<code>Machine</code>](#Machine)
        * [.runProgram(program, [input], [opts])](#Machine+runProgram) ⇒ <code>Promise.&lt;{ok: boolean, stack: Array, tip: \*, trace: Array, runCommitmentHex: (string\|null), error: (string\|undefined)}&gt;</code>
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.commit()](#Actor+commit) ⇒ <code>String</code>
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.get(path)](#Actor+get) ⇒ <code>Object</code>
        * [.set(path, value)](#Actor+set) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * [.fromObjectString([input])](#Machine.fromObjectString) ⇒ <code>Array.&lt;Buffer&gt;</code>

<a name="new_Machine_new"></a>

### new Machine(settings)
Create a Machine.


| Param | Type | Description |
| --- | --- | --- |
| settings | <code>Object</code> | Run-time configuration. |

<a name="Machine+allowedOpcodes"></a>

### machine.allowedOpcodes ⇒ <code>Array.&lt;string&gt;</code>
Active opcode allow-list (empty = unrestricted).

**Kind**: instance property of [<code>Machine</code>](#Machine)  
<a name="Machine+setAllowedOpcodes"></a>

### machine.setAllowedOpcodes(list) ⇒ [<code>Machine</code>](#Machine)
Restrict `define` / `loadProgram` / `compute` to this opcode set.
Empty / null clears the restriction (legacy soft unknown-op behavior).

**Kind**: instance method of [<code>Machine</code>](#Machine)  

| Param | Type |
| --- | --- |
| list | <code>Iterable.&lt;\*&gt;</code> \| <code>null</code> | 

<a name="Machine+applyGenesisOpcodes"></a>

### machine.applyGenesisOpcodes([genesis]) ⇒ [<code>Machine</code>](#Machine)
Apply ARC / Program genesis `primitives.opcodes` as the Machine allow-list.
No-op when genesis has no opcodes (keeps unrestricted).

**Kind**: instance method of [<code>Machine</code>](#Machine)  

| Param | Type |
| --- | --- |
| [genesis] | <code>object</code> | 

<a name="Machine+sip"></a>

### machine.sip([n]) ⇒ <code>Number</code>
Get `n` bits of deterministic random data.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Number</code> - Random bits from [Generator](Generator).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [n] | <code>Number</code> | <code>128</code> | Number of bits to retrieve. |

<a name="Machine+slurp"></a>

### machine.slurp([n]) ⇒ <code>Number</code>
Get `n` bytes of deterministic random data.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Number</code> - Random bytes from [Generator](Generator).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [n] | <code>Number</code> | <code>32</code> | Number of bytes to retrieve. |

<a name="Machine+compute"></a>

### machine.compute(input) ⇒ [<code>Machine</code>](#Machine)
Computes the next "step" for our current Vector.  Analagous to `sum`.
The top item on the stack is always the memory held at current position,
so counts should always begin with 0.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: [<code>Machine</code>](#Machine) - Instance of the resulting machine.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Value to pass as input. |

<a name="Machine+parseManifest"></a>

### machine.parseManifest(raw, [program]) ⇒ <code>Object</code>
Parse program manifest v1 (former DistributedExecution.parseDistributedManifestV1).

**Kind**: instance method of [<code>Machine</code>](#Machine)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| raw | <code>Object</code> |  |  |
| [program] | [<code>Program</code>](#Program) \| <code>null</code> | <code></code> | When provided, programId/hash must match. |

<a name="Machine+loadProgram"></a>

### machine.loadProgram(program, [opts]) ⇒ [<code>Machine</code>](#Machine)
Load a [Program](#Program) onto this machine (sets script steps).
When an opcode allow-list is active (ctor `allowedOpcodes`,
[setAllowedOpcodes](#Machine+setAllowedOpcodes), [applyGenesisOpcodes](#Machine+applyGenesisOpcodes),
or Program/genesis `primitives.opcodes`), steps and javascript `source`
keys must be listed — fail closed.

**Kind**: instance method of [<code>Machine</code>](#Machine)  

| Param | Type | Description |
| --- | --- | --- |
| program | [<code>Program</code>](#Program) \| <code>object</code> |  |
| [opts] | <code>Object</code> |  |
| [opts.genesis] | <code>Object</code> | ARC genesis; may supply `primitives.opcodes` allow-list |

<a name="Machine+runProgram"></a>

### machine.runProgram(program, [input], [opts]) ⇒ <code>Promise.&lt;{ok: boolean, stack: Array, tip: \*, trace: Array, runCommitmentHex: (string\|null), error: (string\|undefined)}&gt;</code>
Load and compute a Program; return stack tip + run commitment for L1 binding.

**Kind**: instance method of [<code>Machine</code>](#Machine)  

| Param | Type | Description |
| --- | --- | --- |
| program | [<code>Program</code>](#Program) \| <code>Object</code> |  |
| [input] | <code>\*</code> |  |
| [opts] | <code>Object</code> |  |
| [opts.genesis] | <code>Object</code> | ARC genesis for `primitives.opcodes` allow-list |

<a name="Actor+adopt"></a>

### machine.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### machine.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Overrides**: [<code>commit</code>](#Actor+commit)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+export"></a>

### machine.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+get"></a>

### machine.get(path) ⇒ <code>Object</code>
Retrieve a value from the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to retrieve using [JSONPointer](JSONPointer). |

<a name="Actor+set"></a>

### machine.set(path, value) ⇒ <code>Object</code>
Set a value in the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to set using [JSONPointer](JSONPointer). |
| value | <code>Object</code> | Value to set. |

<a name="Actor+stream"></a>

### machine.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### machine.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
<a name="Actor+toGenericMessage"></a>

### machine.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### machine.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Machine</code>](#Machine)  
<a name="Actor+pause"></a>

### machine.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### machine.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
<a name="Actor+sign"></a>

### machine.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
<a name="Actor+unpause"></a>

### machine.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### machine.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### machine.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Machine.fromObjectString"></a>

### Machine.fromObjectString([input]) ⇒ <code>Array.&lt;Buffer&gt;</code>
Parse a JSON object of Buffer-like entries into an array of [Buffer](Buffer)s (legacy wire / script helper).

**Kind**: static method of [<code>Machine</code>](#Machine)  

| Param | Type | Default |
| --- | --- | --- |
| [input] | <code>string</code> | <code>&quot;&#x27;&#x27;&quot;</code> | 

<a name="Machine"></a>

## Machine
**Kind**: global class  

* [Machine](#Machine)
    * [new Machine(settings)](#new_Machine_new)
    * _instance_
        * [.allowedOpcodes](#Machine+allowedOpcodes) ⇒ <code>Array.&lt;string&gt;</code>
        * [.setAllowedOpcodes(list)](#Machine+setAllowedOpcodes) ⇒ [<code>Machine</code>](#Machine)
        * [.applyGenesisOpcodes([genesis])](#Machine+applyGenesisOpcodes) ⇒ [<code>Machine</code>](#Machine)
        * [.sip([n])](#Machine+sip) ⇒ <code>Number</code>
        * [.slurp([n])](#Machine+slurp) ⇒ <code>Number</code>
        * [.compute(input)](#Machine+compute) ⇒ [<code>Machine</code>](#Machine)
        * [.parseManifest(raw, [program])](#Machine+parseManifest) ⇒ <code>Object</code>
        * [.loadProgram(program, [opts])](#Machine+loadProgram) ⇒ [<code>Machine</code>](#Machine)
        * [.runProgram(program, [input], [opts])](#Machine+runProgram) ⇒ <code>Promise.&lt;{ok: boolean, stack: Array, tip: \*, trace: Array, runCommitmentHex: (string\|null), error: (string\|undefined)}&gt;</code>
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.commit()](#Actor+commit) ⇒ <code>String</code>
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.get(path)](#Actor+get) ⇒ <code>Object</code>
        * [.set(path, value)](#Actor+set) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * [.fromObjectString([input])](#Machine.fromObjectString) ⇒ <code>Array.&lt;Buffer&gt;</code>

<a name="new_Machine_new"></a>

### new Machine(settings)
Create a Machine.


| Param | Type | Description |
| --- | --- | --- |
| settings | <code>Object</code> | Run-time configuration. |

<a name="Machine+allowedOpcodes"></a>

### machine.allowedOpcodes ⇒ <code>Array.&lt;string&gt;</code>
Active opcode allow-list (empty = unrestricted).

**Kind**: instance property of [<code>Machine</code>](#Machine)  
<a name="Machine+setAllowedOpcodes"></a>

### machine.setAllowedOpcodes(list) ⇒ [<code>Machine</code>](#Machine)
Restrict `define` / `loadProgram` / `compute` to this opcode set.
Empty / null clears the restriction (legacy soft unknown-op behavior).

**Kind**: instance method of [<code>Machine</code>](#Machine)  

| Param | Type |
| --- | --- |
| list | <code>Iterable.&lt;\*&gt;</code> \| <code>null</code> | 

<a name="Machine+applyGenesisOpcodes"></a>

### machine.applyGenesisOpcodes([genesis]) ⇒ [<code>Machine</code>](#Machine)
Apply ARC / Program genesis `primitives.opcodes` as the Machine allow-list.
No-op when genesis has no opcodes (keeps unrestricted).

**Kind**: instance method of [<code>Machine</code>](#Machine)  

| Param | Type |
| --- | --- |
| [genesis] | <code>object</code> | 

<a name="Machine+sip"></a>

### machine.sip([n]) ⇒ <code>Number</code>
Get `n` bits of deterministic random data.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Number</code> - Random bits from [Generator](Generator).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [n] | <code>Number</code> | <code>128</code> | Number of bits to retrieve. |

<a name="Machine+slurp"></a>

### machine.slurp([n]) ⇒ <code>Number</code>
Get `n` bytes of deterministic random data.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Number</code> - Random bytes from [Generator](Generator).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [n] | <code>Number</code> | <code>32</code> | Number of bytes to retrieve. |

<a name="Machine+compute"></a>

### machine.compute(input) ⇒ [<code>Machine</code>](#Machine)
Computes the next "step" for our current Vector.  Analagous to `sum`.
The top item on the stack is always the memory held at current position,
so counts should always begin with 0.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: [<code>Machine</code>](#Machine) - Instance of the resulting machine.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Value to pass as input. |

<a name="Machine+parseManifest"></a>

### machine.parseManifest(raw, [program]) ⇒ <code>Object</code>
Parse program manifest v1 (former DistributedExecution.parseDistributedManifestV1).

**Kind**: instance method of [<code>Machine</code>](#Machine)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| raw | <code>Object</code> |  |  |
| [program] | [<code>Program</code>](#Program) \| <code>null</code> | <code></code> | When provided, programId/hash must match. |

<a name="Machine+loadProgram"></a>

### machine.loadProgram(program, [opts]) ⇒ [<code>Machine</code>](#Machine)
Load a [Program](#Program) onto this machine (sets script steps).
When an opcode allow-list is active (ctor `allowedOpcodes`,
[setAllowedOpcodes](#Machine+setAllowedOpcodes), [applyGenesisOpcodes](#Machine+applyGenesisOpcodes),
or Program/genesis `primitives.opcodes`), steps and javascript `source`
keys must be listed — fail closed.

**Kind**: instance method of [<code>Machine</code>](#Machine)  

| Param | Type | Description |
| --- | --- | --- |
| program | [<code>Program</code>](#Program) \| <code>object</code> |  |
| [opts] | <code>Object</code> |  |
| [opts.genesis] | <code>Object</code> | ARC genesis; may supply `primitives.opcodes` allow-list |

<a name="Machine+runProgram"></a>

### machine.runProgram(program, [input], [opts]) ⇒ <code>Promise.&lt;{ok: boolean, stack: Array, tip: \*, trace: Array, runCommitmentHex: (string\|null), error: (string\|undefined)}&gt;</code>
Load and compute a Program; return stack tip + run commitment for L1 binding.

**Kind**: instance method of [<code>Machine</code>](#Machine)  

| Param | Type | Description |
| --- | --- | --- |
| program | [<code>Program</code>](#Program) \| <code>Object</code> |  |
| [input] | <code>\*</code> |  |
| [opts] | <code>Object</code> |  |
| [opts.genesis] | <code>Object</code> | ARC genesis for `primitives.opcodes` allow-list |

<a name="Actor+adopt"></a>

### machine.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### machine.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Overrides**: [<code>commit</code>](#Actor+commit)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+export"></a>

### machine.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+get"></a>

### machine.get(path) ⇒ <code>Object</code>
Retrieve a value from the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to retrieve using [JSONPointer](JSONPointer). |

<a name="Actor+set"></a>

### machine.set(path, value) ⇒ <code>Object</code>
Set a value in the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to set using [JSONPointer](JSONPointer). |
| value | <code>Object</code> | Value to set. |

<a name="Actor+stream"></a>

### machine.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### machine.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
<a name="Actor+toGenericMessage"></a>

### machine.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### machine.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Machine</code>](#Machine)  
<a name="Actor+pause"></a>

### machine.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### machine.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
<a name="Actor+sign"></a>

### machine.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
<a name="Actor+unpause"></a>

### machine.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### machine.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### machine.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Machine.fromObjectString"></a>

### Machine.fromObjectString([input]) ⇒ <code>Array.&lt;Buffer&gt;</code>
Parse a JSON object of Buffer-like entries into an array of [Buffer](Buffer)s (legacy wire / script helper).

**Kind**: static method of [<code>Machine</code>](#Machine)  

| Param | Type | Default |
| --- | --- | --- |
| [input] | <code>string</code> | <code>&quot;&#x27;&#x27;&quot;</code> | 

<a name="Message"></a>

## Message ⇐ [<code>Actor</code>](#Actor)
<strong>Application Messaging Protocol (AMP)</strong> — binary envelope for what [Peer](#Peer),
[Service](#Service), and bridges actually exchange. Extends [Actor](#Actor) for construction and state helpers, but on the wire
you think in <strong>opcodes</strong>, <strong>headers</strong> (parent, author as x-only pubkey, hash, preimage,
64-byte Schnorr signature), and <strong>payload</strong>.

<p><strong>Signing</strong> — [signWithKey](#Message+signWithKey) / [verifyWithKey](#Message+verifyWithKey) use BIP-340 Schnorr on tagged
hash <code>Fabric/Message</code> over header (signature field zeroed) + body. This is <strong>not</strong> Bitcoin Signed
Message (ECDSA + Core prefix).</p>

<p><strong>Type names</strong> — [wireType](#Message+wireType) / [Message#type](Message#type) use SCREAMING_SNAKE wire labels from
opcode decode; [friendlyType](#Message+friendlyType) and [toObject](#Actor+toObject)'s <code>type</code> use PascalCase (or legacy)
JSON names. [Message.wireTypeFromFriendly](Message.wireTypeFromFriendly) / [Message.friendlyTypeFromWire](Message.friendlyTypeFromWire) bridge the two. See file header
maps (<code>WIRE_TYPE_DECODE_ORDER</code>, <code>LEGACY_MESSAGE_TYPE_ALIASES</code>) when aligning <strong>@fabric/http</strong>
or Hub.</p>

<p><strong>Body (V1)</strong> — Prefer [fromFields](#Message.fromFields) / [toFields](#Message+toFields) with a
registered body schema (see body codec helpers on this module). Bodies are C-like typed fields, not JSON;
JSON bridging is <strong>@fabric/http</strong>. See <code>docs/MESSAGE_BODY.md</code>.</p>

<p><strong>Narrative</strong> — See <strong>DEVELOPERS.md</strong> (<em>Actor and Message</em>) and [Actor](#Actor)
<code>@fileoverview</code>; home HTML is generated from DEVELOPERS.md, while this page comes from
<code>types/message.js</code>.</p>

**Kind**: global class  
**Extends**: [<code>Actor</code>](#Actor)  

* [Message](#Message) ⇐ [<code>Actor</code>](#Actor)
    * [new Message([input])](#new_Message_new)
    * _instance_
        * [._sensitive](#Message+_sensitive)
        * [._explicitPreimage](#Message+_explicitPreimage)
        * [.parent](#Message+parent) ⇒ <code>string</code>
        * [.preimage](#Message+preimage)
        * [.bodyBuffer](#Message+bodyBuffer)
        * [.id](#Message+id) ⇒ <code>string</code>
        * [.wireType](#Message+wireType)
        * [.friendlyType](#Message+friendlyType)
        * [.asRaw()](#Message+asRaw) ⇒ <code>Buffer</code>
        * [.signWithKey(key)](#Message+signWithKey) ⇒ [<code>Message</code>](#Message)
        * [.verify()](#Message+verify) ⇒ <code>Boolean</code>
        * [.verifyWithKey(key)](#Message+verifyWithKey) ⇒ <code>Boolean</code>
        * [._setSigner(key)](#Message+_setSigner) ⇒ [<code>Message</code>](#Message)
        * [.toFields()](#Message+toFields) ⇒ <code>object</code> \| <code>null</code>
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.commit()](#Actor+commit) ⇒ <code>String</code>
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.get(path)](#Actor+get) ⇒ <code>Object</code>
        * [.set(path, value)](#Actor+set) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * [.fromFields(type, [fields], [opts])](#Message.fromFields) ⇒ [<code>Message</code>](#Message)

<a name="new_Message_new"></a>

### new Message([input])
Build a message from an object. Prefer <code>type</code>/<code>data</code>; <code>@type</code> / <code>@data</code>
are accepted for backward compatibility.

**Returns**: [<code>Message</code>](#Message) - Instance ready for [asRaw](#Message+asRaw), [signWithKey](#Message+signWithKey), etc.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [input] | <code>Object</code> | <code>{}</code> | Initial fields: <code>type</code> or <code>@type</code>, <code>data</code> or <code>@data</code>, optional <code>parent</code> (previous [id](#Message+id) or 32 zero bytes), <code>signer</code>, <code>sensitive</code>, <code>preimage</code>. |

<a name="Message+_sensitive"></a>

### message.\_sensitive
When true, keep wire preimage zeroed (no payment secret). Default public
messages already use zeros — see [preimage](#Message+preimage) (Lightning-style).

**Kind**: instance property of [<code>Message</code>](#Message)  
<a name="Message+_explicitPreimage"></a>

### message.\_explicitPreimage
When true, an explicit HTLC / circuit payment preimage was set — do not clobber.

**Kind**: instance property of [<code>Message</code>](#Message)  
<a name="Message+parent"></a>

### message.parent ⇒ <code>string</code>
Previous signed frame id (SHA-256 of that AMP buffer), or 32 zero bytes at genesis.
Covered by [signWithKey](#Message+signWithKey) — set before signing.

**Kind**: instance property of [<code>Message</code>](#Message)  
**Returns**: <code>string</code> - 64-char hex  
<a name="Message+preimage"></a>

### message.preimage
Optional 32-byte **payment** preimage on wire (Lightning-style):
- **All zeros (default / public):** no HTLC secret; body integrity is only [Message#hash](Message#hash)
  (double-SHA256(body)). Do **not** put SHA256(body) here — that collides with circuit HTLC chains.
- **Non-zero:** explicit payment secret for inventory HTLC / Fabric Circuit hops
  (`payment_hash = SHA256(preimage)`), covered by the Schnorr signature.
- [Message#sensitive](Message#sensitive) forces zeros and refuses to clobber an explicit secret.

**Kind**: instance property of [<code>Message</code>](#Message)  
<a name="Message+bodyBuffer"></a>

### message.bodyBuffer
Raw body Buffer (preferred over UTF-8 `data` getter for binary field bodies).

**Kind**: instance property of [<code>Message</code>](#Message)  
<a name="Message+id"></a>

### message.id ⇒ <code>string</code>
SHA-256 of the complete signed AMP frame. This is what the next message
stores in [parent](#Message+parent) (not header <code>hash</code>, which is
only double-SHA256 of the body).

**Kind**: instance property of [<code>Message</code>](#Message)  
**Returns**: <code>string</code> - 64-char hex  
<a name="Message+wireType"></a>

### message.wireType
AMP wire type string (SCREAMING_SNAKE_CASE / opcode-canonical). Same as [Message#type](Message#type).

**Kind**: instance property of [<code>Message</code>](#Message)  
<a name="Message+friendlyType"></a>

### message.friendlyType
JSON-oriented type label (historical PascalCase aliases). Use in APIs and `toObject().type`.

**Kind**: instance property of [<code>Message</code>](#Message)  
<a name="Message+asRaw"></a>

### message.asRaw() ⇒ <code>Buffer</code>
Returns a [Buffer](Buffer) of the complete message.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Buffer</code> - Buffer of the encoded [Message](#Message).  
<a name="Message+signWithKey"></a>

### message.signWithKey(key) ⇒ [<code>Message</code>](#Message)
Signs the message using a specific key.
Uses BIP-340 Schnorr signatures with tagged hash "Fabric/Message".
Signs the complete message (header + body) as per C implementation.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: [<code>Message</code>](#Message) - Signed message.  
**Throws**:

- <code>Error</code> If attempting to sign without a private key


| Param | Type | Description |
| --- | --- | --- |
| key | <code>Object</code> | Key object with private key and sign method. |
| key.private | <code>String</code> \| <code>Buffer</code> | Private key |
| key.pubkey | <code>String</code> \| <code>Buffer</code> | Public key |
| key.sign | <code>function</code> | Signing function |

<a name="Message+verify"></a>

### message.verify() ⇒ <code>Boolean</code>
Verify a message's signature.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Boolean</code> - `true` if the signature is valid, `false` if not.  
<a name="Message+verifyWithKey"></a>

### message.verifyWithKey(key) ⇒ <code>Boolean</code>
Verify a message's signature with a specific key.
Uses BIP-340 Schnorr signature verification with tagged hash "Fabric/Message".
Verifies the complete message (header + body) as per C implementation.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Boolean</code> - `true` if the signature is valid, `false` if not.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>Object</code> | Key object with verify method. |
| key.verify | <code>function</code> | Verification function |

<a name="Message+_setSigner"></a>

### message.\_setSigner(key) ⇒ [<code>Message</code>](#Message)
Sets the signer for the message.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: [<code>Message</code>](#Message) - Instance of the Message with associated signer.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>Object</code> | Key object with pubkey property. |
| key.pubkey | <code>String</code> \| <code>Buffer</code> | Public key |

<a name="Message+toFields"></a>

### message.toFields() ⇒ <code>object</code> \| <code>null</code>
Decode body bytes via the registered field schema for this message type.
Truncated / malformed peer bodies return {@code null} (protocol violation) instead of throwing.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>object</code> \| <code>null</code> - Field map, or null if no schema / empty / undecodable body.  
<a name="Actor+adopt"></a>

### message.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### message.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+export"></a>

### message.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+get"></a>

### message.get(path) ⇒ <code>Object</code>
Retrieve a value from the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to retrieve using [JSONPointer](JSONPointer). |

<a name="Actor+set"></a>

### message.set(path, value) ⇒ <code>Object</code>
Set a value in the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to set using [JSONPointer](JSONPointer). |
| value | <code>Object</code> | Value to set. |

<a name="Actor+stream"></a>

### message.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### message.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Overrides**: [<code>toBuffer</code>](#Actor+toBuffer)  
<a name="Actor+toGenericMessage"></a>

### message.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### message.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Message</code>](#Message)  
**Overrides**: [<code>toObject</code>](#Actor+toObject)  
<a name="Actor+pause"></a>

### message.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### message.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Message</code>](#Message)  
<a name="Actor+sign"></a>

### message.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Overrides**: [<code>sign</code>](#Actor+sign)  
<a name="Actor+unpause"></a>

### message.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### message.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### message.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Message.fromFields"></a>

### Message.fromFields(type, [fields], [opts]) ⇒ [<code>Message</code>](#Message)
Build a Message whose body is encoded from a registered field schema (V1).

**Kind**: static method of [<code>Message</code>](#Message)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| type | <code>string</code> \| <code>number</code> |  | Wire or friendly type name (or opcode). |
| [fields] | <code>object</code> | <code>{}</code> | Named fields matching the schema. |
| [opts] | <code>object</code> | <code>{}</code> | Extra Message constructor options (`signer`, `sensitive`, …). |

<a name="Message"></a>

## Message
**Kind**: global class  

* [Message](#Message)
    * [new Message([input])](#new_Message_new)
    * _instance_
        * [._sensitive](#Message+_sensitive)
        * [._explicitPreimage](#Message+_explicitPreimage)
        * [.parent](#Message+parent) ⇒ <code>string</code>
        * [.preimage](#Message+preimage)
        * [.bodyBuffer](#Message+bodyBuffer)
        * [.id](#Message+id) ⇒ <code>string</code>
        * [.wireType](#Message+wireType)
        * [.friendlyType](#Message+friendlyType)
        * [.asRaw()](#Message+asRaw) ⇒ <code>Buffer</code>
        * [.signWithKey(key)](#Message+signWithKey) ⇒ [<code>Message</code>](#Message)
        * [.verify()](#Message+verify) ⇒ <code>Boolean</code>
        * [.verifyWithKey(key)](#Message+verifyWithKey) ⇒ <code>Boolean</code>
        * [._setSigner(key)](#Message+_setSigner) ⇒ [<code>Message</code>](#Message)
        * [.toFields()](#Message+toFields) ⇒ <code>object</code> \| <code>null</code>
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.commit()](#Actor+commit) ⇒ <code>String</code>
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.get(path)](#Actor+get) ⇒ <code>Object</code>
        * [.set(path, value)](#Actor+set) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * [.fromFields(type, [fields], [opts])](#Message.fromFields) ⇒ [<code>Message</code>](#Message)

<a name="new_Message_new"></a>

### new Message([input])
Build a message from an object. Prefer <code>type</code>/<code>data</code>; <code>@type</code> / <code>@data</code>
are accepted for backward compatibility.

**Returns**: [<code>Message</code>](#Message) - Instance ready for [asRaw](#Message+asRaw), [signWithKey](#Message+signWithKey), etc.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [input] | <code>Object</code> | <code>{}</code> | Initial fields: <code>type</code> or <code>@type</code>, <code>data</code> or <code>@data</code>, optional <code>parent</code> (previous [id](#Message+id) or 32 zero bytes), <code>signer</code>, <code>sensitive</code>, <code>preimage</code>. |

<a name="Message+_sensitive"></a>

### message.\_sensitive
When true, keep wire preimage zeroed (no payment secret). Default public
messages already use zeros — see [preimage](#Message+preimage) (Lightning-style).

**Kind**: instance property of [<code>Message</code>](#Message)  
<a name="Message+_explicitPreimage"></a>

### message.\_explicitPreimage
When true, an explicit HTLC / circuit payment preimage was set — do not clobber.

**Kind**: instance property of [<code>Message</code>](#Message)  
<a name="Message+parent"></a>

### message.parent ⇒ <code>string</code>
Previous signed frame id (SHA-256 of that AMP buffer), or 32 zero bytes at genesis.
Covered by [signWithKey](#Message+signWithKey) — set before signing.

**Kind**: instance property of [<code>Message</code>](#Message)  
**Returns**: <code>string</code> - 64-char hex  
<a name="Message+preimage"></a>

### message.preimage
Optional 32-byte **payment** preimage on wire (Lightning-style):
- **All zeros (default / public):** no HTLC secret; body integrity is only [Message#hash](Message#hash)
  (double-SHA256(body)). Do **not** put SHA256(body) here — that collides with circuit HTLC chains.
- **Non-zero:** explicit payment secret for inventory HTLC / Fabric Circuit hops
  (`payment_hash = SHA256(preimage)`), covered by the Schnorr signature.
- [Message#sensitive](Message#sensitive) forces zeros and refuses to clobber an explicit secret.

**Kind**: instance property of [<code>Message</code>](#Message)  
<a name="Message+bodyBuffer"></a>

### message.bodyBuffer
Raw body Buffer (preferred over UTF-8 `data` getter for binary field bodies).

**Kind**: instance property of [<code>Message</code>](#Message)  
<a name="Message+id"></a>

### message.id ⇒ <code>string</code>
SHA-256 of the complete signed AMP frame. This is what the next message
stores in [parent](#Message+parent) (not header <code>hash</code>, which is
only double-SHA256 of the body).

**Kind**: instance property of [<code>Message</code>](#Message)  
**Returns**: <code>string</code> - 64-char hex  
<a name="Message+wireType"></a>

### message.wireType
AMP wire type string (SCREAMING_SNAKE_CASE / opcode-canonical). Same as [Message#type](Message#type).

**Kind**: instance property of [<code>Message</code>](#Message)  
<a name="Message+friendlyType"></a>

### message.friendlyType
JSON-oriented type label (historical PascalCase aliases). Use in APIs and `toObject().type`.

**Kind**: instance property of [<code>Message</code>](#Message)  
<a name="Message+asRaw"></a>

### message.asRaw() ⇒ <code>Buffer</code>
Returns a [Buffer](Buffer) of the complete message.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Buffer</code> - Buffer of the encoded [Message](#Message).  
<a name="Message+signWithKey"></a>

### message.signWithKey(key) ⇒ [<code>Message</code>](#Message)
Signs the message using a specific key.
Uses BIP-340 Schnorr signatures with tagged hash "Fabric/Message".
Signs the complete message (header + body) as per C implementation.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: [<code>Message</code>](#Message) - Signed message.  
**Throws**:

- <code>Error</code> If attempting to sign without a private key


| Param | Type | Description |
| --- | --- | --- |
| key | <code>Object</code> | Key object with private key and sign method. |
| key.private | <code>String</code> \| <code>Buffer</code> | Private key |
| key.pubkey | <code>String</code> \| <code>Buffer</code> | Public key |
| key.sign | <code>function</code> | Signing function |

<a name="Message+verify"></a>

### message.verify() ⇒ <code>Boolean</code>
Verify a message's signature.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Boolean</code> - `true` if the signature is valid, `false` if not.  
<a name="Message+verifyWithKey"></a>

### message.verifyWithKey(key) ⇒ <code>Boolean</code>
Verify a message's signature with a specific key.
Uses BIP-340 Schnorr signature verification with tagged hash "Fabric/Message".
Verifies the complete message (header + body) as per C implementation.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Boolean</code> - `true` if the signature is valid, `false` if not.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>Object</code> | Key object with verify method. |
| key.verify | <code>function</code> | Verification function |

<a name="Message+_setSigner"></a>

### message.\_setSigner(key) ⇒ [<code>Message</code>](#Message)
Sets the signer for the message.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: [<code>Message</code>](#Message) - Instance of the Message with associated signer.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>Object</code> | Key object with pubkey property. |
| key.pubkey | <code>String</code> \| <code>Buffer</code> | Public key |

<a name="Message+toFields"></a>

### message.toFields() ⇒ <code>object</code> \| <code>null</code>
Decode body bytes via the registered field schema for this message type.
Truncated / malformed peer bodies return {@code null} (protocol violation) instead of throwing.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>object</code> \| <code>null</code> - Field map, or null if no schema / empty / undecodable body.  
<a name="Actor+adopt"></a>

### message.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### message.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+export"></a>

### message.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+get"></a>

### message.get(path) ⇒ <code>Object</code>
Retrieve a value from the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to retrieve using [JSONPointer](JSONPointer). |

<a name="Actor+set"></a>

### message.set(path, value) ⇒ <code>Object</code>
Set a value in the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to set using [JSONPointer](JSONPointer). |
| value | <code>Object</code> | Value to set. |

<a name="Actor+stream"></a>

### message.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### message.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Overrides**: [<code>toBuffer</code>](#Actor+toBuffer)  
<a name="Actor+toGenericMessage"></a>

### message.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### message.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Message</code>](#Message)  
**Overrides**: [<code>toObject</code>](#Actor+toObject)  
<a name="Actor+pause"></a>

### message.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### message.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Message</code>](#Message)  
<a name="Actor+sign"></a>

### message.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Overrides**: [<code>sign</code>](#Actor+sign)  
<a name="Actor+unpause"></a>

### message.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### message.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### message.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Message.fromFields"></a>

### Message.fromFields(type, [fields], [opts]) ⇒ [<code>Message</code>](#Message)
Build a Message whose body is encoded from a registered field schema (V1).

**Kind**: static method of [<code>Message</code>](#Message)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| type | <code>string</code> \| <code>number</code> |  | Wire or friendly type name (or opcode). |
| [fields] | <code>object</code> | <code>{}</code> | Named fields matching the schema. |
| [opts] | <code>object</code> | <code>{}</code> | Extra Message constructor options (`signer`, `sensitive`, …). |

<a name="Book"></a>

## Book
**Kind**: global class  

* [Book](#Book)
    * [new Book([settings])](#new_DocumentOfferBook_new)
    * [._offers](#Book+_offers) : <code>Map.&lt;string, object&gt;</code>
    * [._providers](#Book+_providers) : <code>Map.&lt;string, object&gt;</code>
    * [.recordInventoryLatency(sellerId, latencyMs, [opts])](#Book+recordInventoryLatency)
    * [.recordDelivery(sellerId, outcome)](#Book+recordDelivery)
    * [.recordRefund(sellerId)](#Book+recordRefund)
    * [.recordPenalty(sellerId, [proof])](#Book+recordPenalty)
    * [.ingestFraudProof(body, [ctx])](#Book+ingestFraudProof) ⇒ <code>Object</code>
    * [.scoreFor(sellerId)](#Book+scoreFor) ⇒ <code>number</code>
    * [.latencyFor(sellerId)](#Book+latencyFor) ⇒ <code>number</code>
    * [.providerStats(sellerId)](#Book+providerStats) ⇒ <code>object</code> \| <code>null</code>
    * [.listProviders()](#Book+listProviders) ⇒ <code>Array.&lt;object&gt;</code>
    * [.exportTelemetry()](#Book+exportTelemetry) ⇒ <code>Object</code>
    * [.importTelemetry(record)](#Book+importTelemetry) ⇒ <code>number</code>
    * [.ingestInventoryResponse(opts)](#Book+ingestInventoryResponse)
    * [.forgetSeller(sellerId)](#Book+forgetSeller) ⇒ <code>number</code>
    * [.listOffers([filter])](#Book+listOffers) ⇒ <code>Array.&lt;object&gt;</code>
    * [.providersForBlob(blobHashHex, [opts])](#Book+providersForBlob) ⇒ <code>Array.&lt;object&gt;</code>
    * [.indexByBlobHash([filter])](#Book+indexByBlobHash) ⇒ <code>Map.&lt;string, Array.&lt;object&gt;&gt;</code>
    * [.rankOffers(offers, [weights])](#Book+rankOffers) ⇒ <code>Array.&lt;object&gt;</code>
    * [.pickBest(documentId, [opts])](#Book+pickBest) ⇒ <code>object</code> \| <code>null</code>
    * [.pickBlobPlan(documentId, blobTotal, [opts])](#Book+pickBlobPlan) ⇒ <code>Map.&lt;number, object&gt;</code>
    * [.groupPlanBySeller(plan)](#Book+groupPlanBySeller) ⇒ <code>Array.&lt;object&gt;</code>

<a name="new_DocumentOfferBook_new"></a>

### new Book([settings])

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  |  |
| [settings.alpha] | <code>number</code> | <code>0.3</code> | EWMA smoothing for latencies |
| [settings.hopPenaltyMs] | <code>number</code> | <code>50</code> | latency added per gossip hop |
| [settings.weights] | <code>Object</code> |  | ranking weight overrides |

<a name="Book+_offers"></a>

### documentOfferBook.\_offers : <code>Map.&lt;string, object&gt;</code>
offerKey → offer row

**Kind**: instance property of [<code>Book</code>](#Book)  
<a name="Book+_providers"></a>

### documentOfferBook.\_providers : <code>Map.&lt;string, object&gt;</code>
sellerId → provider telemetry

**Kind**: instance property of [<code>Book</code>](#Book)  
<a name="Book+recordInventoryLatency"></a>

### documentOfferBook.recordInventoryLatency(sellerId, latencyMs, [opts])
Record an inventory round trip for a provider.

**Kind**: instance method of [<code>Book</code>](#Book)  

| Param | Type | Description |
| --- | --- | --- |
| sellerId | <code>string</code> |  |
| latencyMs | <code>number</code> |  |
| [opts] | <code>Object</code> |  |
| [opts.hops] | <code>number</code> | gossip hops the response travelled |

<a name="Book+recordDelivery"></a>

### documentOfferBook.recordDelivery(sellerId, outcome)
Record a delivery outcome (a blob plan or a single blob).

**Kind**: instance method of [<code>Book</code>](#Book)  

| Param | Type | Description |
| --- | --- | --- |
| sellerId | <code>string</code> |  |
| outcome | <code>Object</code> |  |
| outcome.ok | <code>boolean</code> | bytes verified against the advertised hash |
| [outcome.latencyMs] | <code>number</code> |  |
| [outcome.bytes] | <code>number</code> |  |

<a name="Book+recordRefund"></a>

### documentOfferBook.recordRefund(sellerId)
Record that a purchase from this provider ended in an HTLC refund.

**Kind**: instance method of [<code>Book</code>](#Book)  

| Param | Type |
| --- | --- |
| sellerId | <code>string</code> | 

<a name="Book+recordPenalty"></a>

### documentOfferBook.recordPenalty(sellerId, [proof])
Record a verified fraud proof against this provider.

**Kind**: instance method of [<code>Book</code>](#Book)  

| Param | Type | Description |
| --- | --- | --- |
| sellerId | <code>string</code> |  |
| [proof] | <code>Object</code> | `{ kind }` from `types/witness` FraudProof |

<a name="Book+ingestFraudProof"></a>

### documentOfferBook.ingestFraudProof(body, [ctx]) ⇒ <code>Object</code>
Verify a `FraudProof` body (`types/witness`) and penalize the offender
locally. The offender is an x-only pubkey; every seller whose offer rows
were signed by that key (33-byte `sellerPubkey` / `ampSignerPubkey`, or an
x-only `sellerId`) takes the penalty. Reputation stays local (decision 4).

**Kind**: instance method of [<code>Book</code>](#Book)  

| Param | Type | Description |
| --- | --- | --- |
| body | <code>Object</code> | `CONTRACT_MESSAGE` body |
| [ctx] | <code>Object</code> | `{ epoch }` for non-response proofs |

<a name="Book+scoreFor"></a>

### documentOfferBook.scoreFor(sellerId) ⇒ <code>number</code>
Derived 0..1000 score. Unknown providers score [SCORE_UNKNOWN](#SCORE_UNKNOWN); a
verified penalty is weighted as ten failed deliveries.

**Kind**: instance method of [<code>Book</code>](#Book)  

| Param | Type |
| --- | --- |
| sellerId | <code>string</code> | 

<a name="Book+latencyFor"></a>

### documentOfferBook.latencyFor(sellerId) ⇒ <code>number</code>
Effective latency for ranking: measured RTT plus a per-hop penalty.

**Kind**: instance method of [<code>Book</code>](#Book)  

| Param | Type |
| --- | --- |
| sellerId | <code>string</code> | 

<a name="Book+providerStats"></a>

### documentOfferBook.providerStats(sellerId) ⇒ <code>object</code> \| <code>null</code>
**Kind**: instance method of [<code>Book</code>](#Book)  

| Param | Type |
| --- | --- |
| sellerId | <code>string</code> | 

<a name="Book+listProviders"></a>

### documentOfferBook.listProviders() ⇒ <code>Array.&lt;object&gt;</code>
All known providers with derived score, best first.

**Kind**: instance method of [<code>Book</code>](#Book)  
<a name="Book+exportTelemetry"></a>

### documentOfferBook.exportTelemetry() ⇒ <code>Object</code>
Signable, versioned telemetry record (local persistence; future gossip).

**Kind**: instance method of [<code>Book</code>](#Book)  
<a name="Book+importTelemetry"></a>

### documentOfferBook.importTelemetry(record) ⇒ <code>number</code>
Merge a telemetry record exported earlier (same node). Counters add;
latencies take the newer sample.

**Kind**: instance method of [<code>Book</code>](#Book)  
**Returns**: <code>number</code> - providers merged  

| Param | Type |
| --- | --- |
| record | <code>object</code> | 

<a name="Book+ingestInventoryResponse"></a>

### documentOfferBook.ingestInventoryResponse(opts)
Ingest an `INVENTORY_RESPONSE`. Caller-supplied `peerScore` / `latencyMs`
win; otherwise local telemetry for the seller is applied.

**Kind**: instance method of [<code>Book</code>](#Book)  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> |  |
| opts.origin | <code>string</code> | seller address / peer key |
| opts.items | <code>Array.&lt;object&gt;</code> | inventory items |
| [opts.peerScore] | <code>number</code> |  |
| [opts.latencyMs] | <code>number</code> | measured round trip for this response |
| [opts.hops] | <code>number</code> | gossip hops travelled |
| [opts.sellerId] | <code>string</code> |  |
| [opts.sellerPubkey] | <code>string</code> |  |
| [opts.signerPubkeyHex] | <code>string</code> | AMP signer (preferred identity) |

<a name="Book+forgetSeller"></a>

### documentOfferBook.forgetSeller(sellerId) ⇒ <code>number</code>
Drop every offer from one seller (disconnect, fraud, expiry).

**Kind**: instance method of [<code>Book</code>](#Book)  
**Returns**: <code>number</code> - rows removed  

| Param | Type |
| --- | --- |
| sellerId | <code>string</code> | 

<a name="Book+listOffers"></a>

### documentOfferBook.listOffers([filter]) ⇒ <code>Array.&lt;object&gt;</code>
**Kind**: instance method of [<code>Book</code>](#Book)  

| Param | Type | Description |
| --- | --- | --- |
| [filter] | <code>Object</code> |  |
| [filter.documentId] | <code>string</code> |  |
| [filter.blobIndex] | <code>number</code> |  |
| [filter.blobHashHex] | <code>string</code> | chunk selector |
| [filter.merkleRootHex] | <code>string</code> | tree selector |
| [filter.sellerId] | <code>string</code> |  |

<a name="Book+providersForBlob"></a>

### documentOfferBook.providersForBlob(blobHashHex, [opts]) ⇒ <code>Array.&lt;object&gt;</code>
Chunk index: ranked providers for one blob hash.

**Kind**: instance method of [<code>Book</code>](#Book)  
**Returns**: <code>Array.&lt;object&gt;</code> - ranked offers, best first  

| Param | Type | Description |
| --- | --- | --- |
| blobHashHex | <code>string</code> |  |
| [opts] | <code>Object</code> | see [pickBest](#Book+pickBest) |

<a name="Book+indexByBlobHash"></a>

### documentOfferBook.indexByBlobHash([filter]) ⇒ <code>Map.&lt;string, Array.&lt;object&gt;&gt;</code>
Full chunk index: blob hash → ranked offers.

**Kind**: instance method of [<code>Book</code>](#Book)  

| Param | Type | Description |
| --- | --- | --- |
| [filter] | <code>Object</code> | `{ merkleRootHex, documentId }` |

<a name="Book+rankOffers"></a>

### documentOfferBook.rankOffers(offers, [weights]) ⇒ <code>Array.&lt;object&gt;</code>
**Kind**: instance method of [<code>Book</code>](#Book)  
**Returns**: <code>Array.&lt;object&gt;</code> - offers with `rankScore`, best first  

| Param | Type |
| --- | --- |
| offers | <code>Array.&lt;object&gt;</code> | 
| [weights] | <code>Object</code> | 

<a name="Book+pickBest"></a>

### documentOfferBook.pickBest(documentId, [opts]) ⇒ <code>object</code> \| <code>null</code>
**Kind**: instance method of [<code>Book</code>](#Book)  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>string</code> |  |
| [opts] | <code>Object</code> |  |
| [opts.blobIndex] | <code>number</code> |  |
| [opts.maxSats] | <code>number</code> |  |
| [opts.minPaidSats] | <code>number</code> | drop paid offers below this (free offers stay) |
| [opts.excludeSellers] | <code>Array.&lt;string&gt;</code> |  |
| [opts.merkleRootHex] | <code>string</code> | only offers for this tree root |
| [opts.weights] | <code>Object</code> |  |

<a name="Book+pickBlobPlan"></a>

### documentOfferBook.pickBlobPlan(documentId, blobTotal, [opts]) ⇒ <code>Map.&lt;number, object&gt;</code>
One offer per blob index. Prefers seller diversity when rank scores are
within 10%. With per-blob sealing (every blob has its own `K_i` and
payment hash) sealed trees split across sellers exactly like unsealed
ones; a legacy document-level seal (`opts.singleKey`) stays on one seller.

**Kind**: instance method of [<code>Book</code>](#Book)  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>string</code> |  |
| blobTotal | <code>number</code> |  |
| [opts] | <code>Object</code> |  |
| [opts.singleKey] | <code>boolean</code> | legacy whole-document key: lock one seller |
| [opts.maxSats] | <code>number</code> | per-blob ceiling |
| [opts.minPaidSats] | <code>number</code> | drop paid offers below this (free offers stay) |
| [opts.excludeSellers] | <code>Array.&lt;string&gt;</code> |  |
| [opts.merkleRootHex] | <code>string</code> | only offers for this tree root; when   omitted the plan still stays on **one** root (the first pick's), so   blobs from different trees are never mixed into a single document |

<a name="Book+groupPlanBySeller"></a>

### documentOfferBook.groupPlanBySeller(plan) ⇒ <code>Array.&lt;object&gt;</code>
Group a blob plan by seller: the MVP economic unit (one L1 HTLC per
seller covering every blob picked from them).

**Kind**: instance method of [<code>Book</code>](#Book)  
**Returns**: <code>Array.&lt;object&gt;</code> - `[{ sellerId, sellerAddress, blobIndexes, totalSats, offers }]`  

| Param | Type | Description |
| --- | --- | --- |
| plan | <code>Map.&lt;number, object&gt;</code> | from [pickBlobPlan](#Book+pickBlobPlan) |

<a name="Peer"></a>

## Peer ⇐ [<code>Service</code>](#Service)
P2P node: TCP/NOISE sessions, gossip, and relay of [Message](#Message) (AMP) frames. Extends [Service](#Service)
(hence [Actor](#Actor)). Opcode and receipt semantics must stay aligned with <strong>@fabric/http</strong> and Hub when you add types —
see [Message](#Message) wire vs friendly names and <code>constants</code> opcodes.

**Kind**: global class  
**Extends**: [<code>Service</code>](#Service)  

* [Peer](#Peer) ⇐ [<code>Service</code>](#Service)
    * [new Peer([config])](#new_Peer_new)
    * [._actorsByName](#Peer+_actorsByName) : <code>Object.&lt;string, string&gt;</code>
    * [.pendingDocumentRequests](#Peer+pendingDocumentRequests)
    * [._authorizedDocumentKeyReveals](#Peer+_authorizedDocumentKeyReveals)
    * [._contractPatchAllowList](#Peer+_contractPatchAllowList)
    * [._contractGenesis](#Peer+_contractGenesis)
    * [.blobTransfers](#Peer+blobTransfers)
    * [.pendingSealedDeliveries](#Peer+pendingSealedDeliveries)
    * [.pendingSealedBlobs](#Peer+pendingSealedBlobs)
    * [._documentRelayRoutes](#Peer+_documentRelayRoutes)
    * [._inboundNoiseStaticPubkeyByAddress](#Peer+_inboundNoiseStaticPubkeyByAddress)
    * [.messages](#Peer+messages)
    * [._logicalRegisterOnce](#Peer+_logicalRegisterOnce) : <code>Map.&lt;string, {type: string, signer: (string\|null), at: number}&gt;</code>
    * [._gossipPayloadSeen](#Peer+_gossipPayloadSeen)
    * [._gossipRelayByOrigin](#Peer+_gossipRelayByOrigin)
    * [._chatRelayByOrigin](#Peer+_chatRelayByOrigin)
    * [._peeringPayloadSeen](#Peer+_peeringPayloadSeen)
    * [._peeringRelayByOrigin](#Peer+_peeringRelayByOrigin)
    * [._wireInboundByOrigin](#Peer+_wireInboundByOrigin)
    * [._peerBandwidthByOrigin](#Peer+_peerBandwidthByOrigin)
    * [._logicalDupPenaltyByOrigin](#Peer+_logicalDupPenaltyByOrigin)
    * [._peerBans](#Peer+_peerBans) : <code>Map.&lt;string, {until: number, reason: string}&gt;</code>
    * [._candidateKeys](#Peer+_candidateKeys)
    * [._candidateRetryAt](#Peer+_candidateRetryAt)
    * [._outboundDialTargets](#Peer+_outboundDialTargets)
    * [._selfDialSuppressUntil](#Peer+_selfDialSuppressUntil) : <code>Map.&lt;string, number&gt;</code>
    * [._musigSessions](#Peer+_musigSessions) : <code>Map.&lt;string, object&gt;</code>
    * [.bandwidthSummary](#Peer+bandwidthSummary) ⇒ <code>Object</code>
    * ~~[.address](#Peer+address)~~
    * [.knownPeers](#Peer+knownPeers) ⇒ <code>Array.&lt;object&gt;</code>
    * [._gossipPayloadDedupKey(msg)](#Peer+_gossipPayloadDedupKey) ⇒ <code>string</code>
    * [._logicalRegistrationKey(type, object)](#Peer+_logicalRegistrationKey) ⇒ <code>string</code> \| <code>null</code>
    * [._claimLogicalRegistration(type, object, [signerPubkeyHex])](#Peer+_claimLogicalRegistration) ⇒ <code>Object</code>
    * [._applyPeerMisbehavior(originName, reason, [opts])](#Peer+_applyPeerMisbehavior)
    * [._banPeer(originName, reason)](#Peer+_banPeer)
    * [._isPeerBanned(originName, [pubkeyHex])](#Peer+_isPeerBanned) ⇒ <code>boolean</code>
    * [._logicalRegisterDuplicateMisbehavior(originName, type, claim, [signerPubkeyHex])](#Peer+_logicalRegisterDuplicateMisbehavior)
    * [._claimLogicalRegistrationOrPunish(type, object, [signerPubkeyHex], [originName])](#Peer+_claimLogicalRegistrationOrPunish) ⇒ <code>Object</code>
    * [._gossipRateLimitAllow(originName)](#Peer+_gossipRateLimitAllow) ⇒ <code>boolean</code>
    * [._chatRateLimitAllow(originName)](#Peer+_chatRateLimitAllow) ⇒ <code>boolean</code>
    * [._wireInboundCreditCost(wireType)](#Peer+_wireInboundCreditCost) ⇒ <code>number</code>
    * [._wireInboundRateAllowPeer(originName, creditCost)](#Peer+_wireInboundRateAllowPeer) ⇒ <code>boolean</code>
    * [._derankPeerForWireTraffic(originName, penalty, reason)](#Peer+_derankPeerForWireTraffic)
    * [._peeringOfferPayloadDedupKey(msg)](#Peer+_peeringOfferPayloadDedupKey) ⇒ <code>string</code>
    * [._peeringRateLimitAllow(originName)](#Peer+_peeringRateLimitAllow) ⇒ <code>boolean</code>
    * [._enqueuePeeringCandidate(host, port, [meta])](#Peer+_enqueuePeeringCandidate)
    * [._localFabricPubkeyHex()](#Peer+_localFabricPubkeyHex) ⇒ <code>string</code>
    * [._isOwnFabricPubkey(hex)](#Peer+_isOwnFabricPubkey) ⇒ <code>boolean</code>
    * [._isOwnFabricActorId(id)](#Peer+_isOwnFabricActorId) ⇒ <code>boolean</code>
    * [._suppressSelfDialAddress(address, [ttlMs])](#Peer+_suppressSelfDialAddress)
    * [._isSelfDialSuppressed(address)](#Peer+_isSelfDialSuppressed) ⇒ <code>boolean</code>
    * [._abortSelfFabricSession(connAddress, [reason])](#Peer+_abortSelfFabricSession) ⇒ [<code>Peer</code>](#Peer)
    * [.countNoiseHandshakeListeners()](#Peer+countNoiseHandshakeListeners) ⇒ <code>Object</code>
    * [.broadcast(message, [origin])](#Peer+broadcast) ⇒ <code>number</code>
    * [._localXOnlyPeerId()](#Peer+_localXOnlyPeerId) ⇒ <code>Buffer</code>
    * [._resolveAddressByXOnly(peerId)](#Peer+_resolveAddressByXOnly) ⇒ <code>string</code> \| <code>null</code>
    * [.sendOnion(path, payload)](#Peer+sendOnion) ⇒ <code>boolean</code>
    * [.startMusig2([opts])](#Peer+startMusig2) ⇒ <code>object</code> \| <code>null</code>
    * [.getMusig2Session(sessionId)](#Peer+getMusig2Session) ⇒ <code>object</code> \| <code>null</code>
    * [.relayFromTrustedPeers(origin, message, [minScoreExclusive])](#Peer+relayFromTrustedPeers)
    * [._registryScoreForConnectionAddress(connAddress)](#Peer+_registryScoreForConnectionAddress) ⇒ <code>number</code>
    * [._registryScoreForFlushChainSender(connAddress, senderPubkeyHex)](#Peer+_registryScoreForFlushChainSender) ⇒ <code>number</code>
    * [.sendFlushChainToTrustedPeers(object)](#Peer+sendFlushChainToTrustedPeers) ⇒ <code>number</code>
    * [._connect(target)](#Peer+_connect)
    * [._announceAlias(alias, [origin], [_socket])](#Peer+_announceAlias)
    * [._loadPeerRegistry()](#Peer+_loadPeerRegistry) ⇒ <code>Promise.&lt;void&gt;</code>
    * [._savePeerRegistry()](#Peer+_savePeerRegistry)
    * [._flushChainSenderPubkeyHex()](#Peer+_flushChainSenderPubkeyHex)
    * [._upsertPeerRegistry(address, [updates])](#Peer+_upsertPeerRegistry)
    * [._fillPeerSlots()](#Peer+_fillPeerSlots) ⇒ [<code>Peer</code>](#Peer)
    * [._handleFabricMessage(buffer, [origin], [socket], [options])](#Peer+_handleFabricMessage) ⇒ [<code>Peer</code>](#Peer)
    * [._relayWirePayload()](#Peer+_relayWirePayload)
    * [._relayGenericPayload()](#Peer+_relayGenericPayload)
    * [._isTransientSocketError(error)](#Peer+_isTransientSocketError) ⇒ <code>boolean</code>
    * [._attachNoiseStreamErrorHandlers(noiseStream, [label])](#Peer+_attachNoiseStreamErrorHandlers)
    * [._detachNoiseStreamErrorHandlers(noiseStream)](#Peer+_detachNoiseStreamErrorHandlers) ⇒ <code>void</code>
    * [._teardownNoiseClient(socket)](#Peer+_teardownNoiseClient) ⇒ <code>void</code>
    * [._buildDocumentParsedForPublish(documentId, content)](#Peer+_buildDocumentParsedForPublish) ⇒ <code>Object</code>
    * [._collectDocumentCatalogInventoryItems([req])](#Peer+_collectDocumentCatalogInventoryItems) ⇒ <code>Array.&lt;object&gt;</code>
    * [._sendLocalInventoryDocumentsWireResponse(originName, items, [opts])](#Peer+_sendLocalInventoryDocumentsWireResponse) ⇒ <code>boolean</code>
    * [._respondInventoryFromLocalDocuments(message, origin)](#Peer+_respondInventoryFromLocalDocuments) ⇒ <code>boolean</code>
    * [.publishSealedDocument(doc, [opts])](#Peer+publishSealedDocument) ⇒ <code>Object</code>
    * [.sealedBlobPreimageForPaymentHash(paymentHashHex)](#Peer+sealedBlobPreimageForPaymentHash) ⇒ <code>Object</code> \| <code>null</code>
    * [._getSealedBlobDocument(documentId)](#Peer+_getSealedBlobDocument) ⇒ [<code>Document</code>](#Document) \| <code>null</code>
    * [._sendP2pFileSendToPeer(documentId, peerAddress, [opts])](#Peer+_sendP2pFileSendToPeer) ⇒ <code>boolean</code>
    * [._sendDocumentContentKeyReveal(documentId, peerAddress, [opts])](#Peer+_sendDocumentContentKeyReveal) ⇒ <code>boolean</code>
    * [.sealedBlobKeyForPaymentHash(paymentHashHex)](#Peer+sealedBlobKeyForPaymentHash) ⇒ <code>Object</code> \| <code>null</code>
    * [.openSealedBlobWithKey(opts)](#Peer+openSealedBlobWithKey) ⇒ <code>Object</code>
    * [._ingestP2pFileSend(message, origin, [wireMessage])](#Peer+_ingestP2pFileSend) ⇒ <code>Object</code>
    * [._handleDocumentContentKeyReveal(reveal, [origin])](#Peer+_handleDocumentContentKeyReveal) ⇒ <code>Object</code>
    * [.openSealedDeliveryWithPreimage(documentId, preimageHex)](#Peer+openSealedDeliveryWithPreimage) ⇒ <code>Object</code>
    * [.sendDocumentFileToPeer(documentId, peerAddress, [opts])](#Peer+sendDocumentFileToPeer) ⇒ <code>boolean</code>
    * [.requestPeerInventory(peerAddress, [opts])](#Peer+requestPeerInventory) ⇒ <code>boolean</code>
    * [.requestDocument(documentId, [peerAddress], [opts])](#Peer+requestDocument) ⇒ <code>boolean</code>
    * [._attachHtlcOfferToItem(item, req, contentHashHex, amountSats)](#Peer+_attachHtlcOfferToItem) ⇒ <code>object</code> \| <code>null</code>
    * [.listPendingDocumentRequests()](#Peer+listPendingDocumentRequests) ⇒ <code>Array.&lt;object&gt;</code>
    * [.approveDocumentRequest(requestKey)](#Peer+approveDocumentRequest) ⇒ <code>Object</code>
    * [.authorizeDocumentKeyReveal(opts)](#Peer+authorizeDocumentKeyReveal) ⇒ <code>Object</code>
    * [.denyDocumentRequest(requestKey)](#Peer+denyDocumentRequest) ⇒ <code>Object</code>
    * [._buildPublishDocumentWireBuffers(documentId, body, rateSats)](#Peer+_buildPublishDocumentWireBuffers) ⇒ <code>Array.&lt;Buffer&gt;</code>
    * [._announceLocalDocumentsToPeer(peerAddress)](#Peer+_announceLocalDocumentsToPeer)
    * [._publishDocument(documentId, [content], [rateSats])](#Peer+_publishDocument)
    * [._handleDocumentRequestWire(message, origin, socket, [options])](#Peer+_handleDocumentRequestWire)
    * [._privateRelayDocumentRequest(parsed, origin, [originalMessage])](#Peer+_privateRelayDocumentRequest)
    * [._sendPrivateRelayedDocumentRequest(msg, origin, parsed)](#Peer+_sendPrivateRelayedDocumentRequest) ⇒ <code>boolean</code>
    * [._maybeReverseRelayFileSend(fileObj, origin)](#Peer+_maybeReverseRelayFileSend) ⇒ <code>boolean</code>
    * [._unregisterSocketActor(address)](#Peer+_unregisterSocketActor) ⇒ <code>void</code>
    * [._contractPublishSignerAuthorized(object, signerPubkeyHex)](#Peer+_contractPublishSignerAuthorized) ⇒ <code>boolean</code>
    * [._distributedFederationValidatorsFromSettings()](#Peer+_distributedFederationValidatorsFromSettings) ⇒ <code>Array.&lt;string&gt;</code>
    * [._distributedFederationThresholdFromSettings()](#Peer+_distributedFederationThresholdFromSettings) ⇒ <code>number</code>
    * [._registerContract(object, [publisherPubkeyHex])](#Peer+_registerContract) ⇒ <code>boolean</code>
    * [._mergeContractPatchAllowList(contractId, object, [_publisherPubkeyHex])](#Peer+_mergeContractPatchAllowList)
    * [._signerMayPatchContract(contractId, signerPubkeyHex)](#Peer+_signerMayPatchContract) ⇒ <code>boolean</code>
    * [._startFabricPingKeepalive(socket, encryptWrite)](#Peer+_startFabricPingKeepalive)
    * [._writeFabric(msg, stream)](#Peer+_writeFabric) ⇒ <code>boolean</code>
    * [.start()](#Peer+start)
    * [.stop()](#Peer+stop)
    * [.listen()](#Peer+listen) ⇒ [<code>Peer</code>](#Peer)
    * [._appendWarning(msg)](#Service+_appendWarning) ⇒ [<code>Service</code>](#Service)
    * [.init()](#Service+init)
    * [.tick()](#Service+tick) ⇒ <code>Number</code>
    * [.beat()](#Service+beat) ⇒ [<code>Service</code>](#Service)
    * [.get(path)](#Service+get) ⇒ <code>Mixed</code>
    * [.set(path)](#Service+set) ⇒ <code>Mixed</code>
    * [.trust(source)](#Service+trust) ⇒ [<code>Service</code>](#Service)
    * [.handler(message)](#Service+handler) ⇒ [<code>Service</code>](#Service)
    * [.lock([duration])](#Service+lock) ⇒ <code>Boolean</code>
    * [.when(event, method)](#Service+when) ⇒ <code>EventEmitter</code>
    * [.defineOpcode(name, [definition])](#Service+defineOpcode) ⇒ <code>Object</code>
    * [.defineBitcoinOpcode(name, [definition])](#Service+defineBitcoinOpcode) ⇒ <code>Object</code>
    * [.defineFabricOpcode(name, [definition])](#Service+defineFabricOpcode) ⇒ <code>Object</code>
    * [.defineOpcodeContract(name, body, [meta])](#Service+defineOpcodeContract) ⇒ <code>Object</code>
    * [.listOpcodes()](#Service+listOpcodes) ⇒ <code>Array.&lt;Object&gt;</code>
    * [.route(msg)](#Service+route) ⇒ <code>Promise</code>
    * [._GET(path)](#Service+_GET) ⇒ <code>Promise</code>
    * [._PUT(path, value, [commit])](#Service+_PUT) ⇒ <code>Promise</code>
    * [.connect(notify)](#Service+connect) ⇒ <code>Promise</code>
    * [.send(channel, message)](#Service+send) ⇒ [<code>Service</code>](#Service)
    * [.commit()](#Service+commit) ⇒ <code>String</code>
    * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
    * [._send(message)](#Service+_send)
    * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
    * [.export()](#Actor+export) ⇒ <code>Object</code>
    * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
    * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
    * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
    * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
    * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
    * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
    * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
    * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
    * [.value([format])](#Actor+value) ⇒ <code>Object</code>
    * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>

<a name="new_Peer_new"></a>

### new Peer([config])
Create an instance of [Peer](#Peer).


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [config] | <code>Object</code> |  | Initialization Vector for this peer. |
| [config.listen] | <code>Boolean</code> |  | Whether or not to listen for connections. |
| [config.upnp] | <code>Boolean</code> |  | Whether or not to use UPNP for automatic configuration. |
| [config.port] | <code>Number</code> | <code>7777</code> | Port to use for P2P connections. |
| [config.listenPortAttempts] | <code>Number</code> | <code>20</code> | When the listen port is in use (`EADDRINUSE`),   try the next port up to this many times (same host). |
| [config.peers] | <code>Array</code> | <code>[]</code> | List of initial peers. |

<a name="Peer+_actorsByName"></a>

### peer.\_actorsByName : <code>Object.&lt;string, string&gt;</code>
**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+pendingDocumentRequests"></a>

### peer.pendingDocumentRequests
Pending DOCUMENT_REQUEST entries when [Peer#settings.autoFulfillDocumentRequests](Peer#settings.autoFulfillDocumentRequests) is false.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_authorizedDocumentKeyReveals"></a>

### peer.\_authorizedDocumentKeyReveals
Authorized sealed-document key reveals: `"documentId|paymentHashHex"` → meta.
Populated only after verified settlement (never from public hash echo).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_contractPatchAllowList"></a>

### peer.\_contractPatchAllowList
contractId → Set of lowercase compressed pubkeys allowed to apply state ops.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_contractGenesis"></a>

### peer.\_contractGenesis
contractId → original CONTRACT_PUBLISH body (ARC genesis for ingest).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+blobTransfers"></a>

### peer.blobTransfers
Buyer-side verified blob reassembly (DocumentBlobIndex).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+pendingSealedDeliveries"></a>

### peer.pendingSealedDeliveries
Ciphertext awaiting content-key reveal: documentId → meta.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+pendingSealedBlobs"></a>

### peer.pendingSealedBlobs
Per-blob sealed trees awaiting one `DocumentContentKeyReveal` per blob (types/document.js).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_documentRelayRoutes"></a>

### peer.\_documentRelayRoutes
Private reverse routes for rewritten DocumentRequests (never gossiped).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_inboundNoiseStaticPubkeyByAddress"></a>

### peer.\_inboundNoiseStaticPubkeyByAddress
Inbound address -> NOISE static pubkey hex (FLUSH_CHAIN allowlist only; never for AMP verify).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+messages"></a>

### peer.messages
Wire-envelope dedup (SHA-256 of full buffer); FIFO-capped via [Peer#_rememberWireHash](Peer#_rememberWireHash).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_logicalRegisterOnce"></a>

### peer.\_logicalRegisterOnce : <code>Map.&lt;string, {type: string, signer: (string\|null), at: number}&gt;</code>
Logical first-writer-wins registrations (content-addressed keys).
Catches re-signed duplicates of CONTRACT_PUBLISH / DOCUMENT_PUBLISH / etc.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_gossipPayloadSeen"></a>

### peer.\_gossipPayloadSeen
Logical gossip payload dedup (excludes signature / hop churn).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_gossipRelayByOrigin"></a>

### peer.\_gossipRelayByOrigin
origin address → { count, windowStart } for gossip relay rate limiting.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_chatRelayByOrigin"></a>

### peer.\_chatRelayByOrigin
origin address → { count, windowStart } for chat mesh relay rate limiting.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_peeringPayloadSeen"></a>

### peer.\_peeringPayloadSeen
Logical peering-offer payload dedup (ignores advisory peeringHop; frames relay as-is).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_peeringRelayByOrigin"></a>

### peer.\_peeringRelayByOrigin
origin address → { count, windowStart } for peering-offer relay rate limiting.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_wireInboundByOrigin"></a>

### peer.\_wireInboundByOrigin
`host:port` → { credits, windowStart, penalized } — inbound wire flood / de-rank (per peer).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_peerBandwidthByOrigin"></a>

### peer.\_peerBandwidthByOrigin
`host:port` → rolling L1-window byte counters (session + 10 min).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_logicalDupPenaltyByOrigin"></a>

### peer.\_logicalDupPenaltyByOrigin
`host:port` → { windowStart, penalized } — soft logical-duplicate derank once per window.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_peerBans"></a>

### peer.\_peerBans : <code>Map.&lt;string, {until: number, reason: string}&gt;</code>
Temporary bans after hard misbehavior: `addr:<host:port>` or `pk:<hex>` → { until, reason }.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_candidateKeys"></a>

### peer.\_candidateKeys
`host:port` keys for [P2P_PEERING_OFFER](P2P_PEERING_OFFER) candidate queue dedup.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_candidateRetryAt"></a>

### peer.\_candidateRetryAt
`host:port` → next allowed dial (ms). Caps refused-candidate storms.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_outboundDialTargets"></a>

### peer.\_outboundDialTargets
`host:port` strings we opened via [_connect](#Peer+_connect) (outbound dials).
[P2P_SESSION_OFFER](P2P_SESSION_OFFER) must not destroy these when the same peer also opens an inbound
socket (mesh star): otherwise RPC paths that use the listen address (e.g. ChainSyncRequest)
see `peer not connected` while an ephemeral inbound key remains.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_selfDialSuppressUntil"></a>

### peer.\_selfDialSuppressUntil : <code>Map.&lt;string, number&gt;</code>
Addresses suppressed after a self-session (own Fabric key on the wire).
Map `host:port` → expiry ms (Date.now()).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_musigSessions"></a>

### peer.\_musigSessions : <code>Map.&lt;string, object&gt;</code>
BIP-327 directed sessions keyed by sessionId hex.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+bandwidthSummary"></a>

### peer.bandwidthSummary ⇒ <code>Object</code>
Node-wide Fabric P2P bandwidth vs the L1 1 MiB / 10 min target.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+address"></a>

### ~~peer.address~~
***Deprecated***

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+knownPeers"></a>

### peer.knownPeers ⇒ <code>Array.&lt;object&gt;</code>
Registry plus live connections. Each row includes rolling Fabric P2P
bandwidth (`bytesIn` / `bytesOut` / `windowBytes` vs L1 `budgetBytes`).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_gossipPayloadDedupKey"></a>

### peer.\_gossipPayloadDedupKey(msg) ⇒ <code>string</code>
Stable id for gossip *logical* content (ignores advisory `gossipHop`; frames are forwarded bit-identical).
Mesh frames are relayed bit-identical; wire-hash dedup also prevents loops.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>string</code> - hex sha256  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>object</code> | Generic message (`type`, `object`, …) |

<a name="Peer+_logicalRegistrationKey"></a>

### peer.\_logicalRegistrationKey(type, object) ⇒ <code>string</code> \| <code>null</code>
Content-addressed key for first-writer-wins registration types.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| type | <code>string</code> | wire / generic type name |
| object | <code>object</code> \| <code>null</code> \| <code>undefined</code> | message body / object |

<a name="Peer+_claimLogicalRegistration"></a>

### peer.\_claimLogicalRegistration(type, object, [signerPubkeyHex]) ⇒ <code>Object</code>
Claim a logical registration key (first writer wins).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| type | <code>string</code> |  | 
| object | <code>object</code> \| <code>null</code> \| <code>undefined</code> |  | 
| [signerPubkeyHex] | <code>string</code> \| <code>null</code> | <code>null</code> | 

<a name="Peer+_applyPeerMisbehavior"></a>

### peer.\_applyPeerMisbehavior(originName, reason, [opts])
Lower registry score and optionally destroy the TCP connection (hard misbehavior).
Hard disconnects also install a temporary ban (address + known pubkey).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| originName | <code>string</code> \| <code>null</code> \| <code>undefined</code> | 
| reason | <code>string</code> | 
| [opts] | <code>Object</code> | 
| [opts.penalty] | <code>number</code> | 
| [opts.disconnect] | <code>boolean</code> | 

<a name="Peer+_banPeer"></a>

### peer.\_banPeer(originName, reason)
Ban a connection address (and mapped pubkey when known) for [Peer#settings.peerScore.banTtlMs](Peer#settings.peerScore.banTtlMs).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| originName | <code>string</code> | 
| reason | <code>string</code> | 

<a name="Peer+_isPeerBanned"></a>

### peer.\_isPeerBanned(originName, [pubkeyHex]) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| originName | <code>string</code> \| <code>null</code> \| <code>undefined</code> | <code>null</code> | 
| [pubkeyHex] | <code>string</code> \| <code>null</code> \| <code>undefined</code> | <code>null</code> | 

<a name="Peer+_logicalRegisterDuplicateMisbehavior"></a>

### peer.\_logicalRegisterDuplicateMisbehavior(originName, type, claim, [signerPubkeyHex])
Soft (once/window) or hijack (CONTRACT_PUBLISH other signer) penalty for logical duplicates.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| originName | <code>string</code> \| <code>null</code> \| <code>undefined</code> | 
| type | <code>string</code> | 
| claim | <code>Object</code> | 
| [claim.prior] | <code>Object</code> \| <code>null</code> | 
| [claim.prior.signer] | <code>string</code> \| <code>null</code> | 
| [signerPubkeyHex] | <code>string</code> \| <code>null</code> | 

<a name="Peer+_claimLogicalRegistrationOrPunish"></a>

### peer.\_claimLogicalRegistrationOrPunish(type, object, [signerPubkeyHex], [originName]) ⇒ <code>Object</code>
Claim logical registration; on duplicate, apply misbehavior and return claim.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| type | <code>string</code> |  | 
| object | <code>object</code> \| <code>null</code> \| <code>undefined</code> |  | 
| [signerPubkeyHex] | <code>string</code> \| <code>null</code> | <code>null</code> | 
| [originName] | <code>string</code> \| <code>null</code> | <code>null</code> | 

<a name="Peer+_gossipRateLimitAllow"></a>

### peer.\_gossipRateLimitAllow(originName) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| originName | <code>string</code> | Connection id (e.g. `host:port`) |

<a name="Peer+_chatRateLimitAllow"></a>

### peer.\_chatRateLimitAllow(originName) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| originName | <code>string</code> | Connection id (e.g. `host:port`) |

<a name="Peer+_wireInboundCreditCost"></a>

### peer.\_wireInboundCreditCost(wireType) ⇒ <code>number</code>
Credit cost for inbound wire messages (heavier types consume more of the peer's budget).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| wireType | <code>string</code> \| <code>number</code> | 

<a name="Peer+_wireInboundRateAllowPeer"></a>

### peer.\_wireInboundRateAllowPeer(originName, creditCost) ⇒ <code>boolean</code>
Apply rolling-window credits; on overflow, de-rank once per window and reject the message.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - false = drop message  

| Param | Type | Description |
| --- | --- | --- |
| originName | <code>string</code> | connection key (host:port) |
| creditCost | <code>number</code> |  |

<a name="Peer+_derankPeerForWireTraffic"></a>

### peer.\_derankPeerForWireTraffic(originName, penalty, reason)
Lower registry [knownPeers](#Peer+knownPeers) score for a connection (Bitcoin Core misbehavior analogue).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| originName | <code>string</code> | 
| penalty | <code>number</code> | 
| reason | <code>string</code> | 

<a name="Peer+_peeringOfferPayloadDedupKey"></a>

### peer.\_peeringOfferPayloadDedupKey(msg) ⇒ <code>string</code>
Stable id for peering-offer *logical* content (ignores advisory `peeringHop`).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>string</code> - hex sha256  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>object</code> | Generic message (`type`, `object`, …) |

<a name="Peer+_peeringRateLimitAllow"></a>

### peer.\_peeringRateLimitAllow(originName) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| originName | <code>string</code> | Connection id (e.g. `host:port`) |

<a name="Peer+_enqueuePeeringCandidate"></a>

### peer.\_enqueuePeeringCandidate(host, port, [meta])
Enqueue a fabric candidate from [P2P_PEERING_OFFER](P2P_PEERING_OFFER); FIFO-capped and deduped by host:port.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| host | <code>string</code> |  |
| port | <code>number</code> |  |
| [meta] | <code>Object</code> |  |
| [meta.pubkey] | <code>string</code> | Optional advertised Fabric pubkey (informational). |
| [meta.verifiedPubkey] | <code>string</code> | AMP/session-verified pubkey; self-dial suppress uses this only. |

<a name="Peer+_localFabricPubkeyHex"></a>

### peer.\_localFabricPubkeyHex() ⇒ <code>string</code>
Local Fabric session pubkey (x-only hex), same normalization as wire signers.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_isOwnFabricPubkey"></a>

### peer.\_isOwnFabricPubkey(hex) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| hex | <code>\*</code> | 

<a name="Peer+_isOwnFabricActorId"></a>

### peer.\_isOwnFabricActorId(id) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| id | <code>\*</code> | 

<a name="Peer+_suppressSelfDialAddress"></a>

### peer.\_suppressSelfDialAddress(address, [ttlMs])
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| address | <code>string</code> |  | 
| [ttlMs] | <code>number</code> | <code>600000</code> | 

<a name="Peer+_isSelfDialSuppressed"></a>

### peer.\_isSelfDialSuppressed(address) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| address | <code>string</code> | 

<a name="Peer+_abortSelfFabricSession"></a>

### peer.\_abortSelfFabricSession(connAddress, [reason]) ⇒ [<code>Peer</code>](#Peer)
Tear down a TCP/NOISE session that presented our own Fabric identity.
Emits `peer:self` so apps can drop the address from dial lists.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| connAddress | <code>string</code> \| <code>null</code> \| <code>undefined</code> |  | 
| [reason] | <code>string</code> | <code>&quot;own Fabric identity&quot;</code> | 

<a name="Peer+countNoiseHandshakeListeners"></a>

### peer.countNoiseHandshakeListeners() ⇒ <code>Object</code>
Shared WASM handshake-bus listener counts (three events per in-flight session).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+broadcast"></a>

### peer.broadcast(message, [origin]) ⇒ <code>number</code>
Write a [Buffer](Buffer) to all connected peers.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>number</code> - Count of peers the frame was written to.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| message | <code>Buffer</code> |  | Message buffer to send. |
| [origin] | <code>string</code> \| <code>null</code> | <code>null</code> | Skip this connection id (usually the inbound origin). |

<a name="Peer+_localXOnlyPeerId"></a>

### peer.\_localXOnlyPeerId() ⇒ <code>Buffer</code>
Local node x-only pubkey (AMP {@code author} / {@code P2P_FORWARD.nextPeer} encoding).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_resolveAddressByXOnly"></a>

### peer.\_resolveAddressByXOnly(peerId) ⇒ <code>string</code> \| <code>null</code>
Resolve a live connection address for an x-only (or compressed) peer pubkey.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>string</code> \| <code>null</code> - connection key ({@code host:port}) or null  

| Param | Type |
| --- | --- |
| peerId | <code>Buffer</code> \| <code>string</code> | 

<a name="Peer+sendOnion"></a>

### peer.sendOnion(path, payload) ⇒ <code>boolean</code>
Send {@code payload} along a source-routed onion path of Fabric peer pubkeys.
Builds nested {@code P2P_FORWARD} layers and writes the outer frame only to
{@code path[0]} (immediate hop). Destination learns the last hop's IP, not
the originator's. See [module:@fabric/core/functions/fabricOnion](module:@fabric/core/functions/fabricOnion).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - true if the outer frame was written to the first hop  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Array.&lt;(Buffer\|string)&gt;</code> | hop pubkeys; first = next TCP peer, last = deliverer |
| payload | [<code>Message</code>](#Message) \| <code>Buffer</code> | innermost application Message (should already be signed) |

<a name="Peer+startMusig2"></a>

### peer.startMusig2([opts]) ⇒ <code>object</code> \| <code>null</code>
Begin a directed BIP-327 MuSig2 session (n-of-n) with connected peers.
Co-signers ignore inbound START unless `settings.musig2.autoAccept === true`.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>object</code> \| <code>null</code> - public session view  

| Param | Type | Description |
| --- | --- | --- |
| [opts] | <code>object</code> |  |
| opts.msg | <code>Buffer</code> \| <code>string</code> | message to sign (hashed to 32 bytes unless already 32) |
| [opts.pubkeys] | <code>Array.&lt;(Buffer\|string)&gt;</code> | compressed participants; default local + dest |
| [opts.dest] | <code>Buffer</code> \| <code>string</code> | peer pubkey or `host:port` for the first hop |
| [opts.purpose] | <code>string</code> |  |

<a name="Peer+getMusig2Session"></a>

### peer.getMusig2Session(sessionId) ⇒ <code>object</code> \| <code>null</code>
Public MuSig2 session snapshot (no secret nonce).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| sessionId | <code>Buffer</code> \| <code>string</code> | 

<a name="Peer+relayFromTrustedPeers"></a>

### peer.relayFromTrustedPeers(origin, message, [minScoreExclusive])
Relay an AMP message only to connected peers whose persistent registry score is strictly greater than
[Peer#settings.flushChainMinTrustedScore](Peer#settings.flushChainMinTrustedScore) (default 800). Used for `P2P_FLUSH_CHAIN`.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| origin | <code>string</code> \| <code>null</code> |  | Connection key to skip (inbound sender), or null when originating locally. |
| message | [<code>Message</code>](#Message) \| <code>Buffer</code> |  |  |
| [minScoreExclusive] | <code>number</code> | <code></code> | Override trust threshold (relay if peer score &gt; this value). |

<a name="Peer+_registryScoreForConnectionAddress"></a>

### peer.\_registryScoreForConnectionAddress(connAddress) ⇒ <code>number</code>
Best-effort registry score for a live connection key (`host:port`), using mapped Fabric id when known.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| connAddress | <code>string</code> | 

<a name="Peer+_registryScoreForFlushChainSender"></a>

### peer.\_registryScoreForFlushChainSender(connAddress, senderPubkeyHex) ⇒ <code>number</code>
FLUSH_CHAIN trust score bound to verified sender key.

Prevents trusting attacker-controlled `P2P_SESSION_OFFER.actor.id` aliases
by refusing `_addressToId`-mapped scores unless that mapped registry entry
is explicitly bound to the same verified sender pubkey.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| connAddress | <code>string</code> |  |
| senderPubkeyHex | <code>string</code> | verified sender pubkey hex (from NOISE/static or trusted peer record) |

<a name="Peer+sendFlushChainToTrustedPeers"></a>

### peer.sendFlushChainToTrustedPeers(object) ⇒ <code>number</code>
Sign and send `P2P_FLUSH_CHAIN` to all connected peers with registry score &gt; threshold.
Body JSON: `{ snapshotBlockHash, network?, label? }`.

**Receivers** (see `P2P_FLUSH_CHAIN` handler) require **both**:
1. Sender pubkey in [Peer#settings.flushChainAuthorizedPubkeys](Peer#settings.flushChainAuthorizedPubkeys) (non-empty allowlist), and
2. Registry score above [Peer#settings.flushChainMinTrustedScore](Peer#settings.flushChainMinTrustedScore).
Registry score bumps on `P2P_PONG` only when that pong answers an outbound ping on the same
connection (`_fabricPingOutstanding`), so unsolicited pongs cannot inflate trust alone.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>number</code> - number of sockets written  

| Param | Type |
| --- | --- |
| object | <code>Object</code> | 

<a name="Peer+_connect"></a>

### peer.\_connect(target)
Open a Fabric connection to the target address and initiate the Fabric Protocol.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| target | <code>String</code> | Target address. |

<a name="Peer+_announceAlias"></a>

### peer.\_announceAlias(alias, [origin], [_socket])
Broadcast a personal nickname as first-class [P2P_PEER_ALIAS](P2P_PEER_ALIAS)
(UTF-8 body = nickname text only).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| alias | <code>string</code> |  |  |
| [origin] | <code>Object</code> \| <code>null</code> | <code></code> | Optional origin to exclude from broadcast |
| [_socket] | <code>\*</code> | <code></code> | Unused (API compatibility) |

<a name="Peer+_loadPeerRegistry"></a>

### peer.\_loadPeerRegistry() ⇒ <code>Promise.&lt;void&gt;</code>
Load persistent peer registry from LevelDB.
Uses classic-level in Node, browser-level (IndexedDB) in browser.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_savePeerRegistry"></a>

### peer.\_savePeerRegistry()
Persist peer registry to LevelDB (debounced).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_flushChainSenderPubkeyHex"></a>

### peer.\_flushChainSenderPubkeyHex()
FLUSH_CHAIN sender hex: [Peer#peers](Peer#peers)[addr].publicKey if set, else inbound NOISE static (allowlist must match).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_upsertPeerRegistry"></a>

### peer.\_upsertPeerRegistry(address, [updates])
Upsert a peer into the persistent registry (state.peers) and schedule save to LevelDB.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| address | <code>string</code> | Peer address (e.g. host:port). |
| [updates] | <code>Object</code> | Fields to set/merge (id, score, firstSeen, lastSeen, alias, publicKey). |

<a name="Peer+_fillPeerSlots"></a>

### peer.\_fillPeerSlots() ⇒ [<code>Peer</code>](#Peer)
Attempt to fill available connection slots with new peers.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Peer</code>](#Peer) - Instance of the peer.  
<a name="Peer+_handleFabricMessage"></a>

### peer.\_handleFabricMessage(buffer, [origin], [socket], [options]) ⇒ [<code>Peer</code>](#Peer)
Handle a Fabric [Message](#Message) buffer.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Peer</code>](#Peer) - Instance of the Peer.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| buffer | <code>Buffer</code> |  |  |
| [origin] | <code>object</code> \| <code>null</code> | <code></code> |  |
| [socket] | <code>object</code> \| <code>null</code> | <code></code> |  |
| [options] | <code>Object</code> | <code></code> |  |
| [options.relayDepth] | <code>number</code> |  |  |
| [options.skipRelayFlood] | <code>boolean</code> |  |  |
| [options.peeledForward] | <code>boolean</code> |  | true when delivered via [Peer#_handleP2PForward](Peer#_handleP2PForward) peel |

<a name="Peer+_relayWirePayload"></a>

### peer.\_relayWirePayload()
Originate a locally signed {@code P2P_RELAY} envelope around already-signed inner AMP bytes.
Used only when *this* agent starts a flood (e.g. inventory without a prior wire frame).
Inbound {@code P2P_RELAY} must never call this — forward the original outer bit-identical.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_relayGenericPayload"></a>

### peer.\_relayGenericPayload()
Relay inventory / generic payloads. When {@code wireMessage} is present, forward it
bit-identical (no hop re-sign). Otherwise the local agent originates a new signed frame
and may wrap it in {@code P2P_RELAY} for mesh delivery.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_isTransientSocketError"></a>

### peer.\_isTransientSocketError(error) ⇒ <code>boolean</code>
True when a TCP/NOISE error is a routine connect/reset (not an application fault).
Node sometimes omits `error.code` and only puts `ECONNREFUSED` in the message.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| error | <code>\*</code> | 

<a name="Peer+_attachNoiseStreamErrorHandlers"></a>

### peer.\_attachNoiseStreamErrorHandlers(noiseStream, [label])
Bind encrypt/decrypt 'error' before piping. noise-protocol-stream calls
stream.destroy(err) on handshake failure; without listeners Node raises
uncaught Exceptions (e.g. `noise_stream_new`, `malloc`).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| noiseStream | <code>Object</code> |  | noise-protocol-stream duplex pair |
| noiseStream.encrypt | <code>stream.Duplex</code> |  |  |
| noiseStream.decrypt | <code>stream.Duplex</code> |  |  |
| [label] | <code>string</code> | <code>&quot;&#x27;NOISE&#x27;&quot;</code> |  |

<a name="Peer+_detachNoiseStreamErrorHandlers"></a>

### peer.\_detachNoiseStreamErrorHandlers(noiseStream) ⇒ <code>void</code>
Remove encrypt/decrypt 'error' listeners attached by [_attachNoiseStreamErrorHandlers](#Peer+_attachNoiseStreamErrorHandlers).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| noiseStream | <code>Object</code> | 

<a name="Peer+_teardownNoiseClient"></a>

### peer.\_teardownNoiseClient(socket) ⇒ <code>void</code>
Unpipe and destroy a NOISE pair so shared handshake emitters do not leak listeners.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| socket | <code>object</code> \| <code>null</code> | 

<a name="Peer+_buildDocumentParsedForPublish"></a>

### peer.\_buildDocumentParsedForPublish(documentId, content) ⇒ <code>Object</code>
Build hub-compatible document metadata for [purchaseContentHashHex](purchaseContentHashHex).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - Parsed document record (whitelisted fields)  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>String</code> |  |
| content | <code>String</code> | UTF-8 body |

<a name="Peer+_collectDocumentCatalogInventoryItems"></a>

### peer.\_collectDocumentCatalogInventoryItems([req]) ⇒ <code>Array.&lt;object&gt;</code>
Items for Hub-style `kind: 'documents'` inventory (Fabric UI / `@fabric/hub` merge expects `object.kind`).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| [req] | <code>Object</code> | request object subset |

<a name="Peer+_sendLocalInventoryDocumentsWireResponse"></a>

### peer.\_sendLocalInventoryDocumentsWireResponse(originName, items, [opts]) ⇒ <code>boolean</code>
Write [INVENTORY_RESPONSE](INVENTORY_RESPONSE) (`P2P_INVENTORY_RESPONSE`) compatible with `@fabric/hub` Bridge merging
(body includes `kind: 'documents'` so the browser can merge `object.items`).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| originName | <code>string</code> | connection key [Peer#connections](Peer#connections) |
| items | <code>Array.&lt;object&gt;</code> |  |
| [opts] | <code>Object</code> |  |
| [opts.allowEmpty] | <code>boolean</code> |  |

<a name="Peer+_respondInventoryFromLocalDocuments"></a>

### peer.\_respondInventoryFromLocalDocuments(message, origin) ⇒ <code>boolean</code>
Reply to `INVENTORY_REQUEST` with `INVENTORY_RESPONSE` built from local documents and rates.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - true if an `INVENTORY_RESPONSE` was written to the requester  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Object</code> | Generic body from [Peer#_handleGenericMessage](Peer#_handleGenericMessage) |
| origin | <code>Object</code> |  |

<a name="Peer+publishSealedDocument"></a>

### peer.publishSealedDocument(doc, [opts]) ⇒ <code>Object</code>
Register a per-blob sealed [Document](#Document) (one key per blob) for sale.
Inventory advertises hash-only leaves with per-blob payment hashes; buyers
settle one HTLC per blob plan and receive one key reveal per blob.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| doc | [<code>Document</code>](#Document) |  | Sealed document that holds its blob keys. |
| [opts] | <code>Object</code> |  |  |
| [opts.rateSats] | <code>number</code> | <code>0</code> | Per-blob ask: 0 (free) or at least `HTLC_MINIMUM_SATS`, since each blob settles with its own HTLC. |
| [opts.documentId] | <code>string</code> |  | Catalog id (default: the Document's). |

<a name="Peer+sealedBlobPreimageForPaymentHash"></a>

### peer.sealedBlobPreimageForPaymentHash(paymentHashHex) ⇒ <code>Object</code> \| <code>null</code>
Seller side: the content key `K_i` whose SHA256 is `paymentHashHex`, from
this node's published sealed-blob registry. Channel hosts hand this to
`Channel.Book` as `preimageFor` so a committed HTLC for a blob we sell is
fulfilled with the key (seller-fulfills; the buyer learns `K_i` from the
`ChannelHtlcFulfill`).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| paymentHashHex | <code>string</code> | 

<a name="Peer+_getSealedBlobDocument"></a>

### peer.\_getSealedBlobDocument(documentId) ⇒ [<code>Document</code>](#Document) \| <code>null</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Document</code>](#Document) \| <code>null</code> - rehydrated per-blob sealed document (with keys) or null  

| Param | Type |
| --- | --- |
| documentId | <code>string</code> | 

<a name="Peer+_sendP2pFileSendToPeer"></a>

### peer.\_sendP2pFileSendToPeer(documentId, peerAddress, [opts]) ⇒ <code>boolean</code>
Send a locally stored document as indexed, wire-sized `P2P_FILE_SEND` blobs.
Priced sealed docs send **ciphertext** (safe without the content key).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - true if at least one frame was written  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>string</code> |  |
| peerAddress | <code>string</code> | connection key in [Peer#connections](Peer#connections) |
| [opts] | <code>Object</code> |  |
| [opts.blobIndex] | <code>number</code> |  |
| [opts.revealKey] | <code>boolean</code> |  |
| [opts.settlementId] | <code>string</code> |  |
| [opts.routeId] | <code>string</code> |  |

<a name="Peer+_sendDocumentContentKeyReveal"></a>

### peer.\_sendDocumentContentKeyReveal(documentId, peerAddress, [opts]) ⇒ <code>boolean</code>
Reveal the AES content key to a peer (only after payment-hash match).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| documentId | <code>string</code> | 
| peerAddress | <code>string</code> | 
| [opts] | <code>Object</code> | 
| [opts.settlementId] | <code>string</code> | 

<a name="Peer+sealedBlobKeyForPaymentHash"></a>

### peer.sealedBlobKeyForPaymentHash(paymentHashHex) ⇒ <code>Object</code> \| <code>null</code>
Which held sealed blob a payment hash belongs to. Lets the buyer map a
channel `ChannelHtlcFulfill` preimage back onto the blob it unlocks.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| paymentHashHex | <code>string</code> | 

<a name="Peer+openSealedBlobWithKey"></a>

### peer.openSealedBlobWithKey(opts) ⇒ <code>Object</code>
Open a held sealed blob with a key learned out of band (seller-fulfills
channel rail: the HTLC preimage **is** `K_i`). Same verification as a
wire `DocumentContentKeyReveal`: SHA256(key) must equal the part's payment
hash and the plaintext must hash to its advertised digest.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - same shape as the key-reveal handler  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>Object</code> |  |
| opts.documentId | <code>string</code> |  |
| opts.keyHex | <code>string</code> | 32-byte key (hex) |
| [opts.blobIndex] | <code>number</code> | resolved from `paymentHashHex` when omitted |
| [opts.paymentHashHex] | <code>string</code> | SHA256(key); defaults to the hash of `keyHex` |
| [opts.merkleRootHex] | <code>string</code> | disambiguates when two roots are pending |

<a name="Peer+_ingestP2pFileSend"></a>

### peer.\_ingestP2pFileSend(message, origin, [wireMessage]) ⇒ <code>Object</code>
Verify / accumulate an inbound `P2P_FILE_SEND` against the DocumentBlobIndex rules.
Sealed frames store ciphertext until [KEY_REVEAL_TYPE](KEY_REVEAL_TYPE).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| message | [<code>Message</code>](#Message) \| <code>Object</code> |  |
| origin | <code>Object</code> |  |
| [origin.name] | <code>string</code> |  |
| [wireMessage] | [<code>Message</code>](#Message) | raw signed AMP frame (kept per sealed blob for fraud proofs) |

<a name="Peer+_handleDocumentContentKeyReveal"></a>

### peer.\_handleDocumentContentKeyReveal(reveal, [origin]) ⇒ <code>Object</code>
Apply a content-key reveal to a pending sealed delivery.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| reveal | <code>Object</code> |  | 
| [origin] | <code>Object</code> | <code></code> | 
| [origin.name] | <code>string</code> |  | 

<a name="Peer+openSealedDeliveryWithPreimage"></a>

### peer.openSealedDeliveryWithPreimage(documentId, preimageHex) ⇒ <code>Object</code>
Open a pending sealed delivery using an HTLC claim preimage (on-chain witness).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| documentId | <code>string</code> | 
| preimageHex | <code>string</code> | 

<a name="Peer+sendDocumentFileToPeer"></a>

### peer.sendDocumentFileToPeer(documentId, peerAddress, [opts]) ⇒ <code>boolean</code>
Public helper: push document bytes to a peer (same wire path as [_handleDocumentRequestWire](#Peer+_handleDocumentRequestWire) fulfillment).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| documentId | <code>string</code> | 
| peerAddress | <code>string</code> | 
| [opts] | <code>Object</code> | 
| [opts.blobIndex] | <code>number</code> | 
| [opts.revealKey] | <code>boolean</code> | 

<a name="Peer+requestPeerInventory"></a>

### peer.requestPeerInventory(peerAddress, [opts]) ⇒ <code>boolean</code>
Ask a connected peer for their document catalog (`kind: 'documents'`) or L1 offers (`offerBtc`).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| peerAddress | <code>string</code> |  | connection key, Fabric id, or host:port |
| [opts] | <code>Object</code> |  |  |
| [opts.offerBtc] | <code>boolean</code> | <code>false</code> |  |
| [opts.kind] | <code>string</code> | <code>&quot;&#x27;documents&#x27;&quot;</code> |  |
| [opts.maxSats] | <code>number</code> |  |  |
| [opts.blobHashHex] | <code>string</code> |  | chunk selector: only this blob |
| [opts.merkleRootHex] | <code>string</code> |  | tree selector: only this document tree |

<a name="Peer+requestDocument"></a>

### peer.requestDocument(documentId, [peerAddress], [opts]) ⇒ <code>boolean</code>
Send a signed `DocumentRequest` to one peer (or broadcast when peerAddress is omitted).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| documentId | <code>string</code> |  | 
| [peerAddress] | <code>string</code> | <code>null</code> | 
| [opts] | <code>object</code> |  | 
| [opts.maxSats] | <code>number</code> |  | 
| [opts.relayHop] | <code>number</code> |  | 
| [opts.blobIndex] | <code>number</code> |  | 
| [opts.blobTotal] | <code>number</code> |  | 
| [opts.contentHashHex] | <code>string</code> |  | 

<a name="Peer+_attachHtlcOfferToItem"></a>

### peer.\_attachHtlcOfferToItem(item, req, contentHashHex, amountSats) ⇒ <code>object</code> \| <code>null</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| item | <code>object</code> |  |
| req | <code>object</code> | inventory request object |
| contentHashHex | <code>string</code> |  |
| amountSats | <code>number</code> |  |

<a name="Peer+listPendingDocumentRequests"></a>

### peer.listPendingDocumentRequests() ⇒ <code>Array.&lt;object&gt;</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Array.&lt;object&gt;</code> - pending DOCUMENT_REQUEST rows (consent mode)  
<a name="Peer+approveDocumentRequest"></a>

### peer.approveDocumentRequest(requestKey) ⇒ <code>Object</code>
Approve a pending DOCUMENT_REQUEST and send `P2P_FILE_SEND`.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| requestKey | <code>string</code> | pending key, or document id when unique |

<a name="Peer+authorizeDocumentKeyReveal"></a>

### peer.authorizeDocumentKeyReveal(opts) ⇒ <code>Object</code>
Record that settlement for a sealed document was verified so a matching
DocumentRequest may receive the AES content key (not merely the ciphertext).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - `{ ok, error?, key? }`  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> |  |
| opts.documentId | <code>string</code> |  |
| opts.contentHashHex | <code>string</code> | payment hash SHA256(K) |
| [opts.settlementId] | <code>string</code> |  |
| [opts.txid] | <code>string</code> |  |

<a name="Peer+denyDocumentRequest"></a>

### peer.denyDocumentRequest(requestKey) ⇒ <code>Object</code>
Deny / drop a pending DOCUMENT_REQUEST without sending bytes.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| requestKey | <code>string</code> | 

<a name="Peer+_buildPublishDocumentWireBuffers"></a>

### peer.\_buildPublishDocumentWireBuffers(documentId, body, rateSats) ⇒ <code>Array.&lt;Buffer&gt;</code>
AMP buffers for one document: canonical `DocumentPublish`, then optional pricing `P2P_DOCUMENT_PUBLISH`.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>string</code> |  |
| body | <code>string</code> | UTF-8 body |
| rateSats | <code>number</code> |  |

<a name="Peer+_announceLocalDocumentsToPeer"></a>

### peer.\_announceLocalDocumentsToPeer(peerAddress)
Re-send all local document publishes to one peer (same bytes as [_publishDocument](#Peer+_publishDocument)).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| peerAddress | <code>string</code> | connection key in [Peer#connections](Peer#connections) |

<a name="Peer+_publishDocument"></a>

### peer.\_publishDocument(documentId, [content], [rateSats])
Store a document locally and gossip to peers.
1) **Canonical** `DOCUMENT_PUBLISH` wire message (same bytes as hub `documentPublishEnvelope`) for L1 `contentHash`.
2) If `rateSats > 0`, a **pricing** `GENERIC` `P2P_DOCUMENT_PUBLISH` with `rate` and `contentHash` (sat ask).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| documentId | <code>String</code> |  | Catalog key (e.g. CLI document name). |
| [content] | <code>String</code> | <code>&#x27;&#x27;</code> | UTF-8 body stored under [Peer#state](Peer#state).documents. |
| [rateSats] | <code>Number</code> | <code>0</code> | Ask price in satoshis (gossip only; not part of canonical hash). |

<a name="Peer+_handleDocumentRequestWire"></a>

### peer.\_handleDocumentRequestWire(message, origin, socket, [options])
Handle inbound `DOCUMENT_REQUEST`: emit `documentRequest` / `DocumentRequest`, then either
send `P2P_FILE_SEND` (when [Peer#settings.autoFulfillDocumentRequests](Peer#settings.autoFulfillDocumentRequests)), queue for
operator approve, or relay when the document is not held.

Peel / foreign-signed `P2P_RELAY` deliveries are local-observe only: never fulfill or
queue against the TCP last hop, and never second-flood the inner under that hop.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| message | [<code>Message</code>](#Message) |  |  |
| origin | <code>Object</code> |  |  |
| socket | <code>\*</code> |  |  |
| [options] | <code>Object</code> | <code></code> | same delivery opts as [_handleFabricMessage](#Peer+_handleFabricMessage) |

<a name="Peer+_privateRelayDocumentRequest"></a>

### peer.\_privateRelayDocumentRequest(parsed, origin, [originalMessage])
Rewrite a budgeted DocumentRequest (privacy) and forward with reduced maxSats.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| parsed | <code>object</code> |  | 
| origin | <code>Object</code> |  | 
| [originalMessage] | [<code>Message</code>](#Message) | <code></code> | 

<a name="Peer+_sendPrivateRelayedDocumentRequest"></a>

### peer.\_sendPrivateRelayedDocumentRequest(msg, origin, parsed) ⇒ <code>boolean</code>
Deliver a rewritten private DocumentRequest without mesh broadcast.
Preference: onion `relayPath` → explicit `nextPeer` → fan-out to TCP peers
other than the inbound origin.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | signed DocumentRequest |
| origin | <code>Object</code> \| <code>null</code> |  |
| parsed | <code>object</code> | inbound request body |

<a name="Peer+_maybeReverseRelayFileSend"></a>

### peer.\_maybeReverseRelayFileSend(fileObj, origin) ⇒ <code>boolean</code>
Forward a relayed `P2P_FILE_SEND` / key reveal back toward the buyer using reverse routes.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - true if forwarded (caller should skip local ingest)  

| Param | Type |
| --- | --- |
| fileObj | <code>object</code> | 
| origin | <code>Object</code> | 

<a name="Peer+_unregisterSocketActor"></a>

### peer.\_unregisterSocketActor(address) ⇒ <code>void</code>
Drop the ephemeral socket Actor keyed by `host:port`.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| address | <code>string</code> | 

<a name="Peer+_contractPublishSignerAuthorized"></a>

### peer.\_contractPublishSignerAuthorized(object, signerPubkeyHex) ⇒ <code>boolean</code>
When a publish body declares authority arrays, the AMP wire signer must be
present and listed. Bodies with no authorities are allowed (observe-only;
empty patch allow-list). Missing signer fail-closes when authorities exist.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| object | <code>object</code> |  | 
| signerPubkeyHex | <code>string</code> \| <code>null</code> | <code>null</code> | 

<a name="Peer+_distributedFederationValidatorsFromSettings"></a>

### peer.\_distributedFederationValidatorsFromSettings() ⇒ <code>Array.&lt;string&gt;</code>
Federation validator pubkeys for sidechain patch verification (settings or env).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_distributedFederationThresholdFromSettings"></a>

### peer.\_distributedFederationThresholdFromSettings() ⇒ <code>number</code>
k for federation witnesses. Unset = strict majority of the configured validators.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_registerContract"></a>

### peer.\_registerContract(object, [publisherPubkeyHex]) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - true when newly registered (or already present no-op)  

| Param | Type | Default |
| --- | --- | --- |
| object | <code>object</code> |  | 
| [publisherPubkeyHex] | <code>string</code> \| <code>null</code> | <code>null</code> | 

<a name="Peer+_mergeContractPatchAllowList"></a>

### peer.\_mergeContractPatchAllowList(contractId, object, [_publisherPubkeyHex])
Build the set of pubkeys allowed to apply CONTRACT_MESSAGE ops for a newly
registered contract. Called only on first registration of a contract id —
republishes must not invoke this (see [_registerContract](#Peer+_registerContract)).
Membership is taken **only** from body authority arrays (`parties`,
`validators`, `owners`, `members` / `members.signers`, `authorities`,
`spendPolicy.validators`). The wire signer is never granted rights unless
already listed there.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| contractId | <code>string</code> |  |  |
| object | <code>object</code> |  | contract publish body |
| [_publisherPubkeyHex] | <code>string</code> \| <code>null</code> | <code>null</code> | ignored (kept for call-site compat) |

<a name="Peer+_signerMayPatchContract"></a>

### peer.\_signerMayPatchContract(contractId, signerPubkeyHex) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| contractId | <code>string</code> | 
| signerPubkeyHex | <code>string</code> \| <code>null</code> | 

<a name="Peer+_startFabricPingKeepalive"></a>

### peer.\_startFabricPingKeepalive(socket, encryptWrite)
Periodic P2P_PING and track expected P2P_PONG replies so registry score cannot be
self-inflated by unsolicited pongs (see FLUSH_CHAIN trust gate).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| socket | <code>\*</code> | — connection object (stores `_fabricPingOutstanding`, `_keepalive`) |
| encryptWrite | <code>\*</code> | — NOISE encrypt stream with `.write(Buffer)` (`client.encrypt` / `handler.encrypt`) |

<a name="Peer+_writeFabric"></a>

### peer.\_writeFabric(msg, stream) ⇒ <code>boolean</code>
Write an AMP frame onto a NOISE encrypt stream.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - True only when the local encrypt stream accepted the write.  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>Buffer</code> |  |
| stream | <code>object</code> | Noise handler/client (`encrypt.write`) |

<a name="Peer+start"></a>

### peer.start()
Start the Peer.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Overrides**: [<code>start</code>](#Service+start)  
<a name="Peer+stop"></a>

### peer.stop()
Stop the peer.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+listen"></a>

### peer.listen() ⇒ [<code>Peer</code>](#Peer)
Start listening for connections.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Peer</code>](#Peer) - Chainable method.  
<a name="Service+_appendWarning"></a>

### peer.\_appendWarning(msg) ⇒ [<code>Service</code>](#Service)
**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Service</code>](#Service) - This instance.  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>String</code> | Warning text (used by [Service#_registerService](Service#_registerService) duplicate guard). |

<a name="Service+init"></a>

### peer.init()
Called by Web Components.
TODO: move to @fabric/http/types/spa

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Service+tick"></a>

### peer.tick() ⇒ <code>Number</code>
Move forward one clock cycle.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Service+beat"></a>

### peer.beat() ⇒ [<code>Service</code>](#Service)
Compute latest state.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Overrides**: [<code>beat</code>](#Service+beat)  
**Emits**: <code>Message#event:beat</code>  
<a name="Service+get"></a>

### peer.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Mixed</code> - Returns the target value if found, otherwise null.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+set"></a>

### peer.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+trust"></a>

### peer.trust(source) ⇒ [<code>Service</code>](#Service)
Explicitly trust all events from a known source.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Service</code>](#Service) - Instance of Service after binding events.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Emitter of events. |

<a name="Service+handler"></a>

### peer.handler(message) ⇒ [<code>Service</code>](#Service)
Default route handler for an incoming message.  Follows the Activity
Streams 2.0 spec: https://www.w3.org/TR/activitystreams-core/

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Activity</code> | Message object. |

<a name="Service+lock"></a>

### peer.lock([duration]) ⇒ <code>Boolean</code>
Attempt to acquire a lock for `duration` seconds.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Boolean</code> - true if locked, false if unable to lock.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [duration] | <code>Number</code> | <code>1000</code> | Number of milliseconds to hold lock. |

<a name="Service+when"></a>

### peer.when(event, method) ⇒ <code>EventEmitter</code>
Bind a method to an event, with current state as the immutable context.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>EventEmitter</code> - Instance of EventEmitter.  

| Param | Type | Description |
| --- | --- | --- |
| event | <code>String</code> | Name of the event upon which to execute `method` as a function. |
| method | <code>function</code> | Function to execute when named [Event](Event) `event` is encountered. |

<a name="Service+defineOpcode"></a>

### peer.defineOpcode(name, [definition]) ⇒ <code>Object</code>
Register a single opcode entry in the service registry.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Opcode symbol (e.g. `OP_SHA256`, `P2P_FLUSH_CHAIN`) |
| [definition] | <code>Object</code> |  |

<a name="Service+defineBitcoinOpcode"></a>

### peer.defineBitcoinOpcode(name, [definition]) ⇒ <code>Object</code>
Register Bitcoin-style primitive opcode metadata.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineFabricOpcode"></a>

### peer.defineFabricOpcode(name, [definition]) ⇒ <code>Object</code>
Register Fabric opcode metadata.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineOpcodeContract"></a>

### peer.defineOpcodeContract(name, body, [meta]) ⇒ <code>Object</code>
Register a newline-delimited opcode contract.
Contract body example:
`OP_DUP\nOP_HASH160\nP2P_FLUSH_CHAIN`

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Contract label |
| body | <code>string</code> | Newline-delimited opcode list |
| [meta] | <code>Object</code> |  |

<a name="Service+listOpcodes"></a>

### peer.listOpcodes() ⇒ <code>Array.&lt;Object&gt;</code>
Snapshot opcode registry for UI / API use.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Service+route"></a>

### peer.route(msg) ⇒ <code>Promise</code>
Resolve a [State](#State) from a particular [Message](#Message) object.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Promise</code> - Resolves with resulting [State](#State).  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | Explicit Fabric [Message](#Message). |

<a name="Service+_GET"></a>

### peer.\_GET(path) ⇒ <code>Promise</code>
Retrieve a value from the Service's state.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Promise</code> - Resolves with the result.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path of the value to retrieve. |

<a name="Service+_PUT"></a>

### peer.\_PUT(path, value, [commit]) ⇒ <code>Promise</code>
Store a value in the Service's state.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Promise</code> - Resolves with with stored document.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>String</code> |  | Path to store the value at. |
| value | <code>Object</code> |  | Document to store. |
| [commit] | <code>Boolean</code> | <code>false</code> | Sign the resulting state. |

<a name="Service+connect"></a>

### peer.connect(notify) ⇒ <code>Promise</code>
Attach to network.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Promise</code> - Resolves to [Fabric](#Fabric).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| notify | <code>Boolean</code> | <code>true</code> | Commit to changes. |

<a name="Service+send"></a>

### peer.send(channel, message) ⇒ [<code>Service</code>](#Service)
Send a message to a channel.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| channel | <code>String</code> | Channel name to which the message will be sent. |
| message | <code>String</code> | Content of the message to send. |

<a name="Service+commit"></a>

### peer.commit() ⇒ <code>String</code>
Record outstanding JSON Patch deltas and emit a compact commitment id.
Does **not** wrap [Service#state](Service#state) in a new [Actor](#Actor) — that
JSON-cloned the entire tree on every write/connect and OOMed Hub.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>String</code> - 32-byte commitment id  
<a name="Service+_registerActor"></a>

### peer.\_registerActor(actor) ⇒ <code>Promise</code>
Register an [Actor](#Actor) with the [Service](#Service).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Overrides**: [<code>\_registerActor</code>](#Service+_registerActor)  
**Returns**: <code>Promise</code> - Resolves upon successful registration.  

| Param | Type | Description |
| --- | --- | --- |
| actor | <code>Object</code> | Instance of the [Actor](#Actor). |

<a name="Service+_send"></a>

### peer.\_send(message)
Sends a message.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Mixed</code> | Message to send. |

<a name="Actor+adopt"></a>

### peer.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+export"></a>

### peer.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### peer.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Overrides**: [<code>stream</code>](#Actor+stream)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### peer.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Actor+toGenericMessage"></a>

### peer.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### peer.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Actor+pause"></a>

### peer.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### peer.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Actor+sign"></a>

### peer.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Actor+unpause"></a>

### peer.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### peer.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### peer.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Peer"></a>

## Peer
**Kind**: global class  

* [Peer](#Peer)
    * [new Peer([config])](#new_Peer_new)
    * [._actorsByName](#Peer+_actorsByName) : <code>Object.&lt;string, string&gt;</code>
    * [.pendingDocumentRequests](#Peer+pendingDocumentRequests)
    * [._authorizedDocumentKeyReveals](#Peer+_authorizedDocumentKeyReveals)
    * [._contractPatchAllowList](#Peer+_contractPatchAllowList)
    * [._contractGenesis](#Peer+_contractGenesis)
    * [.blobTransfers](#Peer+blobTransfers)
    * [.pendingSealedDeliveries](#Peer+pendingSealedDeliveries)
    * [.pendingSealedBlobs](#Peer+pendingSealedBlobs)
    * [._documentRelayRoutes](#Peer+_documentRelayRoutes)
    * [._inboundNoiseStaticPubkeyByAddress](#Peer+_inboundNoiseStaticPubkeyByAddress)
    * [.messages](#Peer+messages)
    * [._logicalRegisterOnce](#Peer+_logicalRegisterOnce) : <code>Map.&lt;string, {type: string, signer: (string\|null), at: number}&gt;</code>
    * [._gossipPayloadSeen](#Peer+_gossipPayloadSeen)
    * [._gossipRelayByOrigin](#Peer+_gossipRelayByOrigin)
    * [._chatRelayByOrigin](#Peer+_chatRelayByOrigin)
    * [._peeringPayloadSeen](#Peer+_peeringPayloadSeen)
    * [._peeringRelayByOrigin](#Peer+_peeringRelayByOrigin)
    * [._wireInboundByOrigin](#Peer+_wireInboundByOrigin)
    * [._peerBandwidthByOrigin](#Peer+_peerBandwidthByOrigin)
    * [._logicalDupPenaltyByOrigin](#Peer+_logicalDupPenaltyByOrigin)
    * [._peerBans](#Peer+_peerBans) : <code>Map.&lt;string, {until: number, reason: string}&gt;</code>
    * [._candidateKeys](#Peer+_candidateKeys)
    * [._candidateRetryAt](#Peer+_candidateRetryAt)
    * [._outboundDialTargets](#Peer+_outboundDialTargets)
    * [._selfDialSuppressUntil](#Peer+_selfDialSuppressUntil) : <code>Map.&lt;string, number&gt;</code>
    * [._musigSessions](#Peer+_musigSessions) : <code>Map.&lt;string, object&gt;</code>
    * [.bandwidthSummary](#Peer+bandwidthSummary) ⇒ <code>Object</code>
    * ~~[.address](#Peer+address)~~
    * [.knownPeers](#Peer+knownPeers) ⇒ <code>Array.&lt;object&gt;</code>
    * [._gossipPayloadDedupKey(msg)](#Peer+_gossipPayloadDedupKey) ⇒ <code>string</code>
    * [._logicalRegistrationKey(type, object)](#Peer+_logicalRegistrationKey) ⇒ <code>string</code> \| <code>null</code>
    * [._claimLogicalRegistration(type, object, [signerPubkeyHex])](#Peer+_claimLogicalRegistration) ⇒ <code>Object</code>
    * [._applyPeerMisbehavior(originName, reason, [opts])](#Peer+_applyPeerMisbehavior)
    * [._banPeer(originName, reason)](#Peer+_banPeer)
    * [._isPeerBanned(originName, [pubkeyHex])](#Peer+_isPeerBanned) ⇒ <code>boolean</code>
    * [._logicalRegisterDuplicateMisbehavior(originName, type, claim, [signerPubkeyHex])](#Peer+_logicalRegisterDuplicateMisbehavior)
    * [._claimLogicalRegistrationOrPunish(type, object, [signerPubkeyHex], [originName])](#Peer+_claimLogicalRegistrationOrPunish) ⇒ <code>Object</code>
    * [._gossipRateLimitAllow(originName)](#Peer+_gossipRateLimitAllow) ⇒ <code>boolean</code>
    * [._chatRateLimitAllow(originName)](#Peer+_chatRateLimitAllow) ⇒ <code>boolean</code>
    * [._wireInboundCreditCost(wireType)](#Peer+_wireInboundCreditCost) ⇒ <code>number</code>
    * [._wireInboundRateAllowPeer(originName, creditCost)](#Peer+_wireInboundRateAllowPeer) ⇒ <code>boolean</code>
    * [._derankPeerForWireTraffic(originName, penalty, reason)](#Peer+_derankPeerForWireTraffic)
    * [._peeringOfferPayloadDedupKey(msg)](#Peer+_peeringOfferPayloadDedupKey) ⇒ <code>string</code>
    * [._peeringRateLimitAllow(originName)](#Peer+_peeringRateLimitAllow) ⇒ <code>boolean</code>
    * [._enqueuePeeringCandidate(host, port, [meta])](#Peer+_enqueuePeeringCandidate)
    * [._localFabricPubkeyHex()](#Peer+_localFabricPubkeyHex) ⇒ <code>string</code>
    * [._isOwnFabricPubkey(hex)](#Peer+_isOwnFabricPubkey) ⇒ <code>boolean</code>
    * [._isOwnFabricActorId(id)](#Peer+_isOwnFabricActorId) ⇒ <code>boolean</code>
    * [._suppressSelfDialAddress(address, [ttlMs])](#Peer+_suppressSelfDialAddress)
    * [._isSelfDialSuppressed(address)](#Peer+_isSelfDialSuppressed) ⇒ <code>boolean</code>
    * [._abortSelfFabricSession(connAddress, [reason])](#Peer+_abortSelfFabricSession) ⇒ [<code>Peer</code>](#Peer)
    * [.countNoiseHandshakeListeners()](#Peer+countNoiseHandshakeListeners) ⇒ <code>Object</code>
    * [.broadcast(message, [origin])](#Peer+broadcast) ⇒ <code>number</code>
    * [._localXOnlyPeerId()](#Peer+_localXOnlyPeerId) ⇒ <code>Buffer</code>
    * [._resolveAddressByXOnly(peerId)](#Peer+_resolveAddressByXOnly) ⇒ <code>string</code> \| <code>null</code>
    * [.sendOnion(path, payload)](#Peer+sendOnion) ⇒ <code>boolean</code>
    * [.startMusig2([opts])](#Peer+startMusig2) ⇒ <code>object</code> \| <code>null</code>
    * [.getMusig2Session(sessionId)](#Peer+getMusig2Session) ⇒ <code>object</code> \| <code>null</code>
    * [.relayFromTrustedPeers(origin, message, [minScoreExclusive])](#Peer+relayFromTrustedPeers)
    * [._registryScoreForConnectionAddress(connAddress)](#Peer+_registryScoreForConnectionAddress) ⇒ <code>number</code>
    * [._registryScoreForFlushChainSender(connAddress, senderPubkeyHex)](#Peer+_registryScoreForFlushChainSender) ⇒ <code>number</code>
    * [.sendFlushChainToTrustedPeers(object)](#Peer+sendFlushChainToTrustedPeers) ⇒ <code>number</code>
    * [._connect(target)](#Peer+_connect)
    * [._announceAlias(alias, [origin], [_socket])](#Peer+_announceAlias)
    * [._loadPeerRegistry()](#Peer+_loadPeerRegistry) ⇒ <code>Promise.&lt;void&gt;</code>
    * [._savePeerRegistry()](#Peer+_savePeerRegistry)
    * [._flushChainSenderPubkeyHex()](#Peer+_flushChainSenderPubkeyHex)
    * [._upsertPeerRegistry(address, [updates])](#Peer+_upsertPeerRegistry)
    * [._fillPeerSlots()](#Peer+_fillPeerSlots) ⇒ [<code>Peer</code>](#Peer)
    * [._handleFabricMessage(buffer, [origin], [socket], [options])](#Peer+_handleFabricMessage) ⇒ [<code>Peer</code>](#Peer)
    * [._relayWirePayload()](#Peer+_relayWirePayload)
    * [._relayGenericPayload()](#Peer+_relayGenericPayload)
    * [._isTransientSocketError(error)](#Peer+_isTransientSocketError) ⇒ <code>boolean</code>
    * [._attachNoiseStreamErrorHandlers(noiseStream, [label])](#Peer+_attachNoiseStreamErrorHandlers)
    * [._detachNoiseStreamErrorHandlers(noiseStream)](#Peer+_detachNoiseStreamErrorHandlers) ⇒ <code>void</code>
    * [._teardownNoiseClient(socket)](#Peer+_teardownNoiseClient) ⇒ <code>void</code>
    * [._buildDocumentParsedForPublish(documentId, content)](#Peer+_buildDocumentParsedForPublish) ⇒ <code>Object</code>
    * [._collectDocumentCatalogInventoryItems([req])](#Peer+_collectDocumentCatalogInventoryItems) ⇒ <code>Array.&lt;object&gt;</code>
    * [._sendLocalInventoryDocumentsWireResponse(originName, items, [opts])](#Peer+_sendLocalInventoryDocumentsWireResponse) ⇒ <code>boolean</code>
    * [._respondInventoryFromLocalDocuments(message, origin)](#Peer+_respondInventoryFromLocalDocuments) ⇒ <code>boolean</code>
    * [.publishSealedDocument(doc, [opts])](#Peer+publishSealedDocument) ⇒ <code>Object</code>
    * [.sealedBlobPreimageForPaymentHash(paymentHashHex)](#Peer+sealedBlobPreimageForPaymentHash) ⇒ <code>Object</code> \| <code>null</code>
    * [._getSealedBlobDocument(documentId)](#Peer+_getSealedBlobDocument) ⇒ [<code>Document</code>](#Document) \| <code>null</code>
    * [._sendP2pFileSendToPeer(documentId, peerAddress, [opts])](#Peer+_sendP2pFileSendToPeer) ⇒ <code>boolean</code>
    * [._sendDocumentContentKeyReveal(documentId, peerAddress, [opts])](#Peer+_sendDocumentContentKeyReveal) ⇒ <code>boolean</code>
    * [.sealedBlobKeyForPaymentHash(paymentHashHex)](#Peer+sealedBlobKeyForPaymentHash) ⇒ <code>Object</code> \| <code>null</code>
    * [.openSealedBlobWithKey(opts)](#Peer+openSealedBlobWithKey) ⇒ <code>Object</code>
    * [._ingestP2pFileSend(message, origin, [wireMessage])](#Peer+_ingestP2pFileSend) ⇒ <code>Object</code>
    * [._handleDocumentContentKeyReveal(reveal, [origin])](#Peer+_handleDocumentContentKeyReveal) ⇒ <code>Object</code>
    * [.openSealedDeliveryWithPreimage(documentId, preimageHex)](#Peer+openSealedDeliveryWithPreimage) ⇒ <code>Object</code>
    * [.sendDocumentFileToPeer(documentId, peerAddress, [opts])](#Peer+sendDocumentFileToPeer) ⇒ <code>boolean</code>
    * [.requestPeerInventory(peerAddress, [opts])](#Peer+requestPeerInventory) ⇒ <code>boolean</code>
    * [.requestDocument(documentId, [peerAddress], [opts])](#Peer+requestDocument) ⇒ <code>boolean</code>
    * [._attachHtlcOfferToItem(item, req, contentHashHex, amountSats)](#Peer+_attachHtlcOfferToItem) ⇒ <code>object</code> \| <code>null</code>
    * [.listPendingDocumentRequests()](#Peer+listPendingDocumentRequests) ⇒ <code>Array.&lt;object&gt;</code>
    * [.approveDocumentRequest(requestKey)](#Peer+approveDocumentRequest) ⇒ <code>Object</code>
    * [.authorizeDocumentKeyReveal(opts)](#Peer+authorizeDocumentKeyReveal) ⇒ <code>Object</code>
    * [.denyDocumentRequest(requestKey)](#Peer+denyDocumentRequest) ⇒ <code>Object</code>
    * [._buildPublishDocumentWireBuffers(documentId, body, rateSats)](#Peer+_buildPublishDocumentWireBuffers) ⇒ <code>Array.&lt;Buffer&gt;</code>
    * [._announceLocalDocumentsToPeer(peerAddress)](#Peer+_announceLocalDocumentsToPeer)
    * [._publishDocument(documentId, [content], [rateSats])](#Peer+_publishDocument)
    * [._handleDocumentRequestWire(message, origin, socket, [options])](#Peer+_handleDocumentRequestWire)
    * [._privateRelayDocumentRequest(parsed, origin, [originalMessage])](#Peer+_privateRelayDocumentRequest)
    * [._sendPrivateRelayedDocumentRequest(msg, origin, parsed)](#Peer+_sendPrivateRelayedDocumentRequest) ⇒ <code>boolean</code>
    * [._maybeReverseRelayFileSend(fileObj, origin)](#Peer+_maybeReverseRelayFileSend) ⇒ <code>boolean</code>
    * [._unregisterSocketActor(address)](#Peer+_unregisterSocketActor) ⇒ <code>void</code>
    * [._contractPublishSignerAuthorized(object, signerPubkeyHex)](#Peer+_contractPublishSignerAuthorized) ⇒ <code>boolean</code>
    * [._distributedFederationValidatorsFromSettings()](#Peer+_distributedFederationValidatorsFromSettings) ⇒ <code>Array.&lt;string&gt;</code>
    * [._distributedFederationThresholdFromSettings()](#Peer+_distributedFederationThresholdFromSettings) ⇒ <code>number</code>
    * [._registerContract(object, [publisherPubkeyHex])](#Peer+_registerContract) ⇒ <code>boolean</code>
    * [._mergeContractPatchAllowList(contractId, object, [_publisherPubkeyHex])](#Peer+_mergeContractPatchAllowList)
    * [._signerMayPatchContract(contractId, signerPubkeyHex)](#Peer+_signerMayPatchContract) ⇒ <code>boolean</code>
    * [._startFabricPingKeepalive(socket, encryptWrite)](#Peer+_startFabricPingKeepalive)
    * [._writeFabric(msg, stream)](#Peer+_writeFabric) ⇒ <code>boolean</code>
    * [.start()](#Peer+start)
    * [.stop()](#Peer+stop)
    * [.listen()](#Peer+listen) ⇒ [<code>Peer</code>](#Peer)
    * [._appendWarning(msg)](#Service+_appendWarning) ⇒ [<code>Service</code>](#Service)
    * [.init()](#Service+init)
    * [.tick()](#Service+tick) ⇒ <code>Number</code>
    * [.beat()](#Service+beat) ⇒ [<code>Service</code>](#Service)
    * [.get(path)](#Service+get) ⇒ <code>Mixed</code>
    * [.set(path)](#Service+set) ⇒ <code>Mixed</code>
    * [.trust(source)](#Service+trust) ⇒ [<code>Service</code>](#Service)
    * [.handler(message)](#Service+handler) ⇒ [<code>Service</code>](#Service)
    * [.lock([duration])](#Service+lock) ⇒ <code>Boolean</code>
    * [.when(event, method)](#Service+when) ⇒ <code>EventEmitter</code>
    * [.defineOpcode(name, [definition])](#Service+defineOpcode) ⇒ <code>Object</code>
    * [.defineBitcoinOpcode(name, [definition])](#Service+defineBitcoinOpcode) ⇒ <code>Object</code>
    * [.defineFabricOpcode(name, [definition])](#Service+defineFabricOpcode) ⇒ <code>Object</code>
    * [.defineOpcodeContract(name, body, [meta])](#Service+defineOpcodeContract) ⇒ <code>Object</code>
    * [.listOpcodes()](#Service+listOpcodes) ⇒ <code>Array.&lt;Object&gt;</code>
    * [.route(msg)](#Service+route) ⇒ <code>Promise</code>
    * [._GET(path)](#Service+_GET) ⇒ <code>Promise</code>
    * [._PUT(path, value, [commit])](#Service+_PUT) ⇒ <code>Promise</code>
    * [.connect(notify)](#Service+connect) ⇒ <code>Promise</code>
    * [.send(channel, message)](#Service+send) ⇒ [<code>Service</code>](#Service)
    * [.commit()](#Service+commit) ⇒ <code>String</code>
    * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
    * [._send(message)](#Service+_send)
    * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
    * [.export()](#Actor+export) ⇒ <code>Object</code>
    * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
    * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
    * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
    * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
    * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
    * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
    * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
    * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
    * [.value([format])](#Actor+value) ⇒ <code>Object</code>
    * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>

<a name="new_Peer_new"></a>

### new Peer([config])
Create an instance of [Peer](#Peer).


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [config] | <code>Object</code> |  | Initialization Vector for this peer. |
| [config.listen] | <code>Boolean</code> |  | Whether or not to listen for connections. |
| [config.upnp] | <code>Boolean</code> |  | Whether or not to use UPNP for automatic configuration. |
| [config.port] | <code>Number</code> | <code>7777</code> | Port to use for P2P connections. |
| [config.listenPortAttempts] | <code>Number</code> | <code>20</code> | When the listen port is in use (`EADDRINUSE`),   try the next port up to this many times (same host). |
| [config.peers] | <code>Array</code> | <code>[]</code> | List of initial peers. |

<a name="Peer+_actorsByName"></a>

### peer.\_actorsByName : <code>Object.&lt;string, string&gt;</code>
**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+pendingDocumentRequests"></a>

### peer.pendingDocumentRequests
Pending DOCUMENT_REQUEST entries when [Peer#settings.autoFulfillDocumentRequests](Peer#settings.autoFulfillDocumentRequests) is false.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_authorizedDocumentKeyReveals"></a>

### peer.\_authorizedDocumentKeyReveals
Authorized sealed-document key reveals: `"documentId|paymentHashHex"` → meta.
Populated only after verified settlement (never from public hash echo).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_contractPatchAllowList"></a>

### peer.\_contractPatchAllowList
contractId → Set of lowercase compressed pubkeys allowed to apply state ops.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_contractGenesis"></a>

### peer.\_contractGenesis
contractId → original CONTRACT_PUBLISH body (ARC genesis for ingest).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+blobTransfers"></a>

### peer.blobTransfers
Buyer-side verified blob reassembly (DocumentBlobIndex).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+pendingSealedDeliveries"></a>

### peer.pendingSealedDeliveries
Ciphertext awaiting content-key reveal: documentId → meta.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+pendingSealedBlobs"></a>

### peer.pendingSealedBlobs
Per-blob sealed trees awaiting one `DocumentContentKeyReveal` per blob (types/document.js).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_documentRelayRoutes"></a>

### peer.\_documentRelayRoutes
Private reverse routes for rewritten DocumentRequests (never gossiped).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_inboundNoiseStaticPubkeyByAddress"></a>

### peer.\_inboundNoiseStaticPubkeyByAddress
Inbound address -> NOISE static pubkey hex (FLUSH_CHAIN allowlist only; never for AMP verify).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+messages"></a>

### peer.messages
Wire-envelope dedup (SHA-256 of full buffer); FIFO-capped via [Peer#_rememberWireHash](Peer#_rememberWireHash).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_logicalRegisterOnce"></a>

### peer.\_logicalRegisterOnce : <code>Map.&lt;string, {type: string, signer: (string\|null), at: number}&gt;</code>
Logical first-writer-wins registrations (content-addressed keys).
Catches re-signed duplicates of CONTRACT_PUBLISH / DOCUMENT_PUBLISH / etc.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_gossipPayloadSeen"></a>

### peer.\_gossipPayloadSeen
Logical gossip payload dedup (excludes signature / hop churn).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_gossipRelayByOrigin"></a>

### peer.\_gossipRelayByOrigin
origin address → { count, windowStart } for gossip relay rate limiting.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_chatRelayByOrigin"></a>

### peer.\_chatRelayByOrigin
origin address → { count, windowStart } for chat mesh relay rate limiting.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_peeringPayloadSeen"></a>

### peer.\_peeringPayloadSeen
Logical peering-offer payload dedup (ignores advisory peeringHop; frames relay as-is).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_peeringRelayByOrigin"></a>

### peer.\_peeringRelayByOrigin
origin address → { count, windowStart } for peering-offer relay rate limiting.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_wireInboundByOrigin"></a>

### peer.\_wireInboundByOrigin
`host:port` → { credits, windowStart, penalized } — inbound wire flood / de-rank (per peer).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_peerBandwidthByOrigin"></a>

### peer.\_peerBandwidthByOrigin
`host:port` → rolling L1-window byte counters (session + 10 min).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_logicalDupPenaltyByOrigin"></a>

### peer.\_logicalDupPenaltyByOrigin
`host:port` → { windowStart, penalized } — soft logical-duplicate derank once per window.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_peerBans"></a>

### peer.\_peerBans : <code>Map.&lt;string, {until: number, reason: string}&gt;</code>
Temporary bans after hard misbehavior: `addr:<host:port>` or `pk:<hex>` → { until, reason }.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_candidateKeys"></a>

### peer.\_candidateKeys
`host:port` keys for [P2P_PEERING_OFFER](P2P_PEERING_OFFER) candidate queue dedup.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_candidateRetryAt"></a>

### peer.\_candidateRetryAt
`host:port` → next allowed dial (ms). Caps refused-candidate storms.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_outboundDialTargets"></a>

### peer.\_outboundDialTargets
`host:port` strings we opened via [_connect](#Peer+_connect) (outbound dials).
[P2P_SESSION_OFFER](P2P_SESSION_OFFER) must not destroy these when the same peer also opens an inbound
socket (mesh star): otherwise RPC paths that use the listen address (e.g. ChainSyncRequest)
see `peer not connected` while an ephemeral inbound key remains.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_selfDialSuppressUntil"></a>

### peer.\_selfDialSuppressUntil : <code>Map.&lt;string, number&gt;</code>
Addresses suppressed after a self-session (own Fabric key on the wire).
Map `host:port` → expiry ms (Date.now()).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_musigSessions"></a>

### peer.\_musigSessions : <code>Map.&lt;string, object&gt;</code>
BIP-327 directed sessions keyed by sessionId hex.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+bandwidthSummary"></a>

### peer.bandwidthSummary ⇒ <code>Object</code>
Node-wide Fabric P2P bandwidth vs the L1 1 MiB / 10 min target.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+address"></a>

### ~~peer.address~~
***Deprecated***

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+knownPeers"></a>

### peer.knownPeers ⇒ <code>Array.&lt;object&gt;</code>
Registry plus live connections. Each row includes rolling Fabric P2P
bandwidth (`bytesIn` / `bytesOut` / `windowBytes` vs L1 `budgetBytes`).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_gossipPayloadDedupKey"></a>

### peer.\_gossipPayloadDedupKey(msg) ⇒ <code>string</code>
Stable id for gossip *logical* content (ignores advisory `gossipHop`; frames are forwarded bit-identical).
Mesh frames are relayed bit-identical; wire-hash dedup also prevents loops.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>string</code> - hex sha256  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>object</code> | Generic message (`type`, `object`, …) |

<a name="Peer+_logicalRegistrationKey"></a>

### peer.\_logicalRegistrationKey(type, object) ⇒ <code>string</code> \| <code>null</code>
Content-addressed key for first-writer-wins registration types.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| type | <code>string</code> | wire / generic type name |
| object | <code>object</code> \| <code>null</code> \| <code>undefined</code> | message body / object |

<a name="Peer+_claimLogicalRegistration"></a>

### peer.\_claimLogicalRegistration(type, object, [signerPubkeyHex]) ⇒ <code>Object</code>
Claim a logical registration key (first writer wins).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| type | <code>string</code> |  | 
| object | <code>object</code> \| <code>null</code> \| <code>undefined</code> |  | 
| [signerPubkeyHex] | <code>string</code> \| <code>null</code> | <code>null</code> | 

<a name="Peer+_applyPeerMisbehavior"></a>

### peer.\_applyPeerMisbehavior(originName, reason, [opts])
Lower registry score and optionally destroy the TCP connection (hard misbehavior).
Hard disconnects also install a temporary ban (address + known pubkey).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| originName | <code>string</code> \| <code>null</code> \| <code>undefined</code> | 
| reason | <code>string</code> | 
| [opts] | <code>Object</code> | 
| [opts.penalty] | <code>number</code> | 
| [opts.disconnect] | <code>boolean</code> | 

<a name="Peer+_banPeer"></a>

### peer.\_banPeer(originName, reason)
Ban a connection address (and mapped pubkey when known) for [Peer#settings.peerScore.banTtlMs](Peer#settings.peerScore.banTtlMs).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| originName | <code>string</code> | 
| reason | <code>string</code> | 

<a name="Peer+_isPeerBanned"></a>

### peer.\_isPeerBanned(originName, [pubkeyHex]) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| originName | <code>string</code> \| <code>null</code> \| <code>undefined</code> | <code>null</code> | 
| [pubkeyHex] | <code>string</code> \| <code>null</code> \| <code>undefined</code> | <code>null</code> | 

<a name="Peer+_logicalRegisterDuplicateMisbehavior"></a>

### peer.\_logicalRegisterDuplicateMisbehavior(originName, type, claim, [signerPubkeyHex])
Soft (once/window) or hijack (CONTRACT_PUBLISH other signer) penalty for logical duplicates.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| originName | <code>string</code> \| <code>null</code> \| <code>undefined</code> | 
| type | <code>string</code> | 
| claim | <code>Object</code> | 
| [claim.prior] | <code>Object</code> \| <code>null</code> | 
| [claim.prior.signer] | <code>string</code> \| <code>null</code> | 
| [signerPubkeyHex] | <code>string</code> \| <code>null</code> | 

<a name="Peer+_claimLogicalRegistrationOrPunish"></a>

### peer.\_claimLogicalRegistrationOrPunish(type, object, [signerPubkeyHex], [originName]) ⇒ <code>Object</code>
Claim logical registration; on duplicate, apply misbehavior and return claim.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| type | <code>string</code> |  | 
| object | <code>object</code> \| <code>null</code> \| <code>undefined</code> |  | 
| [signerPubkeyHex] | <code>string</code> \| <code>null</code> | <code>null</code> | 
| [originName] | <code>string</code> \| <code>null</code> | <code>null</code> | 

<a name="Peer+_gossipRateLimitAllow"></a>

### peer.\_gossipRateLimitAllow(originName) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| originName | <code>string</code> | Connection id (e.g. `host:port`) |

<a name="Peer+_chatRateLimitAllow"></a>

### peer.\_chatRateLimitAllow(originName) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| originName | <code>string</code> | Connection id (e.g. `host:port`) |

<a name="Peer+_wireInboundCreditCost"></a>

### peer.\_wireInboundCreditCost(wireType) ⇒ <code>number</code>
Credit cost for inbound wire messages (heavier types consume more of the peer's budget).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| wireType | <code>string</code> \| <code>number</code> | 

<a name="Peer+_wireInboundRateAllowPeer"></a>

### peer.\_wireInboundRateAllowPeer(originName, creditCost) ⇒ <code>boolean</code>
Apply rolling-window credits; on overflow, de-rank once per window and reject the message.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - false = drop message  

| Param | Type | Description |
| --- | --- | --- |
| originName | <code>string</code> | connection key (host:port) |
| creditCost | <code>number</code> |  |

<a name="Peer+_derankPeerForWireTraffic"></a>

### peer.\_derankPeerForWireTraffic(originName, penalty, reason)
Lower registry [knownPeers](#Peer+knownPeers) score for a connection (Bitcoin Core misbehavior analogue).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| originName | <code>string</code> | 
| penalty | <code>number</code> | 
| reason | <code>string</code> | 

<a name="Peer+_peeringOfferPayloadDedupKey"></a>

### peer.\_peeringOfferPayloadDedupKey(msg) ⇒ <code>string</code>
Stable id for peering-offer *logical* content (ignores advisory `peeringHop`).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>string</code> - hex sha256  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>object</code> | Generic message (`type`, `object`, …) |

<a name="Peer+_peeringRateLimitAllow"></a>

### peer.\_peeringRateLimitAllow(originName) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| originName | <code>string</code> | Connection id (e.g. `host:port`) |

<a name="Peer+_enqueuePeeringCandidate"></a>

### peer.\_enqueuePeeringCandidate(host, port, [meta])
Enqueue a fabric candidate from [P2P_PEERING_OFFER](P2P_PEERING_OFFER); FIFO-capped and deduped by host:port.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| host | <code>string</code> |  |
| port | <code>number</code> |  |
| [meta] | <code>Object</code> |  |
| [meta.pubkey] | <code>string</code> | Optional advertised Fabric pubkey (informational). |
| [meta.verifiedPubkey] | <code>string</code> | AMP/session-verified pubkey; self-dial suppress uses this only. |

<a name="Peer+_localFabricPubkeyHex"></a>

### peer.\_localFabricPubkeyHex() ⇒ <code>string</code>
Local Fabric session pubkey (x-only hex), same normalization as wire signers.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_isOwnFabricPubkey"></a>

### peer.\_isOwnFabricPubkey(hex) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| hex | <code>\*</code> | 

<a name="Peer+_isOwnFabricActorId"></a>

### peer.\_isOwnFabricActorId(id) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| id | <code>\*</code> | 

<a name="Peer+_suppressSelfDialAddress"></a>

### peer.\_suppressSelfDialAddress(address, [ttlMs])
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| address | <code>string</code> |  | 
| [ttlMs] | <code>number</code> | <code>600000</code> | 

<a name="Peer+_isSelfDialSuppressed"></a>

### peer.\_isSelfDialSuppressed(address) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| address | <code>string</code> | 

<a name="Peer+_abortSelfFabricSession"></a>

### peer.\_abortSelfFabricSession(connAddress, [reason]) ⇒ [<code>Peer</code>](#Peer)
Tear down a TCP/NOISE session that presented our own Fabric identity.
Emits `peer:self` so apps can drop the address from dial lists.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| connAddress | <code>string</code> \| <code>null</code> \| <code>undefined</code> |  | 
| [reason] | <code>string</code> | <code>&quot;own Fabric identity&quot;</code> | 

<a name="Peer+countNoiseHandshakeListeners"></a>

### peer.countNoiseHandshakeListeners() ⇒ <code>Object</code>
Shared WASM handshake-bus listener counts (three events per in-flight session).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+broadcast"></a>

### peer.broadcast(message, [origin]) ⇒ <code>number</code>
Write a [Buffer](Buffer) to all connected peers.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>number</code> - Count of peers the frame was written to.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| message | <code>Buffer</code> |  | Message buffer to send. |
| [origin] | <code>string</code> \| <code>null</code> | <code>null</code> | Skip this connection id (usually the inbound origin). |

<a name="Peer+_localXOnlyPeerId"></a>

### peer.\_localXOnlyPeerId() ⇒ <code>Buffer</code>
Local node x-only pubkey (AMP {@code author} / {@code P2P_FORWARD.nextPeer} encoding).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_resolveAddressByXOnly"></a>

### peer.\_resolveAddressByXOnly(peerId) ⇒ <code>string</code> \| <code>null</code>
Resolve a live connection address for an x-only (or compressed) peer pubkey.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>string</code> \| <code>null</code> - connection key ({@code host:port}) or null  

| Param | Type |
| --- | --- |
| peerId | <code>Buffer</code> \| <code>string</code> | 

<a name="Peer+sendOnion"></a>

### peer.sendOnion(path, payload) ⇒ <code>boolean</code>
Send {@code payload} along a source-routed onion path of Fabric peer pubkeys.
Builds nested {@code P2P_FORWARD} layers and writes the outer frame only to
{@code path[0]} (immediate hop). Destination learns the last hop's IP, not
the originator's. See [module:@fabric/core/functions/fabricOnion](module:@fabric/core/functions/fabricOnion).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - true if the outer frame was written to the first hop  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Array.&lt;(Buffer\|string)&gt;</code> | hop pubkeys; first = next TCP peer, last = deliverer |
| payload | [<code>Message</code>](#Message) \| <code>Buffer</code> | innermost application Message (should already be signed) |

<a name="Peer+startMusig2"></a>

### peer.startMusig2([opts]) ⇒ <code>object</code> \| <code>null</code>
Begin a directed BIP-327 MuSig2 session (n-of-n) with connected peers.
Co-signers ignore inbound START unless `settings.musig2.autoAccept === true`.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>object</code> \| <code>null</code> - public session view  

| Param | Type | Description |
| --- | --- | --- |
| [opts] | <code>object</code> |  |
| opts.msg | <code>Buffer</code> \| <code>string</code> | message to sign (hashed to 32 bytes unless already 32) |
| [opts.pubkeys] | <code>Array.&lt;(Buffer\|string)&gt;</code> | compressed participants; default local + dest |
| [opts.dest] | <code>Buffer</code> \| <code>string</code> | peer pubkey or `host:port` for the first hop |
| [opts.purpose] | <code>string</code> |  |

<a name="Peer+getMusig2Session"></a>

### peer.getMusig2Session(sessionId) ⇒ <code>object</code> \| <code>null</code>
Public MuSig2 session snapshot (no secret nonce).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| sessionId | <code>Buffer</code> \| <code>string</code> | 

<a name="Peer+relayFromTrustedPeers"></a>

### peer.relayFromTrustedPeers(origin, message, [minScoreExclusive])
Relay an AMP message only to connected peers whose persistent registry score is strictly greater than
[Peer#settings.flushChainMinTrustedScore](Peer#settings.flushChainMinTrustedScore) (default 800). Used for `P2P_FLUSH_CHAIN`.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| origin | <code>string</code> \| <code>null</code> |  | Connection key to skip (inbound sender), or null when originating locally. |
| message | [<code>Message</code>](#Message) \| <code>Buffer</code> |  |  |
| [minScoreExclusive] | <code>number</code> | <code></code> | Override trust threshold (relay if peer score &gt; this value). |

<a name="Peer+_registryScoreForConnectionAddress"></a>

### peer.\_registryScoreForConnectionAddress(connAddress) ⇒ <code>number</code>
Best-effort registry score for a live connection key (`host:port`), using mapped Fabric id when known.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| connAddress | <code>string</code> | 

<a name="Peer+_registryScoreForFlushChainSender"></a>

### peer.\_registryScoreForFlushChainSender(connAddress, senderPubkeyHex) ⇒ <code>number</code>
FLUSH_CHAIN trust score bound to verified sender key.

Prevents trusting attacker-controlled `P2P_SESSION_OFFER.actor.id` aliases
by refusing `_addressToId`-mapped scores unless that mapped registry entry
is explicitly bound to the same verified sender pubkey.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| connAddress | <code>string</code> |  |
| senderPubkeyHex | <code>string</code> | verified sender pubkey hex (from NOISE/static or trusted peer record) |

<a name="Peer+sendFlushChainToTrustedPeers"></a>

### peer.sendFlushChainToTrustedPeers(object) ⇒ <code>number</code>
Sign and send `P2P_FLUSH_CHAIN` to all connected peers with registry score &gt; threshold.
Body JSON: `{ snapshotBlockHash, network?, label? }`.

**Receivers** (see `P2P_FLUSH_CHAIN` handler) require **both**:
1. Sender pubkey in [Peer#settings.flushChainAuthorizedPubkeys](Peer#settings.flushChainAuthorizedPubkeys) (non-empty allowlist), and
2. Registry score above [Peer#settings.flushChainMinTrustedScore](Peer#settings.flushChainMinTrustedScore).
Registry score bumps on `P2P_PONG` only when that pong answers an outbound ping on the same
connection (`_fabricPingOutstanding`), so unsolicited pongs cannot inflate trust alone.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>number</code> - number of sockets written  

| Param | Type |
| --- | --- |
| object | <code>Object</code> | 

<a name="Peer+_connect"></a>

### peer.\_connect(target)
Open a Fabric connection to the target address and initiate the Fabric Protocol.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| target | <code>String</code> | Target address. |

<a name="Peer+_announceAlias"></a>

### peer.\_announceAlias(alias, [origin], [_socket])
Broadcast a personal nickname as first-class [P2P_PEER_ALIAS](P2P_PEER_ALIAS)
(UTF-8 body = nickname text only).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| alias | <code>string</code> |  |  |
| [origin] | <code>Object</code> \| <code>null</code> | <code></code> | Optional origin to exclude from broadcast |
| [_socket] | <code>\*</code> | <code></code> | Unused (API compatibility) |

<a name="Peer+_loadPeerRegistry"></a>

### peer.\_loadPeerRegistry() ⇒ <code>Promise.&lt;void&gt;</code>
Load persistent peer registry from LevelDB.
Uses classic-level in Node, browser-level (IndexedDB) in browser.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_savePeerRegistry"></a>

### peer.\_savePeerRegistry()
Persist peer registry to LevelDB (debounced).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_flushChainSenderPubkeyHex"></a>

### peer.\_flushChainSenderPubkeyHex()
FLUSH_CHAIN sender hex: [Peer#peers](Peer#peers)[addr].publicKey if set, else inbound NOISE static (allowlist must match).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_upsertPeerRegistry"></a>

### peer.\_upsertPeerRegistry(address, [updates])
Upsert a peer into the persistent registry (state.peers) and schedule save to LevelDB.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| address | <code>string</code> | Peer address (e.g. host:port). |
| [updates] | <code>Object</code> | Fields to set/merge (id, score, firstSeen, lastSeen, alias, publicKey). |

<a name="Peer+_fillPeerSlots"></a>

### peer.\_fillPeerSlots() ⇒ [<code>Peer</code>](#Peer)
Attempt to fill available connection slots with new peers.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Peer</code>](#Peer) - Instance of the peer.  
<a name="Peer+_handleFabricMessage"></a>

### peer.\_handleFabricMessage(buffer, [origin], [socket], [options]) ⇒ [<code>Peer</code>](#Peer)
Handle a Fabric [Message](#Message) buffer.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Peer</code>](#Peer) - Instance of the Peer.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| buffer | <code>Buffer</code> |  |  |
| [origin] | <code>object</code> \| <code>null</code> | <code></code> |  |
| [socket] | <code>object</code> \| <code>null</code> | <code></code> |  |
| [options] | <code>Object</code> | <code></code> |  |
| [options.relayDepth] | <code>number</code> |  |  |
| [options.skipRelayFlood] | <code>boolean</code> |  |  |
| [options.peeledForward] | <code>boolean</code> |  | true when delivered via [Peer#_handleP2PForward](Peer#_handleP2PForward) peel |

<a name="Peer+_relayWirePayload"></a>

### peer.\_relayWirePayload()
Originate a locally signed {@code P2P_RELAY} envelope around already-signed inner AMP bytes.
Used only when *this* agent starts a flood (e.g. inventory without a prior wire frame).
Inbound {@code P2P_RELAY} must never call this — forward the original outer bit-identical.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_relayGenericPayload"></a>

### peer.\_relayGenericPayload()
Relay inventory / generic payloads. When {@code wireMessage} is present, forward it
bit-identical (no hop re-sign). Otherwise the local agent originates a new signed frame
and may wrap it in {@code P2P_RELAY} for mesh delivery.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_isTransientSocketError"></a>

### peer.\_isTransientSocketError(error) ⇒ <code>boolean</code>
True when a TCP/NOISE error is a routine connect/reset (not an application fault).
Node sometimes omits `error.code` and only puts `ECONNREFUSED` in the message.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| error | <code>\*</code> | 

<a name="Peer+_attachNoiseStreamErrorHandlers"></a>

### peer.\_attachNoiseStreamErrorHandlers(noiseStream, [label])
Bind encrypt/decrypt 'error' before piping. noise-protocol-stream calls
stream.destroy(err) on handshake failure; without listeners Node raises
uncaught Exceptions (e.g. `noise_stream_new`, `malloc`).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| noiseStream | <code>Object</code> |  | noise-protocol-stream duplex pair |
| noiseStream.encrypt | <code>stream.Duplex</code> |  |  |
| noiseStream.decrypt | <code>stream.Duplex</code> |  |  |
| [label] | <code>string</code> | <code>&quot;&#x27;NOISE&#x27;&quot;</code> |  |

<a name="Peer+_detachNoiseStreamErrorHandlers"></a>

### peer.\_detachNoiseStreamErrorHandlers(noiseStream) ⇒ <code>void</code>
Remove encrypt/decrypt 'error' listeners attached by [_attachNoiseStreamErrorHandlers](#Peer+_attachNoiseStreamErrorHandlers).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| noiseStream | <code>Object</code> | 

<a name="Peer+_teardownNoiseClient"></a>

### peer.\_teardownNoiseClient(socket) ⇒ <code>void</code>
Unpipe and destroy a NOISE pair so shared handshake emitters do not leak listeners.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| socket | <code>object</code> \| <code>null</code> | 

<a name="Peer+_buildDocumentParsedForPublish"></a>

### peer.\_buildDocumentParsedForPublish(documentId, content) ⇒ <code>Object</code>
Build hub-compatible document metadata for [purchaseContentHashHex](purchaseContentHashHex).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - Parsed document record (whitelisted fields)  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>String</code> |  |
| content | <code>String</code> | UTF-8 body |

<a name="Peer+_collectDocumentCatalogInventoryItems"></a>

### peer.\_collectDocumentCatalogInventoryItems([req]) ⇒ <code>Array.&lt;object&gt;</code>
Items for Hub-style `kind: 'documents'` inventory (Fabric UI / `@fabric/hub` merge expects `object.kind`).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| [req] | <code>Object</code> | request object subset |

<a name="Peer+_sendLocalInventoryDocumentsWireResponse"></a>

### peer.\_sendLocalInventoryDocumentsWireResponse(originName, items, [opts]) ⇒ <code>boolean</code>
Write [INVENTORY_RESPONSE](INVENTORY_RESPONSE) (`P2P_INVENTORY_RESPONSE`) compatible with `@fabric/hub` Bridge merging
(body includes `kind: 'documents'` so the browser can merge `object.items`).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| originName | <code>string</code> | connection key [Peer#connections](Peer#connections) |
| items | <code>Array.&lt;object&gt;</code> |  |
| [opts] | <code>Object</code> |  |
| [opts.allowEmpty] | <code>boolean</code> |  |

<a name="Peer+_respondInventoryFromLocalDocuments"></a>

### peer.\_respondInventoryFromLocalDocuments(message, origin) ⇒ <code>boolean</code>
Reply to `INVENTORY_REQUEST` with `INVENTORY_RESPONSE` built from local documents and rates.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - true if an `INVENTORY_RESPONSE` was written to the requester  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Object</code> | Generic body from [Peer#_handleGenericMessage](Peer#_handleGenericMessage) |
| origin | <code>Object</code> |  |

<a name="Peer+publishSealedDocument"></a>

### peer.publishSealedDocument(doc, [opts]) ⇒ <code>Object</code>
Register a per-blob sealed [Document](#Document) (one key per blob) for sale.
Inventory advertises hash-only leaves with per-blob payment hashes; buyers
settle one HTLC per blob plan and receive one key reveal per blob.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| doc | [<code>Document</code>](#Document) |  | Sealed document that holds its blob keys. |
| [opts] | <code>Object</code> |  |  |
| [opts.rateSats] | <code>number</code> | <code>0</code> | Per-blob ask: 0 (free) or at least `HTLC_MINIMUM_SATS`, since each blob settles with its own HTLC. |
| [opts.documentId] | <code>string</code> |  | Catalog id (default: the Document's). |

<a name="Peer+sealedBlobPreimageForPaymentHash"></a>

### peer.sealedBlobPreimageForPaymentHash(paymentHashHex) ⇒ <code>Object</code> \| <code>null</code>
Seller side: the content key `K_i` whose SHA256 is `paymentHashHex`, from
this node's published sealed-blob registry. Channel hosts hand this to
`Channel.Book` as `preimageFor` so a committed HTLC for a blob we sell is
fulfilled with the key (seller-fulfills; the buyer learns `K_i` from the
`ChannelHtlcFulfill`).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| paymentHashHex | <code>string</code> | 

<a name="Peer+_getSealedBlobDocument"></a>

### peer.\_getSealedBlobDocument(documentId) ⇒ [<code>Document</code>](#Document) \| <code>null</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Document</code>](#Document) \| <code>null</code> - rehydrated per-blob sealed document (with keys) or null  

| Param | Type |
| --- | --- |
| documentId | <code>string</code> | 

<a name="Peer+_sendP2pFileSendToPeer"></a>

### peer.\_sendP2pFileSendToPeer(documentId, peerAddress, [opts]) ⇒ <code>boolean</code>
Send a locally stored document as indexed, wire-sized `P2P_FILE_SEND` blobs.
Priced sealed docs send **ciphertext** (safe without the content key).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - true if at least one frame was written  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>string</code> |  |
| peerAddress | <code>string</code> | connection key in [Peer#connections](Peer#connections) |
| [opts] | <code>Object</code> |  |
| [opts.blobIndex] | <code>number</code> |  |
| [opts.revealKey] | <code>boolean</code> |  |
| [opts.settlementId] | <code>string</code> |  |
| [opts.routeId] | <code>string</code> |  |

<a name="Peer+_sendDocumentContentKeyReveal"></a>

### peer.\_sendDocumentContentKeyReveal(documentId, peerAddress, [opts]) ⇒ <code>boolean</code>
Reveal the AES content key to a peer (only after payment-hash match).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| documentId | <code>string</code> | 
| peerAddress | <code>string</code> | 
| [opts] | <code>Object</code> | 
| [opts.settlementId] | <code>string</code> | 

<a name="Peer+sealedBlobKeyForPaymentHash"></a>

### peer.sealedBlobKeyForPaymentHash(paymentHashHex) ⇒ <code>Object</code> \| <code>null</code>
Which held sealed blob a payment hash belongs to. Lets the buyer map a
channel `ChannelHtlcFulfill` preimage back onto the blob it unlocks.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| paymentHashHex | <code>string</code> | 

<a name="Peer+openSealedBlobWithKey"></a>

### peer.openSealedBlobWithKey(opts) ⇒ <code>Object</code>
Open a held sealed blob with a key learned out of band (seller-fulfills
channel rail: the HTLC preimage **is** `K_i`). Same verification as a
wire `DocumentContentKeyReveal`: SHA256(key) must equal the part's payment
hash and the plaintext must hash to its advertised digest.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - same shape as the key-reveal handler  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>Object</code> |  |
| opts.documentId | <code>string</code> |  |
| opts.keyHex | <code>string</code> | 32-byte key (hex) |
| [opts.blobIndex] | <code>number</code> | resolved from `paymentHashHex` when omitted |
| [opts.paymentHashHex] | <code>string</code> | SHA256(key); defaults to the hash of `keyHex` |
| [opts.merkleRootHex] | <code>string</code> | disambiguates when two roots are pending |

<a name="Peer+_ingestP2pFileSend"></a>

### peer.\_ingestP2pFileSend(message, origin, [wireMessage]) ⇒ <code>Object</code>
Verify / accumulate an inbound `P2P_FILE_SEND` against the DocumentBlobIndex rules.
Sealed frames store ciphertext until [KEY_REVEAL_TYPE](KEY_REVEAL_TYPE).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| message | [<code>Message</code>](#Message) \| <code>Object</code> |  |
| origin | <code>Object</code> |  |
| [origin.name] | <code>string</code> |  |
| [wireMessage] | [<code>Message</code>](#Message) | raw signed AMP frame (kept per sealed blob for fraud proofs) |

<a name="Peer+_handleDocumentContentKeyReveal"></a>

### peer.\_handleDocumentContentKeyReveal(reveal, [origin]) ⇒ <code>Object</code>
Apply a content-key reveal to a pending sealed delivery.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| reveal | <code>Object</code> |  | 
| [origin] | <code>Object</code> | <code></code> | 
| [origin.name] | <code>string</code> |  | 

<a name="Peer+openSealedDeliveryWithPreimage"></a>

### peer.openSealedDeliveryWithPreimage(documentId, preimageHex) ⇒ <code>Object</code>
Open a pending sealed delivery using an HTLC claim preimage (on-chain witness).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| documentId | <code>string</code> | 
| preimageHex | <code>string</code> | 

<a name="Peer+sendDocumentFileToPeer"></a>

### peer.sendDocumentFileToPeer(documentId, peerAddress, [opts]) ⇒ <code>boolean</code>
Public helper: push document bytes to a peer (same wire path as [_handleDocumentRequestWire](#Peer+_handleDocumentRequestWire) fulfillment).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| documentId | <code>string</code> | 
| peerAddress | <code>string</code> | 
| [opts] | <code>Object</code> | 
| [opts.blobIndex] | <code>number</code> | 
| [opts.revealKey] | <code>boolean</code> | 

<a name="Peer+requestPeerInventory"></a>

### peer.requestPeerInventory(peerAddress, [opts]) ⇒ <code>boolean</code>
Ask a connected peer for their document catalog (`kind: 'documents'`) or L1 offers (`offerBtc`).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| peerAddress | <code>string</code> |  | connection key, Fabric id, or host:port |
| [opts] | <code>Object</code> |  |  |
| [opts.offerBtc] | <code>boolean</code> | <code>false</code> |  |
| [opts.kind] | <code>string</code> | <code>&quot;&#x27;documents&#x27;&quot;</code> |  |
| [opts.maxSats] | <code>number</code> |  |  |
| [opts.blobHashHex] | <code>string</code> |  | chunk selector: only this blob |
| [opts.merkleRootHex] | <code>string</code> |  | tree selector: only this document tree |

<a name="Peer+requestDocument"></a>

### peer.requestDocument(documentId, [peerAddress], [opts]) ⇒ <code>boolean</code>
Send a signed `DocumentRequest` to one peer (or broadcast when peerAddress is omitted).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| documentId | <code>string</code> |  | 
| [peerAddress] | <code>string</code> | <code>null</code> | 
| [opts] | <code>object</code> |  | 
| [opts.maxSats] | <code>number</code> |  | 
| [opts.relayHop] | <code>number</code> |  | 
| [opts.blobIndex] | <code>number</code> |  | 
| [opts.blobTotal] | <code>number</code> |  | 
| [opts.contentHashHex] | <code>string</code> |  | 

<a name="Peer+_attachHtlcOfferToItem"></a>

### peer.\_attachHtlcOfferToItem(item, req, contentHashHex, amountSats) ⇒ <code>object</code> \| <code>null</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| item | <code>object</code> |  |
| req | <code>object</code> | inventory request object |
| contentHashHex | <code>string</code> |  |
| amountSats | <code>number</code> |  |

<a name="Peer+listPendingDocumentRequests"></a>

### peer.listPendingDocumentRequests() ⇒ <code>Array.&lt;object&gt;</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Array.&lt;object&gt;</code> - pending DOCUMENT_REQUEST rows (consent mode)  
<a name="Peer+approveDocumentRequest"></a>

### peer.approveDocumentRequest(requestKey) ⇒ <code>Object</code>
Approve a pending DOCUMENT_REQUEST and send `P2P_FILE_SEND`.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| requestKey | <code>string</code> | pending key, or document id when unique |

<a name="Peer+authorizeDocumentKeyReveal"></a>

### peer.authorizeDocumentKeyReveal(opts) ⇒ <code>Object</code>
Record that settlement for a sealed document was verified so a matching
DocumentRequest may receive the AES content key (not merely the ciphertext).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - `{ ok, error?, key? }`  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> |  |
| opts.documentId | <code>string</code> |  |
| opts.contentHashHex | <code>string</code> | payment hash SHA256(K) |
| [opts.settlementId] | <code>string</code> |  |
| [opts.txid] | <code>string</code> |  |

<a name="Peer+denyDocumentRequest"></a>

### peer.denyDocumentRequest(requestKey) ⇒ <code>Object</code>
Deny / drop a pending DOCUMENT_REQUEST without sending bytes.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| requestKey | <code>string</code> | 

<a name="Peer+_buildPublishDocumentWireBuffers"></a>

### peer.\_buildPublishDocumentWireBuffers(documentId, body, rateSats) ⇒ <code>Array.&lt;Buffer&gt;</code>
AMP buffers for one document: canonical `DocumentPublish`, then optional pricing `P2P_DOCUMENT_PUBLISH`.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>string</code> |  |
| body | <code>string</code> | UTF-8 body |
| rateSats | <code>number</code> |  |

<a name="Peer+_announceLocalDocumentsToPeer"></a>

### peer.\_announceLocalDocumentsToPeer(peerAddress)
Re-send all local document publishes to one peer (same bytes as [_publishDocument](#Peer+_publishDocument)).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| peerAddress | <code>string</code> | connection key in [Peer#connections](Peer#connections) |

<a name="Peer+_publishDocument"></a>

### peer.\_publishDocument(documentId, [content], [rateSats])
Store a document locally and gossip to peers.
1) **Canonical** `DOCUMENT_PUBLISH` wire message (same bytes as hub `documentPublishEnvelope`) for L1 `contentHash`.
2) If `rateSats > 0`, a **pricing** `GENERIC` `P2P_DOCUMENT_PUBLISH` with `rate` and `contentHash` (sat ask).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| documentId | <code>String</code> |  | Catalog key (e.g. CLI document name). |
| [content] | <code>String</code> | <code>&#x27;&#x27;</code> | UTF-8 body stored under [Peer#state](Peer#state).documents. |
| [rateSats] | <code>Number</code> | <code>0</code> | Ask price in satoshis (gossip only; not part of canonical hash). |

<a name="Peer+_handleDocumentRequestWire"></a>

### peer.\_handleDocumentRequestWire(message, origin, socket, [options])
Handle inbound `DOCUMENT_REQUEST`: emit `documentRequest` / `DocumentRequest`, then either
send `P2P_FILE_SEND` (when [Peer#settings.autoFulfillDocumentRequests](Peer#settings.autoFulfillDocumentRequests)), queue for
operator approve, or relay when the document is not held.

Peel / foreign-signed `P2P_RELAY` deliveries are local-observe only: never fulfill or
queue against the TCP last hop, and never second-flood the inner under that hop.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| message | [<code>Message</code>](#Message) |  |  |
| origin | <code>Object</code> |  |  |
| socket | <code>\*</code> |  |  |
| [options] | <code>Object</code> | <code></code> | same delivery opts as [_handleFabricMessage](#Peer+_handleFabricMessage) |

<a name="Peer+_privateRelayDocumentRequest"></a>

### peer.\_privateRelayDocumentRequest(parsed, origin, [originalMessage])
Rewrite a budgeted DocumentRequest (privacy) and forward with reduced maxSats.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| parsed | <code>object</code> |  | 
| origin | <code>Object</code> |  | 
| [originalMessage] | [<code>Message</code>](#Message) | <code></code> | 

<a name="Peer+_sendPrivateRelayedDocumentRequest"></a>

### peer.\_sendPrivateRelayedDocumentRequest(msg, origin, parsed) ⇒ <code>boolean</code>
Deliver a rewritten private DocumentRequest without mesh broadcast.
Preference: onion `relayPath` → explicit `nextPeer` → fan-out to TCP peers
other than the inbound origin.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | signed DocumentRequest |
| origin | <code>Object</code> \| <code>null</code> |  |
| parsed | <code>object</code> | inbound request body |

<a name="Peer+_maybeReverseRelayFileSend"></a>

### peer.\_maybeReverseRelayFileSend(fileObj, origin) ⇒ <code>boolean</code>
Forward a relayed `P2P_FILE_SEND` / key reveal back toward the buyer using reverse routes.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - true if forwarded (caller should skip local ingest)  

| Param | Type |
| --- | --- |
| fileObj | <code>object</code> | 
| origin | <code>Object</code> | 

<a name="Peer+_unregisterSocketActor"></a>

### peer.\_unregisterSocketActor(address) ⇒ <code>void</code>
Drop the ephemeral socket Actor keyed by `host:port`.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| address | <code>string</code> | 

<a name="Peer+_contractPublishSignerAuthorized"></a>

### peer.\_contractPublishSignerAuthorized(object, signerPubkeyHex) ⇒ <code>boolean</code>
When a publish body declares authority arrays, the AMP wire signer must be
present and listed. Bodies with no authorities are allowed (observe-only;
empty patch allow-list). Missing signer fail-closes when authorities exist.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default |
| --- | --- | --- |
| object | <code>object</code> |  | 
| signerPubkeyHex | <code>string</code> \| <code>null</code> | <code>null</code> | 

<a name="Peer+_distributedFederationValidatorsFromSettings"></a>

### peer.\_distributedFederationValidatorsFromSettings() ⇒ <code>Array.&lt;string&gt;</code>
Federation validator pubkeys for sidechain patch verification (settings or env).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_distributedFederationThresholdFromSettings"></a>

### peer.\_distributedFederationThresholdFromSettings() ⇒ <code>number</code>
k for federation witnesses. Unset = strict majority of the configured validators.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+_registerContract"></a>

### peer.\_registerContract(object, [publisherPubkeyHex]) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - true when newly registered (or already present no-op)  

| Param | Type | Default |
| --- | --- | --- |
| object | <code>object</code> |  | 
| [publisherPubkeyHex] | <code>string</code> \| <code>null</code> | <code>null</code> | 

<a name="Peer+_mergeContractPatchAllowList"></a>

### peer.\_mergeContractPatchAllowList(contractId, object, [_publisherPubkeyHex])
Build the set of pubkeys allowed to apply CONTRACT_MESSAGE ops for a newly
registered contract. Called only on first registration of a contract id —
republishes must not invoke this (see [_registerContract](#Peer+_registerContract)).
Membership is taken **only** from body authority arrays (`parties`,
`validators`, `owners`, `members` / `members.signers`, `authorities`,
`spendPolicy.validators`). The wire signer is never granted rights unless
already listed there.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| contractId | <code>string</code> |  |  |
| object | <code>object</code> |  | contract publish body |
| [_publisherPubkeyHex] | <code>string</code> \| <code>null</code> | <code>null</code> | ignored (kept for call-site compat) |

<a name="Peer+_signerMayPatchContract"></a>

### peer.\_signerMayPatchContract(contractId, signerPubkeyHex) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| contractId | <code>string</code> | 
| signerPubkeyHex | <code>string</code> \| <code>null</code> | 

<a name="Peer+_startFabricPingKeepalive"></a>

### peer.\_startFabricPingKeepalive(socket, encryptWrite)
Periodic P2P_PING and track expected P2P_PONG replies so registry score cannot be
self-inflated by unsolicited pongs (see FLUSH_CHAIN trust gate).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| socket | <code>\*</code> | — connection object (stores `_fabricPingOutstanding`, `_keepalive`) |
| encryptWrite | <code>\*</code> | — NOISE encrypt stream with `.write(Buffer)` (`client.encrypt` / `handler.encrypt`) |

<a name="Peer+_writeFabric"></a>

### peer.\_writeFabric(msg, stream) ⇒ <code>boolean</code>
Write an AMP frame onto a NOISE encrypt stream.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - True only when the local encrypt stream accepted the write.  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>Buffer</code> |  |
| stream | <code>object</code> | Noise handler/client (`encrypt.write`) |

<a name="Peer+start"></a>

### peer.start()
Start the Peer.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Overrides**: [<code>start</code>](#Service+start)  
<a name="Peer+stop"></a>

### peer.stop()
Stop the peer.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+listen"></a>

### peer.listen() ⇒ [<code>Peer</code>](#Peer)
Start listening for connections.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Peer</code>](#Peer) - Chainable method.  
<a name="Service+_appendWarning"></a>

### peer.\_appendWarning(msg) ⇒ [<code>Service</code>](#Service)
**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Service</code>](#Service) - This instance.  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>String</code> | Warning text (used by [Service#_registerService](Service#_registerService) duplicate guard). |

<a name="Service+init"></a>

### peer.init()
Called by Web Components.
TODO: move to @fabric/http/types/spa

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Service+tick"></a>

### peer.tick() ⇒ <code>Number</code>
Move forward one clock cycle.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Service+beat"></a>

### peer.beat() ⇒ [<code>Service</code>](#Service)
Compute latest state.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Overrides**: [<code>beat</code>](#Service+beat)  
**Emits**: <code>Message#event:beat</code>  
<a name="Service+get"></a>

### peer.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Mixed</code> - Returns the target value if found, otherwise null.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+set"></a>

### peer.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+trust"></a>

### peer.trust(source) ⇒ [<code>Service</code>](#Service)
Explicitly trust all events from a known source.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Service</code>](#Service) - Instance of Service after binding events.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Emitter of events. |

<a name="Service+handler"></a>

### peer.handler(message) ⇒ [<code>Service</code>](#Service)
Default route handler for an incoming message.  Follows the Activity
Streams 2.0 spec: https://www.w3.org/TR/activitystreams-core/

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Activity</code> | Message object. |

<a name="Service+lock"></a>

### peer.lock([duration]) ⇒ <code>Boolean</code>
Attempt to acquire a lock for `duration` seconds.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Boolean</code> - true if locked, false if unable to lock.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [duration] | <code>Number</code> | <code>1000</code> | Number of milliseconds to hold lock. |

<a name="Service+when"></a>

### peer.when(event, method) ⇒ <code>EventEmitter</code>
Bind a method to an event, with current state as the immutable context.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>EventEmitter</code> - Instance of EventEmitter.  

| Param | Type | Description |
| --- | --- | --- |
| event | <code>String</code> | Name of the event upon which to execute `method` as a function. |
| method | <code>function</code> | Function to execute when named [Event](Event) `event` is encountered. |

<a name="Service+defineOpcode"></a>

### peer.defineOpcode(name, [definition]) ⇒ <code>Object</code>
Register a single opcode entry in the service registry.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Opcode symbol (e.g. `OP_SHA256`, `P2P_FLUSH_CHAIN`) |
| [definition] | <code>Object</code> |  |

<a name="Service+defineBitcoinOpcode"></a>

### peer.defineBitcoinOpcode(name, [definition]) ⇒ <code>Object</code>
Register Bitcoin-style primitive opcode metadata.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineFabricOpcode"></a>

### peer.defineFabricOpcode(name, [definition]) ⇒ <code>Object</code>
Register Fabric opcode metadata.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineOpcodeContract"></a>

### peer.defineOpcodeContract(name, body, [meta]) ⇒ <code>Object</code>
Register a newline-delimited opcode contract.
Contract body example:
`OP_DUP\nOP_HASH160\nP2P_FLUSH_CHAIN`

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Contract label |
| body | <code>string</code> | Newline-delimited opcode list |
| [meta] | <code>Object</code> |  |

<a name="Service+listOpcodes"></a>

### peer.listOpcodes() ⇒ <code>Array.&lt;Object&gt;</code>
Snapshot opcode registry for UI / API use.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Service+route"></a>

### peer.route(msg) ⇒ <code>Promise</code>
Resolve a [State](#State) from a particular [Message](#Message) object.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Promise</code> - Resolves with resulting [State](#State).  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | Explicit Fabric [Message](#Message). |

<a name="Service+_GET"></a>

### peer.\_GET(path) ⇒ <code>Promise</code>
Retrieve a value from the Service's state.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Promise</code> - Resolves with the result.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path of the value to retrieve. |

<a name="Service+_PUT"></a>

### peer.\_PUT(path, value, [commit]) ⇒ <code>Promise</code>
Store a value in the Service's state.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Promise</code> - Resolves with with stored document.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>String</code> |  | Path to store the value at. |
| value | <code>Object</code> |  | Document to store. |
| [commit] | <code>Boolean</code> | <code>false</code> | Sign the resulting state. |

<a name="Service+connect"></a>

### peer.connect(notify) ⇒ <code>Promise</code>
Attach to network.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Promise</code> - Resolves to [Fabric](#Fabric).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| notify | <code>Boolean</code> | <code>true</code> | Commit to changes. |

<a name="Service+send"></a>

### peer.send(channel, message) ⇒ [<code>Service</code>](#Service)
Send a message to a channel.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| channel | <code>String</code> | Channel name to which the message will be sent. |
| message | <code>String</code> | Content of the message to send. |

<a name="Service+commit"></a>

### peer.commit() ⇒ <code>String</code>
Record outstanding JSON Patch deltas and emit a compact commitment id.
Does **not** wrap [Service#state](Service#state) in a new [Actor](#Actor) — that
JSON-cloned the entire tree on every write/connect and OOMed Hub.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>String</code> - 32-byte commitment id  
<a name="Service+_registerActor"></a>

### peer.\_registerActor(actor) ⇒ <code>Promise</code>
Register an [Actor](#Actor) with the [Service](#Service).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Overrides**: [<code>\_registerActor</code>](#Service+_registerActor)  
**Returns**: <code>Promise</code> - Resolves upon successful registration.  

| Param | Type | Description |
| --- | --- | --- |
| actor | <code>Object</code> | Instance of the [Actor](#Actor). |

<a name="Service+_send"></a>

### peer.\_send(message)
Sends a message.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Mixed</code> | Message to send. |

<a name="Actor+adopt"></a>

### peer.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+export"></a>

### peer.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### peer.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Overrides**: [<code>stream</code>](#Actor+stream)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### peer.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Actor+toGenericMessage"></a>

### peer.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### peer.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Actor+pause"></a>

### peer.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### peer.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Actor+sign"></a>

### peer.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Actor+unpause"></a>

### peer.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### peer.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### peer.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Program"></a>

## Program
**Kind**: global class  

* [Program](#Program)
    * [new Program([settings])](#new_Program_new)
    * _instance_
        * [.hash()](#Program+hash) ⇒ <code>string</code>
        * [.compile()](#Program+compile) ⇒ <code>Object</code>
        * [.toRedeemScript()](#Program+toRedeemScript) ⇒ <code>Object</code>
        * [.runCommitmentHex(result)](#Program+runCommitmentHex) ⇒ <code>string</code>
    * _static_
        * [.from([opts])](#Program.from) ⇒ [<code>Program</code>](#Program)

<a name="new_Program_new"></a>

### new Program([settings])

| Param | Type |
| --- | --- |
| [settings] | <code>object</code> | 
| [settings.language] | <code>string</code> | 
| [settings.source] | <code>string</code> \| <code>object</code> | 
| [settings.bytecode] | <code>\*</code> | 
| [settings.steps] | <code>Array.&lt;string&gt;</code> | 
| [settings.programId] | <code>string</code> | 

<a name="Program+hash"></a>

### program.hash() ⇒ <code>string</code>
Content-address of language + source/bytecode/steps.

**Kind**: instance method of [<code>Program</code>](#Program)  
**Returns**: <code>string</code> - 64-char hex  
<a name="Program+compile"></a>

### program.compile() ⇒ <code>Object</code>
Normalize language-specific form into `steps` / `bytecode`.

**Kind**: instance method of [<code>Program</code>](#Program)  
<a name="Program+toRedeemScript"></a>

### program.toRedeemScript() ⇒ <code>Object</code>
L1 redeem script scaffold (bitcoin-script only).

**Kind**: instance method of [<code>Program</code>](#Program)  
<a name="Program+runCommitmentHex"></a>

### program.runCommitmentHex(result) ⇒ <code>string</code>
Stable digest binding program identity to a compute result (L1 / OP_RETURN / witness).

**Kind**: instance method of [<code>Program</code>](#Program)  
**Returns**: <code>string</code> - 64-char hex  

| Param | Type |
| --- | --- |
| result | <code>\*</code> | 

<a name="Program.from"></a>

### Program.from([opts]) ⇒ [<code>Program</code>](#Program)
**Kind**: static method of [<code>Program</code>](#Program)  

| Param | Type |
| --- | --- |
| [opts] | <code>Object</code> | 
| [opts.language] | <code>string</code> | 
| [opts.source] | <code>\*</code> | 
| [opts.bytecode] | <code>\*</code> | 
| [opts.steps] | <code>Array.&lt;string&gt;</code> | 
| [opts.programId] | <code>string</code> | 

<a name="EncryptedPromise"></a>

## EncryptedPromise
A value that can be sealed with a password.  Sealing uses
`functions/sealedBlob` (AES-256-GCM, PBKDF2-SHA256, random salt and IV);
[state](#EncryptedPromise+state) and [toString](#EncryptedPromise+toString) only
ever expose the sealed envelope, never the plaintext or the password.

**Kind**: global class  

* [EncryptedPromise](#EncryptedPromise)
    * [new EncryptedPromise([settings])](#new_EncryptedPromise_new)
    * [.id](#EncryptedPromise+id) : <code>string</code>
    * [.state](#EncryptedPromise+state) : <code>Object</code>
    * [.resolve(msg)](#EncryptedPromise+resolve) ⇒ <code>Object</code>
    * [.lock()](#EncryptedPromise+lock)
    * [.encrypt(password)](#EncryptedPromise+encrypt) ⇒ <code>Object</code>
    * [.decrypt(password)](#EncryptedPromise+decrypt) ⇒ <code>string</code>
    * [.unlock()](#EncryptedPromise+unlock)
    * [.toString()](#EncryptedPromise+toString) ⇒ <code>string</code>

<a name="new_EncryptedPromise_new"></a>

### new EncryptedPromise([settings])

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> |  |
| [settings.value] | <code>string</code> \| <code>Object</code> | Plaintext to hold; objects are JSON-encoded.  Defaults to the other settings as JSON. |
| [settings.password] | <code>string</code> | Seal immediately with this password (at least 8 characters). |
| [settings.seal] | <code>Object</code> | Restore from a sealed envelope (see [state](#EncryptedPromise+state)); call `decrypt` to read it. |

<a name="EncryptedPromise+id"></a>

### encryptedPromise.id : <code>string</code>
SHA-256 of the plaintext, or of the sealed ciphertext while only the
envelope is known.

**Kind**: instance property of [<code>EncryptedPromise</code>](#EncryptedPromise)  
<a name="EncryptedPromise+state"></a>

### encryptedPromise.state : <code>Object</code>
Safe to persist: the sealed envelope (or `null` until sealed).

**Kind**: instance property of [<code>EncryptedPromise</code>](#EncryptedPromise)  
<a name="EncryptedPromise+resolve"></a>

### encryptedPromise.resolve(msg) ⇒ <code>Object</code>
Pair a message with this promise's id.

**Kind**: instance method of [<code>EncryptedPromise</code>](#EncryptedPromise)  

| Param | Type |
| --- | --- |
| msg | <code>\*</code> | 

<a name="EncryptedPromise+lock"></a>

### encryptedPromise.lock()
Not implemented; use [encrypt](#EncryptedPromise+encrypt).

**Kind**: instance method of [<code>EncryptedPromise</code>](#EncryptedPromise)  
<a name="EncryptedPromise+encrypt"></a>

### encryptedPromise.encrypt(password) ⇒ <code>Object</code>
Seal the current plaintext.

**Kind**: instance method of [<code>EncryptedPromise</code>](#EncryptedPromise)  
**Returns**: <code>Object</code> - The sealed envelope.  

| Param | Type | Description |
| --- | --- | --- |
| password | <code>string</code> | At least 8 characters. |

<a name="EncryptedPromise+decrypt"></a>

### encryptedPromise.decrypt(password) ⇒ <code>string</code>
Open the sealed envelope.

**Kind**: instance method of [<code>EncryptedPromise</code>](#EncryptedPromise)  
**Returns**: <code>string</code> - The plaintext.  

| Param | Type |
| --- | --- |
| password | <code>string</code> | 

<a name="EncryptedPromise+unlock"></a>

### encryptedPromise.unlock()
Not implemented; use [decrypt](#EncryptedPromise+decrypt).

**Kind**: instance method of [<code>EncryptedPromise</code>](#EncryptedPromise)  
<a name="EncryptedPromise+toString"></a>

### encryptedPromise.toString() ⇒ <code>string</code>
The persistable [state](#EncryptedPromise+state) as indented JSON (never the plaintext).

**Kind**: instance method of [<code>EncryptedPromise</code>](#EncryptedPromise)  
<a name="Reader"></a>

## ~~Reader~~
***Frame-scan helpers belong on [Peer](#Peer) / [Message](#Message) ingest
for RC. Do not take a new production dependency on [Reader](#Reader); keep this
class as a compatibility scanner only.
Read from a byte stream, seeking valid Fabric messages.***

**Kind**: global class  
<a name="new_Reader_new"></a>

### new Reader(settings)
Create an instance of a [Reader](#Reader), which can listen to a byte stream
for valid Fabric messages.


| Param | Type | Description |
| --- | --- | --- |
| settings | <code>Object</code> | Settings for the stream. |

<a name="Remote"></a>

## Remote ⇐ [<code>Actor</code>](#Actor)
<strong>WebSocket client</strong> to a remote Fabric/Hub-style host (extends [Actor](#Actor)). Per comment in
source, prefer moving richer HTTP to <code>@fabric/http</code>; this type stays for minimal [Message](#Message)-oriented
bridging. Uses browser/Node <code>WebSocket</code> with JSON [Message](#Message) payloads where applicable.

**Kind**: global class  
**Extends**: [<code>Actor</code>](#Actor)  
**Properties**

| Name | Type |
| --- | --- |
| config | <code>Object</code> | 
| secure | <code>Boolean</code> | 


* [Remote](#Remote) ⇐ [<code>Actor</code>](#Actor)
    * [new Remote([config])](#new_Remote_new)
    * [.enumerate()](#Remote+enumerate) ⇒ <code>Configuration</code>
    * [.request(type, path, [params])](#Remote+request) ⇒ <code>FabricHTTPResult</code>
    * [._PUT(path, body)](#Remote+_PUT) ⇒ <code>FabricHTTPResult</code> \| <code>String</code>
    * [._GET(path, params)](#Remote+_GET) ⇒ <code>FabricHTTPResult</code> \| <code>String</code>
    * [._POST(path, params)](#Remote+_POST) ⇒ <code>FabricHTTPResult</code> \| <code>String</code>
    * [._OPTIONS(path, params)](#Remote+_OPTIONS) ⇒ <code>Object</code>
    * [._PATCH(path, body)](#Remote+_PATCH) ⇒ <code>Object</code>
    * [._DELETE(path, params)](#Remote+_DELETE) ⇒ <code>Object</code>
    * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
    * [.commit()](#Actor+commit) ⇒ <code>String</code>
    * [.export()](#Actor+export) ⇒ <code>Object</code>
    * [.get(path)](#Actor+get) ⇒ <code>Object</code>
    * [.set(path, value)](#Actor+set) ⇒ <code>Object</code>
    * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
    * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
    * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
    * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
    * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
    * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
    * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
    * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
    * [.value([format])](#Actor+value) ⇒ <code>Object</code>
    * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>

<a name="new_Remote_new"></a>

### new Remote([config])

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [config] | <code>Object</code> | <code>{}</code> | <code>host</code>, <code>port</code>, <code>secure</code>, backoff, optional macaroon, … |

<a name="Remote+enumerate"></a>

### remote.enumerate() ⇒ <code>Configuration</code>
Enumerate the available Resources on the remote host.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Configuration</code> - An object with enumerable key/value pairs for the Application Resource Contract.  
<a name="Remote+request"></a>

### remote.request(type, path, [params]) ⇒ <code>FabricHTTPResult</code>
Make an HTTP request to the configured authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  

| Param | Type | Description |
| --- | --- | --- |
| type | <code>String</code> | One of `GET`, `PUT`, `POST`, `DELETE`, or `OPTIONS`. |
| path | <code>String</code> | The path to request from the authority. |
| [params] | <code>Object</code> | Options. |

<a name="Remote+_PUT"></a>

### remote.\_PUT(path, body) ⇒ <code>FabricHTTPResult</code> \| <code>String</code>
HTTP PUT against the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>FabricHTTPResult</code> \| <code>String</code> - Result of request.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| body | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_GET"></a>

### remote.\_GET(path, params) ⇒ <code>FabricHTTPResult</code> \| <code>String</code>
HTTP GET against the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>FabricHTTPResult</code> \| <code>String</code> - Result of request.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| params | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_POST"></a>

### remote.\_POST(path, params) ⇒ <code>FabricHTTPResult</code> \| <code>String</code>
HTTP POST against the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>FabricHTTPResult</code> \| <code>String</code> - Result of request.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| params | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_OPTIONS"></a>

### remote.\_OPTIONS(path, params) ⇒ <code>Object</code>
HTTP OPTIONS on the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - - Full description of remote resource.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| params | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_PATCH"></a>

### remote.\_PATCH(path, body) ⇒ <code>Object</code>
HTTP PATCH on the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - - Full description of remote resource.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| body | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_DELETE"></a>

### remote.\_DELETE(path, params) ⇒ <code>Object</code>
HTTP DELETE on the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - - Full description of remote resource.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| params | <code>Object</code> | Map of parameters to supply. |

<a name="Actor+adopt"></a>

### remote.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### remote.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+export"></a>

### remote.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+get"></a>

### remote.get(path) ⇒ <code>Object</code>
Retrieve a value from the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to retrieve using [JSONPointer](JSONPointer). |

<a name="Actor+set"></a>

### remote.set(path, value) ⇒ <code>Object</code>
Set a value in the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to set using [JSONPointer](JSONPointer). |
| value | <code>Object</code> | Value to set. |

<a name="Actor+stream"></a>

### remote.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### remote.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
<a name="Actor+toGenericMessage"></a>

### remote.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### remote.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Remote</code>](#Remote)  
<a name="Actor+pause"></a>

### remote.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### remote.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
<a name="Actor+sign"></a>

### remote.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
<a name="Actor+unpause"></a>

### remote.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### remote.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### remote.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Remote"></a>

## Remote
**Kind**: global class  

* [Remote](#Remote)
    * [new Remote([config])](#new_Remote_new)
    * [.enumerate()](#Remote+enumerate) ⇒ <code>Configuration</code>
    * [.request(type, path, [params])](#Remote+request) ⇒ <code>FabricHTTPResult</code>
    * [._PUT(path, body)](#Remote+_PUT) ⇒ <code>FabricHTTPResult</code> \| <code>String</code>
    * [._GET(path, params)](#Remote+_GET) ⇒ <code>FabricHTTPResult</code> \| <code>String</code>
    * [._POST(path, params)](#Remote+_POST) ⇒ <code>FabricHTTPResult</code> \| <code>String</code>
    * [._OPTIONS(path, params)](#Remote+_OPTIONS) ⇒ <code>Object</code>
    * [._PATCH(path, body)](#Remote+_PATCH) ⇒ <code>Object</code>
    * [._DELETE(path, params)](#Remote+_DELETE) ⇒ <code>Object</code>
    * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
    * [.commit()](#Actor+commit) ⇒ <code>String</code>
    * [.export()](#Actor+export) ⇒ <code>Object</code>
    * [.get(path)](#Actor+get) ⇒ <code>Object</code>
    * [.set(path, value)](#Actor+set) ⇒ <code>Object</code>
    * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
    * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
    * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
    * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
    * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
    * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
    * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
    * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
    * [.value([format])](#Actor+value) ⇒ <code>Object</code>
    * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>

<a name="new_Remote_new"></a>

### new Remote([config])

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [config] | <code>Object</code> | <code>{}</code> | <code>host</code>, <code>port</code>, <code>secure</code>, backoff, optional macaroon, … |

<a name="Remote+enumerate"></a>

### remote.enumerate() ⇒ <code>Configuration</code>
Enumerate the available Resources on the remote host.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Configuration</code> - An object with enumerable key/value pairs for the Application Resource Contract.  
<a name="Remote+request"></a>

### remote.request(type, path, [params]) ⇒ <code>FabricHTTPResult</code>
Make an HTTP request to the configured authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  

| Param | Type | Description |
| --- | --- | --- |
| type | <code>String</code> | One of `GET`, `PUT`, `POST`, `DELETE`, or `OPTIONS`. |
| path | <code>String</code> | The path to request from the authority. |
| [params] | <code>Object</code> | Options. |

<a name="Remote+_PUT"></a>

### remote.\_PUT(path, body) ⇒ <code>FabricHTTPResult</code> \| <code>String</code>
HTTP PUT against the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>FabricHTTPResult</code> \| <code>String</code> - Result of request.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| body | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_GET"></a>

### remote.\_GET(path, params) ⇒ <code>FabricHTTPResult</code> \| <code>String</code>
HTTP GET against the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>FabricHTTPResult</code> \| <code>String</code> - Result of request.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| params | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_POST"></a>

### remote.\_POST(path, params) ⇒ <code>FabricHTTPResult</code> \| <code>String</code>
HTTP POST against the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>FabricHTTPResult</code> \| <code>String</code> - Result of request.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| params | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_OPTIONS"></a>

### remote.\_OPTIONS(path, params) ⇒ <code>Object</code>
HTTP OPTIONS on the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - - Full description of remote resource.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| params | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_PATCH"></a>

### remote.\_PATCH(path, body) ⇒ <code>Object</code>
HTTP PATCH on the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - - Full description of remote resource.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| body | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_DELETE"></a>

### remote.\_DELETE(path, params) ⇒ <code>Object</code>
HTTP DELETE on the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - - Full description of remote resource.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| params | <code>Object</code> | Map of parameters to supply. |

<a name="Actor+adopt"></a>

### remote.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### remote.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+export"></a>

### remote.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+get"></a>

### remote.get(path) ⇒ <code>Object</code>
Retrieve a value from the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to retrieve using [JSONPointer](JSONPointer). |

<a name="Actor+set"></a>

### remote.set(path, value) ⇒ <code>Object</code>
Set a value in the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to set using [JSONPointer](JSONPointer). |
| value | <code>Object</code> | Value to set. |

<a name="Actor+stream"></a>

### remote.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### remote.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
<a name="Actor+toGenericMessage"></a>

### remote.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### remote.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Remote</code>](#Remote)  
<a name="Actor+pause"></a>

### remote.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### remote.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
<a name="Actor+sign"></a>

### remote.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
<a name="Actor+unpause"></a>

### remote.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### remote.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### remote.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Resolutions"></a>

## Resolutions ⇐ [<code>Actor</code>](#Actor)
**Kind**: global class  
**Extends**: [<code>Actor</code>](#Actor)  

* [Resolutions](#Resolutions) ⇐ [<code>Actor</code>](#Actor)
    * [new Resolutions()](#new_Resolutions_new)
    * [new Resolutions([settings])](#new_Resolutions_new)
    * [._states](#Resolutions+_states) : <code>Map.&lt;string, {parent: (string\|null), exits: Map.&lt;string, Object&gt;}&gt;</code>
    * [.stateIds](#Resolutions+stateIds) ⇒ <code>Array.&lt;string&gt;</code>
    * [.rootHex](#Resolutions+rootHex) ⇒ <code>string</code>
    * [.declare(stateId, [parent])](#Resolutions+declare) ⇒ [<code>Resolutions</code>](#Resolutions)
    * [.addExit(stateId, exit)](#Resolutions+addExit) ⇒ <code>Object</code>
    * [.getExit(stateId, exitId)](#Resolutions+getExit) ⇒ <code>Object</code> \| <code>null</code>
    * [.signExit(stateId, exitId, priv32)](#Resolutions+signExit) ⇒ <code>Object</code>
    * [.ingest(artifact)](#Resolutions+ingest) ⇒ <code>Object</code>
    * [.verifyExit(stateId, exitId)](#Resolutions+verifyExit) ⇒ <code>Object</code>
    * [.missingSigners(exit)](#Resolutions+missingSigners) ⇒ <code>Array.&lt;string&gt;</code>
    * [.resolvable(stateId)](#Resolutions+resolvable) ⇒ <code>boolean</code>
    * [.missing(stateId)](#Resolutions+missing) ⇒ <code>Array.&lt;{stateId: string, exitId: string, kind: string, missing: Array.&lt;string&gt;}&gt;</code>
    * [.exitsAfter(height, [stateId])](#Resolutions+exitsAfter) ⇒ <code>Array.&lt;Object&gt;</code>
    * [.finalizeExit(stateId, exitId)](#Resolutions+finalizeExit) ⇒ <code>Object</code>
    * [.toTree()](#Resolutions+toTree) ⇒ [<code>Tree</code>](#Tree)
    * [.export()](#Resolutions+export) ⇒ <code>Object</code>
    * [.import(snapshot)](#Resolutions+import) ⇒ [<code>Resolutions</code>](#Resolutions)
    * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
    * [.commit()](#Actor+commit) ⇒ <code>String</code>
    * [.get(path)](#Actor+get) ⇒ <code>Object</code>
    * [.set(path, value)](#Actor+set) ⇒ <code>Object</code>
    * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
    * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
    * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
    * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
    * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
    * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
    * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
    * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
    * [.value([format])](#Actor+value) ⇒ <code>Object</code>
    * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>

<a name="new_Resolutions_new"></a>

### new Resolutions()
State tree of pre-signed exits. Pure data plus Schnorr verification; no I/O.

<a name="new_Resolutions_new"></a>

### new Resolutions([settings])

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  |  |
| [settings.network] | <code>string</code> | <code>&quot;&#x27;regtest&#x27;&quot;</code> | Fabric network name |
| [settings.states] | <code>Object</code> |  | import snapshot (`export()` output) |

<a name="Resolutions+_states"></a>

### resolutions.\_states : <code>Map.&lt;string, {parent: (string\|null), exits: Map.&lt;string, Object&gt;}&gt;</code>
**Kind**: instance property of [<code>Resolutions</code>](#Resolutions)  
<a name="Resolutions+stateIds"></a>

### resolutions.stateIds ⇒ <code>Array.&lt;string&gt;</code>
**Kind**: instance property of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Array.&lt;string&gt;</code> - known state ids (insertion order).  
<a name="Resolutions+rootHex"></a>

### resolutions.rootHex ⇒ <code>string</code>
**Kind**: instance property of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>string</code> - hex Merkle root (empty tree → 64 zeros).  
<a name="Resolutions+declare"></a>

### resolutions.declare(stateId, [parent]) ⇒ [<code>Resolutions</code>](#Resolutions)
Declare a state node (idempotent).

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| stateId | <code>string</code> |  |  |
| [parent] | <code>string</code> \| <code>null</code> | <code>null</code> | parent state id (tree edge) |

<a name="Resolutions+addExit"></a>

### resolutions.addExit(stateId, exit) ⇒ <code>Object</code>
Register an exit a state depends on. Signatures already present on the
PSBT are harvested into `signers.have`.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Object</code> - stored exit record  

| Param | Type | Description |
| --- | --- | --- |
| stateId | <code>string</code> |  |
| exit | <code>Object</code> |  |
| exit.id | <code>string</code> | unique within the state |
| exit.kind | <code>string</code> | one of [Resolutions.KINDS](Resolutions.KINDS) |
| exit.psbtBase64 | <code>string</code> | unsigned (or partially signed) tapscript spend, input 0 |
| exit.required | <code>Array.&lt;string&gt;</code> | pubkeys (compressed or x-only hex) whose signatures make it broadcastable |
| [exit.locktime] | <code>Object</code> | `{ height }` (nLockTime / CLTV) and/or `{ csv }` (relative) |
| [exit.spends] | <code>Object</code> | `{ txid, vout }` the exit consumes |
| [exit.meta] | <code>Object</code> | free-form (never secrets) |

<a name="Resolutions+getExit"></a>

### resolutions.getExit(stateId, exitId) ⇒ <code>Object</code> \| <code>null</code>
**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type |
| --- | --- |
| stateId | <code>string</code> | 
| exitId | <code>string</code> | 

<a name="Resolutions+signExit"></a>

### resolutions.signExit(stateId, exitId, priv32) ⇒ <code>Object</code>
Sign an exit with a 32-byte private key and record the signature.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Object</code> - `ContractExitSignature` artifact (JSON-safe) for the counterparty  

| Param | Type |
| --- | --- |
| stateId | <code>string</code> | 
| exitId | <code>string</code> | 
| priv32 | <code>Buffer</code> \| <code>string</code> | 

<a name="Resolutions+ingest"></a>

### resolutions.ingest(artifact) ⇒ <code>Object</code>
Accept a counterparty's `ContractExitSignature` artifact after verifying
both the artifact signature and the tapscript signature it carries.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type | Description |
| --- | --- | --- |
| artifact | <code>Object</code> | output of [signExit](#Resolutions+signExit) |

<a name="Resolutions+verifyExit"></a>

### resolutions.verifyExit(stateId, exitId) ⇒ <code>Object</code>
Re-verify every held signature on an exit against its PSBT.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type |
| --- | --- |
| stateId | <code>string</code> | 
| exitId | <code>string</code> | 

<a name="Resolutions+missingSigners"></a>

### resolutions.missingSigners(exit) ⇒ <code>Array.&lt;string&gt;</code>
**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Array.&lt;string&gt;</code> - required x-only pubkeys without a held signature  

| Param | Type |
| --- | --- |
| exit | <code>Object</code> | 

<a name="Resolutions+resolvable"></a>

### resolutions.resolvable(stateId) ⇒ <code>boolean</code>
A state is resolvable when it (and every ancestor it inherits exits from)
holds all required signatures on all exits.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type |
| --- | --- |
| stateId | <code>string</code> | 

<a name="Resolutions+missing"></a>

### resolutions.missing(stateId) ⇒ <code>Array.&lt;{stateId: string, exitId: string, kind: string, missing: Array.&lt;string&gt;}&gt;</code>
What still has to be exchanged before `stateId` is live.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type |
| --- | --- |
| stateId | <code>string</code> | 

<a name="Resolutions+exitsAfter"></a>

### resolutions.exitsAfter(height, [stateId]) ⇒ <code>Array.&lt;Object&gt;</code>
Exits that become broadcastable at or after `height` (absolute locks only).

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| height | <code>number</code> |  |  |
| [stateId] | <code>string</code> | <code>null</code> | restrict to one state |

<a name="Resolutions+finalizeExit"></a>

### resolutions.finalizeExit(stateId, exitId) ⇒ <code>Object</code>
Fully-signed exit as a broadcastable transaction.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type |
| --- | --- |
| stateId | <code>string</code> | 
| exitId | <code>string</code> | 

<a name="Resolutions+toTree"></a>

### resolutions.toTree() ⇒ [<code>Tree</code>](#Tree)
Bitcoin-style Merkle tree over `SHA256(stateId|exitId|txid)` for audit.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
<a name="Resolutions+export"></a>

### resolutions.export() ⇒ <code>Object</code>
**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Overrides**: [<code>export</code>](#Actor+export)  
**Returns**: <code>Object</code> - JSON-safe snapshot (no private material).  
<a name="Resolutions+import"></a>

### resolutions.import(snapshot) ⇒ [<code>Resolutions</code>](#Resolutions)
**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type | Description |
| --- | --- | --- |
| snapshot | <code>Object</code> | output of [export](#Resolutions+export) |

<a name="Actor+adopt"></a>

### resolutions.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### resolutions.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+get"></a>

### resolutions.get(path) ⇒ <code>Object</code>
Retrieve a value from the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to retrieve using [JSONPointer](JSONPointer). |

<a name="Actor+set"></a>

### resolutions.set(path, value) ⇒ <code>Object</code>
Set a value in the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to set using [JSONPointer](JSONPointer). |
| value | <code>Object</code> | Value to set. |

<a name="Actor+stream"></a>

### resolutions.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### resolutions.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
<a name="Actor+toGenericMessage"></a>

### resolutions.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### resolutions.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
<a name="Actor+pause"></a>

### resolutions.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### resolutions.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
<a name="Actor+sign"></a>

### resolutions.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
<a name="Actor+unpause"></a>

### resolutions.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### resolutions.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### resolutions.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Resolutions"></a>

## Resolutions
**Kind**: global class  

* [Resolutions](#Resolutions)
    * [new Resolutions()](#new_Resolutions_new)
    * [new Resolutions([settings])](#new_Resolutions_new)
    * [._states](#Resolutions+_states) : <code>Map.&lt;string, {parent: (string\|null), exits: Map.&lt;string, Object&gt;}&gt;</code>
    * [.stateIds](#Resolutions+stateIds) ⇒ <code>Array.&lt;string&gt;</code>
    * [.rootHex](#Resolutions+rootHex) ⇒ <code>string</code>
    * [.declare(stateId, [parent])](#Resolutions+declare) ⇒ [<code>Resolutions</code>](#Resolutions)
    * [.addExit(stateId, exit)](#Resolutions+addExit) ⇒ <code>Object</code>
    * [.getExit(stateId, exitId)](#Resolutions+getExit) ⇒ <code>Object</code> \| <code>null</code>
    * [.signExit(stateId, exitId, priv32)](#Resolutions+signExit) ⇒ <code>Object</code>
    * [.ingest(artifact)](#Resolutions+ingest) ⇒ <code>Object</code>
    * [.verifyExit(stateId, exitId)](#Resolutions+verifyExit) ⇒ <code>Object</code>
    * [.missingSigners(exit)](#Resolutions+missingSigners) ⇒ <code>Array.&lt;string&gt;</code>
    * [.resolvable(stateId)](#Resolutions+resolvable) ⇒ <code>boolean</code>
    * [.missing(stateId)](#Resolutions+missing) ⇒ <code>Array.&lt;{stateId: string, exitId: string, kind: string, missing: Array.&lt;string&gt;}&gt;</code>
    * [.exitsAfter(height, [stateId])](#Resolutions+exitsAfter) ⇒ <code>Array.&lt;Object&gt;</code>
    * [.finalizeExit(stateId, exitId)](#Resolutions+finalizeExit) ⇒ <code>Object</code>
    * [.toTree()](#Resolutions+toTree) ⇒ [<code>Tree</code>](#Tree)
    * [.export()](#Resolutions+export) ⇒ <code>Object</code>
    * [.import(snapshot)](#Resolutions+import) ⇒ [<code>Resolutions</code>](#Resolutions)
    * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
    * [.commit()](#Actor+commit) ⇒ <code>String</code>
    * [.get(path)](#Actor+get) ⇒ <code>Object</code>
    * [.set(path, value)](#Actor+set) ⇒ <code>Object</code>
    * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
    * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
    * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
    * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
    * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
    * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
    * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
    * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
    * [.value([format])](#Actor+value) ⇒ <code>Object</code>
    * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>

<a name="new_Resolutions_new"></a>

### new Resolutions()
State tree of pre-signed exits. Pure data plus Schnorr verification; no I/O.

<a name="new_Resolutions_new"></a>

### new Resolutions([settings])

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  |  |
| [settings.network] | <code>string</code> | <code>&quot;&#x27;regtest&#x27;&quot;</code> | Fabric network name |
| [settings.states] | <code>Object</code> |  | import snapshot (`export()` output) |

<a name="Resolutions+_states"></a>

### resolutions.\_states : <code>Map.&lt;string, {parent: (string\|null), exits: Map.&lt;string, Object&gt;}&gt;</code>
**Kind**: instance property of [<code>Resolutions</code>](#Resolutions)  
<a name="Resolutions+stateIds"></a>

### resolutions.stateIds ⇒ <code>Array.&lt;string&gt;</code>
**Kind**: instance property of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Array.&lt;string&gt;</code> - known state ids (insertion order).  
<a name="Resolutions+rootHex"></a>

### resolutions.rootHex ⇒ <code>string</code>
**Kind**: instance property of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>string</code> - hex Merkle root (empty tree → 64 zeros).  
<a name="Resolutions+declare"></a>

### resolutions.declare(stateId, [parent]) ⇒ [<code>Resolutions</code>](#Resolutions)
Declare a state node (idempotent).

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| stateId | <code>string</code> |  |  |
| [parent] | <code>string</code> \| <code>null</code> | <code>null</code> | parent state id (tree edge) |

<a name="Resolutions+addExit"></a>

### resolutions.addExit(stateId, exit) ⇒ <code>Object</code>
Register an exit a state depends on. Signatures already present on the
PSBT are harvested into `signers.have`.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Object</code> - stored exit record  

| Param | Type | Description |
| --- | --- | --- |
| stateId | <code>string</code> |  |
| exit | <code>Object</code> |  |
| exit.id | <code>string</code> | unique within the state |
| exit.kind | <code>string</code> | one of [Resolutions.KINDS](Resolutions.KINDS) |
| exit.psbtBase64 | <code>string</code> | unsigned (or partially signed) tapscript spend, input 0 |
| exit.required | <code>Array.&lt;string&gt;</code> | pubkeys (compressed or x-only hex) whose signatures make it broadcastable |
| [exit.locktime] | <code>Object</code> | `{ height }` (nLockTime / CLTV) and/or `{ csv }` (relative) |
| [exit.spends] | <code>Object</code> | `{ txid, vout }` the exit consumes |
| [exit.meta] | <code>Object</code> | free-form (never secrets) |

<a name="Resolutions+getExit"></a>

### resolutions.getExit(stateId, exitId) ⇒ <code>Object</code> \| <code>null</code>
**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type |
| --- | --- |
| stateId | <code>string</code> | 
| exitId | <code>string</code> | 

<a name="Resolutions+signExit"></a>

### resolutions.signExit(stateId, exitId, priv32) ⇒ <code>Object</code>
Sign an exit with a 32-byte private key and record the signature.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Object</code> - `ContractExitSignature` artifact (JSON-safe) for the counterparty  

| Param | Type |
| --- | --- |
| stateId | <code>string</code> | 
| exitId | <code>string</code> | 
| priv32 | <code>Buffer</code> \| <code>string</code> | 

<a name="Resolutions+ingest"></a>

### resolutions.ingest(artifact) ⇒ <code>Object</code>
Accept a counterparty's `ContractExitSignature` artifact after verifying
both the artifact signature and the tapscript signature it carries.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type | Description |
| --- | --- | --- |
| artifact | <code>Object</code> | output of [signExit](#Resolutions+signExit) |

<a name="Resolutions+verifyExit"></a>

### resolutions.verifyExit(stateId, exitId) ⇒ <code>Object</code>
Re-verify every held signature on an exit against its PSBT.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type |
| --- | --- |
| stateId | <code>string</code> | 
| exitId | <code>string</code> | 

<a name="Resolutions+missingSigners"></a>

### resolutions.missingSigners(exit) ⇒ <code>Array.&lt;string&gt;</code>
**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Array.&lt;string&gt;</code> - required x-only pubkeys without a held signature  

| Param | Type |
| --- | --- |
| exit | <code>Object</code> | 

<a name="Resolutions+resolvable"></a>

### resolutions.resolvable(stateId) ⇒ <code>boolean</code>
A state is resolvable when it (and every ancestor it inherits exits from)
holds all required signatures on all exits.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type |
| --- | --- |
| stateId | <code>string</code> | 

<a name="Resolutions+missing"></a>

### resolutions.missing(stateId) ⇒ <code>Array.&lt;{stateId: string, exitId: string, kind: string, missing: Array.&lt;string&gt;}&gt;</code>
What still has to be exchanged before `stateId` is live.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type |
| --- | --- |
| stateId | <code>string</code> | 

<a name="Resolutions+exitsAfter"></a>

### resolutions.exitsAfter(height, [stateId]) ⇒ <code>Array.&lt;Object&gt;</code>
Exits that become broadcastable at or after `height` (absolute locks only).

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| height | <code>number</code> |  |  |
| [stateId] | <code>string</code> | <code>null</code> | restrict to one state |

<a name="Resolutions+finalizeExit"></a>

### resolutions.finalizeExit(stateId, exitId) ⇒ <code>Object</code>
Fully-signed exit as a broadcastable transaction.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type |
| --- | --- |
| stateId | <code>string</code> | 
| exitId | <code>string</code> | 

<a name="Resolutions+toTree"></a>

### resolutions.toTree() ⇒ [<code>Tree</code>](#Tree)
Bitcoin-style Merkle tree over `SHA256(stateId|exitId|txid)` for audit.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
<a name="Resolutions+export"></a>

### resolutions.export() ⇒ <code>Object</code>
**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Overrides**: [<code>export</code>](#Actor+export)  
**Returns**: <code>Object</code> - JSON-safe snapshot (no private material).  
<a name="Resolutions+import"></a>

### resolutions.import(snapshot) ⇒ [<code>Resolutions</code>](#Resolutions)
**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  

| Param | Type | Description |
| --- | --- | --- |
| snapshot | <code>Object</code> | output of [export](#Resolutions+export) |

<a name="Actor+adopt"></a>

### resolutions.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### resolutions.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+get"></a>

### resolutions.get(path) ⇒ <code>Object</code>
Retrieve a value from the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to retrieve using [JSONPointer](JSONPointer). |

<a name="Actor+set"></a>

### resolutions.set(path, value) ⇒ <code>Object</code>
Set a value in the Actor's state by [JSONPointer](JSONPointer) path.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Object</code> - Value of the path in the Actor's state.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path to set using [JSONPointer](JSONPointer). |
| value | <code>Object</code> | Value to set. |

<a name="Actor+stream"></a>

### resolutions.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### resolutions.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
<a name="Actor+toGenericMessage"></a>

### resolutions.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### resolutions.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
<a name="Actor+pause"></a>

### resolutions.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### resolutions.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
<a name="Actor+sign"></a>

### resolutions.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
<a name="Actor+unpause"></a>

### resolutions.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### resolutions.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### resolutions.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Resolutions</code>](#Resolutions)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Resource"></a>

## Resource ⇐ [<code>Store</code>](#Store)
Declarative <strong>application resource</strong> (routes, components, roles) persisted via [Store](#Store). Pairs with
a [Service](#Service) implementation that honors the definition — see <strong>DEVELOPERS.md</strong> (<em>Resources</em> / ARCs). Extends [Store](#Store)
so commits and encryption options match the rest of the stack.

**Kind**: global class  
**Extends**: [<code>Store</code>](#Store)  

* [Resource](#Resource) ⇐ [<code>Store</code>](#Store)
    * [new Resource([definition])](#new_Resource_new)
    * [.codec](#Store+codec)
    * [.create(obj)](#Resource+create) ⇒ [<code>Vector</code>](#Vector)
    * [.update(id, update)](#Resource+update) ⇒ [<code>Vector</code>](#Vector)
    * [._REGISTER(obj)](#Store+_REGISTER) ⇒ [<code>Vector</code>](#Vector)
    * [._POST(key, value)](#Store+_POST) ⇒ <code>Promise</code>
    * [.get(key)](#Store+get) ⇒ <code>Promise</code>
    * [.set(key, value)](#Store+set)
    * [.trust(source)](#Store+trust) ⇒ [<code>Store</code>](#Store)
    * [.del(key)](#Store+del)
    * [.flush()](#Store+flush)
    * [.start()](#Store+start) ⇒ <code>Promise</code>
    * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
    * [.commit()](#Actor+commit) ⇒ <code>String</code>
    * [.export()](#Actor+export) ⇒ <code>Object</code>
    * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
    * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
    * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
    * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
    * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
    * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
    * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
    * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
    * [.value([format])](#Actor+value) ⇒ <code>Object</code>
    * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>

<a name="new_Resource_new"></a>

### new Resource([definition])

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [definition] | <code>Object</code> | <code>{}</code> | Initial definition (<code>name</code>, <code>routes</code>, <code>components</code>, …). |

<a name="Store+codec"></a>

### resource.codec
Optional [Codec](Codec) for encrypted at-rest values (Level `valueEncoding`).
Browser and Hub-style apps typically use one [Store](#Store) with `codec` for
secrets and separate plain stores for cache/tips.

**Kind**: instance property of [<code>Resource</code>](#Resource)  
<a name="Resource+create"></a>

### resource.create(obj) ⇒ [<code>Vector</code>](#Vector)
Create an instance of the Resource's type.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: [<code>Vector</code>](#Vector) - Resulting Vector with deterministic identifier.  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>Object</code> | Map of the instance's properties and values. |

<a name="Resource+update"></a>

### resource.update(id, update) ⇒ [<code>Vector</code>](#Vector)
Modify an existing instance of a Resource by its unique identifier.  Produces a new instance.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: [<code>Vector</code>](#Vector) - Resulting Vector instance with updated identifier.  

| Param | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Unique ID to update. |
| update | <code>Object</code> | Map of change to make (keys -> values). |

<a name="Store+_REGISTER"></a>

### resource.\_REGISTER(obj) ⇒ [<code>Vector</code>](#Vector)
Registers an [Actor](#Actor).  Necessary to store in a collection.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: [<code>Vector</code>](#Vector) - Returned from `storage.set`  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>Object</code> | Instance of the object to store. |

<a name="Store+_POST"></a>

### resource.\_POST(key, value) ⇒ <code>Promise</code>
Insert something into a collection.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: <code>Promise</code> - Resolves on success with a String pointer.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | Path to add data to. |
| value | <code>Mixed</code> | Object to store. |

<a name="Store+get"></a>

### resource.get(key) ⇒ <code>Promise</code>
Barebones getter.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: <code>Promise</code> - Resolves on complete.  `null` if not found.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | Name of data to retrieve. |

<a name="Store+set"></a>

### resource.set(key, value)
Set a `key` to a specific `value`.

**Kind**: instance method of [<code>Resource</code>](#Resource)  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | Address of the information. |
| value | <code>Mixed</code> | Content to store at `key`. |

<a name="Store+trust"></a>

### resource.trust(source) ⇒ [<code>Store</code>](#Store)
Implicitly trust an [Event](Event) source.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: [<code>Store</code>](#Store) - Resulting instance of [Store](#Store) with new trust.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Event-emitting source. |

<a name="Store+del"></a>

### resource.del(key)
Remove a [Value](Value) by [Path](Path).

**Kind**: instance method of [<code>Resource</code>](#Resource)  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>Path</code> | Key to remove. |

<a name="Store+flush"></a>

### resource.flush()
Wipes the storage.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
<a name="Store+start"></a>

### resource.start() ⇒ <code>Promise</code>
Start running the process.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: <code>Promise</code> - Resolves on complete.  
<a name="Actor+adopt"></a>

### resource.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### resource.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+export"></a>

### resource.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### resource.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### resource.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
<a name="Actor+toGenericMessage"></a>

### resource.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### resource.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Resource</code>](#Resource)  
<a name="Actor+pause"></a>

### resource.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### resource.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
<a name="Actor+sign"></a>

### resource.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
<a name="Actor+unpause"></a>

### resource.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### resource.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### resource.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="RoundRobin"></a>

## RoundRobin ⇐ [<code>Circuit</code>](#Circuit)
**Kind**: global class  
**Extends**: [<code>Circuit</code>](#Circuit)  

* [RoundRobin](#RoundRobin) ⇐ [<code>Circuit</code>](#Circuit)
    * [new RoundRobin()](#new_RoundRobin_new)
    * [.next(items)](#RoundRobin+next) ⇒ <code>\*</code> \| <code>null</code>

<a name="new_RoundRobin_new"></a>

### new RoundRobin()
[Circuit](#Circuit) specialization for round-robin selection over a set of nodes or peers.

<a name="RoundRobin+next"></a>

### roundRobin.next(items) ⇒ <code>\*</code> \| <code>null</code>
**Kind**: instance method of [<code>RoundRobin</code>](#RoundRobin)  

| Param | Type |
| --- | --- |
| items | <code>Array</code> | 

<a name="Script"></a>

## Script
**Kind**: global class  
<a name="new_Script_new"></a>

### new Script(config)
Compose a [Script](#Script) for inclusion within a [Contract](#Contract).

**Returns**: [<code>Script</code>](#Script) - Instance of the [Script](#Script), ready for use.  

| Param | Type | Description |
| --- | --- | --- |
| config | <code>Mixed</code> | Configuration options for the script. |

<a name="Secret"></a>

## Secret
Secret material held as an [EncryptedPromise](#EncryptedPromise): 32 random bytes (hex)
unless a value is supplied.

**Kind**: global class  

* [Secret](#Secret)
    * [new Secret([settings])](#new_Secret_new)
    * [.hash](#Secret+hash) : <code>string</code>
    * [.data](#Secret+data) : <code>Object</code>

<a name="new_Secret_new"></a>

### new Secret([settings])

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>string</code> \| <code>Object</code> | The secret itself, or settings. |
| [settings.value] | <code>string</code> | The secret; defaults to 32 random bytes as hex. |
| [settings.password] | <code>string</code> | Seal immediately with this password (at least 8 characters). |
| [settings.seal] | <code>Object</code> | Restore from a sealed envelope. |

<a name="Secret+hash"></a>

### secret.hash : <code>string</code>
SHA-256 of the secret (hex), or `null` while it is sealed and not yet decrypted.

**Kind**: instance property of [<code>Secret</code>](#Secret)  
<a name="Secret+data"></a>

### secret.data : <code>Object</code>
**Kind**: instance property of [<code>Secret</code>](#Secret)  
<a name="Service"></a>

## Service ⇐ [<code>Actor</code>](#Actor)
Long-lived application surface extending [Actor](#Actor). Integrates external systems and the Fabric
network: peers consume and produce [Message](#Message) (AMP) instances, not ad-hoc JSON. Subclasses implement routing,
resources, and lifecycle (<code>start</code>/<code>stop</code> patterns — see <strong>AGENTS.md</strong>). The CLI/browser shell is [Service.FabricShell](Service.FabricShell).

**Kind**: global class  
**Extends**: [<code>Actor</code>](#Actor)  
**Access**: protected  
**Properties**

| Name | Description |
| --- | --- |
| map | The "map" is a hashtable of "key" => "value" pairs. |


* [Service](#Service) ⇐ [<code>Actor</code>](#Actor)
    * [new Service([settings])](#new_Service_new)
    * [._appendWarning(msg)](#Service+_appendWarning) ⇒ [<code>Service</code>](#Service)
    * [.init()](#Service+init)
    * [.tick()](#Service+tick) ⇒ <code>Number</code>
    * [.beat()](#Service+beat) ⇒ [<code>Service</code>](#Service)
    * [.get(path)](#Service+get) ⇒ <code>Mixed</code>
    * [.set(path)](#Service+set) ⇒ <code>Mixed</code>
    * [.trust(source)](#Service+trust) ⇒ [<code>Service</code>](#Service)
    * [.handler(message)](#Service+handler) ⇒ [<code>Service</code>](#Service)
    * [.lock([duration])](#Service+lock) ⇒ <code>Boolean</code>
    * [.when(event, method)](#Service+when) ⇒ <code>EventEmitter</code>
    * [.defineOpcode(name, [definition])](#Service+defineOpcode) ⇒ <code>Object</code>
    * [.defineBitcoinOpcode(name, [definition])](#Service+defineBitcoinOpcode) ⇒ <code>Object</code>
    * [.defineFabricOpcode(name, [definition])](#Service+defineFabricOpcode) ⇒ <code>Object</code>
    * [.defineOpcodeContract(name, body, [meta])](#Service+defineOpcodeContract) ⇒ <code>Object</code>
    * [.listOpcodes()](#Service+listOpcodes) ⇒ <code>Array.&lt;Object&gt;</code>
    * [.route(msg)](#Service+route) ⇒ <code>Promise</code>
    * [.start()](#Service+start)
    * [._GET(path)](#Service+_GET) ⇒ <code>Promise</code>
    * [._PUT(path, value, [commit])](#Service+_PUT) ⇒ <code>Promise</code>
    * [.connect(notify)](#Service+connect) ⇒ <code>Promise</code>
    * [.send(channel, message)](#Service+send) ⇒ [<code>Service</code>](#Service)
    * [.commit()](#Service+commit) ⇒ <code>String</code>
    * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
    * [._send(message)](#Service+_send)
    * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
    * [.export()](#Actor+export) ⇒ <code>Object</code>
    * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
    * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
    * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
    * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
    * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
    * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
    * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
    * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
    * [.value([format])](#Actor+value) ⇒ <code>Object</code>
    * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>

<a name="new_Service_new"></a>

### new Service([settings])
Create an instance of a Service.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  | Configuration for this service. |
| [settings.networking] | <code>Boolean</code> | <code>true</code> | Whether or not to connect to the network. |
| [settings.frequency] | <code>Object</code> |  | Interval frequency in hertz. |
| [settings.state] | <code>Object</code> |  | Initial state to assign. |

<a name="Service+_appendWarning"></a>

### service.\_appendWarning(msg) ⇒ [<code>Service</code>](#Service)
**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: [<code>Service</code>](#Service) - This instance.  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>String</code> | Warning text (used by [Service#_registerService](Service#_registerService) duplicate guard). |

<a name="Service+init"></a>

### service.init()
Called by Web Components.
TODO: move to @fabric/http/types/spa

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Service+tick"></a>

### service.tick() ⇒ <code>Number</code>
Move forward one clock cycle.

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Service+beat"></a>

### service.beat() ⇒ [<code>Service</code>](#Service)
Compute latest state.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Emits**: <code>Message#event:beat</code>  
<a name="Service+get"></a>

### service.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Service</code>](#Service)  
**Overrides**: [<code>get</code>](#Actor+get)  
**Returns**: <code>Mixed</code> - Returns the target value if found, otherwise null.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+set"></a>

### service.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Overrides**: [<code>set</code>](#Actor+set)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+trust"></a>

### service.trust(source) ⇒ [<code>Service</code>](#Service)
Explicitly trust all events from a known source.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: [<code>Service</code>](#Service) - Instance of Service after binding events.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Emitter of events. |

<a name="Service+handler"></a>

### service.handler(message) ⇒ [<code>Service</code>](#Service)
Default route handler for an incoming message.  Follows the Activity
Streams 2.0 spec: https://www.w3.org/TR/activitystreams-core/

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Activity</code> | Message object. |

<a name="Service+lock"></a>

### service.lock([duration]) ⇒ <code>Boolean</code>
Attempt to acquire a lock for `duration` seconds.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Boolean</code> - true if locked, false if unable to lock.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [duration] | <code>Number</code> | <code>1000</code> | Number of milliseconds to hold lock. |

<a name="Service+when"></a>

### service.when(event, method) ⇒ <code>EventEmitter</code>
Bind a method to an event, with current state as the immutable context.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>EventEmitter</code> - Instance of EventEmitter.  

| Param | Type | Description |
| --- | --- | --- |
| event | <code>String</code> | Name of the event upon which to execute `method` as a function. |
| method | <code>function</code> | Function to execute when named [Event](Event) `event` is encountered. |

<a name="Service+defineOpcode"></a>

### service.defineOpcode(name, [definition]) ⇒ <code>Object</code>
Register a single opcode entry in the service registry.

**Kind**: instance method of [<code>Service</code>](#Service)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Opcode symbol (e.g. `OP_SHA256`, `P2P_FLUSH_CHAIN`) |
| [definition] | <code>Object</code> |  |

<a name="Service+defineBitcoinOpcode"></a>

### service.defineBitcoinOpcode(name, [definition]) ⇒ <code>Object</code>
Register Bitcoin-style primitive opcode metadata.

**Kind**: instance method of [<code>Service</code>](#Service)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineFabricOpcode"></a>

### service.defineFabricOpcode(name, [definition]) ⇒ <code>Object</code>
Register Fabric opcode metadata.

**Kind**: instance method of [<code>Service</code>](#Service)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineOpcodeContract"></a>

### service.defineOpcodeContract(name, body, [meta]) ⇒ <code>Object</code>
Register a newline-delimited opcode contract.
Contract body example:
`OP_DUP\nOP_HASH160\nP2P_FLUSH_CHAIN`

**Kind**: instance method of [<code>Service</code>](#Service)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Contract label |
| body | <code>string</code> | Newline-delimited opcode list |
| [meta] | <code>Object</code> |  |

<a name="Service+listOpcodes"></a>

### service.listOpcodes() ⇒ <code>Array.&lt;Object&gt;</code>
Snapshot opcode registry for UI / API use.

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Service+route"></a>

### service.route(msg) ⇒ <code>Promise</code>
Resolve a [State](#State) from a particular [Message](#Message) object.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Promise</code> - Resolves with resulting [State](#State).  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | Explicit Fabric [Message](#Message). |

<a name="Service+start"></a>

### service.start()
Start the service, including the initiation of an outbound connection
to any peers designated in the service's configuration.

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Service+_GET"></a>

### service.\_GET(path) ⇒ <code>Promise</code>
Retrieve a value from the Service's state.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Promise</code> - Resolves with the result.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path of the value to retrieve. |

<a name="Service+_PUT"></a>

### service.\_PUT(path, value, [commit]) ⇒ <code>Promise</code>
Store a value in the Service's state.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Promise</code> - Resolves with with stored document.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>String</code> |  | Path to store the value at. |
| value | <code>Object</code> |  | Document to store. |
| [commit] | <code>Boolean</code> | <code>false</code> | Sign the resulting state. |

<a name="Service+connect"></a>

### service.connect(notify) ⇒ <code>Promise</code>
Attach to network.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Promise</code> - Resolves to [Fabric](#Fabric).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| notify | <code>Boolean</code> | <code>true</code> | Commit to changes. |

<a name="Service+send"></a>

### service.send(channel, message) ⇒ [<code>Service</code>](#Service)
Send a message to a channel.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| channel | <code>String</code> | Channel name to which the message will be sent. |
| message | <code>String</code> | Content of the message to send. |

<a name="Service+commit"></a>

### service.commit() ⇒ <code>String</code>
Record outstanding JSON Patch deltas and emit a compact commitment id.
Does **not** wrap [Service#state](Service#state) in a new [Actor](#Actor) — that
JSON-cloned the entire tree on every write/connect and OOMed Hub.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Overrides**: [<code>commit</code>](#Actor+commit)  
**Returns**: <code>String</code> - 32-byte commitment id  
<a name="Service+_registerActor"></a>

### service.\_registerActor(actor) ⇒ <code>Promise</code>
Register an [Actor](#Actor) with the [Service](#Service).

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Promise</code> - Resolves upon successful registration.  

| Param | Type | Description |
| --- | --- | --- |
| actor | <code>Object</code> | Instance of the [Actor](#Actor). |

<a name="Service+_send"></a>

### service.\_send(message)
Sends a message.

**Kind**: instance method of [<code>Service</code>](#Service)  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Mixed</code> | Message to send. |

<a name="Actor+adopt"></a>

### service.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+export"></a>

### service.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### service.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### service.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Actor+toGenericMessage"></a>

### service.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### service.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Actor+pause"></a>

### service.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### service.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Actor+sign"></a>

### service.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Actor+unpause"></a>

### service.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### service.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### service.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Service"></a>

## Service
**Kind**: global class  

* [Service](#Service)
    * [new Service([settings])](#new_Service_new)
    * [._appendWarning(msg)](#Service+_appendWarning) ⇒ [<code>Service</code>](#Service)
    * [.init()](#Service+init)
    * [.tick()](#Service+tick) ⇒ <code>Number</code>
    * [.beat()](#Service+beat) ⇒ [<code>Service</code>](#Service)
    * [.get(path)](#Service+get) ⇒ <code>Mixed</code>
    * [.set(path)](#Service+set) ⇒ <code>Mixed</code>
    * [.trust(source)](#Service+trust) ⇒ [<code>Service</code>](#Service)
    * [.handler(message)](#Service+handler) ⇒ [<code>Service</code>](#Service)
    * [.lock([duration])](#Service+lock) ⇒ <code>Boolean</code>
    * [.when(event, method)](#Service+when) ⇒ <code>EventEmitter</code>
    * [.defineOpcode(name, [definition])](#Service+defineOpcode) ⇒ <code>Object</code>
    * [.defineBitcoinOpcode(name, [definition])](#Service+defineBitcoinOpcode) ⇒ <code>Object</code>
    * [.defineFabricOpcode(name, [definition])](#Service+defineFabricOpcode) ⇒ <code>Object</code>
    * [.defineOpcodeContract(name, body, [meta])](#Service+defineOpcodeContract) ⇒ <code>Object</code>
    * [.listOpcodes()](#Service+listOpcodes) ⇒ <code>Array.&lt;Object&gt;</code>
    * [.route(msg)](#Service+route) ⇒ <code>Promise</code>
    * [.start()](#Service+start)
    * [._GET(path)](#Service+_GET) ⇒ <code>Promise</code>
    * [._PUT(path, value, [commit])](#Service+_PUT) ⇒ <code>Promise</code>
    * [.connect(notify)](#Service+connect) ⇒ <code>Promise</code>
    * [.send(channel, message)](#Service+send) ⇒ [<code>Service</code>](#Service)
    * [.commit()](#Service+commit) ⇒ <code>String</code>
    * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
    * [._send(message)](#Service+_send)
    * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
    * [.export()](#Actor+export) ⇒ <code>Object</code>
    * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
    * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
    * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
    * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
    * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
    * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
    * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
    * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
    * [.value([format])](#Actor+value) ⇒ <code>Object</code>
    * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>

<a name="new_Service_new"></a>

### new Service([settings])
Create an instance of a Service.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  | Configuration for this service. |
| [settings.networking] | <code>Boolean</code> | <code>true</code> | Whether or not to connect to the network. |
| [settings.frequency] | <code>Object</code> |  | Interval frequency in hertz. |
| [settings.state] | <code>Object</code> |  | Initial state to assign. |

<a name="Service+_appendWarning"></a>

### service.\_appendWarning(msg) ⇒ [<code>Service</code>](#Service)
**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: [<code>Service</code>](#Service) - This instance.  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>String</code> | Warning text (used by [Service#_registerService](Service#_registerService) duplicate guard). |

<a name="Service+init"></a>

### service.init()
Called by Web Components.
TODO: move to @fabric/http/types/spa

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Service+tick"></a>

### service.tick() ⇒ <code>Number</code>
Move forward one clock cycle.

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Service+beat"></a>

### service.beat() ⇒ [<code>Service</code>](#Service)
Compute latest state.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Emits**: <code>Message#event:beat</code>  
<a name="Service+get"></a>

### service.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Service</code>](#Service)  
**Overrides**: [<code>get</code>](#Actor+get)  
**Returns**: <code>Mixed</code> - Returns the target value if found, otherwise null.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+set"></a>

### service.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Overrides**: [<code>set</code>](#Actor+set)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+trust"></a>

### service.trust(source) ⇒ [<code>Service</code>](#Service)
Explicitly trust all events from a known source.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: [<code>Service</code>](#Service) - Instance of Service after binding events.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Emitter of events. |

<a name="Service+handler"></a>

### service.handler(message) ⇒ [<code>Service</code>](#Service)
Default route handler for an incoming message.  Follows the Activity
Streams 2.0 spec: https://www.w3.org/TR/activitystreams-core/

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Activity</code> | Message object. |

<a name="Service+lock"></a>

### service.lock([duration]) ⇒ <code>Boolean</code>
Attempt to acquire a lock for `duration` seconds.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Boolean</code> - true if locked, false if unable to lock.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [duration] | <code>Number</code> | <code>1000</code> | Number of milliseconds to hold lock. |

<a name="Service+when"></a>

### service.when(event, method) ⇒ <code>EventEmitter</code>
Bind a method to an event, with current state as the immutable context.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>EventEmitter</code> - Instance of EventEmitter.  

| Param | Type | Description |
| --- | --- | --- |
| event | <code>String</code> | Name of the event upon which to execute `method` as a function. |
| method | <code>function</code> | Function to execute when named [Event](Event) `event` is encountered. |

<a name="Service+defineOpcode"></a>

### service.defineOpcode(name, [definition]) ⇒ <code>Object</code>
Register a single opcode entry in the service registry.

**Kind**: instance method of [<code>Service</code>](#Service)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Opcode symbol (e.g. `OP_SHA256`, `P2P_FLUSH_CHAIN`) |
| [definition] | <code>Object</code> |  |

<a name="Service+defineBitcoinOpcode"></a>

### service.defineBitcoinOpcode(name, [definition]) ⇒ <code>Object</code>
Register Bitcoin-style primitive opcode metadata.

**Kind**: instance method of [<code>Service</code>](#Service)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineFabricOpcode"></a>

### service.defineFabricOpcode(name, [definition]) ⇒ <code>Object</code>
Register Fabric opcode metadata.

**Kind**: instance method of [<code>Service</code>](#Service)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineOpcodeContract"></a>

### service.defineOpcodeContract(name, body, [meta]) ⇒ <code>Object</code>
Register a newline-delimited opcode contract.
Contract body example:
`OP_DUP\nOP_HASH160\nP2P_FLUSH_CHAIN`

**Kind**: instance method of [<code>Service</code>](#Service)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Contract label |
| body | <code>string</code> | Newline-delimited opcode list |
| [meta] | <code>Object</code> |  |

<a name="Service+listOpcodes"></a>

### service.listOpcodes() ⇒ <code>Array.&lt;Object&gt;</code>
Snapshot opcode registry for UI / API use.

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Service+route"></a>

### service.route(msg) ⇒ <code>Promise</code>
Resolve a [State](#State) from a particular [Message](#Message) object.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Promise</code> - Resolves with resulting [State](#State).  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | Explicit Fabric [Message](#Message). |

<a name="Service+start"></a>

### service.start()
Start the service, including the initiation of an outbound connection
to any peers designated in the service's configuration.

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Service+_GET"></a>

### service.\_GET(path) ⇒ <code>Promise</code>
Retrieve a value from the Service's state.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Promise</code> - Resolves with the result.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path of the value to retrieve. |

<a name="Service+_PUT"></a>

### service.\_PUT(path, value, [commit]) ⇒ <code>Promise</code>
Store a value in the Service's state.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Promise</code> - Resolves with with stored document.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>String</code> |  | Path to store the value at. |
| value | <code>Object</code> |  | Document to store. |
| [commit] | <code>Boolean</code> | <code>false</code> | Sign the resulting state. |

<a name="Service+connect"></a>

### service.connect(notify) ⇒ <code>Promise</code>
Attach to network.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Promise</code> - Resolves to [Fabric](#Fabric).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| notify | <code>Boolean</code> | <code>true</code> | Commit to changes. |

<a name="Service+send"></a>

### service.send(channel, message) ⇒ [<code>Service</code>](#Service)
Send a message to a channel.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| channel | <code>String</code> | Channel name to which the message will be sent. |
| message | <code>String</code> | Content of the message to send. |

<a name="Service+commit"></a>

### service.commit() ⇒ <code>String</code>
Record outstanding JSON Patch deltas and emit a compact commitment id.
Does **not** wrap [Service#state](Service#state) in a new [Actor](#Actor) — that
JSON-cloned the entire tree on every write/connect and OOMed Hub.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Overrides**: [<code>commit</code>](#Actor+commit)  
**Returns**: <code>String</code> - 32-byte commitment id  
<a name="Service+_registerActor"></a>

### service.\_registerActor(actor) ⇒ <code>Promise</code>
Register an [Actor](#Actor) with the [Service](#Service).

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Promise</code> - Resolves upon successful registration.  

| Param | Type | Description |
| --- | --- | --- |
| actor | <code>Object</code> | Instance of the [Actor](#Actor). |

<a name="Service+_send"></a>

### service.\_send(message)
Sends a message.

**Kind**: instance method of [<code>Service</code>](#Service)  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Mixed</code> | Message to send. |

<a name="Actor+adopt"></a>

### service.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+export"></a>

### service.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### service.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### service.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Actor+toGenericMessage"></a>

### service.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### service.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Actor+pause"></a>

### service.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### service.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Actor+sign"></a>

### service.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Actor+unpause"></a>

### service.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### service.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### service.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Session"></a>

## Session
The [Session](#Session) type describes a connection between [Peer](#Peer) objects, and includes its own lifecycle.

**Kind**: global class  

* [Session](#Session)
    * [new Session([settings])](#new_Session_new)
    * [.encrypt(_data)](#Session+encrypt)
    * [.decrypt(_data)](#Session+decrypt)
    * [.start()](#Session+start)
    * [.stop()](#Session+stop)

<a name="new_Session_new"></a>

### new Session([settings])
Creates a new [Session](#Session).

**Returns**: [<code>Session</code>](#Session) - The session instance.  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Configuration. |

<a name="Session+encrypt"></a>

### session.encrypt(_data)
Session does not provide confidentiality — use Peer NOISE or [Key#encrypt](Key#encrypt).

**Kind**: instance method of [<code>Session</code>](#Session)  
**Throws**:

- <code>Error</code> always


| Param | Type |
| --- | --- |
| _data | <code>\*</code> | 

<a name="Session+decrypt"></a>

### session.decrypt(_data)
Session does not provide confidentiality — use Peer NOISE or [Key#decrypt](Key#decrypt).

**Kind**: instance method of [<code>Session</code>](#Session)  
**Throws**:

- <code>Error</code> always


| Param | Type |
| --- | --- |
| _data | <code>\*</code> | 

<a name="Session+start"></a>

### session.start()
Opens the [Session](#Session) for interaction.

**Kind**: instance method of [<code>Session</code>](#Session)  
<a name="Session+stop"></a>

### session.stop()
Closes the [Session](#Session), preventing further interaction.

**Kind**: instance method of [<code>Session</code>](#Session)  
<a name="SetupTui"></a>

## SetupTui
**Kind**: global class  

* [SetupTui](#SetupTui)
    * [new SetupTui(environment, [settings])](#new_SetupTui_new)
    * [.start()](#SetupTui+start) ⇒ <code>Promise.&lt;object&gt;</code>

<a name="new_SetupTui_new"></a>

### new SetupTui(environment, [settings])

| Param | Type | Default |
| --- | --- | --- |
| environment | [<code>Environment</code>](#Environment) |  | 
| [settings] | <code>Object</code> |  | 
| [settings.render] | <code>boolean</code> | <code>true</code> | 
| [settings.passphrase] | <code>string</code> |  | 

<a name="SetupTui+start"></a>

### setupTui.start() ⇒ <code>Promise.&lt;object&gt;</code>
**Kind**: instance method of [<code>SetupTui</code>](#SetupTui)  
**Returns**: <code>Promise.&lt;object&gt;</code> - Public snapshot after the session ends.  
<a name="State"></a>

## State ⇐ [<code>Actor</code>](#Actor)
<strong>Named snapshot</strong> of application data extending [Actor](#Actor) — <code>@type</code>,
<code>@data</code>, <code>@id</code>, JSON Patch
flows. Absorbs former <strong>Scribe</strong> behavior: <code>verbose</code> / <code>verbosity</code>, <code>now</code>,
<code>trust</code>, <code>start</code>/<code>stop</code>, and structured <code>log</code> / <code>error</code> /
<code>warn</code> / <code>debug</code> (console + events). [Channel](#Channel), [Document](#Document), [Ledger](#Ledger),
[Router](Router), and [Instruction](Instruction) extend <code>State</code> directly. [Vector](#Vector) is an [EventEmitter](EventEmitter) only.
Sibling concept to [Entity](#Entity).

**Kind**: global class  
**Extends**: [<code>Actor</code>](#Actor)  
**Access**: protected  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| size | <code>Number</code> | Size of state in bytes. |
| @buffer | <code>Buffer</code> | Byte-for-byte memory representation of state. |
| @type | <code>String</code> | Named type. |
| @data | <code>Mixed</code> | Local instance of the state. |
| @id | <code>String</code> | Unique identifier for this data. |


* [State](#State) ⇐ [<code>Actor</code>](#Actor)
    * [new State(data)](#new_State_new)
    * _instance_
        * [.trust(source)](#State+trust) ⇒ [<code>State</code>](#State)
        * [.inherits(other)](#State+inherits) ⇒ <code>Number</code>
        * [.toHTML()](#State+toHTML)
        * [.toString()](#State+toString) ⇒ <code>String</code>
        * [.serialize([input])](#State+serialize) ⇒ <code>Buffer</code>
        * [.deserialize(input)](#State+deserialize) ⇒ [<code>State</code>](#State)
        * [.fork()](#State+fork) ⇒ [<code>State</code>](#State)
        * [.get(path)](#State+get) ⇒ <code>Mixed</code>
        * [.set(path)](#State+set) ⇒ <code>Mixed</code>
        * [.commit()](#State+commit)
        * [.render()](#State+render) ⇒ <code>String</code>
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * [.fromJSON(input)](#State.fromJSON) ⇒ [<code>State</code>](#State)

<a name="new_State_new"></a>

### new State(data)
Creates a snapshot of some information.

**Returns**: [<code>State</code>](#State) - Resulting state.  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>Mixed</code> | Input data. |

<a name="State+trust"></a>

### state.trust(source) ⇒ [<code>State</code>](#State)
**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: [<code>State</code>](#State) - this  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Event stream. |

<a name="State+inherits"></a>

### state.inherits(other) ⇒ <code>Number</code>
**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>Number</code> - New length of `settings.tags`.  

| Param | Type | Description |
| --- | --- | --- |
| other | [<code>State</code>](#State) | Peer [State](#State) whose `settings.namespace` is appended to `settings.tags`. |

<a name="State+toHTML"></a>

### state.toHTML()
Converts the State to an HTML document.

**Kind**: instance method of [<code>State</code>](#State)  
<a name="State+toString"></a>

### state.toString() ⇒ <code>String</code>
Unmarshall an existing state to an instance of a [Blob](Blob).

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>String</code> - Serialized [Blob](Blob).  
<a name="State+serialize"></a>

### state.serialize([input]) ⇒ <code>Buffer</code>
Convert to [Buffer](Buffer).

**Kind**: instance method of [<code>State</code>](#State)  
**Overrides**: [<code>serialize</code>](#Actor+serialize)  
**Returns**: <code>Buffer</code> - [Store](#Store)-able blob.  

| Param | Type | Description |
| --- | --- | --- |
| [input] | <code>Mixed</code> | Input to serialize. |

<a name="State+deserialize"></a>

### state.deserialize(input) ⇒ [<code>State</code>](#State)
Take a hex-encoded input and convert to a [State](#State) object.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: [<code>State</code>](#State) - [description]  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | [description] |

<a name="State+fork"></a>

### state.fork() ⇒ [<code>State</code>](#State)
Creates a new child [State](#State), with `@parent` set to
the current [State](#State) by immutable identifier.

**Kind**: instance method of [<code>State</code>](#State)  
<a name="State+get"></a>

### state.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>State</code>](#State)  
**Overrides**: [<code>get</code>](#Actor+get)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="State+set"></a>

### state.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>State</code>](#State)  
**Overrides**: [<code>set</code>](#Actor+set)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="State+commit"></a>

### state.commit()
Increment the vector clock, broadcast all changes as a transaction.

**Kind**: instance method of [<code>State</code>](#State)  
**Overrides**: [<code>commit</code>](#Actor+commit)  
<a name="State+render"></a>

### state.render() ⇒ <code>String</code>
Compose a JSON string for network consumption.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>String</code> - JSON-encoded [String](String).  
<a name="Actor+adopt"></a>

### state.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+export"></a>

### state.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### state.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### state.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>State</code>](#State)  
**Overrides**: [<code>toBuffer</code>](#Actor+toBuffer)  
<a name="Actor+toGenericMessage"></a>

### state.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### state.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>State</code>](#State)  
<a name="Actor+pause"></a>

### state.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+sign"></a>

### state.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>State</code>](#State)  
<a name="Actor+unpause"></a>

### state.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### state.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>State</code>](#State)  
**Overrides**: [<code>value</code>](#Actor+value)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### state.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="State.fromJSON"></a>

### State.fromJSON(input) ⇒ [<code>State</code>](#State)
Marshall an input into an instance of a [State](#State).  States have
absolute authority over their own domain, so choose your States wisely.

**Kind**: static method of [<code>State</code>](#State)  
**Returns**: [<code>State</code>](#State) - Resulting instance of the [State](#State).  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | Arbitrary input. |

<a name="State"></a>

## State
**Kind**: global class  

* [State](#State)
    * [new State(data)](#new_State_new)
    * _instance_
        * [.trust(source)](#State+trust) ⇒ [<code>State</code>](#State)
        * [.inherits(other)](#State+inherits) ⇒ <code>Number</code>
        * [.toHTML()](#State+toHTML)
        * [.toString()](#State+toString) ⇒ <code>String</code>
        * [.serialize([input])](#State+serialize) ⇒ <code>Buffer</code>
        * [.deserialize(input)](#State+deserialize) ⇒ [<code>State</code>](#State)
        * [.fork()](#State+fork) ⇒ [<code>State</code>](#State)
        * [.get(path)](#State+get) ⇒ <code>Mixed</code>
        * [.set(path)](#State+set) ⇒ <code>Mixed</code>
        * [.commit()](#State+commit)
        * [.render()](#State+render) ⇒ <code>String</code>
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * [.fromJSON(input)](#State.fromJSON) ⇒ [<code>State</code>](#State)

<a name="new_State_new"></a>

### new State(data)
Creates a snapshot of some information.

**Returns**: [<code>State</code>](#State) - Resulting state.  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>Mixed</code> | Input data. |

<a name="State+trust"></a>

### state.trust(source) ⇒ [<code>State</code>](#State)
**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: [<code>State</code>](#State) - this  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Event stream. |

<a name="State+inherits"></a>

### state.inherits(other) ⇒ <code>Number</code>
**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>Number</code> - New length of `settings.tags`.  

| Param | Type | Description |
| --- | --- | --- |
| other | [<code>State</code>](#State) | Peer [State](#State) whose `settings.namespace` is appended to `settings.tags`. |

<a name="State+toHTML"></a>

### state.toHTML()
Converts the State to an HTML document.

**Kind**: instance method of [<code>State</code>](#State)  
<a name="State+toString"></a>

### state.toString() ⇒ <code>String</code>
Unmarshall an existing state to an instance of a [Blob](Blob).

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>String</code> - Serialized [Blob](Blob).  
<a name="State+serialize"></a>

### state.serialize([input]) ⇒ <code>Buffer</code>
Convert to [Buffer](Buffer).

**Kind**: instance method of [<code>State</code>](#State)  
**Overrides**: [<code>serialize</code>](#Actor+serialize)  
**Returns**: <code>Buffer</code> - [Store](#Store)-able blob.  

| Param | Type | Description |
| --- | --- | --- |
| [input] | <code>Mixed</code> | Input to serialize. |

<a name="State+deserialize"></a>

### state.deserialize(input) ⇒ [<code>State</code>](#State)
Take a hex-encoded input and convert to a [State](#State) object.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: [<code>State</code>](#State) - [description]  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | [description] |

<a name="State+fork"></a>

### state.fork() ⇒ [<code>State</code>](#State)
Creates a new child [State](#State), with `@parent` set to
the current [State](#State) by immutable identifier.

**Kind**: instance method of [<code>State</code>](#State)  
<a name="State+get"></a>

### state.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>State</code>](#State)  
**Overrides**: [<code>get</code>](#Actor+get)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="State+set"></a>

### state.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>State</code>](#State)  
**Overrides**: [<code>set</code>](#Actor+set)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="State+commit"></a>

### state.commit()
Increment the vector clock, broadcast all changes as a transaction.

**Kind**: instance method of [<code>State</code>](#State)  
**Overrides**: [<code>commit</code>](#Actor+commit)  
<a name="State+render"></a>

### state.render() ⇒ <code>String</code>
Compose a JSON string for network consumption.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>String</code> - JSON-encoded [String](String).  
<a name="Actor+adopt"></a>

### state.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+export"></a>

### state.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### state.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### state.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>State</code>](#State)  
**Overrides**: [<code>toBuffer</code>](#Actor+toBuffer)  
<a name="Actor+toGenericMessage"></a>

### state.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### state.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>State</code>](#State)  
<a name="Actor+pause"></a>

### state.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+sign"></a>

### state.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>State</code>](#State)  
<a name="Actor+unpause"></a>

### state.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### state.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>State</code>](#State)  
**Overrides**: [<code>value</code>](#Actor+value)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### state.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="State.fromJSON"></a>

### State.fromJSON(input) ⇒ [<code>State</code>](#State)
Marshall an input into an instance of a [State](#State).  States have
absolute authority over their own domain, so choose your States wisely.

**Kind**: static method of [<code>State</code>](#State)  
**Returns**: [<code>State</code>](#State) - Resulting instance of the [State](#State).  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | Arbitrary input. |

<a name="Store"></a>

## Store ⇐ [<code>Actor</code>](#Actor)
Level-backed persistence extending [Actor](#Actor). Use optional [Codec](Codec) in <code>settings.codec</code> for
encrypted values; [openEncrypted](#Store.openEncrypted) matches Hub/shell keystore defaults. Commit/history behavior follows [Actor](#Actor).

**Kind**: global class  
**Extends**: [<code>Actor</code>](#Actor)  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| settings | <code>Mixed</code> | Current configuration. |


* [Store](#Store) ⇐ [<code>Actor</code>](#Actor)
    * [new Store([settings])](#new_Store_new)
    * _instance_
        * [.codec](#Store+codec)
        * [._REGISTER(obj)](#Store+_REGISTER) ⇒ [<code>Vector</code>](#Vector)
        * [._POST(key, value)](#Store+_POST) ⇒ <code>Promise</code>
        * [.get(key)](#Store+get) ⇒ <code>Promise</code>
        * [.set(key, value)](#Store+set)
        * [.trust(source)](#Store+trust) ⇒ [<code>Store</code>](#Store)
        * [.del(key)](#Store+del)
        * [.flush()](#Store+flush)
        * [.start()](#Store+start) ⇒ <code>Promise</code>
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.commit()](#Actor+commit) ⇒ <code>String</code>
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * [.encryptedSettings([settings])](#Store.encryptedSettings) ⇒ <code>Object</code>
        * [.openEncrypted([settings])](#Store.openEncrypted) ⇒ [<code>Store</code>](#Store)

<a name="new_Store_new"></a>

### new Store([settings])
Create an instance of a [Store](#Store) to manage long-term storage (LevelDB by default).

**Returns**: [<code>Store</code>](#Store) - Instance of the Store, ready to start.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | configuration object (<code>path</code>, <code>codec</code>, <code>persistent</code>, …). |

<a name="Store+codec"></a>

### store.codec
Optional [Codec](Codec) for encrypted at-rest values (Level `valueEncoding`).
Browser and Hub-style apps typically use one [Store](#Store) with `codec` for
secrets and separate plain stores for cache/tips.

**Kind**: instance property of [<code>Store</code>](#Store)  
<a name="Store+_REGISTER"></a>

### store.\_REGISTER(obj) ⇒ [<code>Vector</code>](#Vector)
Registers an [Actor](#Actor).  Necessary to store in a collection.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: [<code>Vector</code>](#Vector) - Returned from `storage.set`  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>Object</code> | Instance of the object to store. |

<a name="Store+_POST"></a>

### store.\_POST(key, value) ⇒ <code>Promise</code>
Insert something into a collection.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: <code>Promise</code> - Resolves on success with a String pointer.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | Path to add data to. |
| value | <code>Mixed</code> | Object to store. |

<a name="Store+get"></a>

### store.get(key) ⇒ <code>Promise</code>
Barebones getter.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Overrides**: [<code>get</code>](#Actor+get)  
**Returns**: <code>Promise</code> - Resolves on complete.  `null` if not found.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | Name of data to retrieve. |

<a name="Store+set"></a>

### store.set(key, value)
Set a `key` to a specific `value`.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Overrides**: [<code>set</code>](#Actor+set)  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | Address of the information. |
| value | <code>Mixed</code> | Content to store at `key`. |

<a name="Store+trust"></a>

### store.trust(source) ⇒ [<code>Store</code>](#Store)
Implicitly trust an [Event](Event) source.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: [<code>Store</code>](#Store) - Resulting instance of [Store](#Store) with new trust.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Event-emitting source. |

<a name="Store+del"></a>

### store.del(key)
Remove a [Value](Value) by [Path](Path).

**Kind**: instance method of [<code>Store</code>](#Store)  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>Path</code> | Key to remove. |

<a name="Store+flush"></a>

### store.flush()
Wipes the storage.

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Store+start"></a>

### store.start() ⇒ <code>Promise</code>
Start running the process.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: <code>Promise</code> - Resolves on complete.  
<a name="Actor+adopt"></a>

### store.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### store.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Overrides**: [<code>commit</code>](#Actor+commit)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+export"></a>

### store.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### store.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### store.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Actor+toGenericMessage"></a>

### store.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### store.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Actor+pause"></a>

### store.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### store.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Actor+sign"></a>

### store.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Actor+unpause"></a>

### store.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### store.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### store.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Store.encryptedSettings"></a>

### Store.encryptedSettings([settings]) ⇒ <code>Object</code>
Settings object for a [Store](#Store) with [Codec](Codec) at-rest encryption
(same defaults as the legacy `Keystore` type). Prefer `openEncrypted` or
`new Store(Store.encryptedSettings(...))` over ad-hoc Codec wiring.

**Kind**: static method of [<code>Store</code>](#Store)  
**Returns**: <code>Object</code> - Settings merged with `codec` when absent.  

| Param | Type | Default |
| --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | 

<a name="Store.openEncrypted"></a>

### Store.openEncrypted([settings]) ⇒ [<code>Store</code>](#Store)
**Kind**: static method of [<code>Store</code>](#Store)  

| Param | Type | Default |
| --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | 

<a name="Store"></a>

## Store
**Kind**: global class  

* [Store](#Store)
    * [new Store([settings])](#new_Store_new)
    * _instance_
        * [.codec](#Store+codec)
        * [._REGISTER(obj)](#Store+_REGISTER) ⇒ [<code>Vector</code>](#Vector)
        * [._POST(key, value)](#Store+_POST) ⇒ <code>Promise</code>
        * [.get(key)](#Store+get) ⇒ <code>Promise</code>
        * [.set(key, value)](#Store+set)
        * [.trust(source)](#Store+trust) ⇒ [<code>Store</code>](#Store)
        * [.del(key)](#Store+del)
        * [.flush()](#Store+flush)
        * [.start()](#Store+start) ⇒ <code>Promise</code>
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.commit()](#Actor+commit) ⇒ <code>String</code>
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * [.encryptedSettings([settings])](#Store.encryptedSettings) ⇒ <code>Object</code>
        * [.openEncrypted([settings])](#Store.openEncrypted) ⇒ [<code>Store</code>](#Store)

<a name="new_Store_new"></a>

### new Store([settings])
Create an instance of a [Store](#Store) to manage long-term storage (LevelDB by default).

**Returns**: [<code>Store</code>](#Store) - Instance of the Store, ready to start.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | configuration object (<code>path</code>, <code>codec</code>, <code>persistent</code>, …). |

<a name="Store+codec"></a>

### store.codec
Optional [Codec](Codec) for encrypted at-rest values (Level `valueEncoding`).
Browser and Hub-style apps typically use one [Store](#Store) with `codec` for
secrets and separate plain stores for cache/tips.

**Kind**: instance property of [<code>Store</code>](#Store)  
<a name="Store+_REGISTER"></a>

### store.\_REGISTER(obj) ⇒ [<code>Vector</code>](#Vector)
Registers an [Actor](#Actor).  Necessary to store in a collection.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: [<code>Vector</code>](#Vector) - Returned from `storage.set`  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>Object</code> | Instance of the object to store. |

<a name="Store+_POST"></a>

### store.\_POST(key, value) ⇒ <code>Promise</code>
Insert something into a collection.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: <code>Promise</code> - Resolves on success with a String pointer.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | Path to add data to. |
| value | <code>Mixed</code> | Object to store. |

<a name="Store+get"></a>

### store.get(key) ⇒ <code>Promise</code>
Barebones getter.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Overrides**: [<code>get</code>](#Actor+get)  
**Returns**: <code>Promise</code> - Resolves on complete.  `null` if not found.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | Name of data to retrieve. |

<a name="Store+set"></a>

### store.set(key, value)
Set a `key` to a specific `value`.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Overrides**: [<code>set</code>](#Actor+set)  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | Address of the information. |
| value | <code>Mixed</code> | Content to store at `key`. |

<a name="Store+trust"></a>

### store.trust(source) ⇒ [<code>Store</code>](#Store)
Implicitly trust an [Event](Event) source.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: [<code>Store</code>](#Store) - Resulting instance of [Store](#Store) with new trust.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Event-emitting source. |

<a name="Store+del"></a>

### store.del(key)
Remove a [Value](Value) by [Path](Path).

**Kind**: instance method of [<code>Store</code>](#Store)  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>Path</code> | Key to remove. |

<a name="Store+flush"></a>

### store.flush()
Wipes the storage.

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Store+start"></a>

### store.start() ⇒ <code>Promise</code>
Start running the process.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: <code>Promise</code> - Resolves on complete.  
<a name="Actor+adopt"></a>

### store.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+commit"></a>

### store.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Overrides**: [<code>commit</code>](#Actor+commit)  
**Returns**: <code>String</code> - 32-byte ID  
<a name="Actor+export"></a>

### store.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### store.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### store.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Actor+toGenericMessage"></a>

### store.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### store.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Actor+pause"></a>

### store.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### store.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Actor+sign"></a>

### store.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Actor+unpause"></a>

### store.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### store.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### store.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Store.encryptedSettings"></a>

### Store.encryptedSettings([settings]) ⇒ <code>Object</code>
Settings object for a [Store](#Store) with [Codec](Codec) at-rest encryption
(same defaults as the legacy `Keystore` type). Prefer `openEncrypted` or
`new Store(Store.encryptedSettings(...))` over ad-hoc Codec wiring.

**Kind**: static method of [<code>Store</code>](#Store)  
**Returns**: <code>Object</code> - Settings merged with `codec` when absent.  

| Param | Type | Default |
| --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | 

<a name="Store.openEncrypted"></a>

### Store.openEncrypted([settings]) ⇒ [<code>Store</code>](#Store)
**Kind**: static method of [<code>Store</code>](#Store)  

| Param | Type | Default |
| --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | 

<a name="Token"></a>

## Token
Implements a capability-based security token.

**Kind**: global class  

* [Token](#Token)
    * [new Token([settings])](#new_Token_new)
    * _instance_
        * [.toSignedString([options])](#Token+toSignedString) ⇒ <code>string</code>
        * [.toString()](#Token+toString) ⇒ <code>string</code>
    * _static_
        * [.verifySigned(tokenString, verificationKey)](#Token.verifySigned) ⇒ <code>Object</code> \| <code>null</code>
        * [.fromString(input)](#Token.fromString) ⇒ [<code>Token</code>](#Token)

<a name="new_Token_new"></a>

### new Token([settings])
Create a new Fabric Token.

**Returns**: [<code>Token</code>](#Token) - The token instance.  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Configuration. |

<a name="Token+toSignedString"></a>

### token.toSignedString([options]) ⇒ <code>string</code>
Create a cryptographically signed token string.
Format: base64url(payload).base64url(signature)
Payload: { cap, iss, sub, iat, exp }. Signature: Schnorr over payload JSON.

**Kind**: instance method of [<code>Token</code>](#Token)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [options] | <code>Object</code> |  |  |
| [options.expiresInSeconds] | <code>number</code> | <code>31536000</code> | Token lifetime (default 1 year). |

<a name="Token+toString"></a>

### token.toString() ⇒ <code>string</code>
Legacy JWT-shaped string. The MAC is SHA-256 over `header.payload` plus a
hardcoded secret (`ffff`). **Not authentication** — anyone can mint one.
Use [toSignedString](#Token+toSignedString) / [verifySigned](#Token.verifySigned) for Hub admin
and other signed tokens.

**Kind**: instance method of [<code>Token</code>](#Token)  
<a name="Token.verifySigned"></a>

### Token.verifySigned(tokenString, verificationKey) ⇒ <code>Object</code> \| <code>null</code>
Verify a signed token string. Returns parsed payload if valid, null otherwise.

**Kind**: static method of [<code>Token</code>](#Token)  

| Param | Type | Description |
| --- | --- | --- |
| tokenString | <code>string</code> |  |
| verificationKey | [<code>Key</code>](#Key) | Key used to verify the signature (must match issuer). |

<a name="Token.fromString"></a>

### Token.fromString(input) ⇒ [<code>Token</code>](#Token)
Parse a legacy three-segment string from [toString](#Token+toString). Not for
[toSignedString](#Token+toSignedString) output — use [verifySigned](#Token.verifySigned) instead.

**Kind**: static method of [<code>Token</code>](#Token)  

| Param | Type |
| --- | --- |
| input | <code>string</code> | 

<a name="Tree"></a>

## Tree
Class implementing a Bitcoin Merkle Tree in display (RPC) byte order:
SHA256d parents over byte-reversed children, and an odd last node paired
with itself. Txid leaves in block order give the block header's
`merkle_root`; one leaf is its own root and no leaves give an empty root.
Leaf encoding, proofs, and verification match `merkletreejs`
`isBitcoinTree` (which this replaced), so earlier roots are unchanged.
Optional `sortLeaves` makes the leaf order lexicographic so adjacent-leaf
**non-inclusion** proofs are well-defined (inclusion proofs work either way).

**Kind**: global class  

* [Tree](#Tree)
    * [new Tree([settings])](#new_Tree_new)
    * _instance_
        * [.root](#Tree+root) ⇒ <code>Buffer</code>
        * [.rootHex](#Tree+rootHex) ⇒ <code>string</code>
        * [.addLeaf(leaf)](#Tree+addLeaf) ⇒ [<code>Tree</code>](#Tree)
        * [.getLeaves()](#Tree+getLeaves) ⇒ <code>Array</code>
        * [.getLayers()](#Tree+getLayers) ⇒ <code>Array.&lt;Array.&lt;Buffer&gt;&gt;</code>
        * [.getRoot()](#Tree+getRoot) ⇒ <code>Buffer</code>
        * [.getProof(leaf, [index])](#Tree+getProof) ⇒ <code>Array.&lt;{position: string, data: Buffer}&gt;</code>
        * [.verify(proof, leaf, [root])](#Tree+verify) ⇒ <code>boolean</code>
        * [.proveInclusion(leaf)](#Tree+proveInclusion) ⇒ <code>object</code>
        * [.verifyInclusion(doc, [rootHex])](#Tree+verifyInclusion) ⇒ <code>boolean</code>
        * [.proveNonInclusion(leaf)](#Tree+proveNonInclusion) ⇒ <code>object</code>
        * [.verifyNonInclusion(doc, [opts])](#Tree+verifyNonInclusion) ⇒ <code>boolean</code>
    * _static_
        * [.verifyProof(proof, leaf, root)](#Tree.verifyProof) ⇒ <code>boolean</code>

<a name="new_Tree_new"></a>

### new Tree([settings])
Create an instance of a Tree.

**Returns**: [<code>Tree</code>](#Tree) - Instance of the tree.  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> \| <code>Array</code> | Configuration, or an array of leaves. |
| [settings.leaves] | <code>Array</code> |  |
| [settings.sortLeaves] | <code>boolean</code> | When true, leaves are sorted before merkling (required for [proveNonInclusion](#Tree+proveNonInclusion)). |

<a name="Tree+root"></a>

### tree.root ⇒ <code>Buffer</code>
Display-order root (an empty Buffer when there are no leaves).

**Kind**: instance property of [<code>Tree</code>](#Tree)  
<a name="Tree+rootHex"></a>

### tree.rootHex ⇒ <code>string</code>
Hex encoding of [root](#Tree+root) (empty string when the tree has no root bytes).

**Kind**: instance property of [<code>Tree</code>](#Tree)  
<a name="Tree+addLeaf"></a>

### tree.addLeaf(leaf) ⇒ [<code>Tree</code>](#Tree)
Add a leaf to the tree (accumulates into `settings.leaves`).

**Kind**: instance method of [<code>Tree</code>](#Tree)  
**Returns**: [<code>Tree</code>](#Tree) - Instance of the tree.  

| Param | Type | Description |
| --- | --- | --- |
| leaf | <code>String</code> \| <code>Buffer</code> | Leaf to add to the tree. |

<a name="Tree+getLeaves"></a>

### tree.getLeaves() ⇒ <code>Array</code>
Get a list of the [Tree](#Tree)'s leaves.

**Kind**: instance method of [<code>Tree</code>](#Tree)  
**Returns**: <code>Array</code> - A list of the [Tree](#Tree)'s leaves.  
<a name="Tree+getLayers"></a>

### tree.getLayers() ⇒ <code>Array.&lt;Array.&lt;Buffer&gt;&gt;</code>
Every layer of the tree, leaves first and the root layer last.

**Kind**: instance method of [<code>Tree</code>](#Tree)  
<a name="Tree+getRoot"></a>

### tree.getRoot() ⇒ <code>Buffer</code>
Same as [root](#Tree+root).

**Kind**: instance method of [<code>Tree</code>](#Tree)  
<a name="Tree+getProof"></a>

### tree.getProof(leaf, [index]) ⇒ <code>Array.&lt;{position: string, data: Buffer}&gt;</code>
Bitcoin-style merkle inclusion branch for `leaf`, leaf to root. Without
an integer `index` the last leaf equal to `leaf` is proven; an unknown
leaf gives `[]`. An odd last node lists itself as its right sibling.

**Kind**: instance method of [<code>Tree</code>](#Tree)  

| Param | Type | Description |
| --- | --- | --- |
| leaf | <code>String</code> \| <code>Buffer</code> |  |
| [index] | <code>number</code> | leaf position (skips the lookup) |

<a name="Tree+verify"></a>

### tree.verify(proof, leaf, [root]) ⇒ <code>boolean</code>
Verify an inclusion branch against this tree's root (or a supplied root).

**Kind**: instance method of [<code>Tree</code>](#Tree)  

| Param | Type |
| --- | --- |
| proof | <code>Array</code> | 
| leaf | <code>String</code> \| <code>Buffer</code> | 
| [root] | <code>Buffer</code> \| <code>string</code> | 

<a name="Tree+proveInclusion"></a>

### tree.proveInclusion(leaf) ⇒ <code>object</code>
JSON inclusion proof (hex siblings). `included` is false when verify fails.

**Kind**: instance method of [<code>Tree</code>](#Tree)  

| Param | Type |
| --- | --- |
| leaf | <code>String</code> \| <code>Buffer</code> | 

<a name="Tree+verifyInclusion"></a>

### tree.verifyInclusion(doc, [rootHex]) ⇒ <code>boolean</code>
Verify a [proveInclusion](#Tree+proveInclusion) object against this tree or a given root.

**Kind**: instance method of [<code>Tree</code>](#Tree)  

| Param | Type |
| --- | --- |
| doc | <code>object</code> | 
| [rootHex] | <code>string</code> | 

<a name="Tree+proveNonInclusion"></a>

### tree.proveNonInclusion(leaf) ⇒ <code>object</code>
Sorted-leaf non-inclusion proof. Requires `sortLeaves: true` so adjacency
is lexicographic. Bind `(root, leafCount)` from a signed collection /
activity tree — the merkle root alone does not commit the count.

**Kind**: instance method of [<code>Tree</code>](#Tree)  

| Param | Type |
| --- | --- |
| leaf | <code>String</code> \| <code>Buffer</code> | 

<a name="Tree+verifyNonInclusion"></a>

### tree.verifyNonInclusion(doc, [opts]) ⇒ <code>boolean</code>
Verify a [proveNonInclusion](#Tree+proveNonInclusion) document. Adjacency is checked
against this tree's sorted leaves (or <code>opts.leaves</code>) so a
prover cannot skip an in-range leaf. Compact root-only verification
without the leaf set is not supported.

**Kind**: instance method of [<code>Tree</code>](#Tree)  

| Param | Type | Description |
| --- | --- | --- |
| doc | <code>object</code> |  |
| [opts] | <code>Object</code> |  |
| [opts.root] | <code>string</code> | committed merkle root hex |
| [opts.leafCount] | <code>number</code> | committed leaf count |
| [opts.leaves] | <code>Array</code> | ordered or unordered leaf set (sorted here) |

<a name="Tree.verifyProof"></a>

### Tree.verifyProof(proof, leaf, root) ⇒ <code>boolean</code>
Check an inclusion branch against `root`. Each step is
`{ position: 'left'|'right', data }`, `[0|1, data]` (0 = left), or a bare
string / Buffer sibling on the left. A missing or empty-string leaf never
verifies; a malformed step throws `TypeError`.

**Kind**: static method of [<code>Tree</code>](#Tree)  

| Param | Type | Description |
| --- | --- | --- |
| proof | <code>Array</code> | sibling steps, leaf to root |
| leaf | <code>\*</code> |  |
| root | <code>Buffer</code> \| <code>string</code> |  |

<a name="Vector"></a>

## Vector ⇐ <code>EventEmitter</code>
Lightweight <strong>event sink</strong> for instruction-stream and VM-adjacent signals.
Former [State](#State)-backed fields (<code>script</code>, <code>stack</code>, <code>known</code>, serialization helpers)
live on [Machine](#Machine) and [State](#State) / [push](#Fabric+push) instead.

**Kind**: global class  
**Extends**: <code>EventEmitter</code>  
<a name="new_Vector_new"></a>

### new Vector([options])

| Param | Type | Description |
| --- | --- | --- |
| [options] | <code>Object</code> | Optional emitter options (e.g. <code>captureRejections</code>). |

<a name="Vector"></a>

## Vector
**Kind**: global class  
<a name="new_Vector_new"></a>

### new Vector([options])

| Param | Type | Description |
| --- | --- | --- |
| [options] | <code>Object</code> | Optional emitter options (e.g. <code>captureRejections</code>). |

<a name="Wallet"></a>

## Wallet : <code>Object</code>
Manage keys and track their balances.

**Kind**: global class  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Unique identifier for this [Wallet](#Wallet). |


* [Wallet](#Wallet) : <code>Object</code>
    * [new Wallet([settings])](#new_Wallet_new)
    * _instance_
        * [._emittedWalletTxKeys](#Wallet+_emittedWalletTxKeys) : <code>Set.&lt;string&gt;</code>
        * [.loadKey(input, [labels])](#Wallet+loadKey) ⇒ <code>Object</code>
        * [.loadSeed(phrase, [labels], [opts])](#Wallet+loadSeed) ⇒ <code>Object</code>
        * [.listSeeds()](#Wallet+listSeeds) ⇒ <code>Array.&lt;{seedId: string, xpub: string, labels: Array.&lt;string&gt;}&gt;</code>
        * [.watchAddress(address, [meta])](#Wallet+watchAddress)
        * [.watchPaymentHash(paymentHashHex, [meta])](#Wallet+watchPaymentHash)
        * [.watchHtlc(htlc)](#Wallet+watchHtlc)
        * [.getWatchSet()](#Wallet+getWatchSet) ⇒ <code>object</code>
        * [._registerDerivedAddresses(key, [opts])](#Wallet+_registerDerivedAddresses)
        * [.ingestBitcoinTransaction(txOrHex, [context])](#Wallet+ingestBitcoinTransaction) ⇒ <code>object</code>
        * [.ingestBitcoinBlock(block)](#Wallet+ingestBitcoinBlock) ⇒ <code>Array.&lt;object&gt;</code>
        * [.start()](#Wallet+start)
        * [.getAddressForScript(script)](#Wallet+getAddressForScript)
        * [.getAddressFromRedeemScript(redeemScript)](#Wallet+getAddressFromRedeemScript)
        * ~~[.createHTLC()](#Wallet+createHTLC)~~
        * [._sign(tx)](#Wallet+_sign)
        * [._createCrowdfund(fund)](#Wallet+_createCrowdfund)
        * [._getSwapInputScript(redeemScript, secret)](#Wallet+_getSwapInputScript)
        * [._getRefundInputScript(redeemScript)](#Wallet+_getRefundInputScript)
        * [.publicKeyFromString(input)](#Wallet+publicKeyFromString)
    * _static_
        * [.createSeed(passphrase)](#Wallet.createSeed) ⇒ <code>FabricSeed</code>
        * [.fromSeed(seed)](#Wallet.fromSeed) ⇒ [<code>Wallet</code>](#Wallet)
        * [.purchaseContentHashHex(documentId, parsed)](#Wallet.purchaseContentHashHex) ⇒ <code>string</code>
        * [.resolveDocumentContentHashHex(opts)](#Wallet.resolveDocumentContentHashHex) ⇒ <code>Object</code>
        * [.buildInventoryHtlcP2tr()](#Wallet.buildInventoryHtlcP2tr)
        * [.buildHtlcFundingHints()](#Wallet.buildHtlcFundingHints)

<a name="new_Wallet_new"></a>

### new Wallet([settings])
Create an instance of a [Wallet](#Wallet).

**Returns**: [<code>Wallet</code>](#Wallet) - Instance of the wallet.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | Configure the wallet. |
| [settings.verbosity] | <code>Number</code> | <code>2</code> | One of: 0 (none), 1 (error), 2 (warning), 3 (notice), 4 (debug), 5 (audit) |
| [settings.key] | <code>Object</code> |  | Key to restore from. |
| [settings.key.seed] | <code>String</code> |  | Mnemonic seed for a restored wallet. |

<a name="Wallet+_emittedWalletTxKeys"></a>

### wallet.\_emittedWalletTxKeys : <code>Set.&lt;string&gt;</code>
**Kind**: instance property of [<code>Wallet</code>](#Wallet)  
<a name="Wallet+loadKey"></a>

### wallet.loadKey(input, [labels]) ⇒ <code>Object</code>
Register a key with optional labels.
Accepts a Key instance, pubkey hex string, or object-like key input.

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  
**Returns**: <code>Object</code> - Stored key descriptor.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| input | [<code>Key</code>](#Key) \| <code>String</code> \| <code>Object</code> |  | Key material to load. |
| [labels] | <code>Array.&lt;String&gt;</code> | <code>[]</code> | Optional labels. |

<a name="Wallet+loadSeed"></a>

### wallet.loadSeed(phrase, [labels], [opts]) ⇒ <code>Object</code>
Load an additional BIP39 seed into this wallet's key collection (does not
replace the primary `this.key`). Addresses derived from the seed are watched.

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| phrase | <code>string</code> |  | BIP39 mnemonic |
| [labels] | <code>Array.&lt;string&gt;</code> | <code>[]</code> |  |
| [opts] | <code>object</code> |  |  |
| [opts.addressWindow] | <code>number</code> |  | receive indices to watch (default gapLimit) |

<a name="Wallet+listSeeds"></a>

### wallet.listSeeds() ⇒ <code>Array.&lt;{seedId: string, xpub: string, labels: Array.&lt;string&gt;}&gt;</code>
**Kind**: instance method of [<code>Wallet</code>](#Wallet)  
<a name="Wallet+watchAddress"></a>

### wallet.watchAddress(address, [meta])
Watch a Bitcoin address for wallet-associated transactions.

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  

| Param | Type |
| --- | --- |
| address | <code>string</code> | 
| [meta] | <code>object</code> | 

<a name="Wallet+watchPaymentHash"></a>

### wallet.watchPaymentHash(paymentHashHex, [meta])
Watch an HTLC payment hash (SHA256 preimage) so claim witnesses are detected.

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  

| Param | Type |
| --- | --- |
| paymentHashHex | <code>string</code> | 
| [meta] | <code>object</code> | 

<a name="Wallet+watchHtlc"></a>

### wallet.watchHtlc(htlc)
Watch an inventory HTLC offer (payment address + payment hash + optional settlement).

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  

| Param | Type |
| --- | --- |
| htlc | <code>object</code> | 

<a name="Wallet+getWatchSet"></a>

### wallet.getWatchSet() ⇒ <code>object</code>
**Kind**: instance method of [<code>Wallet</code>](#Wallet)  
**Returns**: <code>object</code> - watch set snapshot  
<a name="Wallet+_registerDerivedAddresses"></a>

### wallet.\_registerDerivedAddresses(key, [opts])
Derive and watch a window of addresses for a key (all common script types).

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  

| Param | Type |
| --- | --- |
| key | [<code>Key</code>](#Key) | 
| [opts] | <code>object</code> | 

<a name="Wallet+ingestBitcoinTransaction"></a>

### wallet.ingestBitcoinTransaction(txOrHex, [context]) ⇒ <code>object</code>
Ingest a Bitcoin transaction (verbose RPC object or raw hex) and emit when related.

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  
**Returns**: <code>object</code> - classification  

| Param | Type | Description |
| --- | --- | --- |
| txOrHex | <code>object</code> \| <code>string</code> |  |
| [context] | <code>object</code> | { tip, height, source } |

<a name="Wallet+ingestBitcoinBlock"></a>

### wallet.ingestBitcoinBlock(block) ⇒ <code>Array.&lt;object&gt;</code>
Process a new block tip (optionally with verbosity-2 `tx` / `transactions`).

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  
**Returns**: <code>Array.&lt;object&gt;</code> - related classifications  

| Param | Type |
| --- | --- |
| block | <code>object</code> | 

<a name="Wallet+start"></a>

### wallet.start()
Start the wallet, including listening for transactions.

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  
<a name="Wallet+getAddressForScript"></a>

### wallet.getAddressForScript(script)
Returns a bech32 address for the provided [Script](#Script).

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  

| Param | Type |
| --- | --- |
| script | [<code>Script</code>](#Script) | 

<a name="Wallet+getAddressFromRedeemScript"></a>

### wallet.getAddressFromRedeemScript(redeemScript)
Generate a [BitcoinAddress](BitcoinAddress) for the supplied [BitcoinScript](BitcoinScript).

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  

| Param | Type |
| --- | --- |
| redeemScript | <code>BitcoinScript</code> | 

<a name="Wallet+createHTLC"></a>

### ~~wallet.createHTLC()~~
***Legacy bcoin-style HTLC for channels — not the document-market P2TR profile.
Use [buildInventoryHtlcP2tr](#Wallet.buildInventoryHtlcP2tr) / `@fabric/core/functions/inventoryHtlc` instead.***

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  
<a name="Wallet+_sign"></a>

### wallet.\_sign(tx)
Signs a transaction with the keyring.

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  

| Param | Type |
| --- | --- |
| tx | <code>BcoinTX</code> | 

<a name="Wallet+_createCrowdfund"></a>

### wallet.\_createCrowdfund(fund)
Create a crowdfunding transaction.

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  

| Param | Type |
| --- | --- |
| fund | <code>Object</code> | 

<a name="Wallet+_getSwapInputScript"></a>

### wallet.\_getSwapInputScript(redeemScript, secret)
Generate [Script](#Script) for claiming a [Swap](Swap).

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  

| Param | Type |
| --- | --- |
| redeemScript | <code>\*</code> | 
| secret | <code>\*</code> | 

<a name="Wallet+_getRefundInputScript"></a>

### wallet.\_getRefundInputScript(redeemScript)
Generate [Script](#Script) for reclaiming funds commited to a [Swap](Swap).

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  

| Param | Type |
| --- | --- |
| redeemScript | <code>\*</code> | 

<a name="Wallet+publicKeyFromString"></a>

### wallet.publicKeyFromString(input)
Create a public key from a string.

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | Hex-encoded string to create key from. |

<a name="Wallet.createSeed"></a>

### Wallet.createSeed(passphrase) ⇒ <code>FabricSeed</code>
Create a new seed phrase.

**Kind**: static method of [<code>Wallet</code>](#Wallet)  
**Returns**: <code>FabricSeed</code> - The seed object.  

| Param | Type | Description |
| --- | --- | --- |
| passphrase | <code>String</code> | BIP 39 passphrase for key derivation. |

<a name="Wallet.fromSeed"></a>

### Wallet.fromSeed(seed) ⇒ [<code>Wallet</code>](#Wallet)
Create a new [Wallet](#Wallet) from a seed object.

**Kind**: static method of [<code>Wallet</code>](#Wallet)  
**Returns**: [<code>Wallet</code>](#Wallet) - Instance of the wallet.  

| Param | Type | Description |
| --- | --- | --- |
| seed | <code>FabricSeed</code> | Fabric seed. |

<a name="Wallet.purchaseContentHashHex"></a>

### Wallet.purchaseContentHashHex(documentId, parsed) ⇒ <code>string</code>
Envelope (legacy / unsealed) payment hash. Prefer [resolveDocumentContentHashHex](#Wallet.resolveDocumentContentHashHex)
when sealed meta or a content key may apply.

**Kind**: static method of [<code>Wallet</code>](#Wallet)  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>string</code> |  |
| parsed | <code>object</code> | Whitelisted document fields (see [_buildDocumentParsedForPublish](#Peer+_buildDocumentParsedForPublish)). |

<a name="Wallet.resolveDocumentContentHashHex"></a>

### Wallet.resolveDocumentContentHashHex(opts) ⇒ <code>Object</code>
Single path for buy / HTLC `contentHashHex` (sealed | envelope | blob).

**Kind**: static method of [<code>Wallet</code>](#Wallet)  

| Param | Type | Description |
| --- | --- | --- |
| opts | <code>object</code> | see [module:functions/documentPaymentHash.resolveDocumentContentHashHex](module:functions/documentPaymentHash.resolveDocumentContentHashHex) |

<a name="Wallet.buildInventoryHtlcP2tr"></a>

### Wallet.buildInventoryHtlcP2tr()
**Kind**: static method of [<code>Wallet</code>](#Wallet)  
**See**: [module:functions/inventoryHtlc.buildInventoryHtlcP2tr](module:functions/inventoryHtlc.buildInventoryHtlcP2tr)  
<a name="Wallet.buildHtlcFundingHints"></a>

### Wallet.buildHtlcFundingHints()
**Kind**: static method of [<code>Wallet</code>](#Wallet)  
**See**: [module:functions/inventoryHtlc.buildHtlcFundingHints](module:functions/inventoryHtlc.buildHtlcFundingHints)  
<a name="FraudProof"></a>

## FraudProof
Self-contained proof that a market counterparty broke a signed obligation.
Shape: `{ type: 'FraudProof', kind, artifacts, claim }`. `verify()` is pure
over the artifacts; the few kinds that assert an **on-chain fact** (a
broadcast happened, an outpoint is still unspent, the tip passed a height)
take that fact from `ctx` — the verifier's own chain view — and refuse to
conclude without it. No kind ever infers fraud from a *missing* message
alone: absence is always anchored to a timelock (decision 6).

Kinds:
- `wrong-leaf`: signed challenge + provider-signed response whose leaf does
  not belong to the committed root (or names the wrong blob hash).
- `non-response`: signed challenge + provider's signed availability
  commitment and either (a) a response signed after the deadline epoch, or
  (b) **timelock evidence**: the challenge names `deadlineHeight` + the
  deposit outpoint, the provider's `DepositPenaltyPreSig` on a penalty
  transaction with `nLockTime = deadlineHeight`, and the verifier's chain
  view shows the tip past the deadline with the outpoint **unspent** (no
  check-in). The pre-signed penalty is itself the enforcement.
- `wrong-bytes`: seller-signed offer row (with `paymentHashHex`) + the
  claim preimage that opens that payment hash + the seller-signed AMP
  `P2P_FILE_SEND` frame whose delivered bytes miss the offered
  `blobHashHex`. The frame author must be the offer signer.
- `wrongful-penalty`: publisher-signed challenge + the provider's valid,
  Merkle-proven, in-time response + the penalty transaction that spent
  the deposit outpoint anyway — publisher fraud. The penalty's spent
  outputs (`prevouts`) let the verifier check that the penalty leaf is
  committed to the deposit output and signed by both parties.
- `stale-commitment`: a payment-channel party's own signed `ChannelRevoke`
  (naming the commitment txid it revoked) plus that very transaction and
  evidence it was broadcast: an SPV `inclusion` artifact
  (`functions/bitcoinTxInclusion.js`) or `ctx.txConfirmed(txid)`.

**Kind**: global class  

* [FraudProof](#FraudProof)
    * _instance_
        * [.hash](#FraudProof+hash) ⇒ <code>string</code>
        * [.toBody()](#FraudProof+toBody) ⇒ <code>object</code>
        * [.verify([ctx])](#FraudProof+verify) ⇒ <code>Object</code>
    * _static_
        * [.fromBody(body)](#FraudProof.fromBody) ⇒ [<code>FraudProof</code>](#FraudProof) \| <code>null</code>
        * [.verifyPenaltyPreSig(preSig, expect)](#FraudProof.verifyPenaltyPreSig) ⇒ <code>Object</code>

<a name="FraudProof+hash"></a>

### fraudProof.hash ⇒ <code>string</code>
**Kind**: instance property of [<code>FraudProof</code>](#FraudProof)  
**Returns**: <code>string</code> - SHA-256 hex over the canonical body.  
<a name="FraudProof+toBody"></a>

### fraudProof.toBody() ⇒ <code>object</code>
**Kind**: instance method of [<code>FraudProof</code>](#FraudProof)  
**Returns**: <code>object</code> - `CONTRACT_MESSAGE` body (JSON-safe).  
<a name="FraudProof+verify"></a>

### fraudProof.verify([ctx]) ⇒ <code>Object</code>
**Kind**: instance method of [<code>FraudProof</code>](#FraudProof)  

| Param | Type | Description |
| --- | --- | --- |
| [ctx] | <code>object</code> | verifier's chain view |
| [ctx.tipHeight] | <code>number</code> | current block height (timelocked non-response) |
| [ctx.outpointUnspent] | <code>function</code> | `(txid, vout) → boolean` (timelocked non-response) |
| [ctx.txConfirmed] | <code>function</code> | `(txid) → boolean` (stale-commitment / wrongful-penalty broadcast evidence) |
| [ctx.headerKnown] | <code>function</code> | `(blockHash) → boolean` — whether an inclusion artifact's block is in the verifier's header chain |

<a name="FraudProof.fromBody"></a>

### FraudProof.fromBody(body) ⇒ [<code>FraudProof</code>](#FraudProof) \| <code>null</code>
Rehydrate a `FraudProof` from a `CONTRACT_MESSAGE` body (or `null` for other types).

**Kind**: static method of [<code>FraudProof</code>](#FraudProof)  

| Param | Type |
| --- | --- |
| body | <code>Object</code> | 

<a name="FraudProof.verifyPenaltyPreSig"></a>

### FraudProof.verifyPenaltyPreSig(preSig, expect) ⇒ <code>Object</code>
Verify a provider's `DepositPenaltyPreSig`: a signed artifact wrapping a
penalty PSBT that spends the deposit outpoint with `nLockTime` equal to
the challenge deadline height and carries the provider's valid tapscript
signature on the canonical publisher + provider penalty leaf, whose
control block commits to the spent deposit output. Pure.

**Kind**: static method of [<code>FraudProof</code>](#FraudProof)  

| Param | Type | Description |
| --- | --- | --- |
| preSig | <code>object</code> | artifact `{ type: 'DepositPenaltyPreSig', psbtBase64, deposit: { txid, vout }, deadlineHeight, txid, pubkey, signature }` |
| expect | <code>object</code> | `{ providerPubkey (x-only), publisherPubkey, deposit: { txid, vout, penaltyAddress?, minPenaltySats? }, deadlineHeight, depositAddress?, destinationAddress?, destinationScriptHex?, minValueSats? }` — a destination (top-level or from the challenge's signed `deposit`) is mandatory when named; `depositAddress` binds the spent output |

<a name="Worker"></a>

## Worker
Workers are arbitrary containers for processing data.  They can be thought of
almost like "threads", as they run asynchronously over the duration of a
contract's lifetime as "fulfillment conditions" for its closure.

**Kind**: global class  

* [Worker](#Worker)
    * [new Worker(method)](#new_Worker_new)
    * [.compute(input)](#Worker+compute) ⇒ <code>String</code>

<a name="new_Worker_new"></a>

### new Worker(method)

| Param | Type | Description |
| --- | --- | --- |
| method | <code>function</code> | Pure function. |

<a name="Worker+compute"></a>

### worker.compute(input) ⇒ <code>String</code>
Handle a task.

**Kind**: instance method of [<code>Worker</code>](#Worker)  
**Returns**: <code>String</code> - Outcome of the requested job.  

| Param | Type | Description |
| --- | --- | --- |
| input | [<code>Vector</code>](#Vector) | Input vector. |

<a name="Bitcoin"></a>

## Bitcoin ⇐ [<code>Service</code>](#Service)
Manages interaction with the Bitcoin network.

**Kind**: global class  
**Extends**: [<code>Service</code>](#Service)  

* [Bitcoin](#Bitcoin) ⇐ [<code>Service</code>](#Service)
    * [new Bitcoin([settings])](#new_Bitcoin_new)
    * _instance_
        * [.UAString](#Bitcoin+UAString)
        * [.tip](#Bitcoin+tip)
        * [.height](#Bitcoin+height)
        * [.broadcast(tx)](#Bitcoin+broadcast)
        * [._processSpendMessage(message)](#Bitcoin+_processSpendMessage) ⇒ <code>BitcoinTransactionID</code>
        * [._prepareTransaction(obj)](#Bitcoin+_prepareTransaction)
        * [._handleCommittedBlock(block)](#Bitcoin+_handleCommittedBlock)
        * [._handlePeerPacket(msg)](#Bitcoin+_handlePeerPacket)
        * [._handleBlockFromSPV(msg)](#Bitcoin+_handleBlockFromSPV)
        * [._handleTransactionFromSPV(tx)](#Bitcoin+_handleTransactionFromSPV)
        * [._subscribeToShard(shard)](#Bitcoin+_subscribeToShard)
        * [._connectSPV()](#Bitcoin+_connectSPV)
        * [.connect(addr)](#Bitcoin+connect)
        * [._makeRPCRequest(method, params, [opts])](#Bitcoin+_makeRPCRequest) ⇒ <code>Promise</code>
        * [.getBlockInfo(hashOrHeight)](#Bitcoin+getBlockInfo) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.getTransactionInfo(txid)](#Bitcoin+getTransactionInfo) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.getAddressInfo(address)](#Bitcoin+getAddressInfo) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.flushChainToSnapshot(snapshotBlockHash)](#Bitcoin+flushChainToSnapshot) ⇒ <code>Promise.&lt;{ok: boolean, steps: number, snapshotBlockHash: string}&gt;</code>
        * [._requestBlockAtHeight(height)](#Bitcoin+_requestBlockAtHeight) ⇒ <code>Object</code>
        * [._createContractProposal(options)](#Bitcoin+_createContractProposal) ⇒ <code>ContractProposal</code>
        * [._buildPSBT(options)](#Bitcoin+_buildPSBT) ⇒ <code>PSBT</code>
        * [._normalizeP2pPeerAddress(peer)](#Bitcoin+_normalizeP2pPeerAddress) ⇒ <code>string</code> \| <code>null</code>
        * [.applyP2pAddNodes(peers, [command])](#Bitcoin+applyP2pAddNodes) ⇒ <code>Promise.&lt;Array.&lt;string&gt;&gt;</code>
        * [._emitErrorSafe(msg)](#Bitcoin+_emitErrorSafe) ⇒ <code>void</code>
        * [.start()](#Bitcoin+start)
        * [.stop()](#Bitcoin+stop)
        * [._appendWarning(msg)](#Service+_appendWarning) ⇒ [<code>Service</code>](#Service)
        * [.init()](#Service+init)
        * [.tick()](#Service+tick) ⇒ <code>Number</code>
        * [.beat()](#Service+beat) ⇒ [<code>Service</code>](#Service)
        * [.get(path)](#Service+get) ⇒ <code>Mixed</code>
        * [.set(path)](#Service+set) ⇒ <code>Mixed</code>
        * [.trust(source)](#Service+trust) ⇒ [<code>Service</code>](#Service)
        * [.handler(message)](#Service+handler) ⇒ [<code>Service</code>](#Service)
        * [.lock([duration])](#Service+lock) ⇒ <code>Boolean</code>
        * [.when(event, method)](#Service+when) ⇒ <code>EventEmitter</code>
        * [.defineOpcode(name, [definition])](#Service+defineOpcode) ⇒ <code>Object</code>
        * [.defineBitcoinOpcode(name, [definition])](#Service+defineBitcoinOpcode) ⇒ <code>Object</code>
        * [.defineFabricOpcode(name, [definition])](#Service+defineFabricOpcode) ⇒ <code>Object</code>
        * [.defineOpcodeContract(name, body, [meta])](#Service+defineOpcodeContract) ⇒ <code>Object</code>
        * [.listOpcodes()](#Service+listOpcodes) ⇒ <code>Array.&lt;Object&gt;</code>
        * [.route(msg)](#Service+route) ⇒ <code>Promise</code>
        * [._GET(path)](#Service+_GET) ⇒ <code>Promise</code>
        * [._PUT(path, value, [commit])](#Service+_PUT) ⇒ <code>Promise</code>
        * [.send(channel, message)](#Service+send) ⇒ [<code>Service</code>](#Service)
        * [.commit()](#Service+commit) ⇒ <code>String</code>
        * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
        * [._send(message)](#Service+_send)
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * [.bitcoindChainDataDirSegment(network)](#Bitcoin.bitcoindChainDataDirSegment) ⇒ <code>string</code>
        * [.resolveBitcoinDatadirForLocalAccess(datadir)](#Bitcoin.resolveBitcoinDatadirForLocalAccess) ⇒ <code>string</code> \| <code>null</code>
        * [.resolveBitcoinCookieFileForLocalRead(filePath)](#Bitcoin.resolveBitcoinCookieFileForLocalRead) ⇒ <code>string</code> \| <code>null</code>
        * [.tryReadRpcCookieFileCredentials(cookiePath)](#Bitcoin.tryReadRpcCookieFileCredentials) ⇒ <code>Promise.&lt;({username: string, password: string}\|null)&gt;</code>
        * [.cookiePathForBitcoind(datadirRoot, network)](#Bitcoin.cookiePathForBitcoind) ⇒ <code>string</code>
        * [.cookiePathForChainSubtree(datadirRoot, chainSubdir)](#Bitcoin.cookiePathForChainSubtree) ⇒ <code>string</code>
        * [.defaultStoresRelativeDirsForProbe(network, [constraints])](#Bitcoin.defaultStoresRelativeDirsForProbe) ⇒ <code>Array.&lt;string&gt;</code>
        * [.buildLocalCookieProbePaths(opts)](#Bitcoin.buildLocalCookieProbePaths) ⇒ <code>Array.&lt;string&gt;</code>
        * [.parentDirNameForCookieProbe(cookiePath)](#Bitcoin.parentDirNameForCookieProbe) ⇒ <code>string</code>
        * ~~[.buildRegtestCookiePathList(opts)](#Bitcoin.buildRegtestCookiePathList) ⇒ <code>Array.&lt;string&gt;</code>~~

<a name="new_Bitcoin_new"></a>

### new Bitcoin([settings])
Creates an instance of the Bitcoin service.


| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Map of configuration options for the Bitcoin service. |
| [settings.network] | <code>String</code> | One of `regtest`, `testnet`, or `mainnet`. |
| [settings.nodes] | <code>Array</code> | List of address:port pairs to trust. |
| [settings.seeds] | <code>Array</code> | Bitcoin peers to request chain from (address:port). |
| [settings.fullnode] | <code>Boolean</code> | Run a full node. |

<a name="Bitcoin+UAString"></a>

### bitcoin.UAString
User Agent string for the Bitcoin P2P network.

**Kind**: instance property of [<code>Bitcoin</code>](#Bitcoin)  
<a name="Bitcoin+tip"></a>

### bitcoin.tip
Chain tip (block hash of the chain with the most Proof of Work)

**Kind**: instance property of [<code>Bitcoin</code>](#Bitcoin)  
<a name="Bitcoin+height"></a>

### bitcoin.height
Chain height (`=== length - 1`)

**Kind**: instance property of [<code>Bitcoin</code>](#Bitcoin)  
<a name="Bitcoin+broadcast"></a>

### bitcoin.broadcast(tx)
Broadcast a transaction to the Bitcoin network.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Unstable**:   

| Param | Type | Description |
| --- | --- | --- |
| tx | <code>TX</code> | Bitcoin transaction |

<a name="Bitcoin+_processSpendMessage"></a>

### bitcoin.\_processSpendMessage(message) ⇒ <code>BitcoinTransactionID</code>
Process a spend message.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Returns**: <code>BitcoinTransactionID</code> - Hex-encoded representation of the transaction ID.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>SpendMessage</code> | Generic-level message for spending. |
| message.amount | <code>String</code> | Amount (in BTC) to spend. |
| message.destination | <code>String</code> | Destination for funds. |

<a name="Bitcoin+_prepareTransaction"></a>

### bitcoin.\_prepareTransaction(obj)
Prepares a [Transaction](Transaction) for storage.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>Transaction</code> | Transaction to prepare. |

<a name="Bitcoin+_handleCommittedBlock"></a>

### bitcoin.\_handleCommittedBlock(block)
Receive a committed block.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type | Description |
| --- | --- | --- |
| block | [<code>Block</code>](#Block) | Block to handle. |

<a name="Bitcoin+_handlePeerPacket"></a>

### bitcoin.\_handlePeerPacket(msg)
Process a message from a peer in the Bitcoin network.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>PeerPacket</code> | Message from peer. |

<a name="Bitcoin+_handleBlockFromSPV"></a>

### bitcoin.\_handleBlockFromSPV(msg)
Hand a [Block](#Block) message as supplied by an [SPV](SPV) client.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>BlockMessage</code> | A [Message](#Message) as passed by the [SPV](SPV) source. |

<a name="Bitcoin+_handleTransactionFromSPV"></a>

### bitcoin.\_handleTransactionFromSPV(tx)
Verify and interpret a [BitcoinTransaction](BitcoinTransaction), as received from an
[SPVSource](SPVSource).

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type | Description |
| --- | --- | --- |
| tx | <code>BitcoinTransaction</code> | Incoming transaction from the SPV source. |

<a name="Bitcoin+_subscribeToShard"></a>

### bitcoin.\_subscribeToShard(shard)
Attach event handlers for a supplied list of addresses.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type | Description |
| --- | --- | --- |
| shard | <code>Shard</code> | List of addresses to monitor. |

<a name="Bitcoin+_connectSPV"></a>

### bitcoin.\_connectSPV()
Initiate outbound connections to configured SPV nodes.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
<a name="Bitcoin+connect"></a>

### bitcoin.connect(addr)
Connect to a Fabric [Peer](#Peer).

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>connect</code>](#Service+connect)  

| Param | Type | Description |
| --- | --- | --- |
| addr | <code>String</code> | Address to connect to. |

<a name="Bitcoin+_makeRPCRequest"></a>

### bitcoin.\_makeRPCRequest(method, params, [opts]) ⇒ <code>Promise</code>
Make a single RPC request to the Bitcoin node.
Retries on "Work queue depth exceeded" (bitcoind temporary backpressure).

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Returns**: <code>Promise</code> - A promise that resolves to the RPC response.  

| Param | Type | Description |
| --- | --- | --- |
| method | <code>String</code> | The RPC method to call. |
| params | <code>Array</code> | The parameters to pass to the RPC method. |
| [opts] | <code>Object</code> | Options. retries: max retries for work-queue errors (default 5). |

<a name="Bitcoin+getBlockInfo"></a>

### bitcoin.getBlockInfo(hashOrHeight) ⇒ <code>Promise.&lt;Object&gt;</code>
Blockchain explorer: fetch block info by hash or height.
Uses RPC when available; optional HTTP API when `explorerBaseUrl` is set.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - Block info { hash, height, time, txcount, size, ... }.  

| Param | Type | Description |
| --- | --- | --- |
| hashOrHeight | <code>String</code> \| <code>Number</code> | Block hash (hex) or block height. |

<a name="Bitcoin+getTransactionInfo"></a>

### bitcoin.getTransactionInfo(txid) ⇒ <code>Promise.&lt;Object&gt;</code>
Blockchain explorer: fetch transaction info by txid.
Uses RPC when available; optional HTTP API when `explorerBaseUrl` is set.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - Transaction info.  

| Param | Type | Description |
| --- | --- | --- |
| txid | <code>String</code> | Transaction ID (hex). |

<a name="Bitcoin+getAddressInfo"></a>

### bitcoin.getAddressInfo(address) ⇒ <code>Promise.&lt;Object&gt;</code>
Blockchain explorer: fetch address info (balance, tx count, recent txs).
Requires `explorerBaseUrl` (Core has no generic address index over RPC alone).

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - Address info { address, chain_stats, mempool_stats, recent_txs }.  

| Param | Type | Description |
| --- | --- | --- |
| address | <code>String</code> | Bitcoin address. |

<a name="Bitcoin+flushChainToSnapshot"></a>

### bitcoin.flushChainToSnapshot(snapshotBlockHash) ⇒ <code>Promise.&lt;{ok: boolean, steps: number, snapshotBlockHash: string}&gt;</code>
Rewind the attached Bitcoin Core node to a known-good tip by repeatedly calling `invalidateblock`
on the current best block until `getbestblockhash` matches `snapshotBlockHash`.
Allowed on regtest, playnet, signet, testnet, testnet4 unless settings.flushChainAllowUnsafeNetworks.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type | Description |
| --- | --- | --- |
| snapshotBlockHash | <code>string</code> | 64-char hex block hash to keep as the active tip. |

<a name="Bitcoin+_requestBlockAtHeight"></a>

### bitcoin.\_requestBlockAtHeight(height) ⇒ <code>Object</code>
Retrieve the equivalent to `getblockhash` from Bitcoin Core.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Returns**: <code>Object</code> - The block hash.  

| Param | Type | Description |
| --- | --- | --- |
| height | <code>Number</code> | Height of block to retrieve. |

<a name="Bitcoin+_createContractProposal"></a>

### bitcoin.\_createContractProposal(options) ⇒ <code>ContractProposal</code>
Creates an unsigned Bitcoin transaction.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Returns**: <code>ContractProposal</code> - Instance of the proposal.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | Options for the transaction. |

<a name="Bitcoin+_buildPSBT"></a>

### bitcoin.\_buildPSBT(options) ⇒ <code>PSBT</code>
Create a Partially-Signed Bitcoin Transaction (PSBT).
Vin/vout are BIP-69 sorted before they are added (unsigned construction only).

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Returns**: <code>PSBT</code> - Instance of the PSBT.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | Parameters for the PSBT. |

<a name="Bitcoin+_normalizeP2pPeerAddress"></a>

### bitcoin.\_normalizeP2pPeerAddress(peer) ⇒ <code>string</code> \| <code>null</code>
Normalize `host` or `host:port` for Bitcoin Core `addnode`.
IPv6 must use brackets: `[::1]:18444`. If port is omitted, the default P2P port for [settings.network](settings.network) is appended.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type |
| --- | --- |
| peer | <code>string</code> | 

<a name="Bitcoin+applyP2pAddNodes"></a>

### bitcoin.applyP2pAddNodes(peers, [command]) ⇒ <code>Promise.&lt;Array.&lt;string&gt;&gt;</code>
Connect to Bitcoin P2P peers via RPC (`addnode`). Best-effort per peer; failures emit `warning`.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Returns**: <code>Promise.&lt;Array.&lt;string&gt;&gt;</code> - Peers successfully passed to `addnode`  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| peers | <code>Array.&lt;string&gt;</code> |  |  |
| [command] | <code>string</code> | <code>&quot;&#x27;add&#x27;&quot;</code> | add | onetry | remove |

<a name="Bitcoin+_emitErrorSafe"></a>

### bitcoin.\_emitErrorSafe(msg) ⇒ <code>void</code>
Emit `error` only when a listener is present. Node's EventEmitter throws
`ERR_UNHANDLED_ERROR` otherwise, which mocha reports as a second `done()`.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type |
| --- | --- |
| msg | <code>\*</code> | 

<a name="Bitcoin+start"></a>

### bitcoin.start()
Start the Bitcoin service, including the initiation of outbound requests.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>start</code>](#Service+start)  
<a name="Bitcoin+stop"></a>

### bitcoin.stop()
Stop the Bitcoin service.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
<a name="Service+_appendWarning"></a>

### bitcoin.\_appendWarning(msg) ⇒ [<code>Service</code>](#Service)
**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>\_appendWarning</code>](#Service+_appendWarning)  
**Returns**: [<code>Service</code>](#Service) - This instance.  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>String</code> | Warning text (used by [Service#_registerService](Service#_registerService) duplicate guard). |

<a name="Service+init"></a>

### bitcoin.init()
Called by Web Components.
TODO: move to @fabric/http/types/spa

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>init</code>](#Service+init)  
<a name="Service+tick"></a>

### bitcoin.tick() ⇒ <code>Number</code>
Move forward one clock cycle.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>tick</code>](#Service+tick)  
<a name="Service+beat"></a>

### bitcoin.beat() ⇒ [<code>Service</code>](#Service)
Compute latest state.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>beat</code>](#Service+beat)  
**Emits**: <code>Message#event:beat</code>  
<a name="Service+get"></a>

### bitcoin.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>get</code>](#Service+get)  
**Returns**: <code>Mixed</code> - Returns the target value if found, otherwise null.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+set"></a>

### bitcoin.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>set</code>](#Service+set)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+trust"></a>

### bitcoin.trust(source) ⇒ [<code>Service</code>](#Service)
Explicitly trust all events from a known source.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>trust</code>](#Service+trust)  
**Returns**: [<code>Service</code>](#Service) - Instance of Service after binding events.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Emitter of events. |

<a name="Service+handler"></a>

### bitcoin.handler(message) ⇒ [<code>Service</code>](#Service)
Default route handler for an incoming message.  Follows the Activity
Streams 2.0 spec: https://www.w3.org/TR/activitystreams-core/

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>handler</code>](#Service+handler)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Activity</code> | Message object. |

<a name="Service+lock"></a>

### bitcoin.lock([duration]) ⇒ <code>Boolean</code>
Attempt to acquire a lock for `duration` seconds.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>lock</code>](#Service+lock)  
**Returns**: <code>Boolean</code> - true if locked, false if unable to lock.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [duration] | <code>Number</code> | <code>1000</code> | Number of milliseconds to hold lock. |

<a name="Service+when"></a>

### bitcoin.when(event, method) ⇒ <code>EventEmitter</code>
Bind a method to an event, with current state as the immutable context.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>when</code>](#Service+when)  
**Returns**: <code>EventEmitter</code> - Instance of EventEmitter.  

| Param | Type | Description |
| --- | --- | --- |
| event | <code>String</code> | Name of the event upon which to execute `method` as a function. |
| method | <code>function</code> | Function to execute when named [Event](Event) `event` is encountered. |

<a name="Service+defineOpcode"></a>

### bitcoin.defineOpcode(name, [definition]) ⇒ <code>Object</code>
Register a single opcode entry in the service registry.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>defineOpcode</code>](#Service+defineOpcode)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Opcode symbol (e.g. `OP_SHA256`, `P2P_FLUSH_CHAIN`) |
| [definition] | <code>Object</code> |  |

<a name="Service+defineBitcoinOpcode"></a>

### bitcoin.defineBitcoinOpcode(name, [definition]) ⇒ <code>Object</code>
Register Bitcoin-style primitive opcode metadata.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>defineBitcoinOpcode</code>](#Service+defineBitcoinOpcode)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineFabricOpcode"></a>

### bitcoin.defineFabricOpcode(name, [definition]) ⇒ <code>Object</code>
Register Fabric opcode metadata.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>defineFabricOpcode</code>](#Service+defineFabricOpcode)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineOpcodeContract"></a>

### bitcoin.defineOpcodeContract(name, body, [meta]) ⇒ <code>Object</code>
Register a newline-delimited opcode contract.
Contract body example:
`OP_DUP\nOP_HASH160\nP2P_FLUSH_CHAIN`

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>defineOpcodeContract</code>](#Service+defineOpcodeContract)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Contract label |
| body | <code>string</code> | Newline-delimited opcode list |
| [meta] | <code>Object</code> |  |

<a name="Service+listOpcodes"></a>

### bitcoin.listOpcodes() ⇒ <code>Array.&lt;Object&gt;</code>
Snapshot opcode registry for UI / API use.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>listOpcodes</code>](#Service+listOpcodes)  
<a name="Service+route"></a>

### bitcoin.route(msg) ⇒ <code>Promise</code>
Resolve a [State](#State) from a particular [Message](#Message) object.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>route</code>](#Service+route)  
**Returns**: <code>Promise</code> - Resolves with resulting [State](#State).  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | Explicit Fabric [Message](#Message). |

<a name="Service+_GET"></a>

### bitcoin.\_GET(path) ⇒ <code>Promise</code>
Retrieve a value from the Service's state.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>\_GET</code>](#Service+_GET)  
**Returns**: <code>Promise</code> - Resolves with the result.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path of the value to retrieve. |

<a name="Service+_PUT"></a>

### bitcoin.\_PUT(path, value, [commit]) ⇒ <code>Promise</code>
Store a value in the Service's state.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>\_PUT</code>](#Service+_PUT)  
**Returns**: <code>Promise</code> - Resolves with with stored document.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>String</code> |  | Path to store the value at. |
| value | <code>Object</code> |  | Document to store. |
| [commit] | <code>Boolean</code> | <code>false</code> | Sign the resulting state. |

<a name="Service+send"></a>

### bitcoin.send(channel, message) ⇒ [<code>Service</code>](#Service)
Send a message to a channel.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>send</code>](#Service+send)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| channel | <code>String</code> | Channel name to which the message will be sent. |
| message | <code>String</code> | Content of the message to send. |

<a name="Service+commit"></a>

### bitcoin.commit() ⇒ <code>String</code>
Record outstanding JSON Patch deltas and emit a compact commitment id.
Does **not** wrap [Service#state](Service#state) in a new [Actor](#Actor) — that
JSON-cloned the entire tree on every write/connect and OOMed Hub.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>commit</code>](#Service+commit)  
**Returns**: <code>String</code> - 32-byte commitment id  
<a name="Service+_registerActor"></a>

### bitcoin.\_registerActor(actor) ⇒ <code>Promise</code>
Register an [Actor](#Actor) with the [Service](#Service).

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>\_registerActor</code>](#Service+_registerActor)  
**Returns**: <code>Promise</code> - Resolves upon successful registration.  

| Param | Type | Description |
| --- | --- | --- |
| actor | <code>Object</code> | Instance of the [Actor](#Actor). |

<a name="Service+_send"></a>

### bitcoin.\_send(message)
Sends a message.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>\_send</code>](#Service+_send)  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Mixed</code> | Message to send. |

<a name="Actor+adopt"></a>

### bitcoin.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>adopt</code>](#Actor+adopt)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+export"></a>

### bitcoin.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>export</code>](#Actor+export)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### bitcoin.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>stream</code>](#Actor+stream)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### bitcoin.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>toBuffer</code>](#Actor+toBuffer)  
<a name="Actor+toGenericMessage"></a>

### bitcoin.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>toGenericMessage</code>](#Actor+toGenericMessage)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### bitcoin.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>toObject</code>](#Actor+toObject)  
<a name="Actor+pause"></a>

### bitcoin.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>pause</code>](#Actor+pause)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### bitcoin.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>serialize</code>](#Actor+serialize)  
<a name="Actor+sign"></a>

### bitcoin.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>sign</code>](#Actor+sign)  
<a name="Actor+unpause"></a>

### bitcoin.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>unpause</code>](#Actor+unpause)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### bitcoin.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>value</code>](#Actor+value)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### bitcoin.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>\_readObject</code>](#Actor+_readObject)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Bitcoin.bitcoindChainDataDirSegment"></a>

### Bitcoin.bitcoindChainDataDirSegment(network) ⇒ <code>string</code>
Bitcoin Core chain data subdirectory under {@code -datadir} (empty string for mainnet cookie at datadir root).
Matches Core layout: `regtest/`, `testnet3/`, `signet/`, `testnet4/`, or root for mainnet.

**Kind**: static method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type | Description |
| --- | --- | --- |
| network | <code>string</code> | Fabric network name (mainnet, testnet, regtest, signet, testnet4, playnet, …). |

<a name="Bitcoin.resolveBitcoinDatadirForLocalAccess"></a>

### Bitcoin.resolveBitcoinDatadirForLocalAccess(datadir) ⇒ <code>string</code> \| <code>null</code>
Resolve a configured bitcoind datadir for local cookie discovery. Relative paths are cwd-anchored
and must not escape the project root; absolute paths are normalized as-is.

**Kind**: static method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type |
| --- | --- |
| datadir | <code>string</code> | 

<a name="Bitcoin.resolveBitcoinCookieFileForLocalRead"></a>

### Bitcoin.resolveBitcoinCookieFileForLocalRead(filePath) ⇒ <code>string</code> \| <code>null</code>
Resolve {@code FABRIC_BITCOIN_COOKIE_FILE}-style paths: normalize, bound length, and keep relative paths
inside the process cwd (absolute paths allowed for explicit operator overrides).

**Kind**: static method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type |
| --- | --- |
| filePath | <code>string</code> | 

<a name="Bitcoin.tryReadRpcCookieFileCredentials"></a>

### Bitcoin.tryReadRpcCookieFileCredentials(cookiePath) ⇒ <code>Promise.&lt;({username: string, password: string}\|null)&gt;</code>
Read Bitcoin Core {@code .cookie} (user:password) using async I/O. Path must already be resolved/normalized.

**Kind**: static method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type |
| --- | --- |
| cookiePath | <code>string</code> | 

<a name="Bitcoin.cookiePathForBitcoind"></a>

### Bitcoin.cookiePathForBitcoind(datadirRoot, network) ⇒ <code>string</code>
`.cookie` path under a resolved bitcoind datadir root for the given Fabric network.

**Kind**: static method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type | Description |
| --- | --- | --- |
| datadirRoot | <code>string</code> | Absolute or project-relative resolved datadir (Core {@code -datadir} value). |
| network | <code>string</code> |  |

<a name="Bitcoin.cookiePathForChainSubtree"></a>

### Bitcoin.cookiePathForChainSubtree(datadirRoot, chainSubdir) ⇒ <code>string</code>
Cookie file under explicit chain subdirectory (empty string = mainnet-style datadir/.cookie only).
Prefer [#cookiePathForBitcoind](#cookiePathForBitcoind) when you have a Fabric network name.

**Kind**: static method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type | Description |
| --- | --- | --- |
| datadirRoot | <code>string</code> |  |
| chainSubdir | <code>string</code> | e.g. `regtest`, `signet`, or `''` |

<a name="Bitcoin.defaultStoresRelativeDirsForProbe"></a>

### Bitcoin.defaultStoresRelativeDirsForProbe(network, [constraints]) ⇒ <code>Array.&lt;string&gt;</code>
Typical `stores/…` paths under the project for the network (for cookie discovery before node spawn).

**Kind**: static method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type |
| --- | --- |
| network | <code>string</code> | 
| [constraints] | [<code>BitcoinCookieProbeConstraints</code>](#BitcoinCookieProbeConstraints) | 

<a name="Bitcoin.buildLocalCookieProbePaths"></a>

### Bitcoin.buildLocalCookieProbePaths(opts) ⇒ <code>Array.&lt;string&gt;</code>
Ordered local cookie paths to probe for RPC (env override, project stores, Electron mirror, ~/.bitcoin, optional settings datadir).

**Kind**: static method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type |
| --- | --- |
| opts | [<code>BitcoinLocalCookieProbeOpts</code>](#BitcoinLocalCookieProbeOpts) | 

<a name="Bitcoin.parentDirNameForCookieProbe"></a>

### Bitcoin.parentDirNameForCookieProbe(cookiePath) ⇒ <code>string</code>
Parent directory name of `.cookie` (for probe logging).

**Kind**: static method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type |
| --- | --- |
| cookiePath | <code>string</code> | 

<a name="Bitcoin.buildRegtestCookiePathList"></a>

### ~~Bitcoin.buildRegtestCookiePathList(opts) ⇒ <code>Array.&lt;string&gt;</code>~~
***Use [#buildLocalCookieProbePaths](#buildLocalCookieProbePaths) with `network: 'regtest'`.***

**Kind**: static method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type |
| --- | --- |
| opts | [<code>BitcoinRegtestCookieOpts</code>](#BitcoinRegtestCookieOpts) | 

<a name="Lightning"></a>

## Lightning
Manage a Lightning node (Core Lightning JSON-RPC over Unix socket).

BOLT checklist: `docs/BOLT_COMPATIBILITY.md`. RPC map: `docs/LIGHTNING_COMPAT.md`.

**Kind**: global class  
**See**: Lightning.DOCS  

* [Lightning](#Lightning)
    * [new Lightning([settings])](#new_Lightning_new)
    * _instance_
        * [.rpc](#Lightning+rpc)
        * [.createChannel(peer, amount, [pushMsat], [options])](#Lightning+createChannel)
        * [.createInvoice(amount, [label], [description], [options])](#Lightning+createInvoice)
        * [.callRpc(method, [params], [timeoutMs])](#Lightning+callRpc) ⇒ <code>Promise.&lt;\*&gt;</code>
        * [.decodeLightning(boltString)](#Lightning+decodeLightning) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.decodePay(bolt11)](#Lightning+decodePay) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.createOffer(params)](#Lightning+createOffer) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.fetchInvoice(offerOrParams, [invoiceParams])](#Lightning+fetchInvoice) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.pay(invoiceOrParams, [timeoutMs])](#Lightning+pay) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.listOffers([filter])](#Lightning+listOffers) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.disableOffer(offerId)](#Lightning+disableOffer) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.createInvoiceRequest(params)](#Lightning+createInvoiceRequest) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.listInvoiceRequests([filter])](#Lightning+listInvoiceRequests) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.disableInvoiceRequest(invreqId)](#Lightning+disableInvoiceRequest) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.sendInvoice(params)](#Lightning+sendInvoice) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.getRoute(destinationId, amountMsat, [riskfactor], [cltvOrRouteOptions])](#Lightning+getRoute) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.computeLiquidity()](#Lightning+computeLiquidity) ⇒ <code>Object</code>
        * [._makeRPCRequest(method, [params], [timeoutMs])](#Lightning+_makeRPCRequest) ⇒ <code>Object</code> \| <code>String</code>
    * _static_
        * [.CLN_RPC_METHODS](#Lightning.CLN_RPC_METHODS) : <code>ReadonlyArray.&lt;string&gt;</code>
        * [.DOCS](#Lightning.DOCS) : <code>Readonly.&lt;{boltCompatibility: string, fabricLightningOffers: string, fabricLightningMarkets: string, fabricPaymentBech32: string, lightningCompat: string}&gt;</code>
        * [.defaultListenPortForNetwork([network])](#Lightning.defaultListenPortForNetwork) ⇒ <code>number</code>

<a name="new_Lightning_new"></a>

### new Lightning([settings])
Create an instance of the Lightning [Service](#Service).


| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Settings. |

<a name="Lightning+rpc"></a>

### lightning.rpc
Optional RPC client handle (e.g. REST/grpc); not used by Core Lightning socket `_makeRPCRequest`.

**Kind**: instance property of [<code>Lightning</code>](#Lightning)  
<a name="Lightning+createChannel"></a>

### lightning.createChannel(peer, amount, [pushMsat], [options])
Creates a new Lightning channel.

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| peer | <code>String</code> |  | Public key of the peer to create a channel with. |
| amount | <code>String</code> |  | Amount in satoshis to fund the channel. |
| [pushMsat] | <code>Number</code> \| <code>null</code> | <code></code> | Optional push amount in millisatoshis. |
| [options] | <code>Object</code> | <code>{}</code> | Optional overrides (e.g. minconf for regtest). |

<a name="Lightning+createInvoice"></a>

### lightning.createInvoice(amount, [label], [description], [options])
Create a new Lightning invoice.

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| amount | <code>String</code> |  | Amount in millisatoshi (msat). |
| [label] | <code>String</code> | <code>Generic Invoice</code> |  |
| [description] | <code>String</code> | <code>Generic description.</code> |  |
| [options] | <code>Object</code> |  |  |
| [options.preimage] | <code>String</code> |  | 32-byte hex preimage to lock the invoice to (swaps: the HTLC hash must match) |
| [options.expiry] | <code>Number</code> |  | seconds until the invoice expires |

<a name="Lightning+callRpc"></a>

### lightning.callRpc(method, [params], [timeoutMs]) ⇒ <code>Promise.&lt;\*&gt;</code>
Invoke any Core Lightning JSON-RPC method over the lightningd socket (escape hatch for methods without a typed wrapper).
Named `callRpc` so it does not shadow the `rpc` instance property.

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  
**Returns**: <code>Promise.&lt;\*&gt;</code> - RPC result.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| method | <code>String</code> |  | RPC method name (e.g. `listpeers`). |
| [params] | <code>Array</code> | <code>[]</code> | Positional/object params as accepted by lightningd for that method. |
| [timeoutMs] | <code>Number</code> | <code>30000</code> | Optional timeout. |

<a name="Lightning+decodeLightning"></a>

### lightning.decodeLightning(boltString) ⇒ <code>Promise.&lt;Object&gt;</code>
Decode a BOLT11 invoice or BOLT12 offer string (Core Lightning `decode`).

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - Decoded fields.  

| Param | Type | Description |
| --- | --- | --- |
| boltString | <code>String</code> | `lnbc...`, `lno1...`, etc. |

<a name="Lightning+decodePay"></a>

### lightning.decodePay(bolt11) ⇒ <code>Promise.&lt;Object&gt;</code>
Decode a BOLT11 invoice for payment fields (Core Lightning `decodepay`).

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - Decoded pay details.  

| Param | Type |
| --- | --- |
| bolt11 | <code>String</code> | 

<a name="Lightning+createOffer"></a>

### lightning.createOffer(params) ⇒ <code>Promise.&lt;Object&gt;</code>
Create a BOLT12 offer (requires `experimental-offers` / modern CLN). Pass-through to `offer`.

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - Offer result (includes `bolt12` / offer id per CLN version).  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | Keyword args, e.g. `{ amount_msat, description, label, issuer, ... }`. |

<a name="Lightning+fetchInvoice"></a>

### lightning.fetchInvoice(offerOrParams, [invoiceParams]) ⇒ <code>Promise.&lt;Object&gt;</code>
Request a BOLT11 invoice from a BOLT12 offer (Core Lightning `fetchinvoice`).

Call either:
- `fetchInvoice('lno1…')` or `fetchInvoice('lno1…', { amount_msat, quantity, payer_note, timeout, … })`
- **Recurrence** (when the offer is recurring): `recurrence_counter` (start at 0), `recurrence_start`, `recurrence_label` (stable label linking the series; required when counter is set). See Core Lightning **`fetchinvoice`** and [BOLT #12](https://github.com/lightning/bolts/blob/master/12-offer-encoding.md).
- `fetchInvoice({ offer: 'lno1…', amount_msat, … })` — single keyword object as accepted by CLN.

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - Invoice response (includes `invoice` bolt11 when successful).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| offerOrParams | <code>String</code> \| <code>Object</code> |  | Bolt12 offer string (`lno1…`), or one params object with an `offer` field. |
| [invoiceParams] | <code>Object</code> | <code></code> | When the first arg is a string, optional extra fields merged into the RPC (second positional group). |

<a name="Lightning+pay"></a>

### lightning.pay(invoiceOrParams, [timeoutMs]) ⇒ <code>Promise.&lt;Object&gt;</code>
Pay a BOLT11 invoice or BOLT12-fetched bolt11 string (Core Lightning `pay`).

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - Payment result; `paymentPreimage` mirrors CLN `payment_preimage`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| invoiceOrParams | <code>String</code> \| <code>Object</code> |  | Bolt11 string, or keyword object (e.g. `{ bolt11 }`, `{ bolt12 }` per CLN). |
| [timeoutMs] | <code>Number</code> | <code>30000</code> |  |

<a name="Lightning+listOffers"></a>

### lightning.listOffers([filter]) ⇒ <code>Promise.&lt;Object&gt;</code>
List offers created on this node (Core Lightning `listoffers`).

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [filter] | <code>String</code> \| <code>Object</code> \| <code>null</code> | <code></code> | `offer_id` string, or `{ offer_id?, active_only? }`, or null for all. |

<a name="Lightning+disableOffer"></a>

### lightning.disableOffer(offerId) ⇒ <code>Promise.&lt;Object&gt;</code>
Disable a local offer by id (Core Lightning `disableoffer`).

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  

| Param | Type |
| --- | --- |
| offerId | <code>String</code> | 

<a name="Lightning+createInvoiceRequest"></a>

### lightning.createInvoiceRequest(params) ⇒ <code>Promise.&lt;Object&gt;</code>
Create a BOLT12 `invoice_request` (you request that someone else pay you via their offer flow). Returns `bolt12` (`lnr1…`). (Core Lightning `invoicerequest`, v22.11+.)

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | `{ amount, description, issuer?, label?, absolute_expiry?, single_use? }` — see CLN docs for amount formats. |

<a name="Lightning+listInvoiceRequests"></a>

### lightning.listInvoiceRequests([filter]) ⇒ <code>Promise.&lt;Object&gt;</code>
List `invoice_request` records (Core Lightning `listinvoicerequests`).

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [filter] | <code>String</code> \| <code>Object</code> \| <code>null</code> | <code></code> | `invreq_id` string, or `{ invreq_id?, active_only? }`, or null for all. |

<a name="Lightning+disableInvoiceRequest"></a>

### lightning.disableInvoiceRequest(invreqId) ⇒ <code>Promise.&lt;Object&gt;</code>
Disable an `invoice_request` so no further invoices are accepted (Core Lightning `disableinvoicerequest`).

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  

| Param | Type |
| --- | --- |
| invreqId | <code>String</code> | 

<a name="Lightning+sendInvoice"></a>

### lightning.sendInvoice(params) ⇒ <code>Promise.&lt;Object&gt;</code>
Create and send a BOLT12 invoice to the issuer of an `invoice_request` (Core Lightning `sendinvoice`).

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | `{ invreq, label, amount_msat?, timeout?, quantity? }` — `invreq` is the `lnr1…` string. |

<a name="Lightning+getRoute"></a>

### lightning.getRoute(destinationId, amountMsat, [riskfactor], [cltvOrRouteOptions]) ⇒ <code>Promise.&lt;Object&gt;</code>
Route probe (Core Lightning `getroute`).
CLN order: `id`, `amount_msat`, `riskfactor`, `cltv`, `fromid`, `fuzzpercent`, `exclude`, `maxhops`
— the fourth **positional** is `cltv`, not `maxhops`. To set `maxhops` (or other tail fields) use the
`routeOptions` object so intermediate slots are sent as `null` where needed.

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| destinationId | <code>String</code> |  | Destination node id (pubkey). |
| amountMsat | <code>Number</code> \| <code>String</code> |  |  |
| [riskfactor] | <code>Number</code> | <code>10</code> |  |
| [cltvOrRouteOptions] | <code>Number</code> \| <code>Object</code> \| <code>null</code> | <code></code> | Omitted: three-arg RPC. If a number: fourth positional (`cltv`).   If an object: tail fields `cltv`, `fromid`, `fuzzpercent`, `exclude`, `maxhops` (each optional). |

<a name="Lightning+computeLiquidity"></a>

### lightning.computeLiquidity() ⇒ <code>Object</code>
Computes the total liquidity of the Lightning node.

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  
**Returns**: <code>Object</code> - Liquidity in BTC.  
<a name="Lightning+_makeRPCRequest"></a>

### lightning.\_makeRPCRequest(method, [params], [timeoutMs]) ⇒ <code>Object</code> \| <code>String</code>
Make an RPC request through the Lightning UNIX socket.

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  
**Returns**: <code>Object</code> \| <code>String</code> - Respond from the Lightning node.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| method | <code>String</code> |  | Name of method to call. |
| [params] | <code>Array</code> |  | Array of parameters. |
| [timeoutMs] | <code>Number</code> | <code>30000</code> | Optional timeout in ms; default 30000. Prevents hanging when lightningd is busy. |

<a name="Lightning.CLN_RPC_METHODS"></a>

### Lightning.CLN\_RPC\_METHODS : <code>ReadonlyArray.&lt;string&gt;</code>
Core Lightning JSON-RPC method names invoked by this service (see docs/LIGHTNING_COMPAT.md).

**Kind**: static property of [<code>Lightning</code>](#Lightning)  
<a name="Lightning.DOCS"></a>

### Lightning.DOCS : <code>Readonly.&lt;{boltCompatibility: string, fabricLightningOffers: string, fabricLightningMarkets: string, fabricPaymentBech32: string, lightningCompat: string}&gt;</code>
Paths to canonical Markdown docs (relative to the `@fabric/core` package root).
`fabricLightningMarkets` and `fabricLightningOffers` point at the same file (Fabric **markets** vs Lightning BOLT12 **offers**).

**Kind**: static property of [<code>Lightning</code>](#Lightning)  
<a name="Lightning.defaultListenPortForNetwork"></a>

### Lightning.defaultListenPortForNetwork([network]) ⇒ <code>number</code>
Default TCP port lightningd listens on when [settings.port](settings.port) is omitted (BOLT / common conventions).

**Kind**: static method of [<code>Lightning</code>](#Lightning)  

| Param | Type |
| --- | --- |
| [network] | <code>string</code> | 

<a name="Market"></a>

## Market
**Kind**: global class  

* [Market](#Market)
    * [new Market([settings])](#new_Market_new)
    * [.attach(deps)](#Market+attach) ⇒ [<code>Market</code>](#Market)
    * [.setBudget(sats)](#Market+setBudget) ⇒ [<code>Market</code>](#Market)
    * [.want(documentId, [opts])](#Market+want) ⇒ <code>Object</code>
    * [.forget(documentId)](#Market+forget) ⇒ <code>boolean</code>
    * [.listWants()](#Market+listWants) ⇒ <code>Array.&lt;Object&gt;</code>
    * [.listSessions()](#Market+listSessions) ⇒ <code>Array.&lt;Object&gt;</code>
    * [.status()](#Market+status) ⇒ <code>Object</code>
    * [.weights()](#Market+weights) ⇒ <code>Object</code>
    * [.planCap(want)](#Market+planCap) ⇒ <code>number</code>
    * [.planFor(want)](#Market+planFor) ⇒ <code>Object</code>
    * [.start()](#Market+start) ⇒ [<code>Promise.&lt;Market&gt;</code>](#Market)
    * [.stop()](#Market+stop) ⇒ [<code>Promise.&lt;Market&gt;</code>](#Market)
    * [.tick()](#Market+tick) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.buyerRefundPubkeyHex()](#Market+buyerRefundPubkeyHex) ⇒ <code>string</code> \| <code>null</code>
    * [.purchasePlan(want, planned)](#Market+purchasePlan) ⇒ <code>Promise.&lt;Array.&lt;Object&gt;&gt;</code>
    * [.openSession(want, offer, blobIndex, blobTotal)](#Market+openSession) ⇒ <code>Object</code> \| <code>null</code>
    * [.confirm(settlementId, [txid])](#Market+confirm) ⇒ <code>Object</code>
    * [.export()](#Market+export) ⇒ <code>Object</code>
    * [.import(snapshot)](#Market+import) ⇒ [<code>Market</code>](#Market)

<a name="new_Market_new"></a>

### new Market([settings])

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  |  |
| [settings.budgetSats] | <code>number</code> | <code>0</code> | Total sats this agent may spend. |
| [settings.perPlanMaxSats] | <code>number</code> | <code>0</code> | Cap per document plan (0 = only the budget caps). |
| [settings.proximityWeight] | <code>number</code> | <code>0.5</code> | 0 = cheapest wins, 1 = nearest / fastest wins. |
| [settings.tickMs] | <code>number</code> | <code>15000</code> | Scheduler interval (0 = manual `tick()` only). |
| [settings.inventoryEveryMs] | <code>number</code> | <code>30000</code> | Minimum spacing between inventory refreshes per want. |
| [settings.deliveryTimeoutMs] | <code>number</code> | <code>600000</code> | Confirmed sessions without delivery fail after this (0 = never). |
| [settings.network] | <code>string</code> | <code>&quot;&#x27;regtest&#x27;&quot;</code> | Bitcoin network for HTLC construction (mainnet refused). |
| [settings.book] | <code>Object</code> |  | `Book` settings. |

<a name="Market+attach"></a>

### market.attach(deps) ⇒ [<code>Market</code>](#Market)
**Kind**: instance method of [<code>Market</code>](#Market)  

| Param | Type | Description |
| --- | --- | --- |
| deps | <code>Object</code> |  |
| deps.peer | <code>Object</code> | `@fabric/core` Peer (inventory, requests, delivery events). |
| [deps.book] | [<code>Book</code>](#Book) | shared offer book (defaults to the agent's own). |
| [deps.pay] | <code>function</code> | `async (session) => txid|null` — funds the session HTLC address. |
| [deps.verify] | <code>function</code> | `async (session, txid) => boolean` — L1 / Hub payment proof. |

<a name="Market+setBudget"></a>

### market.setBudget(sats) ⇒ [<code>Market</code>](#Market)
**Kind**: instance method of [<code>Market</code>](#Market)  

| Param | Type |
| --- | --- |
| sats | <code>number</code> | 

<a name="Market+want"></a>

### market.want(documentId, [opts]) ⇒ <code>Object</code>
Register a document to acquire.

**Kind**: instance method of [<code>Market</code>](#Market)  
**Returns**: <code>Object</code> - want record  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>string</code> |  |
| [opts] | <code>Object</code> |  |
| [opts.blobTotal] | <code>number</code> | Known blob count (else the first offer's). |
| [opts.merkleRootHex] | <code>string</code> | Tree root selector for inventory + plans. |
| [opts.maxSats] | <code>number</code> | Per-document cap (defaults to `perPlanMaxSats`). |

<a name="Market+forget"></a>

### market.forget(documentId) ⇒ <code>boolean</code>
**Kind**: instance method of [<code>Market</code>](#Market)  

| Param | Type |
| --- | --- |
| documentId | <code>string</code> | 

<a name="Market+listWants"></a>

### market.listWants() ⇒ <code>Array.&lt;Object&gt;</code>
**Kind**: instance method of [<code>Market</code>](#Market)  
<a name="Market+listSessions"></a>

### market.listSessions() ⇒ <code>Array.&lt;Object&gt;</code>
**Kind**: instance method of [<code>Market</code>](#Market)  
<a name="Market+status"></a>

### market.status() ⇒ <code>Object</code>
**Kind**: instance method of [<code>Market</code>](#Market)  
**Returns**: <code>Object</code> - status summary (safe to expose over HTTP).  
<a name="Market+weights"></a>

### market.weights() ⇒ <code>Object</code>
**Kind**: instance method of [<code>Market</code>](#Market)  
**Returns**: <code>Object</code> - offer-book weights derived from `proximityWeight`.  
<a name="Market+planCap"></a>

### market.planCap(want) ⇒ <code>number</code>
Cap for one document plan: min(perPlanMaxSats, want.maxSats, remaining budget).

**Kind**: instance method of [<code>Market</code>](#Market)  

| Param | Type |
| --- | --- |
| want | <code>Object</code> | 

<a name="Market+planFor"></a>

### market.planFor(want) ⇒ <code>Object</code>
Build the blob plan for a want without spending anything.

**Kind**: instance method of [<code>Market</code>](#Market)  

| Param | Type |
| --- | --- |
| want | <code>Object</code> | 

<a name="Market+start"></a>

### market.start() ⇒ [<code>Promise.&lt;Market&gt;</code>](#Market)
Start the agent: mark `running` and arm the periodic `tick` when `tickMs > 0`.

**Kind**: instance method of [<code>Market</code>](#Market)  
<a name="Market+stop"></a>

### market.stop() ⇒ [<code>Promise.&lt;Market&gt;</code>](#Market)
Stop the agent: clear the tick timer and detach peer / channel listeners.

**Kind**: instance method of [<code>Market</code>](#Market)  
<a name="Market+tick"></a>

### market.tick() ⇒ <code>Promise.&lt;Object&gt;</code>
One scheduler pass: refresh inventories, plan, purchase within budget.

**Kind**: instance method of [<code>Market</code>](#Market)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - summary `{ planned, opened, skipped }`  
<a name="Market+buyerRefundPubkeyHex"></a>

### market.buyerRefundPubkeyHex() ⇒ <code>string</code> \| <code>null</code>
**Kind**: instance method of [<code>Market</code>](#Market)  
**Returns**: <code>string</code> \| <code>null</code> - compressed buyer refund key (Peer identity).  
<a name="Market+purchasePlan"></a>

### market.purchasePlan(want, planned) ⇒ <code>Promise.&lt;Array.&lt;Object&gt;&gt;</code>
Open, fund, confirm, and request every blob in a plan.

**Kind**: instance method of [<code>Market</code>](#Market)  
**Returns**: <code>Promise.&lt;Array.&lt;Object&gt;&gt;</code> - opened sessions  

| Param | Type |
| --- | --- |
| want | <code>Object</code> | 
| planned | <code>Object</code> | 

<a name="Market+openSession"></a>

### market.openSession(want, offer, blobIndex, blobTotal) ⇒ <code>Object</code> \| <code>null</code>
One purchase session for one blob (one HTLC per seller per blob).

**Kind**: instance method of [<code>Market</code>](#Market)  

| Param | Type |
| --- | --- |
| want | <code>Object</code> | 
| offer | <code>Object</code> | 
| blobIndex | <code>number</code> | 
| blobTotal | <code>number</code> | 

<a name="Market+confirm"></a>

### market.confirm(settlementId, [txid]) ⇒ <code>Object</code>
Mark a session funded and request delivery.

**Kind**: instance method of [<code>Market</code>](#Market)  
**Returns**: <code>Object</code> - session  

| Param | Type | Default |
| --- | --- | --- |
| settlementId | <code>string</code> |  | 
| [txid] | <code>string</code> \| <code>null</code> | <code>null</code> | 

<a name="Market+export"></a>

### market.export() ⇒ <code>Object</code>
**Kind**: instance method of [<code>Market</code>](#Market)  
**Returns**: <code>Object</code> - JSON-safe snapshot including offer-book telemetry.  
<a name="Market+import"></a>

### market.import(snapshot) ⇒ [<code>Market</code>](#Market)
**Kind**: instance method of [<code>Market</code>](#Market)  

| Param | Type | Description |
| --- | --- | --- |
| snapshot | <code>Object</code> | output of `export()` |

<a name="Redis"></a>

## Redis
Connect and subscribe to Redis servers (node-redis v6).

**Kind**: global class  

* [Redis](#Redis)
    * [new Redis([settings])](#new_Redis_new)
    * [.start()](#Redis+start) ⇒ [<code>Promise.&lt;Redis&gt;</code>](#Redis)
    * [.stop()](#Redis+stop) ⇒ [<code>Promise.&lt;Redis&gt;</code>](#Redis)
    * [.subscribe(name)](#Redis+subscribe) ⇒ <code>Promise.&lt;void&gt;</code>

<a name="new_Redis_new"></a>

### new Redis([settings])
Creates an instance of a Redis subscriber.

**Returns**: [<code>Redis</code>](#Redis) - Instance of the Redis service, ready to run `start()`  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Settings for the Redis connection. |
| [settings.host] | <code>String</code> | Host for the Redis server. |
| [settings.port] | <code>Number</code> | Remote Redis service port. |
| [settings.url] | <code>String</code> | Optional redis URL (overrides host/port). |

<a name="Redis+start"></a>

### redis.start() ⇒ [<code>Promise.&lt;Redis&gt;</code>](#Redis)
Opens the connection and subscribes to the requested channels.

**Kind**: instance method of [<code>Redis</code>](#Redis)  
<a name="Redis+stop"></a>

### redis.stop() ⇒ [<code>Promise.&lt;Redis&gt;</code>](#Redis)
Closes the connection to the Redis server.

**Kind**: instance method of [<code>Redis</code>](#Redis)  
<a name="Redis+subscribe"></a>

### redis.subscribe(name) ⇒ <code>Promise.&lt;void&gt;</code>
**Kind**: instance method of [<code>Redis</code>](#Redis)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Channel name |

<a name="Text"></a>

## Text ⇐ [<code>Service</code>](#Service)
**Kind**: global class  
**Extends**: [<code>Service</code>](#Service)  

* [Text](#Text) ⇐ [<code>Service</code>](#Service)
    * [new Text()](#new_Text_new)
    * _instance_
        * [._appendWarning(msg)](#Service+_appendWarning) ⇒ [<code>Service</code>](#Service)
        * [.init()](#Service+init)
        * [.tick()](#Service+tick) ⇒ <code>Number</code>
        * [.beat()](#Service+beat) ⇒ [<code>Service</code>](#Service)
        * [.get(path)](#Service+get) ⇒ <code>Mixed</code>
        * [.set(path)](#Service+set) ⇒ <code>Mixed</code>
        * [.trust(source)](#Service+trust) ⇒ [<code>Service</code>](#Service)
        * [.handler(message)](#Service+handler) ⇒ [<code>Service</code>](#Service)
        * [.lock([duration])](#Service+lock) ⇒ <code>Boolean</code>
        * [.when(event, method)](#Service+when) ⇒ <code>EventEmitter</code>
        * [.defineOpcode(name, [definition])](#Service+defineOpcode) ⇒ <code>Object</code>
        * [.defineBitcoinOpcode(name, [definition])](#Service+defineBitcoinOpcode) ⇒ <code>Object</code>
        * [.defineFabricOpcode(name, [definition])](#Service+defineFabricOpcode) ⇒ <code>Object</code>
        * [.defineOpcodeContract(name, body, [meta])](#Service+defineOpcodeContract) ⇒ <code>Object</code>
        * [.listOpcodes()](#Service+listOpcodes) ⇒ <code>Array.&lt;Object&gt;</code>
        * [.route(msg)](#Service+route) ⇒ <code>Promise</code>
        * [.start()](#Service+start)
        * [._GET(path)](#Service+_GET) ⇒ <code>Promise</code>
        * [._PUT(path, value, [commit])](#Service+_PUT) ⇒ <code>Promise</code>
        * [.connect(notify)](#Service+connect) ⇒ <code>Promise</code>
        * [.send(channel, message)](#Service+send) ⇒ [<code>Service</code>](#Service)
        * [.commit()](#Service+commit) ⇒ <code>String</code>
        * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
        * [._send(message)](#Service+_send)
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * [.tokenize(string)](#Text.tokenize) ⇒ <code>Array.&lt;string&gt;</code>
        * [.truncateMiddle(fullStr, strLen, [separator])](#Text.truncateMiddle) ⇒ <code>string</code>
        * [.toRelativeTime(date)](#Text.toRelativeTime) ⇒ <code>string</code>
        * [.oxfordJoin(list)](#Text.oxfordJoin) ⇒ <code>string</code>

<a name="new_Text_new"></a>

### new Text()
Text-oriented [Service](#Service) stub (legacy name was <code>TXT</code>).
Static helpers for common text formatting (tokenize, middle truncation,
relative time strings) and core helpers ([module:functions/oxfordJoin](module:functions/oxfordJoin)).

<a name="Service+_appendWarning"></a>

### text.\_appendWarning(msg) ⇒ [<code>Service</code>](#Service)
**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: [<code>Service</code>](#Service) - This instance.  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>String</code> | Warning text (used by [Service#_registerService](Service#_registerService) duplicate guard). |

<a name="Service+init"></a>

### text.init()
Called by Web Components.
TODO: move to @fabric/http/types/spa

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Service+tick"></a>

### text.tick() ⇒ <code>Number</code>
Move forward one clock cycle.

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Service+beat"></a>

### text.beat() ⇒ [<code>Service</code>](#Service)
Compute latest state.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Emits**: <code>Message#event:beat</code>  
<a name="Service+get"></a>

### text.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Mixed</code> - Returns the target value if found, otherwise null.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+set"></a>

### text.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Text</code>](#Text)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+trust"></a>

### text.trust(source) ⇒ [<code>Service</code>](#Service)
Explicitly trust all events from a known source.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: [<code>Service</code>](#Service) - Instance of Service after binding events.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Emitter of events. |

<a name="Service+handler"></a>

### text.handler(message) ⇒ [<code>Service</code>](#Service)
Default route handler for an incoming message.  Follows the Activity
Streams 2.0 spec: https://www.w3.org/TR/activitystreams-core/

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Activity</code> | Message object. |

<a name="Service+lock"></a>

### text.lock([duration]) ⇒ <code>Boolean</code>
Attempt to acquire a lock for `duration` seconds.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Boolean</code> - true if locked, false if unable to lock.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [duration] | <code>Number</code> | <code>1000</code> | Number of milliseconds to hold lock. |

<a name="Service+when"></a>

### text.when(event, method) ⇒ <code>EventEmitter</code>
Bind a method to an event, with current state as the immutable context.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>EventEmitter</code> - Instance of EventEmitter.  

| Param | Type | Description |
| --- | --- | --- |
| event | <code>String</code> | Name of the event upon which to execute `method` as a function. |
| method | <code>function</code> | Function to execute when named [Event](Event) `event` is encountered. |

<a name="Service+defineOpcode"></a>

### text.defineOpcode(name, [definition]) ⇒ <code>Object</code>
Register a single opcode entry in the service registry.

**Kind**: instance method of [<code>Text</code>](#Text)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Opcode symbol (e.g. `OP_SHA256`, `P2P_FLUSH_CHAIN`) |
| [definition] | <code>Object</code> |  |

<a name="Service+defineBitcoinOpcode"></a>

### text.defineBitcoinOpcode(name, [definition]) ⇒ <code>Object</code>
Register Bitcoin-style primitive opcode metadata.

**Kind**: instance method of [<code>Text</code>](#Text)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineFabricOpcode"></a>

### text.defineFabricOpcode(name, [definition]) ⇒ <code>Object</code>
Register Fabric opcode metadata.

**Kind**: instance method of [<code>Text</code>](#Text)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineOpcodeContract"></a>

### text.defineOpcodeContract(name, body, [meta]) ⇒ <code>Object</code>
Register a newline-delimited opcode contract.
Contract body example:
`OP_DUP\nOP_HASH160\nP2P_FLUSH_CHAIN`

**Kind**: instance method of [<code>Text</code>](#Text)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Contract label |
| body | <code>string</code> | Newline-delimited opcode list |
| [meta] | <code>Object</code> |  |

<a name="Service+listOpcodes"></a>

### text.listOpcodes() ⇒ <code>Array.&lt;Object&gt;</code>
Snapshot opcode registry for UI / API use.

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Service+route"></a>

### text.route(msg) ⇒ <code>Promise</code>
Resolve a [State](#State) from a particular [Message](#Message) object.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Promise</code> - Resolves with resulting [State](#State).  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | Explicit Fabric [Message](#Message). |

<a name="Service+start"></a>

### text.start()
Start the service, including the initiation of an outbound connection
to any peers designated in the service's configuration.

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Service+_GET"></a>

### text.\_GET(path) ⇒ <code>Promise</code>
Retrieve a value from the Service's state.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Promise</code> - Resolves with the result.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path of the value to retrieve. |

<a name="Service+_PUT"></a>

### text.\_PUT(path, value, [commit]) ⇒ <code>Promise</code>
Store a value in the Service's state.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Promise</code> - Resolves with with stored document.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>String</code> |  | Path to store the value at. |
| value | <code>Object</code> |  | Document to store. |
| [commit] | <code>Boolean</code> | <code>false</code> | Sign the resulting state. |

<a name="Service+connect"></a>

### text.connect(notify) ⇒ <code>Promise</code>
Attach to network.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Promise</code> - Resolves to [Fabric](#Fabric).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| notify | <code>Boolean</code> | <code>true</code> | Commit to changes. |

<a name="Service+send"></a>

### text.send(channel, message) ⇒ [<code>Service</code>](#Service)
Send a message to a channel.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| channel | <code>String</code> | Channel name to which the message will be sent. |
| message | <code>String</code> | Content of the message to send. |

<a name="Service+commit"></a>

### text.commit() ⇒ <code>String</code>
Record outstanding JSON Patch deltas and emit a compact commitment id.
Does **not** wrap [Service#state](Service#state) in a new [Actor](#Actor) — that
JSON-cloned the entire tree on every write/connect and OOMed Hub.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>String</code> - 32-byte commitment id  
<a name="Service+_registerActor"></a>

### text.\_registerActor(actor) ⇒ <code>Promise</code>
Register an [Actor](#Actor) with the [Service](#Service).

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Promise</code> - Resolves upon successful registration.  

| Param | Type | Description |
| --- | --- | --- |
| actor | <code>Object</code> | Instance of the [Actor](#Actor). |

<a name="Service+_send"></a>

### text.\_send(message)
Sends a message.

**Kind**: instance method of [<code>Text</code>](#Text)  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Mixed</code> | Message to send. |

<a name="Actor+adopt"></a>

### text.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+export"></a>

### text.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### text.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### text.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Actor+toGenericMessage"></a>

### text.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### text.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Actor+pause"></a>

### text.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### text.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Actor+sign"></a>

### text.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Actor+unpause"></a>

### text.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### text.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### text.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Text.tokenize"></a>

### Text.tokenize(string) ⇒ <code>Array.&lt;string&gt;</code>
Split on runs of whitespace.

**Kind**: static method of [<code>Text</code>](#Text)  

| Param | Type |
| --- | --- |
| string | <code>string</code> | 

<a name="Text.truncateMiddle"></a>

### Text.truncateMiddle(fullStr, strLen, [separator]) ⇒ <code>string</code>
Shorten a string in the middle if longer than <code>strLen</code>.

**Kind**: static method of [<code>Text</code>](#Text)  

| Param | Type |
| --- | --- |
| fullStr | <code>string</code> | 
| strLen | <code>number</code> | 
| [separator] | <code>string</code> | 

<a name="Text.toRelativeTime"></a>

### Text.toRelativeTime(date) ⇒ <code>string</code>
Human-readable relative time (e.g. <code>3 days ago</code>).

**Kind**: static method of [<code>Text</code>](#Text)  

| Param | Type |
| --- | --- |
| date | <code>Date</code> \| <code>string</code> \| <code>number</code> | 

<a name="Text.oxfordJoin"></a>

### Text.oxfordJoin(list) ⇒ <code>string</code>
Join a list with an Oxford comma (delegates to [module:functions/oxfordJoin](module:functions/oxfordJoin)).

**Kind**: static method of [<code>Text</code>](#Text)  

| Param | Type |
| --- | --- |
| list | <code>Array.&lt;string&gt;</code> | 

<a name="ZMQ"></a>

## ZMQ
Connect and subscribe to ZeroMQ publishers.

**Kind**: global class  

* [ZMQ](#ZMQ)
    * [new ZMQ([settings])](#new_ZMQ_new)
    * [._emitErrorSafe()](#ZMQ+_emitErrorSafe)
    * [.start()](#ZMQ+start) ⇒ [<code>ZMQ</code>](#ZMQ)
    * [.stop()](#ZMQ+stop) ⇒ [<code>ZMQ</code>](#ZMQ)

<a name="new_ZMQ_new"></a>

### new ZMQ([settings])
Creates an instance of a ZeroMQ subscriber.

**Returns**: [<code>ZMQ</code>](#ZMQ) - Instance of the ZMQ service, ready to run `start()`  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Settings for the ZMQ connection. |
| [settings.host] | <code>String</code> | Host for the ZMQ publisher. |
| [settings.port] | <code>Number</code> | Remote ZeroMQ service port. |

<a name="ZMQ+_emitErrorSafe"></a>

### zmQ.\_emitErrorSafe()
Avoid process crash when nothing listens for `error` (Node EventEmitter default).

**Kind**: instance method of [<code>ZMQ</code>](#ZMQ)  
<a name="ZMQ+start"></a>

### zmQ.start() ⇒ [<code>ZMQ</code>](#ZMQ)
Opens the connection and subscribes to the requested channels.

**Kind**: instance method of [<code>ZMQ</code>](#ZMQ)  
**Returns**: [<code>ZMQ</code>](#ZMQ) - Instance of the service.  
<a name="ZMQ+stop"></a>

### zmQ.stop() ⇒ [<code>ZMQ</code>](#ZMQ)
Closes the connection to the ZMQ publisher.

**Kind**: instance method of [<code>ZMQ</code>](#ZMQ)  
**Returns**: [<code>ZMQ</code>](#ZMQ) - Instance of the service.  
<a name="Scribe"></a>

## ~~Scribe~~
***Deprecated***

Deprecated 2021-11-06 — use [FabricState](FabricState) (<code>types/state</code>). <code>Scribe</code> was merged into <code>State</code>.

**Kind**: global class  
<a name="CHANNEL_BODY_TYPES"></a>

## CHANNEL\_BODY\_TYPES
CONTRACT_MESSAGE body types for the Fabric payment channel flow. These ride
the existing `CONTRACT_MESSAGE` opcode as signed artifacts
([signArtifact](#Witness.signArtifact)); **no channel opcode is introduced** — a
dedicated opcode is a separate, later protocol decision.

**Kind**: global constant  
<a name="CHANNEL_DEFAULTS"></a>

## CHANNEL\_DEFAULTS
Channel defaults (Lightning-derived). Policy fields are negotiated at
`ChannelOpen` — the stricter value wins. HTLCs are never trimmed: every one
carries at least `HTLC_MINIMUM_SATS`, so it has a commitment output its
receiver can claim on-chain.

**Kind**: global constant  
<a name="GCM_TAG_BYTES"></a>

## GCM\_TAG\_BYTES
AES-GCM tag appended to each sealed blob.

**Kind**: global constant  
<a name="DEFAULT_WEIGHTS"></a>

## DEFAULT\_WEIGHTS
Default ranking weights (sum to 1).

**Kind**: global constant  
<a name="TELEMETRY_VERSION"></a>

## TELEMETRY\_VERSION
Telemetry record schema version.

**Kind**: global constant  
<a name="TELEMETRY_TYPE"></a>

## TELEMETRY\_TYPE
Canonical `type` for an exported telemetry record.

**Kind**: global constant  
<a name="SCORE_UNKNOWN"></a>

## SCORE\_UNKNOWN
Neutral score for a provider with no observations.

**Kind**: global constant  
<a name="SCORE_MAX"></a>

## SCORE\_MAX
Maximum provider score.

**Kind**: global constant  
<a name="HOP_PENALTY_MS"></a>

## HOP\_PENALTY\_MS
Each extra gossip hop counts as this many milliseconds of latency.

**Kind**: global constant  
<a name="EXIT_KINDS"></a>

## EXIT\_KINDS
Exit kinds.

**Kind**: global constant  
<a name="EXIT_SIGNATURE_TYPE"></a>

## EXIT\_SIGNATURE\_TYPE
`CONTRACT_MESSAGE` body carrying one exit signature.

**Kind**: global constant  
<a name="Text"></a>

## ~~Text~~
***Require [module:services/text~Text](module:services/text~Text) from <code>services/text.js</code> instead.***

**Kind**: global constant  

* ~~[Text](#Text)~~
    * [new Text()](#new_Text_new)
    * _instance_
        * [._appendWarning(msg)](#Service+_appendWarning) ⇒ [<code>Service</code>](#Service)
        * [.init()](#Service+init)
        * [.tick()](#Service+tick) ⇒ <code>Number</code>
        * [.beat()](#Service+beat) ⇒ [<code>Service</code>](#Service)
        * [.get(path)](#Service+get) ⇒ <code>Mixed</code>
        * [.set(path)](#Service+set) ⇒ <code>Mixed</code>
        * [.trust(source)](#Service+trust) ⇒ [<code>Service</code>](#Service)
        * [.handler(message)](#Service+handler) ⇒ [<code>Service</code>](#Service)
        * [.lock([duration])](#Service+lock) ⇒ <code>Boolean</code>
        * [.when(event, method)](#Service+when) ⇒ <code>EventEmitter</code>
        * [.defineOpcode(name, [definition])](#Service+defineOpcode) ⇒ <code>Object</code>
        * [.defineBitcoinOpcode(name, [definition])](#Service+defineBitcoinOpcode) ⇒ <code>Object</code>
        * [.defineFabricOpcode(name, [definition])](#Service+defineFabricOpcode) ⇒ <code>Object</code>
        * [.defineOpcodeContract(name, body, [meta])](#Service+defineOpcodeContract) ⇒ <code>Object</code>
        * [.listOpcodes()](#Service+listOpcodes) ⇒ <code>Array.&lt;Object&gt;</code>
        * [.route(msg)](#Service+route) ⇒ <code>Promise</code>
        * [.start()](#Service+start)
        * [._GET(path)](#Service+_GET) ⇒ <code>Promise</code>
        * [._PUT(path, value, [commit])](#Service+_PUT) ⇒ <code>Promise</code>
        * [.connect(notify)](#Service+connect) ⇒ <code>Promise</code>
        * [.send(channel, message)](#Service+send) ⇒ [<code>Service</code>](#Service)
        * [.commit()](#Service+commit) ⇒ <code>String</code>
        * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
        * [._send(message)](#Service+_send)
        * [.adopt(changes)](#Actor+adopt) ⇒ [<code>Actor</code>](#Actor)
        * [.export()](#Actor+export) ⇒ <code>Object</code>
        * [.stream([pipe])](#Actor+stream) ⇒ <code>TransformStream</code>
        * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
        * [.toGenericMessage([type])](#Actor+toGenericMessage) ⇒ <code>Object</code>
        * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
        * [.pause()](#Actor+pause) ⇒ [<code>Actor</code>](#Actor)
        * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
        * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
        * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
        * [.value([format])](#Actor+value) ⇒ <code>Object</code>
        * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>
    * _static_
        * [.tokenize(string)](#Text.tokenize) ⇒ <code>Array.&lt;string&gt;</code>
        * [.truncateMiddle(fullStr, strLen, [separator])](#Text.truncateMiddle) ⇒ <code>string</code>
        * [.toRelativeTime(date)](#Text.toRelativeTime) ⇒ <code>string</code>
        * [.oxfordJoin(list)](#Text.oxfordJoin) ⇒ <code>string</code>

<a name="new_Text_new"></a>

### new Text()
Text-oriented [Service](#Service) stub (legacy name was <code>TXT</code>).
Static helpers for common text formatting (tokenize, middle truncation,
relative time strings) and core helpers ([module:functions/oxfordJoin](module:functions/oxfordJoin)).

<a name="Service+_appendWarning"></a>

### text.\_appendWarning(msg) ⇒ [<code>Service</code>](#Service)
**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: [<code>Service</code>](#Service) - This instance.  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>String</code> | Warning text (used by [Service#_registerService](Service#_registerService) duplicate guard). |

<a name="Service+init"></a>

### text.init()
Called by Web Components.
TODO: move to @fabric/http/types/spa

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Service+tick"></a>

### text.tick() ⇒ <code>Number</code>
Move forward one clock cycle.

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Service+beat"></a>

### text.beat() ⇒ [<code>Service</code>](#Service)
Compute latest state.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Emits**: <code>Message#event:beat</code>  
<a name="Service+get"></a>

### text.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Mixed</code> - Returns the target value if found, otherwise null.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+set"></a>

### text.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Text</code>](#Text)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="Service+trust"></a>

### text.trust(source) ⇒ [<code>Service</code>](#Service)
Explicitly trust all events from a known source.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: [<code>Service</code>](#Service) - Instance of Service after binding events.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Emitter of events. |

<a name="Service+handler"></a>

### text.handler(message) ⇒ [<code>Service</code>](#Service)
Default route handler for an incoming message.  Follows the Activity
Streams 2.0 spec: https://www.w3.org/TR/activitystreams-core/

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Activity</code> | Message object. |

<a name="Service+lock"></a>

### text.lock([duration]) ⇒ <code>Boolean</code>
Attempt to acquire a lock for `duration` seconds.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Boolean</code> - true if locked, false if unable to lock.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [duration] | <code>Number</code> | <code>1000</code> | Number of milliseconds to hold lock. |

<a name="Service+when"></a>

### text.when(event, method) ⇒ <code>EventEmitter</code>
Bind a method to an event, with current state as the immutable context.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>EventEmitter</code> - Instance of EventEmitter.  

| Param | Type | Description |
| --- | --- | --- |
| event | <code>String</code> | Name of the event upon which to execute `method` as a function. |
| method | <code>function</code> | Function to execute when named [Event](Event) `event` is encountered. |

<a name="Service+defineOpcode"></a>

### text.defineOpcode(name, [definition]) ⇒ <code>Object</code>
Register a single opcode entry in the service registry.

**Kind**: instance method of [<code>Text</code>](#Text)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Opcode symbol (e.g. `OP_SHA256`, `P2P_FLUSH_CHAIN`) |
| [definition] | <code>Object</code> |  |

<a name="Service+defineBitcoinOpcode"></a>

### text.defineBitcoinOpcode(name, [definition]) ⇒ <code>Object</code>
Register Bitcoin-style primitive opcode metadata.

**Kind**: instance method of [<code>Text</code>](#Text)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineFabricOpcode"></a>

### text.defineFabricOpcode(name, [definition]) ⇒ <code>Object</code>
Register Fabric opcode metadata.

**Kind**: instance method of [<code>Text</code>](#Text)  

| Param | Type |
| --- | --- |
| name | <code>string</code> | 
| [definition] | <code>Object</code> | 

<a name="Service+defineOpcodeContract"></a>

### text.defineOpcodeContract(name, body, [meta]) ⇒ <code>Object</code>
Register a newline-delimited opcode contract.
Contract body example:
`OP_DUP\nOP_HASH160\nP2P_FLUSH_CHAIN`

**Kind**: instance method of [<code>Text</code>](#Text)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Contract label |
| body | <code>string</code> | Newline-delimited opcode list |
| [meta] | <code>Object</code> |  |

<a name="Service+listOpcodes"></a>

### text.listOpcodes() ⇒ <code>Array.&lt;Object&gt;</code>
Snapshot opcode registry for UI / API use.

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Service+route"></a>

### text.route(msg) ⇒ <code>Promise</code>
Resolve a [State](#State) from a particular [Message](#Message) object.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Promise</code> - Resolves with resulting [State](#State).  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | Explicit Fabric [Message](#Message). |

<a name="Service+start"></a>

### text.start()
Start the service, including the initiation of an outbound connection
to any peers designated in the service's configuration.

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Service+_GET"></a>

### text.\_GET(path) ⇒ <code>Promise</code>
Retrieve a value from the Service's state.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Promise</code> - Resolves with the result.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path of the value to retrieve. |

<a name="Service+_PUT"></a>

### text.\_PUT(path, value, [commit]) ⇒ <code>Promise</code>
Store a value in the Service's state.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Promise</code> - Resolves with with stored document.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>String</code> |  | Path to store the value at. |
| value | <code>Object</code> |  | Document to store. |
| [commit] | <code>Boolean</code> | <code>false</code> | Sign the resulting state. |

<a name="Service+connect"></a>

### text.connect(notify) ⇒ <code>Promise</code>
Attach to network.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Promise</code> - Resolves to [Fabric](#Fabric).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| notify | <code>Boolean</code> | <code>true</code> | Commit to changes. |

<a name="Service+send"></a>

### text.send(channel, message) ⇒ [<code>Service</code>](#Service)
Send a message to a channel.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| channel | <code>String</code> | Channel name to which the message will be sent. |
| message | <code>String</code> | Content of the message to send. |

<a name="Service+commit"></a>

### text.commit() ⇒ <code>String</code>
Record outstanding JSON Patch deltas and emit a compact commitment id.
Does **not** wrap [Service#state](Service#state) in a new [Actor](#Actor) — that
JSON-cloned the entire tree on every write/connect and OOMed Hub.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>String</code> - 32-byte commitment id  
<a name="Service+_registerActor"></a>

### text.\_registerActor(actor) ⇒ <code>Promise</code>
Register an [Actor](#Actor) with the [Service](#Service).

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Promise</code> - Resolves upon successful registration.  

| Param | Type | Description |
| --- | --- | --- |
| actor | <code>Object</code> | Instance of the [Actor](#Actor). |

<a name="Service+_send"></a>

### text.\_send(message)
Sends a message.

**Kind**: instance method of [<code>Text</code>](#Text)  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Mixed</code> | Message to send. |

<a name="Actor+adopt"></a>

### text.adopt(changes) ⇒ [<code>Actor</code>](#Actor)
Explicitly adopt a set of [JSONPatch](JSONPatch)-encoded changes.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| changes | <code>Array</code> | List of [JSONPatch](JSONPatch) operations to apply. |

<a name="Actor+export"></a>

### text.export() ⇒ <code>Object</code>
Export the Actor's state to a standard [Object](Object).

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Object</code> - Standard object.  
<a name="Actor+stream"></a>

### text.stream([pipe]) ⇒ <code>TransformStream</code>
Returns a new output stream for the Actor.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>TransformStream</code> - New output stream for the Actor.  

| Param | Type | Description |
| --- | --- | --- |
| [pipe] | <code>TransformStream</code> | Pipe to stream to. |

<a name="Actor+toBuffer"></a>

### text.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Actor+toGenericMessage"></a>

### text.toGenericMessage([type]) ⇒ <code>Object</code>
Casts the Actor to a generic message envelope for state announcements and history.
Shape is stable: `{ type, object }` where `object` is sorted-key state ([toObject](#Actor+toObject)).
[Actor#id](Actor#id) derives from a digest of the pretty-printed generic message; extending this
envelope requires a format/version migration across the network.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Object</code> - `{ type, object }`  
**See**

- [https://en.wikipedia.org/wiki/Merkle_tree](https://en.wikipedia.org/wiki/Merkle_tree)
- [https://dev.fabric.pub/messages](https://dev.fabric.pub/messages)


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [type] | <code>String</code> | <code>&#x27;FabricActorState&#x27;</code> | Logical message type string. |

<a name="Actor+toObject"></a>

### text.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Actor+pause"></a>

### text.pause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to paused.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+serialize"></a>

### text.serialize() ⇒ <code>String</code>
Serialize the Actor's current state into a JSON-formatted string.

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Actor+sign"></a>

### text.sign() ⇒ [<code>Actor</code>](#Actor)
Signs the Actor when `this.key` is a [Key](#Key); otherwise throws.
Prefer [signWithKey](#Message+signWithKey) / [sign](#Key+sign) for wire auth.

**Kind**: instance method of [<code>Text</code>](#Text)  
<a name="Actor+unpause"></a>

### text.unpause() ⇒ [<code>Actor</code>](#Actor)
Toggles `status` property to unpaused.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: [<code>Actor</code>](#Actor) - Instance of the Actor.  
<a name="Actor+value"></a>

### text.value([format]) ⇒ <code>Object</code>
Get the inner value of the Actor with an optional cast type.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Object</code> - Inner value of the Actor as an [Object](Object), or cast to the requested `format`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [format] | <code>String</code> | <code>object</code> | Cast the value to one of: `buffer, hex, json, string` |

<a name="Actor+_readObject"></a>

### text.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Text.tokenize"></a>

### Text.tokenize(string) ⇒ <code>Array.&lt;string&gt;</code>
Split on runs of whitespace.

**Kind**: static method of [<code>Text</code>](#Text)  

| Param | Type |
| --- | --- |
| string | <code>string</code> | 

<a name="Text.truncateMiddle"></a>

### Text.truncateMiddle(fullStr, strLen, [separator]) ⇒ <code>string</code>
Shorten a string in the middle if longer than <code>strLen</code>.

**Kind**: static method of [<code>Text</code>](#Text)  

| Param | Type |
| --- | --- |
| fullStr | <code>string</code> | 
| strLen | <code>number</code> | 
| [separator] | <code>string</code> | 

<a name="Text.toRelativeTime"></a>

### Text.toRelativeTime(date) ⇒ <code>string</code>
Human-readable relative time (e.g. <code>3 days ago</code>).

**Kind**: static method of [<code>Text</code>](#Text)  

| Param | Type |
| --- | --- |
| date | <code>Date</code> \| <code>string</code> \| <code>number</code> | 

<a name="Text.oxfordJoin"></a>

### Text.oxfordJoin(list) ⇒ <code>string</code>
Join a list with an Oxford comma (delegates to [module:functions/oxfordJoin](module:functions/oxfordJoin)).

**Kind**: static method of [<code>Text</code>](#Text)  

| Param | Type |
| --- | --- |
| list | <code>Array.&lt;string&gt;</code> | 

<a name="lockFrom"></a>

## lockFrom()
Accept a block height, a `{ type, height|unix|blocks }` lock, or a normalized lock. @private

**Kind**: global function  
<a name="offerKey"></a>

## offerKey(row) ⇒ <code>string</code>
Stable key for one offer row.

**Kind**: global function  

| Param | Type |
| --- | --- |
| row | <code>object</code> | 

<a name="toIntegerSats"></a>

## toIntegerSats(value) ⇒ <code>bigint</code>
PSBT output values are integer satoshis. Reject float BTC leftovers.

**Kind**: global function  

| Param | Type |
| --- | --- |
| value | <code>bigint</code> \| <code>number</code> \| <code>string</code> | 

<a name="weightsForProximity"></a>

## weightsForProximity(proximityWeight) ⇒ <code>Object</code>
Translate `proximityWeight` (0..1) into offer-book ranking weights: higher
proximity shifts weight from price toward measured latency + hops.

**Kind**: global function  

| Param | Type |
| --- | --- |
| proximityWeight | <code>number</code> | 

<a name="BitcoinCookieProbeConstraints"></a>

## BitcoinCookieProbeConstraints : <code>Object</code>
Constraints hint for cookie / store probe paths (e.g. pruned mainnet).

**Kind**: global typedef  
**Properties**

| Name | Type |
| --- | --- |
| [storage] | <code>Object</code> | 
| [storage.size] | <code>number</code> | 

<a name="BitcoinLocalCookieProbeOpts"></a>

## BitcoinLocalCookieProbeOpts : <code>Object</code>
Options for [buildLocalCookieProbePaths](#Bitcoin.buildLocalCookieProbePaths).

**Kind**: global typedef  
**Properties**

| Name | Type |
| --- | --- |
| [network] | <code>string</code> | 
| [envCookieFile] | <code>string</code> | 
| [settingsDatadir] | <code>string</code> | 
| [constraints] | [<code>BitcoinCookieProbeConstraints</code>](#BitcoinCookieProbeConstraints) | 

<a name="BitcoinRegtestCookieOpts"></a>

## BitcoinRegtestCookieOpts : <code>Object</code>
Options for [buildRegtestCookiePathList](#Bitcoin.buildRegtestCookiePathList).

**Kind**: global typedef  
**Properties**

| Name | Type |
| --- | --- |
| [envCookieFile] | <code>string</code> | 
| [settingsDatadir] | <code>string</code> | 

