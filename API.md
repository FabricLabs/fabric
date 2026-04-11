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
<dt><a href="#Bond">Bond</a> ⇐ <code><a href="#Contract">Contract</a></code></dt>
<dd></dd>
<dt><a href="#Chain">Chain</a></dt>
<dd><p>Chain.</p>
</dd>
<dt><a href="#Channel">Channel</a> ⇐ <code><a href="#State">State</a></code></dt>
<dd><p><strong>Payment / capacity channel</strong> between peers: balances (<code>incoming</code> /
<code>outgoing</code>), counterparty handle, optional asset caps (<code>MAX_CHANNEL_VALUE</code>). Extends
<a href="#State">State</a> → <a href="#Actor">Actor</a>. Wording below is product-oriented;
wire safety still depends on the Lightning/Bitcoin services you attach, not this object alone.</p>
</dd>
<dt><a href="#Channel">Channel</a></dt>
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
<dt><a href="#Contract">Contract</a> ⇐ <code><a href="#Service">Service</a></code></dt>
<dd></dd>
<dt><a href="#Disk">Disk</a></dt>
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
<dd><p><strong>BIP32/BIP39 identity</strong> wrapping <a href="#Key">Key</a>: mnemonic / xprv / passphrase, derivation
<code>m/44'/7778'/account'/0/index</code> (see <code>derivation</code> getter). <strong>Important:</strong> this class
overrides <a href="Actor#id">Actor#id</a> with <code>toString()</code> (human-facing / Bech32-style identity), <strong>not</strong> the
content-addressed <code>Actor#id</code> / <code>preimage</code> chain from <a href="#Actor+toGenericMessage">toGenericMessage</a>. Use
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

<p><strong>Narrative</strong> — See <strong>DEVELOPERS.md</strong> (<em>Actor and Message</em>) and [Actor](#Actor)
<code>@fileoverview</code>; home HTML is generated from DEVELOPERS.md, while this page comes from
<code>types/message.js</code>.</p></dd>
<dt><a href="#Message">Message</a></dt>
<dd></dd>
<dt><a href="#Peer">Peer</a> ⇐ <code><a href="#Service">Service</a></code></dt>
<dd><p>P2P node: TCP/NOISE sessions, gossip, and relay of <a href="#Message">Message</a> (AMP) frames. Extends <a href="#Service">Service</a>
(hence <a href="#Actor">Actor</a>). Opcode and receipt semantics must stay aligned with <strong>@fabric/http</strong> and Hub when you add types —
see <a href="#Message">Message</a> wire vs friendly names and <code>constants</code> opcodes.</p>
</dd>
<dt><a href="#Peer">Peer</a></dt>
<dd></dd>
<dt><a href="#Reader">Reader</a></dt>
<dd><p>Read from a byte stream, seeking valid Fabric messages.</p>
</dd>
<dt><a href="#Remote">Remote</a> ⇐ <code><a href="#Actor">Actor</a></code></dt>
<dd><p><strong>WebSocket client</strong> to a remote Fabric/Hub-style host (extends <a href="#Actor">Actor</a>). Per comment in
source, prefer moving richer HTTP to <code>@fabric/http</code>; this type stays for minimal <a href="#Message">Message</a>-oriented
bridging. Uses browser/Node <code>WebSocket</code> with JSON <a href="#Message">Message</a> payloads where applicable.</p>
</dd>
<dt><a href="#Remote">Remote</a></dt>
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
<dt><a href="#State">State</a> ⇐ <code><a href="#Actor">Actor</a></code></dt>
<dd><p><strong>Named snapshot</strong> of application data extending <a href="#Actor">Actor</a> — <code>@type</code>,
<code>@data</code>, <code>@id</code>, JSON Patch
flows. Absorbs former <strong>Scribe</strong> behavior: <code>verbose</code> / <code>verbosity</code>, <code>now</code>,
<code>trust</code>, <code>start</code>/<code>stop</code>, and structured <code>log</code> / <code>error</code> /
<code>warn</code> / <code>debug</code> (console + events). <a href="#Channel">Channel</a>, <a href="Document">Document</a>, <a href="#Ledger">Ledger</a>,
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
<dd><p>Class implementing a Merkle Tree.</p>
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
<dt><a href="#Worker">Worker</a></dt>
<dd><p>Workers are arbitrary containers for processing data.  They can be thought of
almost like &quot;threads&quot;, as they run asynchronously over the duration of a
contract&#39;s lifetime as &quot;fulfillment conditions&quot; for its closure.</p>
</dd>
<dt><a href="#Bitcoin">Bitcoin</a> ⇐ <code><a href="#Service">Service</a></code></dt>
<dd><p>Manages interaction with the Bitcoin network.</p>
</dd>
<dt><a href="#Lightning">Lightning</a></dt>
<dd><p>Manage a Lightning node.</p>
</dd>
<dt><a href="#Redis">Redis</a></dt>
<dd><p>Connect and subscribe to Redis servers.</p>
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
<dt><a href="#SAT_ADJ_EPS">SAT_ADJ_EPS</a></dt>
<dd><p>Max |sats − round(sats)| allowed when scaling BTC → satoshis (reject fractional satoshis; allow float noise).</p>
</dd>
<dt><a href="#BITCOIN_COOKIE_PATH_MAX_LEN">BITCOIN_COOKIE_PATH_MAX_LEN</a></dt>
<dd><p>Reject absurd paths from env/settings before touching the filesystem (Codacy/Semgrep-friendly bounds).</p>
</dd>
<dt><a href="#BITCOIND_CHAIN_FOLDER_NAMES">BITCOIND_CHAIN_FOLDER_NAMES</a></dt>
<dd><p>Directory names Bitcoin Core uses under {@code -datadir} (used to block traversal in <code>.cookie</code> paths).</p>
</dd>
<dt><del><a href="#Text">Text</a></del></dt>
<dd></dd>
</dl>

## Functions

<dl>
<dt><a href="#cookiePathUnderDatadirBase">cookiePathUnderDatadirBase(baseAbs, parts)</a> ⇒ <code>string</code> | <code>null</code></dt>
<dd><p>Append fixed path components under a resolved base; return null if the result leaves {@code baseAbs}.</p>
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
Signs the Actor.

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
Signs the Actor.

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

<a name="Bond"></a>

## Bond ⇐ [<code>Contract</code>](#Contract)
**Kind**: global class  
**Extends**: [<code>Contract</code>](#Contract)  

* [Bond](#Bond) ⇐ [<code>Contract</code>](#Contract)
    * [new Bond()](#new_Bond_new)
    * [.deploy()](#Contract+deploy) ⇒ <code>String</code>
    * [.start()](#Contract+start) ⇒ [<code>Contract</code>](#Contract)
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
    * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
    * [._send(message)](#Service+_send)

<a name="new_Bond_new"></a>

### new Bond()
On-chain or logical bond / stake terms layered on [Contract](#Contract).

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

<a name="Chain"></a>

## Chain
Chain.

**Kind**: global class  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | Current name. |
| indices | <code>Map</code> |  |
| storage | <code>Storage</code> |  |

<a name="new_Chain_new"></a>

### new Chain(genesis)
Holds an immutable chain of events.


| Param | Type | Description |
| --- | --- | --- |
| genesis | [<code>Vector</code>](#Vector) | Initial state for the chain of events. |

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
Signs the Actor.

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

<a name="Channel"></a>

## Channel
**Kind**: global class  

* [Channel](#Channel)
    * [new Channel([settings])](#new_Channel_new)
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
Signs the Actor.

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
    * [.asMerkleTree()](#Collection+asMerkleTree) ⇒ <code>MerkleTree</code>
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

<a name="Collection+asMerkleTree"></a>

### collection.asMerkleTree() ⇒ <code>MerkleTree</code>
Current elements of the collection as a [MerkleTree](MerkleTree).

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

<a name="Contract"></a>

## Contract ⇐ [<code>Service</code>](#Service)
**Kind**: global class  
**Extends**: [<code>Service</code>](#Service)  

* [Contract](#Contract) ⇐ [<code>Service</code>](#Service)
    * [new Contract()](#new_Contract_new)
    * [.deploy()](#Contract+deploy) ⇒ <code>String</code>
    * [.start()](#Contract+start) ⇒ [<code>Contract</code>](#Contract)
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
    * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
    * [._send(message)](#Service+_send)

<a name="new_Contract_new"></a>

### new Contract()
Service-backed agreement template: DOT graphs, a derived circuit structure, deploy/genesis/publish flows,
and JSON-Patch–observed commits. Specialized by [Bond](#Bond), [Federation](#Federation), and [Distribution](Distribution).

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
    * [._getDefaultBitcoinDatadir([configPath])](#Environment+_getDefaultBitcoinDatadir) ⇒ <code>Object</code>
    * [._parseConfigValue(value)](#Environment+_parseConfigValue) ⇒ <code>\*</code>
    * [._hasSingleNumericPortSuffix(host)](#Environment+_hasSingleNumericPortSuffix) ⇒ <code>boolean</code>
    * [._toFabricSettings(bitcoinConf)](#Environment+_toFabricSettings) ⇒ <code>Object</code>
    * [.readVariable(name)](#Environment+readVariable) ⇒ <code>String</code>
    * [.setWallet(wallet, force)](#Environment+setWallet) ⇒ [<code>Environment</code>](#Environment)
    * [.start()](#Environment+start) ⇒ [<code>Environment</code>](#Environment)

<a name="new_Environment_new"></a>

### new Environment([settings])
Create an instance of [Environment](#Environment).

**Returns**: [<code>Environment</code>](#Environment) - Instance of the Environment.  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Settings for the Fabric environment. |

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

<a name="Environment+readVariable"></a>

### environment.readVariable(name) ⇒ <code>String</code>
Read a variable from the environment.

**Kind**: instance method of [<code>Environment</code>](#Environment)  
**Returns**: <code>String</code> - Value of the variable (or an empty string).  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | Variable name to read. |

<a name="Environment+setWallet"></a>

### environment.setWallet(wallet, force) ⇒ [<code>Environment</code>](#Environment)
Configure the Environment to use a Fabric [Wallet](#Wallet).

**Kind**: instance method of [<code>Environment</code>](#Environment)  
**Returns**: [<code>Environment</code>](#Environment) - The Fabric Environment.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| wallet | [<code>Wallet</code>](#Wallet) |  | Wallet to attach. |
| force | <code>Boolean</code> | <code>false</code> | Force existing wallets to be destroyed. |

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
        * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
        * [._send(message)](#Service+_send)
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
        * ~~[.Scribe](#Fabric.Scribe)~~
        * [.Vector](#Fabric.Vector) ⇒ <code>function</code>
        * [.Federation](#Fabric.Federation) ⇒ <code>function</code>
        * [.DistributedExecution](#Fabric.DistributedExecution) ⇒ <code>function</code>

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

<a name="Actor+commit"></a>

### fabric.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>String</code> - 32-byte ID  
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
Signs the Actor.

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

### Fabric.DistributedExecution ⇒ <code>function</code>
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
        * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
        * [._send(message)](#Service+_send)
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
        * ~~[.Scribe](#Fabric.Scribe)~~
        * [.Vector](#Fabric.Vector) ⇒ <code>function</code>
        * [.Federation](#Fabric.Federation) ⇒ <code>function</code>
        * [.DistributedExecution](#Fabric.DistributedExecution) ⇒ <code>function</code>

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

<a name="Actor+commit"></a>

### fabric.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>String</code> - 32-byte ID  
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
Signs the Actor.

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

### Fabric.DistributedExecution ⇒ <code>function</code>
**Kind**: static property of [<code>Fabric</code>](#Fabric)  
<a name="Federation"></a>

## Federation
Create and manage sets of {Signer} instances with the Federation class.

**Kind**: global class  

* [Federation](#Federation)
    * [new Federation([settings])](#new_Federation_new)
    * [.start()](#Federation+start) ⇒ [<code>Federation</code>](#Federation)
    * [.sign(msg, [pubkey])](#Federation+sign) ⇒ <code>Buffer</code>
    * [.verify(msg, sig)](#Federation+verify) ⇒ <code>Boolean</code>
    * [.createMultiSignature(msg)](#Federation+createMultiSignature) ⇒ <code>Object</code>
    * [.verifyMultiSignature(multiSig, threshold)](#Federation+verifyMultiSignature) ⇒ <code>Boolean</code>

<a name="new_Federation_new"></a>

### new Federation([settings])
Create an instance of a federation.

**Returns**: [<code>Federation</code>](#Federation) - Instance of the federation.  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Settings. |

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
<strong>BIP32/BIP39 identity</strong> wrapping [Key](#Key): mnemonic / xprv / passphrase, derivation
<code>m/44'/7778'/account'/0/index</code> (see <code>derivation</code> getter). <strong>Important:</strong> this class
overrides [Actor#id](Actor#id) with <code>toString()</code> (human-facing / Bech32-style identity), <strong>not</strong> the
content-addressed <code>Actor#id</code> / <code>preimage</code> chain from [toGenericMessage](#Actor+toGenericMessage). Use
<code>pubkey</code>, <code>pubkeyhash</code>, or explicit hashing when you need stable bytes.

**Kind**: global class  
**Extends**: [<code>Actor</code>](#Actor)  

* [Identity](#Identity) ⇐ [<code>Actor</code>](#Actor)
    * [new Identity([settings])](#new_Identity_new)
    * [.toString()](#Identity+toString) ⇒ <code>String</code>
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
| [settings.seed] | <code>String</code> |  | BIP 39 seed phrase. |
| [settings.xprv] | <code>String</code> |  | Serialized BIP 32 master private key. |
| [settings.xpub] | <code>String</code> |  | Serialized BIP 32 master public key. |
| [settings.account] | <code>Number</code> | <code>0</code> | BIP 44 account index. |
| [settings.index] | <code>Number</code> | <code>0</code> | BIP 44 key index. |
| [settings.passphrase] | <code>String</code> |  | Passphrase for the key. |

<a name="Identity+toString"></a>

### identity.toString() ⇒ <code>String</code>
Retrieve the bech32m-encoded identity.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>String</code> - Public identity.  
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
Signs the Actor.

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
    * [.toString()](#Identity+toString) ⇒ <code>String</code>
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
| [settings.seed] | <code>String</code> |  | BIP 39 seed phrase. |
| [settings.xprv] | <code>String</code> |  | Serialized BIP 32 master private key. |
| [settings.xpub] | <code>String</code> |  | Serialized BIP 32 master public key. |
| [settings.account] | <code>Number</code> | <code>0</code> | BIP 44 account index. |
| [settings.index] | <code>Number</code> | <code>0</code> | BIP 44 key index. |
| [settings.passphrase] | <code>String</code> |  | Passphrase for the key. |

<a name="Identity+toString"></a>

### identity.toString() ⇒ <code>String</code>
Retrieve the bech32m-encoded identity.

**Kind**: instance method of [<code>Identity</code>](#Identity)  
**Returns**: <code>String</code> - Public identity.  
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
Signs the Actor.

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
| [settings.seed] | <code>String</code> |  | Mnemonic seed for initializing the key. |
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
Signs the Actor.

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
Signs the Actor.

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
        * [.sip([n])](#Machine+sip) ⇒ <code>Number</code>
        * [.slurp([n])](#Machine+slurp) ⇒ <code>Number</code>
        * [.compute(input)](#Machine+compute) ⇒ [<code>Machine</code>](#Machine)
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
Signs the Actor.

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
        * [.sip([n])](#Machine+sip) ⇒ <code>Number</code>
        * [.slurp([n])](#Machine+slurp) ⇒ <code>Number</code>
        * [.compute(input)](#Machine+compute) ⇒ [<code>Machine</code>](#Machine)
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
Signs the Actor.

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

<p><strong>Narrative</strong> — See <strong>DEVELOPERS.md</strong> (<em>Actor and Message</em>) and [Actor](#Actor)
<code>@fileoverview</code>; home HTML is generated from DEVELOPERS.md, while this page comes from
<code>types/message.js</code>.</p>

**Kind**: global class  
**Extends**: [<code>Actor</code>](#Actor)  

* [Message](#Message) ⇐ [<code>Actor</code>](#Actor)
    * [new Message([input])](#new_Message_new)
    * [._sensitive](#Message+_sensitive)
    * [.preimage](#Message+preimage)
    * [.wireType](#Message+wireType)
    * [.friendlyType](#Message+friendlyType)
    * [.asRaw()](#Message+asRaw) ⇒ <code>Buffer</code>
    * [.signWithKey(key)](#Message+signWithKey) ⇒ [<code>Message</code>](#Message)
    * [.verify()](#Message+verify) ⇒ <code>Boolean</code>
    * [.verifyWithKey(key)](#Message+verifyWithKey) ⇒ <code>Boolean</code>
    * [._setSigner(key)](#Message+_setSigner) ⇒ [<code>Message</code>](#Message)
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

<a name="new_Message_new"></a>

### new Message([input])
Build a message from an object. Prefer <code>type</code>/<code>data</code>; <code>@type</code> / <code>@data</code>
are accepted for backward compatibility.

**Returns**: [<code>Message</code>](#Message) - Instance ready for [asRaw](#Message+asRaw), [signWithKey](#Message+signWithKey), etc.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [input] | <code>Object</code> | <code>{}</code> | Initial fields: <code>type</code> or <code>@type</code>, <code>data</code> or <code>@data</code>, optional <code>signer</code>, <code>sensitive</code>, <code>preimage</code>. |

<a name="Message+_sensitive"></a>

### message.\_sensitive
When true, body preimage field is zeroed on wire (no SHA256(body) commitment).

**Kind**: instance property of [<code>Message</code>](#Message)  
<a name="Message+preimage"></a>

### message.preimage
Optional 32-byte preimage on wire:
- **All zeros:** sensitive payload (no commitment) or legacy; [Message#sensitive](Message#sensitive) uses this.
- **SHA256(body):** default for non-sensitive messages (single digest; [Message#hash](Message#hash) is double-SHA256(body)).
- **Other:** explicit HTLC secret or custom (must match what was signed).

**Kind**: instance property of [<code>Message</code>](#Message)  
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
Signs the Actor.

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

<a name="Message"></a>

## Message
**Kind**: global class  

* [Message](#Message)
    * [new Message([input])](#new_Message_new)
    * [._sensitive](#Message+_sensitive)
    * [.preimage](#Message+preimage)
    * [.wireType](#Message+wireType)
    * [.friendlyType](#Message+friendlyType)
    * [.asRaw()](#Message+asRaw) ⇒ <code>Buffer</code>
    * [.signWithKey(key)](#Message+signWithKey) ⇒ [<code>Message</code>](#Message)
    * [.verify()](#Message+verify) ⇒ <code>Boolean</code>
    * [.verifyWithKey(key)](#Message+verifyWithKey) ⇒ <code>Boolean</code>
    * [._setSigner(key)](#Message+_setSigner) ⇒ [<code>Message</code>](#Message)
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

<a name="new_Message_new"></a>

### new Message([input])
Build a message from an object. Prefer <code>type</code>/<code>data</code>; <code>@type</code> / <code>@data</code>
are accepted for backward compatibility.

**Returns**: [<code>Message</code>](#Message) - Instance ready for [asRaw](#Message+asRaw), [signWithKey](#Message+signWithKey), etc.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [input] | <code>Object</code> | <code>{}</code> | Initial fields: <code>type</code> or <code>@type</code>, <code>data</code> or <code>@data</code>, optional <code>signer</code>, <code>sensitive</code>, <code>preimage</code>. |

<a name="Message+_sensitive"></a>

### message.\_sensitive
When true, body preimage field is zeroed on wire (no SHA256(body) commitment).

**Kind**: instance property of [<code>Message</code>](#Message)  
<a name="Message+preimage"></a>

### message.preimage
Optional 32-byte preimage on wire:
- **All zeros:** sensitive payload (no commitment) or legacy; [Message#sensitive](Message#sensitive) uses this.
- **SHA256(body):** default for non-sensitive messages (single digest; [Message#hash](Message#hash) is double-SHA256(body)).
- **Other:** explicit HTLC secret or custom (must match what was signed).

**Kind**: instance property of [<code>Message</code>](#Message)  
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
Signs the Actor.

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

<a name="Peer"></a>

## Peer ⇐ [<code>Service</code>](#Service)
P2P node: TCP/NOISE sessions, gossip, and relay of [Message](#Message) (AMP) frames. Extends [Service](#Service)
(hence [Actor](#Actor)). Opcode and receipt semantics must stay aligned with <strong>@fabric/http</strong> and Hub when you add types —
see [Message](#Message) wire vs friendly names and <code>constants</code> opcodes.

**Kind**: global class  
**Extends**: [<code>Service</code>](#Service)  

* [Peer](#Peer) ⇐ [<code>Service</code>](#Service)
    * [new Peer([config])](#new_Peer_new)
    * [._inboundNoiseStaticPubkeyByAddress](#Peer+_inboundNoiseStaticPubkeyByAddress)
    * [.messages](#Peer+messages)
    * [._gossipPayloadSeen](#Peer+_gossipPayloadSeen)
    * [._gossipRelayByOrigin](#Peer+_gossipRelayByOrigin)
    * [._peeringPayloadSeen](#Peer+_peeringPayloadSeen)
    * [._peeringRelayByOrigin](#Peer+_peeringRelayByOrigin)
    * [._wireInboundByOrigin](#Peer+_wireInboundByOrigin)
    * [._candidateKeys](#Peer+_candidateKeys)
    * [._outboundDialTargets](#Peer+_outboundDialTargets)
    * ~~[.address](#Peer+address)~~
    * [._gossipPayloadDedupKey(msg)](#Peer+_gossipPayloadDedupKey) ⇒ <code>string</code>
    * [._gossipRateLimitAllow(originName)](#Peer+_gossipRateLimitAllow) ⇒ <code>boolean</code>
    * [._wireInboundCreditCost(wireType)](#Peer+_wireInboundCreditCost) ⇒ <code>number</code>
    * [._wireInboundRateAllowPeer(originName, creditCost)](#Peer+_wireInboundRateAllowPeer) ⇒ <code>boolean</code>
    * [._derankPeerForWireTraffic(originName, penalty, reason)](#Peer+_derankPeerForWireTraffic)
    * [._peeringOfferPayloadDedupKey(msg)](#Peer+_peeringOfferPayloadDedupKey) ⇒ <code>string</code>
    * [._peeringRateLimitAllow(originName)](#Peer+_peeringRateLimitAllow) ⇒ <code>boolean</code>
    * [._enqueuePeeringCandidate(host, port)](#Peer+_enqueuePeeringCandidate)
    * [.broadcast(message)](#Peer+broadcast)
    * [.relayFromTrustedPeers(origin, message, [minScoreExclusive])](#Peer+relayFromTrustedPeers)
    * [._registryScoreForConnectionAddress(connAddress)](#Peer+_registryScoreForConnectionAddress) ⇒ <code>number</code>
    * [._registryScoreForFlushChainSender(connAddress, senderPubkeyHex)](#Peer+_registryScoreForFlushChainSender) ⇒ <code>number</code>
    * [.sendFlushChainToTrustedPeers(object)](#Peer+sendFlushChainToTrustedPeers) ⇒ <code>number</code>
    * [._connect(target)](#Peer+_connect)
    * [._loadPeerRegistry()](#Peer+_loadPeerRegistry) ⇒ <code>Promise.&lt;void&gt;</code>
    * [._savePeerRegistry()](#Peer+_savePeerRegistry)
    * [._flushChainSenderPubkeyHex()](#Peer+_flushChainSenderPubkeyHex)
    * [._upsertPeerRegistry(address, [updates])](#Peer+_upsertPeerRegistry)
    * [._fillPeerSlots()](#Peer+_fillPeerSlots) ⇒ [<code>Peer</code>](#Peer)
    * [._handleFabricMessage(buffer)](#Peer+_handleFabricMessage) ⇒ [<code>Peer</code>](#Peer)
    * [._buildDocumentParsedForPublish(documentId, content)](#Peer+_buildDocumentParsedForPublish) ⇒ <code>Object</code>
    * [._respondInventoryFromLocalDocuments(message, origin)](#Peer+_respondInventoryFromLocalDocuments) ⇒ <code>boolean</code>
    * [._sendP2pFileSendToPeer(documentId, peerAddress)](#Peer+_sendP2pFileSendToPeer) ⇒ <code>boolean</code>
    * [.sendDocumentFileToPeer(documentId, peerAddress)](#Peer+sendDocumentFileToPeer) ⇒ <code>boolean</code>
    * [._buildPublishDocumentWireBuffers(documentId, body, rateSats)](#Peer+_buildPublishDocumentWireBuffers) ⇒ <code>Array.&lt;Buffer&gt;</code>
    * [._announceLocalDocumentsToPeer(peerAddress)](#Peer+_announceLocalDocumentsToPeer)
    * [._publishDocument(documentId, [content], [rateSats])](#Peer+_publishDocument)
    * [._handleDocumentRequestWire(message, origin, socket)](#Peer+_handleDocumentRequestWire)
    * [._startFabricPingKeepalive(socket, encryptWrite)](#Peer+_startFabricPingKeepalive)
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
    * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
    * [._send(message)](#Service+_send)
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

<a name="Peer+_inboundNoiseStaticPubkeyByAddress"></a>

### peer.\_inboundNoiseStaticPubkeyByAddress
Inbound address -> NOISE static pubkey hex (FLUSH_CHAIN allowlist only; never for AMP verify).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+messages"></a>

### peer.messages
Wire-envelope dedup (SHA-256 of full buffer); FIFO-capped via [Peer#_rememberWireHash](Peer#_rememberWireHash).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_gossipPayloadSeen"></a>

### peer.\_gossipPayloadSeen
Logical gossip payload dedup (excludes signature / hop churn).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_gossipRelayByOrigin"></a>

### peer.\_gossipRelayByOrigin
origin address → { count, windowStart } for gossip relay rate limiting.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_peeringPayloadSeen"></a>

### peer.\_peeringPayloadSeen
Logical peering-offer payload dedup (ignores per-hop re-signing).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_peeringRelayByOrigin"></a>

### peer.\_peeringRelayByOrigin
origin address → { count, windowStart } for peering-offer relay rate limiting.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_wireInboundByOrigin"></a>

### peer.\_wireInboundByOrigin
`host:port` → { credits, windowStart, penalized } — inbound wire flood / de-rank (per peer).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_candidateKeys"></a>

### peer.\_candidateKeys
`host:port` keys for [P2P_PEERING_OFFER](P2P_PEERING_OFFER) candidate queue dedup.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_outboundDialTargets"></a>

### peer.\_outboundDialTargets
`host:port` strings we opened via [_connect](#Peer+_connect) (outbound dials).
[P2P_SESSION_OFFER](P2P_SESSION_OFFER) must not destroy these when the same peer also opens an inbound
socket (mesh star): otherwise RPC paths that use the listen address (e.g. ChainSyncRequest)
see `peer not connected` while an ephemeral inbound key remains.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+address"></a>

### ~~peer.address~~
***Deprecated***

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_gossipPayloadDedupKey"></a>

### peer.\_gossipPayloadDedupKey(msg) ⇒ <code>string</code>
Stable id for gossip *logical* content (ignores `gossipHop` and wire signature changes).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>string</code> - hex sha256  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>object</code> | Generic message (`type`, `object`, …) |

<a name="Peer+_gossipRateLimitAllow"></a>

### peer.\_gossipRateLimitAllow(originName) ⇒ <code>boolean</code>
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
Lower registry [Peer#knownPeers](Peer#knownPeers) score for a connection (Bitcoin Core misbehavior analogue).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| originName | <code>string</code> | 
| penalty | <code>number</code> | 
| reason | <code>string</code> | 

<a name="Peer+_peeringOfferPayloadDedupKey"></a>

### peer.\_peeringOfferPayloadDedupKey(msg) ⇒ <code>string</code>
Stable id for peering-offer *logical* content (ignores `peeringHop` and wire signature changes).

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

### peer.\_enqueuePeeringCandidate(host, port)
Enqueue a fabric candidate from [P2P_PEERING_OFFER](P2P_PEERING_OFFER); FIFO-capped and deduped by host:port.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| host | <code>string</code> | 
| port | <code>number</code> | 

<a name="Peer+broadcast"></a>

### peer.broadcast(message)
Write a [Buffer](Buffer) to all connected peers.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Buffer</code> | Message buffer to send. |

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

### peer.\_handleFabricMessage(buffer) ⇒ [<code>Peer</code>](#Peer)
Handle a Fabric [Message](#Message) buffer.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Peer</code>](#Peer) - Instance of the Peer.  

| Param | Type |
| --- | --- |
| buffer | <code>Buffer</code> | 

<a name="Peer+_buildDocumentParsedForPublish"></a>

### peer.\_buildDocumentParsedForPublish(documentId, content) ⇒ <code>Object</code>
Build hub-compatible document metadata for [purchaseContentHashHex](purchaseContentHashHex).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - Parsed document record (whitelisted fields)  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>String</code> |  |
| content | <code>String</code> | UTF-8 body |

<a name="Peer+_respondInventoryFromLocalDocuments"></a>

### peer.\_respondInventoryFromLocalDocuments(message, origin) ⇒ <code>boolean</code>
Reply to `INVENTORY_REQUEST` with `INVENTORY_RESPONSE` built from local documents and rates.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - true if an `INVENTORY_RESPONSE` was written to the requester  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Object</code> | Generic body from [Peer#_handleGenericMessage](Peer#_handleGenericMessage) |
| origin | <code>Object</code> |  |

<a name="Peer+_sendP2pFileSendToPeer"></a>

### peer.\_sendP2pFileSendToPeer(documentId, peerAddress) ⇒ <code>boolean</code>
Send a locally stored document to a connected peer as `P2P_FILE_SEND`.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - true if the payload was written  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>string</code> |  |
| peerAddress | <code>string</code> | connection key in [Peer#connections](Peer#connections) |

<a name="Peer+sendDocumentFileToPeer"></a>

### peer.sendDocumentFileToPeer(documentId, peerAddress) ⇒ <code>boolean</code>
Public helper: push document bytes to a peer (same wire path as [_handleDocumentRequestWire](#Peer+_handleDocumentRequestWire) fulfillment).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| documentId | <code>string</code> | 
| peerAddress | <code>string</code> | 

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

### peer.\_handleDocumentRequestWire(message, origin, socket)
Handle inbound `DOCUMENT_REQUEST`: emit `documentRequest` / `DocumentRequest`, then either
send `P2P_FILE_SEND` to the requester if `state.documents[id]` is present, or relay the
request to other peers (conditional relay).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| message | [<code>Message</code>](#Message) | 
| origin | <code>Object</code> | 
| socket | <code>\*</code> | 

<a name="Peer+_startFabricPingKeepalive"></a>

### peer.\_startFabricPingKeepalive(socket, encryptWrite)
Periodic P2P_PING and track expected P2P_PONG replies so registry score cannot be
self-inflated by unsolicited pongs (see FLUSH_CHAIN trust gate).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| socket | <code>\*</code> | — connection object (stores `_fabricPingOutstanding`, `_keepalive`) |
| encryptWrite | <code>\*</code> | — NOISE encrypt stream with `.write(Buffer)` (`client.encrypt` / `handler.encrypt`) |

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

<a name="Actor+commit"></a>

### peer.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>String</code> - 32-byte ID  
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
Signs the Actor.

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
    * [._inboundNoiseStaticPubkeyByAddress](#Peer+_inboundNoiseStaticPubkeyByAddress)
    * [.messages](#Peer+messages)
    * [._gossipPayloadSeen](#Peer+_gossipPayloadSeen)
    * [._gossipRelayByOrigin](#Peer+_gossipRelayByOrigin)
    * [._peeringPayloadSeen](#Peer+_peeringPayloadSeen)
    * [._peeringRelayByOrigin](#Peer+_peeringRelayByOrigin)
    * [._wireInboundByOrigin](#Peer+_wireInboundByOrigin)
    * [._candidateKeys](#Peer+_candidateKeys)
    * [._outboundDialTargets](#Peer+_outboundDialTargets)
    * ~~[.address](#Peer+address)~~
    * [._gossipPayloadDedupKey(msg)](#Peer+_gossipPayloadDedupKey) ⇒ <code>string</code>
    * [._gossipRateLimitAllow(originName)](#Peer+_gossipRateLimitAllow) ⇒ <code>boolean</code>
    * [._wireInboundCreditCost(wireType)](#Peer+_wireInboundCreditCost) ⇒ <code>number</code>
    * [._wireInboundRateAllowPeer(originName, creditCost)](#Peer+_wireInboundRateAllowPeer) ⇒ <code>boolean</code>
    * [._derankPeerForWireTraffic(originName, penalty, reason)](#Peer+_derankPeerForWireTraffic)
    * [._peeringOfferPayloadDedupKey(msg)](#Peer+_peeringOfferPayloadDedupKey) ⇒ <code>string</code>
    * [._peeringRateLimitAllow(originName)](#Peer+_peeringRateLimitAllow) ⇒ <code>boolean</code>
    * [._enqueuePeeringCandidate(host, port)](#Peer+_enqueuePeeringCandidate)
    * [.broadcast(message)](#Peer+broadcast)
    * [.relayFromTrustedPeers(origin, message, [minScoreExclusive])](#Peer+relayFromTrustedPeers)
    * [._registryScoreForConnectionAddress(connAddress)](#Peer+_registryScoreForConnectionAddress) ⇒ <code>number</code>
    * [._registryScoreForFlushChainSender(connAddress, senderPubkeyHex)](#Peer+_registryScoreForFlushChainSender) ⇒ <code>number</code>
    * [.sendFlushChainToTrustedPeers(object)](#Peer+sendFlushChainToTrustedPeers) ⇒ <code>number</code>
    * [._connect(target)](#Peer+_connect)
    * [._loadPeerRegistry()](#Peer+_loadPeerRegistry) ⇒ <code>Promise.&lt;void&gt;</code>
    * [._savePeerRegistry()](#Peer+_savePeerRegistry)
    * [._flushChainSenderPubkeyHex()](#Peer+_flushChainSenderPubkeyHex)
    * [._upsertPeerRegistry(address, [updates])](#Peer+_upsertPeerRegistry)
    * [._fillPeerSlots()](#Peer+_fillPeerSlots) ⇒ [<code>Peer</code>](#Peer)
    * [._handleFabricMessage(buffer)](#Peer+_handleFabricMessage) ⇒ [<code>Peer</code>](#Peer)
    * [._buildDocumentParsedForPublish(documentId, content)](#Peer+_buildDocumentParsedForPublish) ⇒ <code>Object</code>
    * [._respondInventoryFromLocalDocuments(message, origin)](#Peer+_respondInventoryFromLocalDocuments) ⇒ <code>boolean</code>
    * [._sendP2pFileSendToPeer(documentId, peerAddress)](#Peer+_sendP2pFileSendToPeer) ⇒ <code>boolean</code>
    * [.sendDocumentFileToPeer(documentId, peerAddress)](#Peer+sendDocumentFileToPeer) ⇒ <code>boolean</code>
    * [._buildPublishDocumentWireBuffers(documentId, body, rateSats)](#Peer+_buildPublishDocumentWireBuffers) ⇒ <code>Array.&lt;Buffer&gt;</code>
    * [._announceLocalDocumentsToPeer(peerAddress)](#Peer+_announceLocalDocumentsToPeer)
    * [._publishDocument(documentId, [content], [rateSats])](#Peer+_publishDocument)
    * [._handleDocumentRequestWire(message, origin, socket)](#Peer+_handleDocumentRequestWire)
    * [._startFabricPingKeepalive(socket, encryptWrite)](#Peer+_startFabricPingKeepalive)
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
    * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
    * [._send(message)](#Service+_send)
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

<a name="Peer+_inboundNoiseStaticPubkeyByAddress"></a>

### peer.\_inboundNoiseStaticPubkeyByAddress
Inbound address -> NOISE static pubkey hex (FLUSH_CHAIN allowlist only; never for AMP verify).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+messages"></a>

### peer.messages
Wire-envelope dedup (SHA-256 of full buffer); FIFO-capped via [Peer#_rememberWireHash](Peer#_rememberWireHash).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_gossipPayloadSeen"></a>

### peer.\_gossipPayloadSeen
Logical gossip payload dedup (excludes signature / hop churn).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_gossipRelayByOrigin"></a>

### peer.\_gossipRelayByOrigin
origin address → { count, windowStart } for gossip relay rate limiting.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_peeringPayloadSeen"></a>

### peer.\_peeringPayloadSeen
Logical peering-offer payload dedup (ignores per-hop re-signing).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_peeringRelayByOrigin"></a>

### peer.\_peeringRelayByOrigin
origin address → { count, windowStart } for peering-offer relay rate limiting.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_wireInboundByOrigin"></a>

### peer.\_wireInboundByOrigin
`host:port` → { credits, windowStart, penalized } — inbound wire flood / de-rank (per peer).

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_candidateKeys"></a>

### peer.\_candidateKeys
`host:port` keys for [P2P_PEERING_OFFER](P2P_PEERING_OFFER) candidate queue dedup.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_outboundDialTargets"></a>

### peer.\_outboundDialTargets
`host:port` strings we opened via [_connect](#Peer+_connect) (outbound dials).
[P2P_SESSION_OFFER](P2P_SESSION_OFFER) must not destroy these when the same peer also opens an inbound
socket (mesh star): otherwise RPC paths that use the listen address (e.g. ChainSyncRequest)
see `peer not connected` while an ephemeral inbound key remains.

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+address"></a>

### ~~peer.address~~
***Deprecated***

**Kind**: instance property of [<code>Peer</code>](#Peer)  
<a name="Peer+_gossipPayloadDedupKey"></a>

### peer.\_gossipPayloadDedupKey(msg) ⇒ <code>string</code>
Stable id for gossip *logical* content (ignores `gossipHop` and wire signature changes).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>string</code> - hex sha256  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>object</code> | Generic message (`type`, `object`, …) |

<a name="Peer+_gossipRateLimitAllow"></a>

### peer.\_gossipRateLimitAllow(originName) ⇒ <code>boolean</code>
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
Lower registry [Peer#knownPeers](Peer#knownPeers) score for a connection (Bitcoin Core misbehavior analogue).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| originName | <code>string</code> | 
| penalty | <code>number</code> | 
| reason | <code>string</code> | 

<a name="Peer+_peeringOfferPayloadDedupKey"></a>

### peer.\_peeringOfferPayloadDedupKey(msg) ⇒ <code>string</code>
Stable id for peering-offer *logical* content (ignores `peeringHop` and wire signature changes).

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

### peer.\_enqueuePeeringCandidate(host, port)
Enqueue a fabric candidate from [P2P_PEERING_OFFER](P2P_PEERING_OFFER); FIFO-capped and deduped by host:port.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| host | <code>string</code> | 
| port | <code>number</code> | 

<a name="Peer+broadcast"></a>

### peer.broadcast(message)
Write a [Buffer](Buffer) to all connected peers.

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Buffer</code> | Message buffer to send. |

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

### peer.\_handleFabricMessage(buffer) ⇒ [<code>Peer</code>](#Peer)
Handle a Fabric [Message](#Message) buffer.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Peer</code>](#Peer) - Instance of the Peer.  

| Param | Type |
| --- | --- |
| buffer | <code>Buffer</code> | 

<a name="Peer+_buildDocumentParsedForPublish"></a>

### peer.\_buildDocumentParsedForPublish(documentId, content) ⇒ <code>Object</code>
Build hub-compatible document metadata for [purchaseContentHashHex](purchaseContentHashHex).

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>Object</code> - Parsed document record (whitelisted fields)  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>String</code> |  |
| content | <code>String</code> | UTF-8 body |

<a name="Peer+_respondInventoryFromLocalDocuments"></a>

### peer.\_respondInventoryFromLocalDocuments(message, origin) ⇒ <code>boolean</code>
Reply to `INVENTORY_REQUEST` with `INVENTORY_RESPONSE` built from local documents and rates.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - true if an `INVENTORY_RESPONSE` was written to the requester  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Object</code> | Generic body from [Peer#_handleGenericMessage](Peer#_handleGenericMessage) |
| origin | <code>Object</code> |  |

<a name="Peer+_sendP2pFileSendToPeer"></a>

### peer.\_sendP2pFileSendToPeer(documentId, peerAddress) ⇒ <code>boolean</code>
Send a locally stored document to a connected peer as `P2P_FILE_SEND`.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>boolean</code> - true if the payload was written  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>string</code> |  |
| peerAddress | <code>string</code> | connection key in [Peer#connections](Peer#connections) |

<a name="Peer+sendDocumentFileToPeer"></a>

### peer.sendDocumentFileToPeer(documentId, peerAddress) ⇒ <code>boolean</code>
Public helper: push document bytes to a peer (same wire path as [_handleDocumentRequestWire](#Peer+_handleDocumentRequestWire) fulfillment).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| documentId | <code>string</code> | 
| peerAddress | <code>string</code> | 

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

### peer.\_handleDocumentRequestWire(message, origin, socket)
Handle inbound `DOCUMENT_REQUEST`: emit `documentRequest` / `DocumentRequest`, then either
send `P2P_FILE_SEND` to the requester if `state.documents[id]` is present, or relay the
request to other peers (conditional relay).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type |
| --- | --- |
| message | [<code>Message</code>](#Message) | 
| origin | <code>Object</code> | 
| socket | <code>\*</code> | 

<a name="Peer+_startFabricPingKeepalive"></a>

### peer.\_startFabricPingKeepalive(socket, encryptWrite)
Periodic P2P_PING and track expected P2P_PONG replies so registry score cannot be
self-inflated by unsolicited pongs (see FLUSH_CHAIN trust gate).

**Kind**: instance method of [<code>Peer</code>](#Peer)  

| Param | Type | Description |
| --- | --- | --- |
| socket | <code>\*</code> | — connection object (stores `_fabricPingOutstanding`, `_keepalive`) |
| encryptWrite | <code>\*</code> | — NOISE encrypt stream with `.write(Buffer)` (`client.encrypt` / `handler.encrypt`) |

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

<a name="Actor+commit"></a>

### peer.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: <code>String</code> - 32-byte ID  
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
Signs the Actor.

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

<a name="Reader"></a>

## Reader
Read from a byte stream, seeking valid Fabric messages.

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
Signs the Actor.

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
Signs the Actor.

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
Signs the Actor.

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
    * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
    * [._send(message)](#Service+_send)
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

<a name="Actor+commit"></a>

### service.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Overrides**: [<code>commit</code>](#Actor+commit)  
**Returns**: <code>String</code> - 32-byte ID  
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
Signs the Actor.

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
    * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
    * [._send(message)](#Service+_send)
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

<a name="Actor+commit"></a>

### service.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Service</code>](#Service)  
**Overrides**: [<code>commit</code>](#Actor+commit)  
**Returns**: <code>String</code> - 32-byte ID  
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
Signs the Actor.

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
    * [.start()](#Session+start)
    * [.stop()](#Session+stop)

<a name="new_Session_new"></a>

### new Session([settings])
Creates a new [Session](#Session).

**Returns**: [<code>Session</code>](#Session) - The session instance.  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Configuration. |

<a name="Session+start"></a>

### session.start()
Opens the [Session](#Session) for interaction.

**Kind**: instance method of [<code>Session</code>](#Session)  
<a name="Session+stop"></a>

### session.stop()
Closes the [Session](#Session), preventing further interaction.

**Kind**: instance method of [<code>Session</code>](#Session)  
<a name="State"></a>

## State ⇐ [<code>Actor</code>](#Actor)
<strong>Named snapshot</strong> of application data extending [Actor](#Actor) — <code>@type</code>,
<code>@data</code>, <code>@id</code>, JSON Patch
flows. Absorbs former <strong>Scribe</strong> behavior: <code>verbose</code> / <code>verbosity</code>, <code>now</code>,
<code>trust</code>, <code>start</code>/<code>stop</code>, and structured <code>log</code> / <code>error</code> /
<code>warn</code> / <code>debug</code> (console + events). [Channel](#Channel), [Document](Document), [Ledger](#Ledger),
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
Signs the Actor.

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
Signs the Actor.

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
Signs the Actor.

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
Signs the Actor.

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
    * _static_
        * [.verifySigned(tokenString, verificationKey)](#Token.verifySigned) ⇒ <code>Object</code> \| <code>null</code>

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

<a name="Token.verifySigned"></a>

### Token.verifySigned(tokenString, verificationKey) ⇒ <code>Object</code> \| <code>null</code>
Verify a signed token string. Returns parsed payload if valid, null otherwise.

**Kind**: static method of [<code>Token</code>](#Token)  

| Param | Type | Description |
| --- | --- | --- |
| tokenString | <code>string</code> |  |
| verificationKey | [<code>Key</code>](#Key) | Key used to verify the signature (must match issuer). |

<a name="Tree"></a>

## Tree
Class implementing a Merkle Tree.

**Kind**: global class  

* [Tree](#Tree)
    * [new Tree([settings])](#new_Tree_new)
    * [.addLeaf(leaf)](#Tree+addLeaf) ⇒ [<code>Tree</code>](#Tree)
    * [.getLeaves()](#Tree+getLeaves) ⇒ <code>Array</code>

<a name="new_Tree_new"></a>

### new Tree([settings])
Create an instance of a Tree.

**Returns**: [<code>Tree</code>](#Tree) - Instance of the tree.  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Configuration. |

<a name="Tree+addLeaf"></a>

### tree.addLeaf(leaf) ⇒ [<code>Tree</code>](#Tree)
Add a leaf to the tree.

**Kind**: instance method of [<code>Tree</code>](#Tree)  
**Returns**: [<code>Tree</code>](#Tree) - Instance of the tree.  

| Param | Type | Description |
| --- | --- | --- |
| leaf | <code>String</code> | Leaf to add to the tree. |

<a name="Tree+getLeaves"></a>

### tree.getLeaves() ⇒ <code>Array</code>
Get a list of the [Tree](#Tree)'s leaves.

**Kind**: instance method of [<code>Tree</code>](#Tree)  
**Returns**: <code>Array</code> - A list of the [Tree](#Tree)'s leaves.  
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
        * [.loadKey(input, [labels])](#Wallet+loadKey) ⇒ <code>Object</code>
        * [.start()](#Wallet+start)
        * [.getAddressForScript(script)](#Wallet+getAddressForScript)
        * [.getAddressFromRedeemScript(redeemScript)](#Wallet+getAddressFromRedeemScript)
        * [._sign(tx)](#Wallet+_sign)
        * [._createCrowdfund(fund)](#Wallet+_createCrowdfund)
        * [._getSwapInputScript(redeemScript, secret)](#Wallet+_getSwapInputScript)
        * [._getRefundInputScript(redeemScript)](#Wallet+_getRefundInputScript)
        * [.publicKeyFromString(input)](#Wallet+publicKeyFromString)
    * _static_
        * [.createSeed(passphrase)](#Wallet.createSeed) ⇒ <code>FabricSeed</code>
        * [.fromSeed(seed)](#Wallet.fromSeed) ⇒ [<code>Wallet</code>](#Wallet)
        * [.purchaseContentHashHex(documentId, parsed)](#Wallet.purchaseContentHashHex) ⇒ <code>string</code>

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
L1 / hub document purchase binding: same 64-char hex as hub `CreatePurchaseInvoice` / HTLC `contentHash`.

**Kind**: static method of [<code>Wallet</code>](#Wallet)  

| Param | Type | Description |
| --- | --- | --- |
| documentId | <code>string</code> |  |
| parsed | <code>object</code> | Whitelisted document fields (see [_buildDocumentParsedForPublish](#Peer+_buildDocumentParsedForPublish)). |

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
        * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
        * [._send(message)](#Service+_send)
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
| block | <code>Block</code> | Block to handle. |

<a name="Bitcoin+_handlePeerPacket"></a>

### bitcoin.\_handlePeerPacket(msg)
Process a message from a peer in the Bitcoin network.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>PeerPacket</code> | Message from peer. |

<a name="Bitcoin+_handleBlockFromSPV"></a>

### bitcoin.\_handleBlockFromSPV(msg)
Hand a [Block](Block) message as supplied by an [SPV](SPV) client.

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

<a name="Actor+commit"></a>

### bitcoin.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>commit</code>](#Actor+commit)  
**Returns**: <code>String</code> - 32-byte ID  
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
Signs the Actor.

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
Manage a Lightning node.

**Kind**: global class  

* [Lightning](#Lightning)
    * [new Lightning([settings])](#new_Lightning_new)
    * _instance_
        * [.createChannel(peer, amount, [pushMsat], [options])](#Lightning+createChannel)
        * [.createInvoice(amount)](#Lightning+createInvoice)
        * [.computeLiquidity()](#Lightning+computeLiquidity) ⇒ <code>Object</code>
        * [._makeRPCRequest(method, [params], [timeoutMs])](#Lightning+_makeRPCRequest) ⇒ <code>Object</code> \| <code>String</code>
    * _static_
        * [.CLN_RPC_METHODS](#Lightning.CLN_RPC_METHODS) : <code>ReadonlyArray.&lt;string&gt;</code>
        * [.defaultListenPortForNetwork([network])](#Lightning.defaultListenPortForNetwork) ⇒ <code>number</code>

<a name="new_Lightning_new"></a>

### new Lightning([settings])
Create an instance of the Lightning [Service](#Service).


| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Settings. |

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

### lightning.createInvoice(amount)
Create a new Lightning invoice.

**Kind**: instance method of [<code>Lightning</code>](#Lightning)  

| Param | Type | Description |
| --- | --- | --- |
| amount | <code>String</code> | Amount in millisatoshi (msat). |

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
<a name="Lightning.defaultListenPortForNetwork"></a>

### Lightning.defaultListenPortForNetwork([network]) ⇒ <code>number</code>
Default TCP port lightningd listens on when [settings.port](settings.port) is omitted (BOLT / common conventions).

**Kind**: static method of [<code>Lightning</code>](#Lightning)  

| Param | Type |
| --- | --- |
| [network] | <code>string</code> | 

<a name="Redis"></a>

## Redis
Connect and subscribe to Redis servers.

**Kind**: global class  

* [Redis](#Redis)
    * [new Redis([settings])](#new_Redis_new)
    * [.start()](#Redis+start) ⇒ [<code>Redis</code>](#Redis)
    * [.stop()](#Redis+stop) ⇒ [<code>Redis</code>](#Redis)

<a name="new_Redis_new"></a>

### new Redis([settings])
Creates an instance of a Redis subscriber.

**Returns**: [<code>Redis</code>](#Redis) - Instance of the Redis service, ready to run `start()`  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Settings for the Redis connection. |
| [settings.host] | <code>String</code> | Host for the Redis server. |
| [settings.port] | <code>Number</code> | Remote Redis service port. |

<a name="Redis+start"></a>

### redis.start() ⇒ [<code>Redis</code>](#Redis)
Opens the connection and subscribes to the requested channels.

**Kind**: instance method of [<code>Redis</code>](#Redis)  
**Returns**: [<code>Redis</code>](#Redis) - Instance of the service.  
<a name="Redis+stop"></a>

### redis.stop() ⇒ [<code>Redis</code>](#Redis)
Closes the connection to the Redis server.

**Kind**: instance method of [<code>Redis</code>](#Redis)  
**Returns**: [<code>Redis</code>](#Redis) - Instance of the service.  
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
        * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
        * [._send(message)](#Service+_send)
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
        * [.tokenize(string)](#Text.tokenize) ⇒ <code>Array.&lt;string&gt;</code>
        * [.truncateMiddle(fullStr, strLen, [separator])](#Text.truncateMiddle) ⇒ <code>string</code>
        * [.toRelativeTime(date)](#Text.toRelativeTime) ⇒ <code>string</code>
        * [.oxfordJoin(list)](#Text.oxfordJoin) ⇒ <code>string</code>

<a name="new_Text_new"></a>

### new Text()
Text-oriented [Service](#Service) stub (legacy name was <code>TXT</code>).
Static helpers mirror small utilities used in Sensemaker (tokenize, middle truncation,
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

<a name="Actor+commit"></a>

### text.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>String</code> - 32-byte ID  
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
Signs the Actor.

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
Split on runs of whitespace (Sensemaker-style tokenization).

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
Human-readable relative time (e.g. <code>3 days ago</code>), ported from Sensemaker.

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
<a name="SAT_ADJ_EPS"></a>

## SAT\_ADJ\_EPS
Max |sats − round(sats)| allowed when scaling BTC → satoshis (reject fractional satoshis; allow float noise).

**Kind**: global constant  
<a name="BITCOIN_COOKIE_PATH_MAX_LEN"></a>

## BITCOIN\_COOKIE\_PATH\_MAX\_LEN
Reject absurd paths from env/settings before touching the filesystem (Codacy/Semgrep-friendly bounds).

**Kind**: global constant  
<a name="BITCOIND_CHAIN_FOLDER_NAMES"></a>

## BITCOIND\_CHAIN\_FOLDER\_NAMES
Directory names Bitcoin Core uses under {@code -datadir} (used to block traversal in `.cookie` paths).

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
        * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
        * [._send(message)](#Service+_send)
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
        * [.tokenize(string)](#Text.tokenize) ⇒ <code>Array.&lt;string&gt;</code>
        * [.truncateMiddle(fullStr, strLen, [separator])](#Text.truncateMiddle) ⇒ <code>string</code>
        * [.toRelativeTime(date)](#Text.toRelativeTime) ⇒ <code>string</code>
        * [.oxfordJoin(list)](#Text.oxfordJoin) ⇒ <code>string</code>

<a name="new_Text_new"></a>

### new Text()
Text-oriented [Service](#Service) stub (legacy name was <code>TXT</code>).
Static helpers mirror small utilities used in Sensemaker (tokenize, middle truncation,
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

<a name="Actor+commit"></a>

### text.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Text</code>](#Text)  
**Returns**: <code>String</code> - 32-byte ID  
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
Signs the Actor.

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
Split on runs of whitespace (Sensemaker-style tokenization).

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
Human-readable relative time (e.g. <code>3 days ago</code>), ported from Sensemaker.

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

<a name="cookiePathUnderDatadirBase"></a>

## cookiePathUnderDatadirBase(baseAbs, parts) ⇒ <code>string</code> \| <code>null</code>
Append fixed path components under a resolved base; return null if the result leaves {@code baseAbs}.

**Kind**: global function  

| Param | Type | Description |
| --- | --- | --- |
| baseAbs | <code>string</code> |  |
| parts | <code>Array.&lt;string&gt;</code> | — no separators; validated by caller |

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

