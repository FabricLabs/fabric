## Classes

<dl>
<dt><a href="#Actor">Actor</a></dt>
<dd><p>Generic Fabric Actor.</p>
</dd>
<dt><a href="#Aggregator">Aggregator</a></dt>
<dd><p>Aggregates a set of balances (inputs).</p>
</dd>
<dt><a href="#App">App</a> ⇐ <code><a href="#Service">Service</a></code></dt>
<dd><p>Web-friendly application framework for building single-page applications with
Fabric-based networking and storage.</p>
</dd>
<dt><a href="#Chain">Chain</a></dt>
<dd><p>Chain.</p>
</dd>
<dt><a href="#Channel">Channel</a></dt>
<dd><p>The <a href="#Channel">Channel</a> is a encrypted connection with a member of your
<a href="#Peer">Peer</a> group, with some amount of $BTC bonded and paid for each
correctly-validated message.</p>
<p>Channels in Fabric are powerful tools for application development, as they
can empower users with income opportunities in exchange for delivering
service to the network.</p>
</dd>
<dt><a href="#Circuit">Circuit</a></dt>
<dd><p>The <a href="#Circuit">Circuit</a> is the mechanism through which <a href="#Fabric">Fabric</a>
operates, a computable directed graph describing a network of
<a href="#Peer">Peer</a> components and their interactions (side effects).
See also <a href="#Swarm">Swarm</a> for deeper *inspection of <a href="#Machine">Machine</a>
mechanics.</p>
</dd>
<dt><a href="#CLI">CLI</a></dt>
<dd><p>Provides a Command Line Interface (CLI) for interacting with
the Fabric network using a terminal emulator.</p>
</dd>
<dt><a href="#Collection">Collection</a></dt>
<dd><p>The <a href="#Collection">Collection</a> type maintains an ordered list of <a href="#State">State</a> items.</p>
</dd>
<dt><a href="#Compiler">Compiler</a> : <code><a href="#Actor">Actor</a></code></dt>
<dd><p>Compilers build interfaces for users of Fabric applications.</p>
</dd>
<dt><a href="#Consensus">Consensus</a></dt>
<dd><p>Provides various network-specific rules.</p>
</dd>
<dt><a href="#Entity">Entity</a> : <code>Object</code></dt>
<dd><p>Live instance of an ARC in Fabric.</p>
</dd>
<dt><a href="#Fabric">Fabric</a></dt>
<dd><p>Reliable decentralized infrastructure.</p>
</dd>
<dt><a href="#Federation">Federation</a></dt>
<dd><p>Create and manage sets of signers with the Federation class.</p>
</dd>
<dt><a href="#Filesystem">Filesystem</a></dt>
<dd></dd>
<dt><a href="#Hash256">Hash256</a></dt>
<dd><p>Simple interaction with 256-bit spaces.</p>
</dd>
<dt><a href="#HKDF">HKDF</a></dt>
<dd><p>Provides an HMAC-based Extract-and-Expand Key Derivation Function (HKDF), compatible with
RFC 5869.  Defaults to 32 byte output, matching Bitcoin&#39;s implementaton.</p>
</dd>
<dt><a href="#Interface">Interface</a> ⇐ <code>EventEmitter</code></dt>
<dd><p>Interfaces compile abstract contract code into <a href="#Chain">Chain</a>-executable transactions, or &quot;chaincode&quot;. For example, the &quot;Bitcoin&quot; interface might compile a Swap contract into Script, preparing a valid Bitcoin transaction for broadcast which executes the swap contract.</p>
</dd>
<dt><a href="#Key">Key</a></dt>
<dd><p>Represents a cryptographic key.</p>
</dd>
<dt><a href="#Keystore">Keystore</a></dt>
<dd><p>Provides an encrypted datastore for generic object storage.</p>
</dd>
<dt><a href="#Ledger">Ledger</a> ⇐ <code><a href="#Scribe">Scribe</a></code></dt>
<dd><p>An ordered stack of pages.</p>
</dd>
<dt><a href="#Logger">Logger</a> ⇐ <code><a href="#Actor">Actor</a></code></dt>
<dd><p>A basic logger that writes logs to the local file system</p>
</dd>
<dt><a href="#Machine">Machine</a></dt>
<dd><p>General-purpose state machine with <a href="#Vector">Vector</a>-based instructions.</p>
</dd>
<dt><a href="#Mempool">Mempool</a></dt>
<dd><p>Stores a list of <a href="Transaction">Transaction</a> elements.</p>
</dd>
<dt><a href="#Message">Message</a> : <code>Object</code></dt>
<dd><p>The <a href="#Message">Message</a> type defines the Application Messaging Protocol, or AMP.
Each <a href="#Actor">Actor</a> in the network receives and broadcasts messages,
selectively disclosing new routes to peers which may have open circuits.</p>
</dd>
<dt><a href="#Node">Node</a></dt>
<dd><p>Full definition of a Fabric node.</p>
</dd>
<dt><a href="#Oracle">Oracle</a> ⇐ <code><a href="#Store">Store</a></code></dt>
<dd><p>An Oracle manages one or more collections, using a <code>mempool</code> for
transitive state.</p>
</dd>
<dt><a href="#Path">Path</a></dt>
<dd><p>A <a href="#Path">Path</a> is a <a href="#Fabric">Fabric</a>-native link to a <a href="Document">Document</a>
within the network.</p>
</dd>
<dt><a href="#Peer">Peer</a></dt>
<dd><p>An in-memory representation of a node in our network.</p>
</dd>
<dt><a href="#Reader">Reader</a></dt>
<dd><p>Read from a byte stream, seeking valid Fabric messages.</p>
</dd>
<dt><a href="#Resource">Resource</a></dt>
<dd><p>Generic interface for collections of digital objects.</p>
</dd>
<dt><a href="#Router">Router</a> ⇐ <code><a href="#Scribe">Scribe</a></code></dt>
<dd><p>Process incoming messages.</p>
</dd>
<dt><a href="#Scribe">Scribe</a> ⇐ <code><a href="#State">State</a></code></dt>
<dd><p>Simple tag-based recordkeeper.</p>
</dd>
<dt><a href="#Script">Script</a></dt>
<dd></dd>
<dt><a href="#Service">Service</a></dt>
<dd><p>The &quot;Service&quot; is a simple model for processing messages in a distributed
system.  <a href="#Service">Service</a> instances are public interfaces for outside systems,
and typically advertise their presence to the network.</p>
<p>To implement a Service, you will typically need to implement all methods from
this prototype.  In general, <code>connect</code> and <code>send</code> are the highest-priority
jobs, and by default the <code>fabric</code> property will serve as an I/O stream using
familiar semantics.</p>
</dd>
<dt><a href="#Session">Session</a></dt>
<dd><p>The <a href="#Session">Session</a> type describes a connection between <a href="#Peer">Peer</a>
objects, and includes its own lifecycle.</p>
</dd>
<dt><a href="#Signer">Signer</a></dt>
<dd><p>Generic Fabric Signer.</p>
</dd>
<dt><a href="#Snapshot">Snapshot</a></dt>
<dd><p>A type of message to be expected from a <a href="#Service">Service</a>.</p>
</dd>
<dt><a href="#Stack">Stack</a></dt>
<dd><p>Manage stacks of data.</p>
</dd>
<dt><a href="#State">State</a> ⇐ <code>EventEmitter</code></dt>
<dd><p>The <a href="#State">State</a> is the core of most <a href="User">User</a>-facing interactions.  To
interact with the <a href="User">User</a>, simply propose a change in the state by
committing to the outcome.  This workflow keeps app design quite simple!</p>
</dd>
<dt><a href="#Store">Store</a></dt>
<dd><p>Long-term storage.</p>
</dd>
<dt><a href="#Swap">Swap</a> : <code>Object</code></dt>
<dd><p>The <a href="#Swap">Swap</a> contract executes a set of transactions on two distinct
<a href="#Chain">Chain</a> components, utilizing a secret-reveal mechanism to atomically
execute either the full set or none.</p>
</dd>
<dt><a href="#Swarm">Swarm</a> : <code>String</code></dt>
<dd><p>Orchestrates a network of peers.</p>
</dd>
<dt><a href="#Transition">Transition</a></dt>
<dd><p>The <a href="#Transition">Transition</a> type reflects a change from one finite
<a href="#State">State</a> to another.</p>
</dd>
<dt><a href="#Tree">Tree</a></dt>
<dd><p>Class implementing a Merkle Tree.</p>
</dd>
<dt><a href="#Value">Value</a></dt>
<dd><p><a href="Number">Number</a>-like type.</p>
</dd>
<dt><a href="#Vector">Vector</a></dt>
<dd></dd>
<dt><a href="#Walker">Walker</a></dt>
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
<dt><a href="#Exchange">Exchange</a></dt>
<dd><p>Implements a basic Exchange.</p>
</dd>
<dt><a href="#Redis">Redis</a></dt>
<dd><p>Connect and subscribe to ZeroMQ servers.</p>
</dd>
<dt><a href="#ZMQ">ZMQ</a></dt>
<dd><p>Connect and subscribe to ZeroMQ publishers.</p>
</dd>
<dt><del><a href="#HTTPServer">HTTPServer</a></del></dt>
<dd><p>Deprecated 2021-10-16.</p>
</dd>
<dt><del><a href="#Scribe">Scribe</a></del></dt>
<dd><p>Deprecated 2021-11-06.</p>
</dd>
<dt><del><a href="#Stash">Stash</a></del></dt>
<dd><p>Deprecated 2021-11-06.</p>
</dd>
</dl>

<a name="Actor"></a>

## Actor
Generic Fabric Actor.

**Kind**: global class  
**Emits**: <code>event:message Fabric {@link Message} objects.</code>  
**Access**: protected  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Unique identifier for this Actor (id === SHA256(preimage)). |
| preimage | <code>String</code> | Input hash for the `id` property (preimage === SHA256(ActorState)). |


* [Actor](#Actor)
    * [new Actor([actor])](#new_Actor_new)
    * [.commit()](#Actor+commit) ⇒ <code>String</code>
    * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
    * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
    * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
    * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
    * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
    * [._readObject(input)](#Actor+_readObject) ⇒ <code>Object</code>

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
| [actor.seed] | <code>String</code> | BIP24 Mnemonic to use as a seed phrase. |
| [actor.public] | <code>Buffer</code> | Public key. |
| [actor.private] | <code>Buffer</code> | Private key. |

<a name="Actor+commit"></a>

### actor.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>String</code> - 32-byte ID  
**Emits**: <code>event:Actor Current malleable state.</code>  
<a name="Actor+toBuffer"></a>

### actor.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
<a name="Actor+toObject"></a>

### actor.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Actor</code>](#Actor)  
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
@

**Kind**: instance method of [<code>Actor</code>](#Actor)  
<a name="Actor+_readObject"></a>

### actor.\_readObject(input) ⇒ <code>Object</code>
Parse an Object into a corresponding Fabric state.

**Kind**: instance method of [<code>Actor</code>](#Actor)  
**Returns**: <code>Object</code> - Fabric state.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Object</code> | Object to read as input. |

<a name="Aggregator"></a>

## Aggregator
Aggregates a set of balances (inputs).

**Kind**: global class  

* [Aggregator](#Aggregator)
    * [new Aggregator([settings])](#new_Aggregator_new)
    * [._importBalances(list)](#Aggregator+_importBalances) ⇒ <code>AnchorBalance</code>
    * [._computeBalances()](#Aggregator+_computeBalances) ⇒ <code>AnchorBalance</code>
    * [.commit()](#Aggregator+commit) ⇒ <code>AggregatorCommit</code>
    * ["commit"](#Aggregator+event_commit)

<a name="new_Aggregator_new"></a>

### new Aggregator([settings])
Create a new Aggregator.

**Returns**: [<code>Aggregator</code>](#Aggregator) - Instance of the [Aggregator](#Aggregator).  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Map of configuration values. |
| [settings.inputs] | <code>Array</code> | Array of [AnchorBalance](AnchorBalance) instances. |

<a name="Aggregator+_importBalances"></a>

### aggregator.\_importBalances(list) ⇒ <code>AnchorBalance</code>
Import a list of [AnchorBalance](AnchorBalance) instances.

**Kind**: instance method of [<code>Aggregator</code>](#Aggregator)  
**Returns**: <code>AnchorBalance</code> - Summary of resulting balances.  

| Param | Type | Description |
| --- | --- | --- |
| list | <code>Array</code> | List of inputs to add. |

<a name="Aggregator+_computeBalances"></a>

### aggregator.\_computeBalances() ⇒ <code>AnchorBalance</code>
Updates the state to reflect balances from current inputs.

**Kind**: instance method of [<code>Aggregator</code>](#Aggregator)  
**Returns**: <code>AnchorBalance</code> - Summary of balances.  
<a name="Aggregator+commit"></a>

### aggregator.commit() ⇒ <code>AggregatorCommit</code>
Commits the balance of all input.

**Kind**: instance method of [<code>Aggregator</code>](#Aggregator)  
**Returns**: <code>AggregatorCommit</code> - Commit instance.  
**Emits**: [<code>commit</code>](#Aggregator+event_commit)  
<a name="Aggregator+event_commit"></a>

### "commit"
Commit event.

**Kind**: event emitted by [<code>Aggregator</code>](#Aggregator)  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| root | <code>Uint8Array</code> | Root of the [Tree](#Tree). |
| leaves | <code>Array</code> | Leaves of the [Tree](#Tree). |

<a name="App"></a>

## App ⇐ [<code>Service</code>](#Service)
Web-friendly application framework for building single-page applications with
Fabric-based networking and storage.

**Kind**: global class  
**Extends**: [<code>Service</code>](#Service)  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| components | [<code>Collection</code>](#Collection) | Interface elements. |
| stash | [<code>Store</code>](#Store) | Routable [Datastore](Datastore). |


* [App](#App) ⇐ [<code>Service</code>](#Service)
    * [new App(definition)](#new_App_new)
    * [.start()](#App+start) ⇒ <code>Promise</code>
    * [.stop()](#App+stop) ⇒ <code>Promise</code>
    * [.define(name, structure)](#App+define) ⇒ <code>Object</code>
    * [.defer(authority)](#App+defer) ⇒ [<code>App</code>](#App)
    * [.attach(element)](#App+attach) ⇒ [<code>App</code>](#App)
    * [.consume(resources)](#App+consume) ⇒ [<code>App</code>](#App)
    * [.envelop(selector)](#App+envelop) ⇒ [<code>App</code>](#App)
    * [.use(name, definition)](#App+use) ⇒ [<code>App</code>](#App)
    * [.render()](#App+render) ⇒ <code>String</code>
    * [._registerService(name, Service)](#App+_registerService) ⇒ [<code>Service</code>](#Service)
    * [.init()](#Service+init)
    * [.tick()](#Service+tick) ⇒ <code>Number</code>
    * [.get(path)](#Service+get) ⇒ <code>Mixed</code>
    * [.set(path)](#Service+set) ⇒ <code>Mixed</code>
    * [.trust(source)](#Service+trust) ⇒ [<code>Service</code>](#Service)
    * [.handler(message)](#Service+handler) ⇒ [<code>Service</code>](#Service)
    * [.lock([duration])](#Service+lock) ⇒ <code>Boolean</code>
    * [.route(msg)](#Service+route) ⇒ <code>Promise</code>
    * [._GET(path)](#Service+_GET) ⇒ <code>Promise</code>
    * [._PUT(path, value, [commit])](#Service+_PUT) ⇒ <code>Promise</code>
    * [.connect(notify)](#Service+connect) ⇒ <code>Promise</code>
    * [.send(channel, message)](#Service+send) ⇒ [<code>Service</code>](#Service)
    * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
    * [._send(message)](#Service+_send)

<a name="new_App_new"></a>

### new App(definition)
Generic bundle for building Fabric applications.

**Returns**: [<code>App</code>](#App) - Returns an instance of `App`.  

| Param | Type | Description |
| --- | --- | --- |
| definition | <code>Object</code> | Application definition.  See `config` for examples. |

<a name="App+start"></a>

### app.start() ⇒ <code>Promise</code>
Start the program.

**Kind**: instance method of [<code>App</code>](#App)  
**Overrides**: [<code>start</code>](#Service+start)  
<a name="App+stop"></a>

### app.stop() ⇒ <code>Promise</code>
Stop the program.

**Kind**: instance method of [<code>App</code>](#App)  
<a name="App+define"></a>

### app.define(name, structure) ⇒ <code>Object</code>
Define a Resource, or "Type", used by the application.

**Kind**: instance method of [<code>App</code>](#App)  
**Returns**: <code>Object</code> - [description]  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | Human-friendly name for the Resource. |
| structure | <code>Object</code> | Map of attribute names -> definitions. |

<a name="App+defer"></a>

### app.defer(authority) ⇒ [<code>App</code>](#App)
Defer control of this application to an outside authority.

**Kind**: instance method of [<code>App</code>](#App)  
**Returns**: [<code>App</code>](#App) - The configured application as deferred to `authority`.  

| Param | Type | Description |
| --- | --- | --- |
| authority | <code>String</code> | Hostname to trust. |

<a name="App+attach"></a>

### app.attach(element) ⇒ [<code>App</code>](#App)
Configure the Application to use a specific element.

**Kind**: instance method of [<code>App</code>](#App)  
**Returns**: [<code>App</code>](#App) - Configured instance of the Application.  

| Param | Type | Description |
| --- | --- | --- |
| element | <code>DOMElement</code> | DOM element to bind to. |

<a name="App+consume"></a>

### app.consume(resources) ⇒ [<code>App</code>](#App)
Define the Application's resources from an existing resource map.

**Kind**: instance method of [<code>App</code>](#App)  
**Returns**: [<code>App</code>](#App) - Configured instance of the Application.  

| Param | Type | Description |
| --- | --- | --- |
| resources | <code>Object</code> | Map of resource definitions by name. |

<a name="App+envelop"></a>

### app.envelop(selector) ⇒ [<code>App</code>](#App)
Use a CSS selector to find an element in the current document's tree and
bind to it as the render target.

**Kind**: instance method of [<code>App</code>](#App)  
**Returns**: [<code>App</code>](#App) - Instance of app with bound element.  

| Param | Type | Description |
| --- | --- | --- |
| selector | <code>String</code> | CSS selector. |

<a name="App+use"></a>

### app.use(name, definition) ⇒ [<code>App</code>](#App)
Define a named [Resource](#Resource).

**Kind**: instance method of [<code>App</code>](#App)  
**Returns**: [<code>App</code>](#App) - Configurated instance of the [App](#App).  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | Human-friendly name for this resource. |
| definition | <code>Object</code> | Map of configuration values. |

<a name="App+render"></a>

### app.render() ⇒ <code>String</code>
Get the output of our program.

**Kind**: instance method of [<code>App</code>](#App)  
**Returns**: <code>String</code> - Output of the program.  
<a name="App+_registerService"></a>

### app.\_registerService(name, Service) ⇒ [<code>Service</code>](#Service)
Registers a named [Service](#Service) with the application.  Services are
standardized interfaces for Fabric contracts, emitting [Message](#Message)
events with a predictable lifecycle.

**Kind**: instance method of [<code>App</code>](#App)  
**Returns**: [<code>Service</code>](#Service) - The registered service instance.  
**Internal**:   

| Param | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | Internal name of the service. |
| Service | <code>Class</code> | The ES6 class definition implementing [Service](#Service). |

<a name="Service+init"></a>

### app.init()
Called by Web Components.
TODO: move to @fabric/http/types/spa

**Kind**: instance method of [<code>App</code>](#App)  
**Overrides**: [<code>init</code>](#Service+init)  
<a name="Service+tick"></a>

### app.tick() ⇒ <code>Number</code>
Move forward one clock cycle.

**Kind**: instance method of [<code>App</code>](#App)  
**Overrides**: [<code>tick</code>](#Service+tick)  
<a name="Service+get"></a>

### app.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>App</code>](#App)  
**Overrides**: [<code>get</code>](#Service+get)  

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

<a name="Service+set"></a>

### app.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>App</code>](#App)  
**Overrides**: [<code>set</code>](#Service+set)  

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

<a name="Service+trust"></a>

### app.trust(source) ⇒ [<code>Service</code>](#Service)
Explicitly trust all events from a known source.

**Kind**: instance method of [<code>App</code>](#App)  
**Overrides**: [<code>trust</code>](#Service+trust)  
**Returns**: [<code>Service</code>](#Service) - Instance of Service after binding events.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Emitter of events. |

<a name="Service+handler"></a>

### app.handler(message) ⇒ [<code>Service</code>](#Service)
Default route handler for an incoming message.  Follows the Activity
Streams 2.0 spec: https://www.w3.org/TR/activitystreams-core/

**Kind**: instance method of [<code>App</code>](#App)  
**Overrides**: [<code>handler</code>](#Service+handler)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Activity</code> | Message object. |

<a name="Service+lock"></a>

### app.lock([duration]) ⇒ <code>Boolean</code>
Attempt to acquire a lock for `duration` seconds.

**Kind**: instance method of [<code>App</code>](#App)  
**Overrides**: [<code>lock</code>](#Service+lock)  
**Returns**: <code>Boolean</code> - true if locked, false if unable to lock.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [duration] | <code>Number</code> | <code>1000</code> | Number of milliseconds to hold lock. |

<a name="Service+route"></a>

### app.route(msg) ⇒ <code>Promise</code>
Resolve a [State](#State) from a particular [Message](#Message) object.

**Kind**: instance method of [<code>App</code>](#App)  
**Overrides**: [<code>route</code>](#Service+route)  
**Returns**: <code>Promise</code> - Resolves with resulting [State](#State).  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | Explicit Fabric [Message](#Message). |

<a name="Service+_GET"></a>

### app.\_GET(path) ⇒ <code>Promise</code>
Retrieve a value from the Service's state.

**Kind**: instance method of [<code>App</code>](#App)  
**Overrides**: [<code>\_GET</code>](#Service+_GET)  
**Returns**: <code>Promise</code> - Resolves with the result.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Path of the value to retrieve. |

<a name="Service+_PUT"></a>

### app.\_PUT(path, value, [commit]) ⇒ <code>Promise</code>
Store a value in the Service's state.

**Kind**: instance method of [<code>App</code>](#App)  
**Overrides**: [<code>\_PUT</code>](#Service+_PUT)  
**Returns**: <code>Promise</code> - Resolves with with stored document.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>String</code> |  | Path to store the value at. |
| value | <code>Object</code> |  | Document to store. |
| [commit] | <code>Boolean</code> | <code>false</code> | Sign the resulting state. |

<a name="Service+connect"></a>

### app.connect(notify) ⇒ <code>Promise</code>
Attach to network.

**Kind**: instance method of [<code>App</code>](#App)  
**Overrides**: [<code>connect</code>](#Service+connect)  
**Returns**: <code>Promise</code> - Resolves to [Fabric](#Fabric).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| notify | <code>Boolean</code> | <code>true</code> | Commit to changes. |

<a name="Service+send"></a>

### app.send(channel, message) ⇒ [<code>Service</code>](#Service)
Send a message to a channel.

**Kind**: instance method of [<code>App</code>](#App)  
**Overrides**: [<code>send</code>](#Service+send)  
**Returns**: [<code>Service</code>](#Service) - Chainable method.  

| Param | Type | Description |
| --- | --- | --- |
| channel | <code>String</code> | Channel name to which the message will be sent. |
| message | <code>String</code> | Content of the message to send. |

<a name="Service+_registerActor"></a>

### app.\_registerActor(actor) ⇒ <code>Promise</code>
Register an [Actor](#Actor) with the [Service](#Service).

**Kind**: instance method of [<code>App</code>](#App)  
**Overrides**: [<code>\_registerActor</code>](#Service+_registerActor)  
**Returns**: <code>Promise</code> - Resolves upon successful registration.  

| Param | Type | Description |
| --- | --- | --- |
| actor | <code>Object</code> | Instance of the [Actor](#Actor). |

<a name="Service+_send"></a>

### app.\_send(message)
Sends a message.

**Kind**: instance method of [<code>App</code>](#App)  
**Overrides**: [<code>\_send</code>](#Service+_send)  

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

## Channel
The [Channel](#Channel) is a encrypted connection with a member of your
[Peer](#Peer) group, with some amount of $BTC bonded and paid for each
correctly-validated message.

Channels in Fabric are powerful tools for application development, as they
can empower users with income opportunities in exchange for delivering
service to the network.

**Kind**: global class  

* [Channel](#Channel)
    * [new Channel([settings])](#new_Channel_new)
    * [.add(amount)](#Channel+add)
    * [.fund(input)](#Channel+fund)
    * [.open(channel)](#Channel+open)

<a name="new_Channel_new"></a>

### new Channel([settings])
Creates a channel between two peers.
of many transactions over time, to be settled on-chain later.


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

<a name="Circuit"></a>

## Circuit
The [Circuit](#Circuit) is the mechanism through which [Fabric](#Fabric)
operates, a computable directed graph describing a network of
[Peer](#Peer) components and their interactions (side effects).
See also [Swarm](#Swarm) for deeper *inspection of [Machine](#Machine)
mechanics.

**Kind**: global class  
<a name="CLI"></a>

## CLI
Provides a Command Line Interface (CLI) for interacting with
the Fabric network using a terminal emulator.

**Kind**: global class  

* [CLI](#CLI)
    * [new CLI([settings])](#new_CLI_new)
    * [.start()](#CLI+start)
    * [.stop()](#CLI+stop)

<a name="new_CLI_new"></a>

### new CLI([settings])
Create a terminal-based interface for a [User](User).


| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Configuration values. |
| [settings.currencies] | <code>Array</code> | List of currencies to support. |

<a name="CLI+start"></a>

### clI.start()
Starts (and renders) the CLI.

**Kind**: instance method of [<code>CLI</code>](#CLI)  
<a name="CLI+stop"></a>

### clI.stop()
Disconnect all interfaces and exit the process.

**Kind**: instance method of [<code>CLI</code>](#CLI)  
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
| path | [<code>Path</code>](#Path) | Key to retrieve. |

<a name="Collection+set"></a>

### collection.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Collection</code>](#Collection)  

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

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
**Emits**: <code>event:message Will emit one {@link Snapshot} message.</code>  

| Param | Type | Description |
| --- | --- | --- |
| state | [<code>State</code>](#State) | State to import. |
| commit | <code>Boolean</code> | Whether or not to commit the result. |

<a name="Compiler"></a>

## Compiler : [<code>Actor</code>](#Actor)
Compilers build interfaces for users of Fabric applications.

**Kind**: global class  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| ast | <code>AST</code> | Compiler's current AST. |
| entity | [<code>Entity</code>](#Entity) | Compiler's current [Entity](#Entity). |


* [Compiler](#Compiler) : [<code>Actor</code>](#Actor)
    * [new Compiler(settings)](#new_Compiler_new)
    * _instance_
        * [._getJavaScriptAST(input)](#Compiler+_getJavaScriptAST) ⇒ <code>AST</code>
    * _static_
        * [._fromJavaScript(body)](#Compiler._fromJavaScript) ⇒

<a name="new_Compiler_new"></a>

### new Compiler(settings)
Create a new Compiler.

**Returns**: [<code>Compiler</code>](#Compiler) - Instance of the compiler.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| settings | <code>Object</code> | <code>{}</code> | Configuration. |
| settings.body | <code>Buffer</code> |  | Body of the input program to compile. |

<a name="Compiler+_getJavaScriptAST"></a>

### compiler.\_getJavaScriptAST(input) ⇒ <code>AST</code>
Parse a [Buffer](Buffer) of JavaScript into an Abstract Syntax Tree ([AST](AST)).

**Kind**: instance method of [<code>Compiler</code>](#Compiler)  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Buffer</code> | Input JavaScript to parse. |

<a name="Compiler._fromJavaScript"></a>

### Compiler.\_fromJavaScript(body) ⇒
Creates a new Compiler instance from a JavaScript contract.

**Kind**: static method of [<code>Compiler</code>](#Compiler)  
**Returns**: Compiler  

| Param | Type | Description |
| --- | --- | --- |
| body | <code>Buffer</code> | Content of the JavaScript to evaluate. |

<a name="Consensus"></a>

## Consensus
Provides various network-specific rules.

**Kind**: global class  
<a name="new_Consensus_new"></a>

### new Consensus([settings])
Create an instance of a [Consensus](#Consensus) verifier.


| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Configuration for the network. |
| [settings.network] | <code>String</code> | Name of the network. |
| [settings.provider] | <code>String</code> | Name of the source provider. |

<a name="Entity"></a>

## Entity : <code>Object</code>
Live instance of an ARC in Fabric.

**Kind**: global class  

* [Entity](#Entity) : <code>Object</code>
    * [new Entity([data])](#new_Entity_new)
    * [.toJSON()](#Entity+toJSON) ⇒ <code>String</code>
    * [.toRaw()](#Entity+toRaw) ⇒ <code>Buffer</code>
    * [._downsample([input])](#Entity+_downsample)

<a name="new_Entity_new"></a>

### new Entity([data])
Generic template for virtual objects.

**Returns**: [<code>Entity</code>](#Entity) - Instance of the [Entity](#Entity).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [data] | <code>Object</code> | <code>{}</code> | Pass an object to use. |

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

<a name="Fabric"></a>

## Fabric
Reliable decentralized infrastructure.

**Kind**: global class  
**Emits**: <code>Fabric#event:thread</code>, <code>Fabric#event:step Emitted on a &#x60;compute&#x60; step.</code>  
**Properties**

| Name | Type |
| --- | --- |
| Block | <code>Class</code> | 


* [Fabric](#Fabric)
    * [new Fabric(config)](#new_Fabric_new)
    * [.register(service)](#Fabric+register)
    * [.push(value)](#Fabric+push) ⇒ [<code>Stack</code>](#Stack)
    * [.trust(source)](#Fabric+trust) ⇒ [<code>Fabric</code>](#Fabric)
    * [.compute()](#Fabric+compute) ⇒ [<code>Fabric</code>](#Fabric)

<a name="new_Fabric_new"></a>

### new Fabric(config)
The [Fabric](#Fabric) type implements a peer-to-peer protocol for
establishing and settling of mutually-agreed upon proofs of
work.  Contract execution takes place in the local node first,
then is optionally shared with the network.

Utilizing


| Param | Type | Description |
| --- | --- | --- |
| config | [<code>Vector</code>](#Vector) | Initial configuration for the Fabric engine.  This can be considered the "genesis" state for any contract using the system.  If a chain of events is maintained over long periods of time, `state` can be considered "in contention", and it is demonstrated that the outstanding value of the contract remains to be settled. |

<a name="Fabric+register"></a>

### fabric.register(service)
Register an available [Service](#Service) using an ES6 [Class](Class).

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type | Description |
| --- | --- | --- |
| service | <code>Class</code> | The ES6 [Class](Class). |

<a name="Fabric+push"></a>

### fabric.push(value) ⇒ [<code>Stack</code>](#Stack)
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
**Returns**: [<code>Fabric</code>](#Fabric) - Returns itself.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Any object which implements the `EventEmitter` pattern. |

<a name="Fabric+compute"></a>

### fabric.compute() ⇒ [<code>Fabric</code>](#Fabric)
Process the current stack.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: [<code>Fabric</code>](#Fabric) - Resulting instance of the stack.  
<a name="Federation"></a>

## Federation
Create and manage sets of signers with the Federation class.

**Kind**: global class  

* [Federation](#Federation)
    * [new Federation([settings])](#new_Federation_new)
    * [.start()](#Federation+start) ⇒ [<code>Federation</code>](#Federation)

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
<a name="Filesystem"></a>

## Filesystem
**Kind**: global class  
<a name="Hash256"></a>

## Hash256
Simple interaction with 256-bit spaces.

**Kind**: global class  

* [Hash256](#Hash256)
    * [new Hash256(settings)](#new_Hash256_new)
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
| [settings.purpose] | <code>String</code> | <code>44</code> | Constrains derivations to this space. |

<a name="Keystore"></a>

## Keystore
Provides an encrypted datastore for generic object storage.

**Kind**: global class  

* [Keystore](#Keystore)
    * [new Keystore([configuration])](#new_Keystore_new)
    * [._setState(state)](#Keystore+_setState) ⇒ [<code>Actor</code>](#Actor)

<a name="new_Keystore_new"></a>

### new Keystore([configuration])
Create an instance of the Store.

**Returns**: [<code>Keystore</code>](#Keystore) - Instance of the store.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [configuration] | <code>FabricStoreConfiguration</code> |  | Settings to use. |
| [configuration.name] | <code>String</code> | <code>&quot;DefaultStore&quot;</code> | Name of the Store. |

<a name="Keystore+_setState"></a>

### keystore.\_setState(state) ⇒ [<code>Actor</code>](#Actor)
Saves an Object to the store.

**Kind**: instance method of [<code>Keystore</code>](#Keystore)  
**Returns**: [<code>Actor</code>](#Actor) - The local instance of the provided State's [Actor](#Actor).  

| Param | Type | Description |
| --- | --- | --- |
| state | <code>Object</code> | State to store. |

<a name="Ledger"></a>

## Ledger ⇐ [<code>Scribe</code>](#Scribe)
An ordered stack of pages.

**Kind**: global class  
**Extends**: [<code>Scribe</code>](#Scribe)  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| memory | <code>Buffer</code> | The ledger's memory (4096 bytes). |
| stack | [<code>Stack</code>](#Stack) | The ledger's stack. |
| tip | <code>Mixed</code> | The most recent page in the ledger. |


* [Ledger](#Ledger) ⇐ [<code>Scribe</code>](#Scribe)
    * [.append(item)](#Ledger+append) ⇒ <code>Promise</code>
    * [.now()](#Scribe+now) ⇒ <code>Number</code>
    * [.trust(source)](#Scribe+trust) ⇒ [<code>Scribe</code>](#Scribe)
    * [.inherits(scribe)](#Scribe+inherits) ⇒ [<code>Scribe</code>](#Scribe)
    * [.toHTML()](#State+toHTML)
    * [.toString()](#State+toString) ⇒ <code>String</code>
    * [.serialize([input])](#State+serialize) ⇒ <code>Buffer</code>
    * [.deserialize(input)](#State+deserialize) ⇒ [<code>State</code>](#State)
    * [.fork()](#State+fork) ⇒ [<code>State</code>](#State)
    * [.get(path)](#State+get) ⇒ <code>Mixed</code>
    * [.set(path)](#State+set) ⇒ <code>Mixed</code>
    * [.commit()](#State+commit)
    * [.render()](#State+render) ⇒ <code>String</code>

<a name="Ledger+append"></a>

### ledger.append(item) ⇒ <code>Promise</code>
Attempts to append a [Page](Page) to the ledger.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Returns**: <code>Promise</code> - Resolves after the change has been committed.  

| Param | Type | Description |
| --- | --- | --- |
| item | <code>Mixed</code> | Item to store. |

<a name="Scribe+now"></a>

### ledger.now() ⇒ <code>Number</code>
Retrives the current timestamp, in milliseconds.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>now</code>](#Scribe+now)  
**Returns**: <code>Number</code> - [Number](Number) representation of the millisecond [Integer](Integer) value.  
<a name="Scribe+trust"></a>

### ledger.trust(source) ⇒ [<code>Scribe</code>](#Scribe)
Blindly bind event handlers to the [Source](Source).

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>trust</code>](#Scribe+trust)  
**Returns**: [<code>Scribe</code>](#Scribe) - Instance of the [Scribe](#Scribe).  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>Source</code> | Event stream. |

<a name="Scribe+inherits"></a>

### ledger.inherits(scribe) ⇒ [<code>Scribe</code>](#Scribe)
Use an existing Scribe instance as a parent.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>inherits</code>](#Scribe+inherits)  
**Returns**: [<code>Scribe</code>](#Scribe) - The configured instance of the Scribe.  

| Param | Type | Description |
| --- | --- | --- |
| scribe | [<code>Scribe</code>](#Scribe) | Instance of Scribe to use as parent. |

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
| path | [<code>Path</code>](#Path) | Key to retrieve. |

<a name="State+set"></a>

### ledger.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Overrides**: [<code>set</code>](#State+set)  

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

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
    * [.commit()](#Actor+commit) ⇒ <code>String</code>
    * [.toBuffer()](#Actor+toBuffer) ⇒ <code>Buffer</code>
    * [.toObject()](#Actor+toObject) ⇒ <code>Object</code>
    * [.serialize()](#Actor+serialize) ⇒ <code>String</code>
    * [.sign()](#Actor+sign) ⇒ [<code>Actor</code>](#Actor)
    * [.unpause()](#Actor+unpause) ⇒ [<code>Actor</code>](#Actor)
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
<a name="Actor+commit"></a>

### logger.commit() ⇒ <code>String</code>
Resolve the current state to a commitment.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>commit</code>](#Actor+commit)  
**Returns**: <code>String</code> - 32-byte ID  
**Emits**: <code>event:Actor Current malleable state.</code>  
<a name="Actor+toBuffer"></a>

### logger.toBuffer() ⇒ <code>Buffer</code>
Casts the Actor to a normalized Buffer.

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>toBuffer</code>](#Actor+toBuffer)  
<a name="Actor+toObject"></a>

### logger.toObject() ⇒ <code>Object</code>
Returns the Actor's current state as an [Object](Object).

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>toObject</code>](#Actor+toObject)  
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
@

**Kind**: instance method of [<code>Logger</code>](#Logger)  
**Overrides**: [<code>unpause</code>](#Actor+unpause)  
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

## Machine
General-purpose state machine with [Vector](#Vector)-based instructions.

**Kind**: global class  

* [Machine](#Machine)
    * [new Machine(settings)](#new_Machine_new)
    * [.sip([n])](#Machine+sip) ⇒ <code>Number</code>
    * [.slurp([n])](#Machine+slurp) ⇒ <code>Number</code>
    * [.compute(input)](#Machine+compute) ⇒ <code>Promise</code>

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

### machine.compute(input) ⇒ <code>Promise</code>
Computes the next "step" for our current Vector.  Analagous to `sum`.
The top item on the stack is always the memory held at current position,
so counts should always begin with 0.

**Kind**: instance method of [<code>Machine</code>](#Machine)  

| Param | Type | Description |
| --- | --- | --- |
| input | [<code>Vector</code>](#Vector) | Input state, undefined if desired. |

<a name="Mempool"></a>

## Mempool
Stores a list of [Transaction](Transaction) elements.

**Kind**: global class  
**Emits**: <code>event:{Message} confirmed Emitted when the Mempool has dropped a transaction.</code>  
<a name="new_Mempool_new"></a>

### new Mempool(settings)
Creates an instance of a [Mempool](#Mempool) [Service](#Service).


| Param | Type | Description |
| --- | --- | --- |
| settings | <code>Object</code> | Map of settings to utilize. |

<a name="Message"></a>

## Message : <code>Object</code>
The [Message](#Message) type defines the Application Messaging Protocol, or AMP.
Each [Actor](#Actor) in the network receives and broadcasts messages,
selectively disclosing new routes to peers which may have open circuits.

**Kind**: global class  

* [Message](#Message) : <code>Object</code>
    * [new Message(message)](#new_Message_new)
    * [.asRaw()](#Message+asRaw) ⇒ <code>Buffer</code>

<a name="new_Message_new"></a>

### new Message(message)
The `Message` type is standardized in [Fabric](#Fabric) as a [Array](Array), which can be added to any other vector to compute a resulting state.

**Returns**: [<code>Message</code>](#Message) - Instance of the message.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Object</code> | Message vector.  Will be serialized by [Array#_serialize](Array#_serialize). |

<a name="Message+asRaw"></a>

### message.asRaw() ⇒ <code>Buffer</code>
Returns a [Buffer](Buffer) of the complete message.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Buffer</code> - Buffer of the encoded [Message](#Message).  
<a name="Node"></a>

## Node
Full definition of a Fabric node.

**Kind**: global class  

* [Node](#Node)
    * [new Node(settings)](#new_Node_new)
    * [.trust(source, settings)](#Node+trust)

<a name="new_Node_new"></a>

### new Node(settings)
Manage a Fabric service.

**Returns**: [<code>Node</code>](#Node) - Instance of the managed service.  

| Param | Type | Description |
| --- | --- | --- |
| settings | <code>Object</code> | Configuration for the node. |

<a name="Node+trust"></a>

### node.trust(source, settings)
Explicitly trusts an [EventEmitter](EventEmitter).

**Kind**: instance method of [<code>Node</code>](#Node)  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Actor to listen to. |
| settings | <code>Object</code> \| <code>String</code> | Label for the trusted messages, or a configuration object. |

<a name="Oracle"></a>

## Oracle ⇐ [<code>Store</code>](#Store)
An Oracle manages one or more collections, using a <code>mempool</code> for
transitive state.

**Kind**: global class  
**Extends**: [<code>Store</code>](#Store)  

* [Oracle](#Oracle) ⇐ [<code>Store</code>](#Store)
    * [new Oracle(initial)](#new_Oracle_new)
    * [.broadcast(msg)](#Oracle+broadcast) ⇒ <code>Boolean</code>
    * [._REGISTER(obj)](#Store+_REGISTER) ⇒ [<code>Vector</code>](#Vector)
    * [._POST(key, value)](#Store+_POST) ⇒ <code>Promise</code>
    * [.get(key)](#Store+get) ⇒ <code>Promise</code>
    * [.set(key, value)](#Store+set)
    * [.trust(source)](#Store+trust) ⇒ [<code>Store</code>](#Store)
    * [.del(key)](#Store+del)
    * [.flush()](#Store+flush)
    * [.start()](#Store+start) ⇒ <code>Promise</code>

<a name="new_Oracle_new"></a>

### new Oracle(initial)
Trusted point-of-reference for external services.


| Param | Type | Description |
| --- | --- | --- |
| initial | <code>Object</code> | Initialization vector. |

<a name="Oracle+broadcast"></a>

### oracle.broadcast(msg) ⇒ <code>Boolean</code>
Core messaging function for interacting with this object in system-time.

**Kind**: instance method of [<code>Oracle</code>](#Oracle)  
**Returns**: <code>Boolean</code> - Returns `true` on success, `false` on failure.  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | Instance of a [module:Message](module:Message) object, validated then transmitted verbatim. |

<a name="Store+_REGISTER"></a>

### oracle.\_REGISTER(obj) ⇒ [<code>Vector</code>](#Vector)
Registers an [Actor](#Actor).  Necessary to store in a collection.

**Kind**: instance method of [<code>Oracle</code>](#Oracle)  
**Overrides**: [<code>\_REGISTER</code>](#Store+_REGISTER)  
**Returns**: [<code>Vector</code>](#Vector) - Returned from `storage.set`  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>Object</code> | Instance of the object to store. |

<a name="Store+_POST"></a>

### oracle.\_POST(key, value) ⇒ <code>Promise</code>
Insert something into a collection.

**Kind**: instance method of [<code>Oracle</code>](#Oracle)  
**Overrides**: [<code>\_POST</code>](#Store+_POST)  
**Returns**: <code>Promise</code> - Resolves on success with a String pointer.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | Path to add data to. |
| value | <code>Mixed</code> | Object to store. |

<a name="Store+get"></a>

### oracle.get(key) ⇒ <code>Promise</code>
Barebones getter.

**Kind**: instance method of [<code>Oracle</code>](#Oracle)  
**Overrides**: [<code>get</code>](#Store+get)  
**Returns**: <code>Promise</code> - Resolves on complete.  `null` if not found.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | Name of data to retrieve. |

<a name="Store+set"></a>

### oracle.set(key, value)
Set a `key` to a specific `value`.

**Kind**: instance method of [<code>Oracle</code>](#Oracle)  
**Overrides**: [<code>set</code>](#Store+set)  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | Address of the information. |
| value | <code>Mixed</code> | Content to store at `key`. |

<a name="Store+trust"></a>

### oracle.trust(source) ⇒ [<code>Store</code>](#Store)
Implicitly trust an [Event](Event) source.

**Kind**: instance method of [<code>Oracle</code>](#Oracle)  
**Overrides**: [<code>trust</code>](#Store+trust)  
**Returns**: [<code>Store</code>](#Store) - Resulting instance of [Store](#Store) with new trust.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Event-emitting source. |

<a name="Store+del"></a>

### oracle.del(key)
Remove a [Value](#Value) by [Path](#Path).

**Kind**: instance method of [<code>Oracle</code>](#Oracle)  
**Overrides**: [<code>del</code>](#Store+del)  

| Param | Type | Description |
| --- | --- | --- |
| key | [<code>Path</code>](#Path) | Key to remove. |

<a name="Store+flush"></a>

### oracle.flush()
Wipes the storage.

**Kind**: instance method of [<code>Oracle</code>](#Oracle)  
**Overrides**: [<code>flush</code>](#Store+flush)  
<a name="Store+start"></a>

### oracle.start() ⇒ <code>Promise</code>
Start running the process.

**Kind**: instance method of [<code>Oracle</code>](#Oracle)  
**Overrides**: [<code>start</code>](#Store+start)  
**Returns**: <code>Promise</code> - Resolves on complete.  
<a name="Path"></a>

## Path
A [Path](#Path) is a [Fabric](#Fabric)-native link to a [Document](Document)
within the network.

**Kind**: global class  

* [Path](#Path)
    * [new Path(input)](#new_Path_new)
    * [.isValid()](#Path+isValid) ⇒ <code>Boolean</code>

<a name="new_Path_new"></a>

### new Path(input)
Create a new [Path](#Path).


| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> \| <code>Object</code> | Named path. |

<a name="Path+isValid"></a>

### path.isValid() ⇒ <code>Boolean</code>
**Kind**: instance method of [<code>Path</code>](#Path)  
**Returns**: <code>Boolean</code> - Whether or not the Path is valid.  
<a name="Peer"></a>

## Peer
An in-memory representation of a node in our network.

**Kind**: global class  

* [Peer](#Peer)
    * [new Peer([config])](#new_Peer_new)
    * [.start()](#Peer+start)
    * [.stop()](#Peer+stop)
    * [.listen()](#Peer+listen) ⇒ [<code>Peer</code>](#Peer)

<a name="new_Peer_new"></a>

### new Peer([config])
Create an instance of [Peer](#Peer).


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [config] | <code>Object</code> |  | Initialization Vector for this peer. |
| [config.listen] | <code>Boolean</code> |  | Whether or not to listen for connections. |
| [config.upnp] | <code>Boolean</code> |  | Whether or not to use UPNP for automatic configuration. |
| [config.port] | <code>Number</code> | <code>7777</code> | Port to use for P2P connections. |
| [config.peers] | <code>Array</code> | <code>[]</code> | List of initial peers. |

<a name="Peer+start"></a>

### peer.start()
Start the Peer.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+stop"></a>

### peer.stop()
Stop the peer.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
<a name="Peer+listen"></a>

### peer.listen() ⇒ [<code>Peer</code>](#Peer)
Start listening for connections.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Peer</code>](#Peer) - Chainable method.  
**Emits**: <code>Peer#event:ready</code>  
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

<a name="Resource"></a>

## Resource
Generic interface for collections of digital objects.

**Kind**: global class  

* [Resource](#Resource)
    * [new Resource(definition)](#new_Resource_new)
    * [.create(obj)](#Resource+create) ⇒ [<code>Vector</code>](#Vector)
    * [.update(id, update)](#Resource+update) ⇒ [<code>Vector</code>](#Vector)

<a name="new_Resource_new"></a>

### new Resource(definition)

| Param | Type | Description |
| --- | --- | --- |
| definition | <code>Object</code> | Initial parameters |

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

<a name="Router"></a>

## Router ⇐ [<code>Scribe</code>](#Scribe)
Process incoming messages.

**Kind**: global class  
**Extends**: [<code>Scribe</code>](#Scribe)  

* [Router](#Router) ⇐ [<code>Scribe</code>](#Scribe)
    * [new Router(map)](#new_Router_new)
    * [.route(msg)](#Router+route) ⇒ <code>Array</code>
    * [.use(plugin, name)](#Router+use) ⇒ [<code>Router</code>](#Router)
    * [.now()](#Scribe+now) ⇒ <code>Number</code>
    * [.trust(source)](#Scribe+trust) ⇒ [<code>Scribe</code>](#Scribe)
    * [.inherits(scribe)](#Scribe+inherits) ⇒ [<code>Scribe</code>](#Scribe)
    * [.toHTML()](#State+toHTML)
    * [.toString()](#State+toString) ⇒ <code>String</code>
    * [.serialize([input])](#State+serialize) ⇒ <code>Buffer</code>
    * [.deserialize(input)](#State+deserialize) ⇒ [<code>State</code>](#State)
    * [.fork()](#State+fork) ⇒ [<code>State</code>](#State)
    * [.get(path)](#State+get) ⇒ <code>Mixed</code>
    * [.set(path)](#State+set) ⇒ <code>Mixed</code>
    * [.commit()](#State+commit)
    * [.render()](#State+render) ⇒ <code>String</code>

<a name="new_Router_new"></a>

### new Router(map)
Maintains a list of triggers ("commands") and their behaviors.


| Param | Type | Description |
| --- | --- | --- |
| map | <code>Object</code> | Map of command names => behaviors. |

<a name="Router+route"></a>

### router.route(msg) ⇒ <code>Array</code>
Assembles a list of possible responses to the incoming request.

**Kind**: instance method of [<code>Router</code>](#Router)  
**Returns**: <code>Array</code> - List of outputs generated from the input string.  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>String</code> | Input message to route. |

<a name="Router+use"></a>

### router.use(plugin, name) ⇒ [<code>Router</code>](#Router)
Attaches a new handler to the router.

**Kind**: instance method of [<code>Router</code>](#Router)  
**Returns**: [<code>Router</code>](#Router) - Configured instance of the router.  

| Param | Type | Description |
| --- | --- | --- |
| plugin | <code>Plugin</code> | Instance of the plugin. |
| name | <code>Plugin.name</code> | Name of the plugin. |

<a name="Scribe+now"></a>

### router.now() ⇒ <code>Number</code>
Retrives the current timestamp, in milliseconds.

**Kind**: instance method of [<code>Router</code>](#Router)  
**Overrides**: [<code>now</code>](#Scribe+now)  
**Returns**: <code>Number</code> - [Number](Number) representation of the millisecond [Integer](Integer) value.  
<a name="Scribe+trust"></a>

### router.trust(source) ⇒ [<code>Scribe</code>](#Scribe)
Blindly bind event handlers to the [Source](Source).

**Kind**: instance method of [<code>Router</code>](#Router)  
**Overrides**: [<code>trust</code>](#Scribe+trust)  
**Returns**: [<code>Scribe</code>](#Scribe) - Instance of the [Scribe](#Scribe).  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>Source</code> | Event stream. |

<a name="Scribe+inherits"></a>

### router.inherits(scribe) ⇒ [<code>Scribe</code>](#Scribe)
Use an existing Scribe instance as a parent.

**Kind**: instance method of [<code>Router</code>](#Router)  
**Overrides**: [<code>inherits</code>](#Scribe+inherits)  
**Returns**: [<code>Scribe</code>](#Scribe) - The configured instance of the Scribe.  

| Param | Type | Description |
| --- | --- | --- |
| scribe | [<code>Scribe</code>](#Scribe) | Instance of Scribe to use as parent. |

<a name="State+toHTML"></a>

### router.toHTML()
Converts the State to an HTML document.

**Kind**: instance method of [<code>Router</code>](#Router)  
**Overrides**: [<code>toHTML</code>](#State+toHTML)  
<a name="State+toString"></a>

### router.toString() ⇒ <code>String</code>
Unmarshall an existing state to an instance of a [Blob](Blob).

**Kind**: instance method of [<code>Router</code>](#Router)  
**Overrides**: [<code>toString</code>](#State+toString)  
**Returns**: <code>String</code> - Serialized [Blob](Blob).  
<a name="State+serialize"></a>

### router.serialize([input]) ⇒ <code>Buffer</code>
Convert to [Buffer](Buffer).

**Kind**: instance method of [<code>Router</code>](#Router)  
**Overrides**: [<code>serialize</code>](#State+serialize)  
**Returns**: <code>Buffer</code> - [Store](#Store)-able blob.  

| Param | Type | Description |
| --- | --- | --- |
| [input] | <code>Mixed</code> | Input to serialize. |

<a name="State+deserialize"></a>

### router.deserialize(input) ⇒ [<code>State</code>](#State)
Take a hex-encoded input and convert to a [State](#State) object.

**Kind**: instance method of [<code>Router</code>](#Router)  
**Overrides**: [<code>deserialize</code>](#State+deserialize)  
**Returns**: [<code>State</code>](#State) - [description]  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | [description] |

<a name="State+fork"></a>

### router.fork() ⇒ [<code>State</code>](#State)
Creates a new child [State](#State), with `@parent` set to
the current [State](#State) by immutable identifier.

**Kind**: instance method of [<code>Router</code>](#Router)  
**Overrides**: [<code>fork</code>](#State+fork)  
<a name="State+get"></a>

### router.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Router</code>](#Router)  
**Overrides**: [<code>get</code>](#State+get)  

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

<a name="State+set"></a>

### router.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Router</code>](#Router)  
**Overrides**: [<code>set</code>](#State+set)  

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

<a name="State+commit"></a>

### router.commit()
Increment the vector clock, broadcast all changes as a transaction.

**Kind**: instance method of [<code>Router</code>](#Router)  
**Overrides**: [<code>commit</code>](#State+commit)  
<a name="State+render"></a>

### router.render() ⇒ <code>String</code>
Compose a JSON string for network consumption.

**Kind**: instance method of [<code>Router</code>](#Router)  
**Overrides**: [<code>render</code>](#State+render)  
**Returns**: <code>String</code> - JSON-encoded [String](String).  
<a name="Scribe"></a>

## Scribe ⇐ [<code>State</code>](#State)
Simple tag-based recordkeeper.

**Kind**: global class  
**Extends**: [<code>State</code>](#State)  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | Current configuration. |


* [Scribe](#Scribe) ⇐ [<code>State</code>](#State)
    * [new Scribe(config)](#new_Scribe_new)
    * [.now()](#Scribe+now) ⇒ <code>Number</code>
    * [.trust(source)](#Scribe+trust) ⇒ [<code>Scribe</code>](#Scribe)
    * [.inherits(scribe)](#Scribe+inherits) ⇒ [<code>Scribe</code>](#Scribe)
    * [.toHTML()](#State+toHTML)
    * [.toString()](#State+toString) ⇒ <code>String</code>
    * [.serialize([input])](#State+serialize) ⇒ <code>Buffer</code>
    * [.deserialize(input)](#State+deserialize) ⇒ [<code>State</code>](#State)
    * [.fork()](#State+fork) ⇒ [<code>State</code>](#State)
    * [.get(path)](#State+get) ⇒ <code>Mixed</code>
    * [.set(path)](#State+set) ⇒ <code>Mixed</code>
    * [.commit()](#State+commit)
    * [.render()](#State+render) ⇒ <code>String</code>

<a name="new_Scribe_new"></a>

### new Scribe(config)
The "Scribe" is a simple tag-based recordkeeper.


| Param | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | General configuration object. |
| config.verbose | <code>Boolean</code> | Should the Scribe be noisy? |

<a name="Scribe+now"></a>

### scribe.now() ⇒ <code>Number</code>
Retrives the current timestamp, in milliseconds.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Returns**: <code>Number</code> - [Number](Number) representation of the millisecond [Integer](Integer) value.  
<a name="Scribe+trust"></a>

### scribe.trust(source) ⇒ [<code>Scribe</code>](#Scribe)
Blindly bind event handlers to the [Source](Source).

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Returns**: [<code>Scribe</code>](#Scribe) - Instance of the [Scribe](#Scribe).  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>Source</code> | Event stream. |

<a name="Scribe+inherits"></a>

### scribe.inherits(scribe) ⇒ [<code>Scribe</code>](#Scribe)
Use an existing Scribe instance as a parent.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Returns**: [<code>Scribe</code>](#Scribe) - The configured instance of the Scribe.  

| Param | Type | Description |
| --- | --- | --- |
| scribe | [<code>Scribe</code>](#Scribe) | Instance of Scribe to use as parent. |

<a name="State+toHTML"></a>

### scribe.toHTML()
Converts the State to an HTML document.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>toHTML</code>](#State+toHTML)  
<a name="State+toString"></a>

### scribe.toString() ⇒ <code>String</code>
Unmarshall an existing state to an instance of a [Blob](Blob).

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>toString</code>](#State+toString)  
**Returns**: <code>String</code> - Serialized [Blob](Blob).  
<a name="State+serialize"></a>

### scribe.serialize([input]) ⇒ <code>Buffer</code>
Convert to [Buffer](Buffer).

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>serialize</code>](#State+serialize)  
**Returns**: <code>Buffer</code> - [Store](#Store)-able blob.  

| Param | Type | Description |
| --- | --- | --- |
| [input] | <code>Mixed</code> | Input to serialize. |

<a name="State+deserialize"></a>

### scribe.deserialize(input) ⇒ [<code>State</code>](#State)
Take a hex-encoded input and convert to a [State](#State) object.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>deserialize</code>](#State+deserialize)  
**Returns**: [<code>State</code>](#State) - [description]  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | [description] |

<a name="State+fork"></a>

### scribe.fork() ⇒ [<code>State</code>](#State)
Creates a new child [State](#State), with `@parent` set to
the current [State](#State) by immutable identifier.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>fork</code>](#State+fork)  
<a name="State+get"></a>

### scribe.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>get</code>](#State+get)  

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

<a name="State+set"></a>

### scribe.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>set</code>](#State+set)  

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

<a name="State+commit"></a>

### scribe.commit()
Increment the vector clock, broadcast all changes as a transaction.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>commit</code>](#State+commit)  
<a name="State+render"></a>

### scribe.render() ⇒ <code>String</code>
Compose a JSON string for network consumption.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>render</code>](#State+render)  
**Returns**: <code>String</code> - JSON-encoded [String](String).  
<a name="Script"></a>

## Script
**Kind**: global class  
<a name="new_Script_new"></a>

### new Script(config)
Compose a [Script](#Script) for inclusion within a [Contract](Contract).

**Returns**: [<code>Script</code>](#Script) - Instance of the [Script](#Script), ready for use.  

| Param | Type | Description |
| --- | --- | --- |
| config | <code>Mixed</code> | Configuration options for the script. |

<a name="Service"></a>

## Service
The "Service" is a simple model for processing messages in a distributed
system.  [Service](#Service) instances are public interfaces for outside systems,
and typically advertise their presence to the network.

To implement a Service, you will typically need to implement all methods from
this prototype.  In general, `connect` and `send` are the highest-priority
jobs, and by default the `fabric` property will serve as an I/O stream using
familiar semantics.

**Kind**: global class  
**Access**: protected  
**Properties**

| Name | Description |
| --- | --- |
| map | The "map" is a hashtable of "key" => "value" pairs. |


* [Service](#Service)
    * [new Service(settings)](#new_Service_new)
    * [.init()](#Service+init)
    * [.tick()](#Service+tick) ⇒ <code>Number</code>
    * [.get(path)](#Service+get) ⇒ <code>Mixed</code>
    * [.set(path)](#Service+set) ⇒ <code>Mixed</code>
    * [.trust(source)](#Service+trust) ⇒ [<code>Service</code>](#Service)
    * [.handler(message)](#Service+handler) ⇒ [<code>Service</code>](#Service)
    * [.lock([duration])](#Service+lock) ⇒ <code>Boolean</code>
    * [.route(msg)](#Service+route) ⇒ <code>Promise</code>
    * [.start()](#Service+start)
    * [._GET(path)](#Service+_GET) ⇒ <code>Promise</code>
    * [._PUT(path, value, [commit])](#Service+_PUT) ⇒ <code>Promise</code>
    * [.connect(notify)](#Service+connect) ⇒ <code>Promise</code>
    * [.send(channel, message)](#Service+send) ⇒ [<code>Service</code>](#Service)
    * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
    * [._send(message)](#Service+_send)

<a name="new_Service_new"></a>

### new Service(settings)
Create an instance of a Service.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| settings | <code>Object</code> |  | Configuration for this service. |
| [settings.networking] | <code>Boolean</code> | <code>true</code> | Whether or not to connect to the network. |
| [settings.@data] | <code>Object</code> |  | Internal data to assign. |

<a name="Service+init"></a>

### service.init()
Called by Web Components.
TODO: move to @fabric/http/types/spa

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Service+tick"></a>

### service.tick() ⇒ <code>Number</code>
Move forward one clock cycle.

**Kind**: instance method of [<code>Service</code>](#Service)  
<a name="Service+get"></a>

### service.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Service</code>](#Service)  

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

<a name="Service+set"></a>

### service.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Service</code>](#Service)  

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

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

<a name="Session"></a>

## Session
The [Session](#Session) type describes a connection between [Peer](#Peer)
objects, and includes its own lifecycle.

**Kind**: global class  

* [Session](#Session)
    * [new Session(settings)](#new_Session_new)
    * [.start()](#Session+start)
    * [.stop()](#Session+stop)

<a name="new_Session_new"></a>

### new Session(settings)
Creates a new [Session](#Session).


| Param | Type |
| --- | --- |
| settings | <code>Object</code> | 

<a name="Session+start"></a>

### session.start()
Opens the [Session](#Session) for interaction.

**Kind**: instance method of [<code>Session</code>](#Session)  
<a name="Session+stop"></a>

### session.stop()
Closes the [Session](#Session), preventing further interaction.

**Kind**: instance method of [<code>Session</code>](#Session)  
<a name="Signer"></a>

## Signer
Generic Fabric Signer.

**Kind**: global class  
**Emits**: <code>event:message Fabric {@link Message} objects.</code>  
**Access**: protected  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Unique identifier for this Signer (id === SHA256(preimage)). |
| preimage | <code>String</code> | Input hash for the `id` property (preimage === SHA256(SignerState)). |


* [Signer](#Signer)
    * [new Signer([actor])](#new_Signer_new)
    * [.sign()](#Signer+sign) ⇒ [<code>Signer</code>](#Signer)

<a name="new_Signer_new"></a>

### new Signer([actor])
Creates an [Signer](#Signer), which emits messages for other
Signers to subscribe to.  You can supply certain parameters
for the actor, including key material [!!!] — be mindful of
what you share with others!

**Returns**: [<code>Signer</code>](#Signer) - Instance of the Signer.  Call [sign](#Signer+sign) to emit a [Signature](Signature).  

| Param | Type | Description |
| --- | --- | --- |
| [actor] | <code>Object</code> | Object to use as the actor. |
| [actor.seed] | <code>String</code> | BIP24 Mnemonic to use as a seed phrase. |
| [actor.public] | <code>Buffer</code> | Public key. |
| [actor.private] | <code>Buffer</code> | Private key. |

<a name="Signer+sign"></a>

### signer.sign() ⇒ [<code>Signer</code>](#Signer)
Signs some data.

**Kind**: instance method of [<code>Signer</code>](#Signer)  
<a name="Snapshot"></a>

## Snapshot
A type of message to be expected from a [Service](#Service).

**Kind**: global class  

* [Snapshot](#Snapshot)
    * [new Snapshot(settings)](#new_Snapshot_new)
    * [.commit()](#Snapshot+commit)

<a name="new_Snapshot_new"></a>

### new Snapshot(settings)
Creates an instance of a [Snapshot](#Snapshot).


| Param | Type | Description |
| --- | --- | --- |
| settings | <code>Object</code> | Map of settings to configure the [Snapshot](#Snapshot) with. |

<a name="Snapshot+commit"></a>

### snapshot.commit()
Retrieves the `sha256` fingerprint for the [Snapshot](#Snapshot) state.

**Kind**: instance method of [<code>Snapshot</code>](#Snapshot)  
<a name="Stack"></a>

## Stack
Manage stacks of data.

**Kind**: global class  

* [Stack](#Stack)
    * [new Stack([list])](#new_Stack_new)
    * [.push(data)](#Stack+push) ⇒ <code>Number</code>

<a name="new_Stack_new"></a>

### new Stack([list])
Create a [Stack](#Stack) instance.

**Returns**: [<code>Stack</code>](#Stack) - Instance of the [Stack](#Stack).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [list] | <code>Array</code> | <code>[]</code> | Genesis state for the [Stack](#Stack) instance. |

<a name="Stack+push"></a>

### stack.push(data) ⇒ <code>Number</code>
Push data onto the stack.  Changes the [Stack#frame](Stack#frame) and
[Stack#id](Stack#id).

**Kind**: instance method of [<code>Stack</code>](#Stack)  
**Returns**: <code>Number</code> - Resulting size of the stack.  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>Mixed</code> | Treated as a [State](#State). |

<a name="State"></a>

## State ⇐ <code>EventEmitter</code>
The [State](#State) is the core of most [User](User)-facing interactions.  To
interact with the [User](User), simply propose a change in the state by
committing to the outcome.  This workflow keeps app design quite simple!

**Kind**: global class  
**Extends**: <code>EventEmitter</code>  
**Access**: protected  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| size | <code>Number</code> | Size of state in bytes. |
| @buffer | <code>Buffer</code> | Byte-for-byte memory representation of state. |
| @type | <code>String</code> | Named type. |
| @data | <code>Mixed</code> | Local instance of the state. |
| @id | <code>String</code> | Unique identifier for this data. |


* [State](#State) ⇐ <code>EventEmitter</code>
    * [new State(data)](#new_State_new)
    * _instance_
        * [.toHTML()](#State+toHTML)
        * [.toString()](#State+toString) ⇒ <code>String</code>
        * [.serialize([input])](#State+serialize) ⇒ <code>Buffer</code>
        * [.deserialize(input)](#State+deserialize) ⇒ [<code>State</code>](#State)
        * [.fork()](#State+fork) ⇒ [<code>State</code>](#State)
        * [.get(path)](#State+get) ⇒ <code>Mixed</code>
        * [.set(path)](#State+set) ⇒ <code>Mixed</code>
        * [.commit()](#State+commit)
        * [.render()](#State+render) ⇒ <code>String</code>
    * _static_
        * [.fromJSON(input)](#State.fromJSON) ⇒ [<code>State</code>](#State)

<a name="new_State_new"></a>

### new State(data)
Creates a snapshot of some information.

**Returns**: [<code>State</code>](#State) - Resulting state.  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>Mixed</code> | Input data. |

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

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

<a name="State+set"></a>

### state.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>State</code>](#State)  

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

<a name="State+commit"></a>

### state.commit()
Increment the vector clock, broadcast all changes as a transaction.

**Kind**: instance method of [<code>State</code>](#State)  
<a name="State+render"></a>

### state.render() ⇒ <code>String</code>
Compose a JSON string for network consumption.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>String</code> - JSON-encoded [String](String).  
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

## Store
Long-term storage.

**Kind**: global class  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| settings | <code>Mixed</code> | Current configuration. |


* [Store](#Store)
    * [new Store([settings])](#new_Store_new)
    * [._REGISTER(obj)](#Store+_REGISTER) ⇒ [<code>Vector</code>](#Vector)
    * [._POST(key, value)](#Store+_POST) ⇒ <code>Promise</code>
    * [.get(key)](#Store+get) ⇒ <code>Promise</code>
    * [.set(key, value)](#Store+set)
    * [.trust(source)](#Store+trust) ⇒ [<code>Store</code>](#Store)
    * [.del(key)](#Store+del)
    * [.flush()](#Store+flush)
    * [.start()](#Store+start) ⇒ <code>Promise</code>

<a name="new_Store_new"></a>

### new Store([settings])
Create an instance of a [Store](#Store) to manage long-term storage, which is
particularly useful when building a user-facing [Product](Product).

**Returns**: [<code>Store</code>](#Store) - Instance of the Store, ready to start.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | configuration object. |

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
**Returns**: <code>Promise</code> - Resolves on complete.  `null` if not found.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | Name of data to retrieve. |

<a name="Store+set"></a>

### store.set(key, value)
Set a `key` to a specific `value`.

**Kind**: instance method of [<code>Store</code>](#Store)  

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
Remove a [Value](#Value) by [Path](#Path).

**Kind**: instance method of [<code>Store</code>](#Store)  

| Param | Type | Description |
| --- | --- | --- |
| key | [<code>Path</code>](#Path) | Key to remove. |

<a name="Store+flush"></a>

### store.flush()
Wipes the storage.

**Kind**: instance method of [<code>Store</code>](#Store)  
<a name="Store+start"></a>

### store.start() ⇒ <code>Promise</code>
Start running the process.

**Kind**: instance method of [<code>Store</code>](#Store)  
**Returns**: <code>Promise</code> - Resolves on complete.  
<a name="Swap"></a>

## Swap : <code>Object</code>
The [Swap](#Swap) contract executes a set of transactions on two distinct
[Chain](#Chain) components, utilizing a secret-reveal mechanism to atomically
execute either the full set or none.

**Kind**: global class  

* [Swap](#Swap) : <code>Object</code>
    * [new Swap([settings])](#new_Swap_new)
    * [.extractSecret(tx, address)](#Swap+extractSecret) ⇒ <code>Mixed</code>

<a name="new_Swap_new"></a>

### new Swap([settings])
Atomically execute a set of transactions across two [Chain](#Chain) components.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | Configuration for the swap. |

<a name="Swap+extractSecret"></a>

### swap.extractSecret(tx, address) ⇒ <code>Mixed</code>
Find an input from the provided transaction which spends from the target
P2SH address.

**Kind**: instance method of [<code>Swap</code>](#Swap)  
**Returns**: <code>Mixed</code> - False on failure, secret value on success.  

| Param | Type | Description |
| --- | --- | --- |
| tx | <code>Transaction</code> | [Transaction](Transaction) to iterate over. |
| address | <code>String</code> | P2SH address to search for. |

<a name="Swarm"></a>

## Swarm : <code>String</code>
Orchestrates a network of peers.

**Kind**: global class  

* [Swarm](#Swarm) : <code>String</code>
    * [new Swarm(config)](#new_Swarm_new)
    * [.trust(source)](#Swarm+trust)
    * [.start()](#Swarm+start) ⇒ <code>Promise</code>

<a name="new_Swarm_new"></a>

### new Swarm(config)
Create an instance of a [Swarm](#Swarm).

**Returns**: [<code>Swarm</code>](#Swarm) - Instance of the Swarm.  

| Param | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | Configuration object. |

<a name="Swarm+trust"></a>

### swarm.trust(source)
Explicitly trust an [EventEmitter](EventEmitter) to provide messages using
the expected [Interface](#Interface), providing [Message](#Message) objects as
the expected [Type](Type).

**Kind**: instance method of [<code>Swarm</code>](#Swarm)  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | [Actor](#Actor) to utilize. |

<a name="Swarm+start"></a>

### swarm.start() ⇒ <code>Promise</code>
Begin computing.

**Kind**: instance method of [<code>Swarm</code>](#Swarm)  
**Returns**: <code>Promise</code> - Resolves to instance of [Swarm](#Swarm).  
<a name="Transition"></a>

## Transition
The [Transition](#Transition) type reflects a change from one finite
[State](#State) to another.

**Kind**: global class  
<a name="new_Transition_new"></a>

### new Transition(settings)

| Param | Type | Description |
| --- | --- | --- |
| settings | <code>Object</code> | Configuration for the transition object. |

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


| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Configuration. |

<a name="Tree+addLeaf"></a>

### tree.addLeaf(leaf) ⇒ [<code>Tree</code>](#Tree)
Add a leaf to the tree.

**Kind**: instance method of [<code>Tree</code>](#Tree)  

| Param | Type | Description |
| --- | --- | --- |
| leaf | <code>String</code> | Leaf to add to the tree. |

<a name="Tree+getLeaves"></a>

### tree.getLeaves() ⇒ <code>Array</code>
Get a list of the [Tree](#Tree)'s leaves.

**Kind**: instance method of [<code>Tree</code>](#Tree)  
**Returns**: <code>Array</code> - A list of the [Tree](#Tree)'s leaves.  
<a name="Value"></a>

## Value
[Number](Number)-like type.

**Kind**: global class  

* [Value](#Value)
    * [new Value(data)](#new_Value_new)
    * [.value(input)](#Value+value)

<a name="new_Value_new"></a>

### new Value(data)
Use the [Value](#Value) type to interact with [Number](Number)-like objects.


| Param | Type | Description |
| --- | --- | --- |
| data | <code>Mixed</code> | Input value. |

<a name="Value+value"></a>

### value.value(input)
Compute the numeric representation of this input.

**Kind**: instance method of [<code>Value</code>](#Value)  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | Input string to seek for value. |

<a name="Vector"></a>

## Vector
**Kind**: global class  

* [Vector](#Vector)
    * [new Vector(origin)](#new_Vector_new)
    * [._serialize(input)](#Vector+_serialize) ⇒ <code>String</code>
    * [.toString(input)](#Vector+toString) ⇒ <code>String</code>

<a name="new_Vector_new"></a>

### new Vector(origin)
An "Initialization" Vector.


| Param | Type | Description |
| --- | --- | --- |
| origin | <code>Object</code> | Input state (will map to `@data`.) |

<a name="Vector+_serialize"></a>

### vector.\_serialize(input) ⇒ <code>String</code>
_serialize is a placeholder, should be discussed.

**Kind**: instance method of [<code>Vector</code>](#Vector)  
**Returns**: <code>String</code> - - resulting string [JSON-encoded version of the local `@data` value.]  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | What to serialize.  Defaults to `this.state`. |

<a name="Vector+toString"></a>

### vector.toString(input) ⇒ <code>String</code>
Render the output to a [String](String).

**Kind**: instance method of [<code>Vector</code>](#Vector)  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Mixed</code> | Arbitrary input. |

<a name="Walker"></a>

## Walker
**Kind**: global class  

* [Walker](#Walker)
    * [new Walker(init)](#new_Walker_new)
    * [._explore(path, [map])](#Walker+_explore) ⇒ <code>Object</code>
    * [._define(dir, [map])](#Walker+_define) ⇒ <code>Object</code>

<a name="new_Walker_new"></a>

### new Walker(init)
The Walker explores a directory tree and maps it to memory.


| Param | Type | Description |
| --- | --- | --- |
| init | [<code>Vector</code>](#Vector) | Initial state tree. |

<a name="Walker+_explore"></a>

### walker.\_explore(path, [map]) ⇒ <code>Object</code>
Explores a directory tree on the local system's disk.

**Kind**: instance method of [<code>Walker</code>](#Walker)  
**Returns**: <code>Object</code> - [description]  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>String</code> |  | [description] |
| [map] | <code>Object</code> | <code>{}</code> | [description] |

<a name="Walker+_define"></a>

### walker.\_define(dir, [map]) ⇒ <code>Object</code>
Explores a directory tree on the local system's disk.

**Kind**: instance method of [<code>Walker</code>](#Walker)  
**Returns**: <code>Object</code> - A hashmap of directory contents.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| dir | <code>String</code> |  | Path to crawl on local disk. |
| [map] | <code>Object</code> | <code>{}</code> | Pointer to previous step in stack. |

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
        * [.start()](#Wallet+start)
        * [._load(settings)](#Wallet+_load)
        * [.getAddressForScript(script)](#Wallet+getAddressForScript)
        * [.getAddressFromRedeemScript(redeemScript)](#Wallet+getAddressFromRedeemScript)
        * [.createPricedOrder(order)](#Wallet+createPricedOrder)
        * [._sign(tx)](#Wallet+_sign)
        * [._createCrowdfund(fund)](#Wallet+_createCrowdfund)
        * [._getSwapInputScript(redeemScript, secret)](#Wallet+_getSwapInputScript)
        * [._getRefundInputScript(redeemScript)](#Wallet+_getRefundInputScript)
        * [.publicKeyFromString(input)](#Wallet+publicKeyFromString)
    * _static_
        * [.createSeed(passphrase)](#Wallet.createSeed) ⇒ <code>FabricSeed</code>
        * [.fromSeed(seed)](#Wallet.fromSeed) ⇒ [<code>Wallet</code>](#Wallet)

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

<a name="Wallet+start"></a>

### wallet.start()
Start the wallet, including listening for transactions.

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  
<a name="Wallet+_load"></a>

### wallet.\_load(settings)
Initialize the wallet, including keys and addresses.

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  

| Param | Type | Description |
| --- | --- | --- |
| settings | <code>Object</code> | Settings to load. |

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

<a name="Wallet+createPricedOrder"></a>

### wallet.createPricedOrder(order)
Create a priced order.

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  

| Param | Type |
| --- | --- |
| order | <code>Object</code> | 
| order.asset | <code>Object</code> | 
| order.amount | <code>Object</code> | 

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
Generate [Script](#Script) for claiming a [Swap](#Swap).

**Kind**: instance method of [<code>Wallet</code>](#Wallet)  

| Param | Type |
| --- | --- |
| redeemScript | <code>\*</code> | 
| secret | <code>\*</code> | 

<a name="Wallet+_getRefundInputScript"></a>

### wallet.\_getRefundInputScript(redeemScript)
Generate [Script](#Script) for reclaiming funds commited to a [Swap](#Swap).

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
        * [._createContractProposal(options)](#Bitcoin+_createContractProposal) ⇒ <code>ContractProposal</code>
        * [._buildPSBT(options)](#Bitcoin+_buildPSBT) ⇒ <code>PSBT</code>
        * [.start()](#Bitcoin+start)
        * [.stop()](#Bitcoin+stop)
        * [.init()](#Service+init)
        * [.tick()](#Service+tick) ⇒ <code>Number</code>
        * [.get(path)](#Service+get) ⇒ <code>Mixed</code>
        * [.set(path)](#Service+set) ⇒ <code>Mixed</code>
        * [.trust(source)](#Service+trust) ⇒ [<code>Service</code>](#Service)
        * [.handler(message)](#Service+handler) ⇒ [<code>Service</code>](#Service)
        * [.lock([duration])](#Service+lock) ⇒ <code>Boolean</code>
        * [.route(msg)](#Service+route) ⇒ <code>Promise</code>
        * [._GET(path)](#Service+_GET) ⇒ <code>Promise</code>
        * [._PUT(path, value, [commit])](#Service+_PUT) ⇒ <code>Promise</code>
        * [.send(channel, message)](#Service+send) ⇒ [<code>Service</code>](#Service)
        * [._registerActor(actor)](#Service+_registerActor) ⇒ <code>Promise</code>
        * [._send(message)](#Service+_send)
    * _static_
        * [.Transaction](#Bitcoin.Transaction)
        * [.MutableTransaction](#Bitcoin.MutableTransaction)

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

<a name="Bitcoin+_createContractProposal"></a>

### bitcoin.\_createContractProposal(options) ⇒ <code>ContractProposal</code>
Creates an unsigned Bitcoin transaction.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Returns**: <code>ContractProposal</code> - Instance of the proposal.  

| Param | Type |
| --- | --- |
| options | <code>Object</code> | 

<a name="Bitcoin+_buildPSBT"></a>

### bitcoin.\_buildPSBT(options) ⇒ <code>PSBT</code>
Create a Partially-Signed Bitcoin Transaction (PSBT).

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Returns**: <code>PSBT</code> - Instance of the PSBT.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | Parameters for the PSBT. |

<a name="Bitcoin+start"></a>

### bitcoin.start()
Start the Bitcoin service, including the initiation of outbound requests.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>start</code>](#Service+start)  
<a name="Bitcoin+stop"></a>

### bitcoin.stop()
Stop the Bitcoin service.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
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
<a name="Service+get"></a>

### bitcoin.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>get</code>](#Service+get)  

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

<a name="Service+set"></a>

### bitcoin.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Bitcoin</code>](#Bitcoin)  
**Overrides**: [<code>set</code>](#Service+set)  

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

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

<a name="Bitcoin.Transaction"></a>

### Bitcoin.Transaction
Provides bcoin's implementation of `TX` internally.  This static may be
removed in the future.

**Kind**: static property of [<code>Bitcoin</code>](#Bitcoin)  
<a name="Bitcoin.MutableTransaction"></a>

### Bitcoin.MutableTransaction
Provides bcoin's implementation of `MTX` internally.  This static may be
removed in the future.

**Kind**: static property of [<code>Bitcoin</code>](#Bitcoin)  
<a name="Exchange"></a>

## Exchange
Implements a basic Exchange.

**Kind**: global class  
<a name="new_Exchange_new"></a>

### new Exchange(settings)
Create an instance of the Exchange.  You may run two instances at
once to simulate two-party contracts, or use the Fabric Market to
find and trade with real peers.

**Returns**: Exchnge  

| Param | Type | Description |
| --- | --- | --- |
| settings | <code>Object</code> | Map of settings to values. |
| settings.fees | <code>Object</code> | Map of fee settings (all values in BTC). |
| settings.fees.minimum | <code>Object</code> | Minimum fee (satoshis). |

<a name="Redis"></a>

## Redis
Connect and subscribe to ZeroMQ servers.

**Kind**: global class  

* [Redis](#Redis)
    * [new Redis([settings])](#new_Redis_new)
    * [.start()](#Redis+start) ⇒ [<code>Redis</code>](#Redis)
    * [.stop()](#Redis+stop) ⇒ [<code>Redis</code>](#Redis)

<a name="new_Redis_new"></a>

### new Redis([settings])
Creates an instance of a ZeroMQ subscriber.

**Returns**: [<code>Redis</code>](#Redis) - Instance of the Redis service, ready to run `start()`  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Settings for the Redis connection. |
| [settings.host] | <code>String</code> | Host for the Redis server. |
| [settings.port] | <code>Number</code> | Remote ZeroMQ service port. |

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
<a name="ZMQ"></a>

## ZMQ
Connect and subscribe to ZeroMQ publishers.

**Kind**: global class  

* [ZMQ](#ZMQ)
    * [new ZMQ([settings])](#new_ZMQ_new)
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
<a name="HTTPServer"></a>

## ~~HTTPServer~~
***Deprecated***

Deprecated 2021-10-16.

**Kind**: global class  
<a name="Scribe"></a>

## ~~Scribe~~
***Deprecated***

Deprecated 2021-11-06.

**Kind**: global class  

* ~~[Scribe](#Scribe)~~
    * [new Scribe(config)](#new_Scribe_new)
    * [.now()](#Scribe+now) ⇒ <code>Number</code>
    * [.trust(source)](#Scribe+trust) ⇒ [<code>Scribe</code>](#Scribe)
    * [.inherits(scribe)](#Scribe+inherits) ⇒ [<code>Scribe</code>](#Scribe)
    * [.toHTML()](#State+toHTML)
    * [.toString()](#State+toString) ⇒ <code>String</code>
    * [.serialize([input])](#State+serialize) ⇒ <code>Buffer</code>
    * [.deserialize(input)](#State+deserialize) ⇒ [<code>State</code>](#State)
    * [.fork()](#State+fork) ⇒ [<code>State</code>](#State)
    * [.get(path)](#State+get) ⇒ <code>Mixed</code>
    * [.set(path)](#State+set) ⇒ <code>Mixed</code>
    * [.commit()](#State+commit)
    * [.render()](#State+render) ⇒ <code>String</code>

<a name="new_Scribe_new"></a>

### new Scribe(config)
The "Scribe" is a simple tag-based recordkeeper.


| Param | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | General configuration object. |
| config.verbose | <code>Boolean</code> | Should the Scribe be noisy? |

<a name="Scribe+now"></a>

### scribe.now() ⇒ <code>Number</code>
Retrives the current timestamp, in milliseconds.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Returns**: <code>Number</code> - [Number](Number) representation of the millisecond [Integer](Integer) value.  
<a name="Scribe+trust"></a>

### scribe.trust(source) ⇒ [<code>Scribe</code>](#Scribe)
Blindly bind event handlers to the [Source](Source).

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Returns**: [<code>Scribe</code>](#Scribe) - Instance of the [Scribe](#Scribe).  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>Source</code> | Event stream. |

<a name="Scribe+inherits"></a>

### scribe.inherits(scribe) ⇒ [<code>Scribe</code>](#Scribe)
Use an existing Scribe instance as a parent.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Returns**: [<code>Scribe</code>](#Scribe) - The configured instance of the Scribe.  

| Param | Type | Description |
| --- | --- | --- |
| scribe | [<code>Scribe</code>](#Scribe) | Instance of Scribe to use as parent. |

<a name="State+toHTML"></a>

### scribe.toHTML()
Converts the State to an HTML document.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>toHTML</code>](#State+toHTML)  
<a name="State+toString"></a>

### scribe.toString() ⇒ <code>String</code>
Unmarshall an existing state to an instance of a [Blob](Blob).

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>toString</code>](#State+toString)  
**Returns**: <code>String</code> - Serialized [Blob](Blob).  
<a name="State+serialize"></a>

### scribe.serialize([input]) ⇒ <code>Buffer</code>
Convert to [Buffer](Buffer).

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>serialize</code>](#State+serialize)  
**Returns**: <code>Buffer</code> - [Store](#Store)-able blob.  

| Param | Type | Description |
| --- | --- | --- |
| [input] | <code>Mixed</code> | Input to serialize. |

<a name="State+deserialize"></a>

### scribe.deserialize(input) ⇒ [<code>State</code>](#State)
Take a hex-encoded input and convert to a [State](#State) object.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>deserialize</code>](#State+deserialize)  
**Returns**: [<code>State</code>](#State) - [description]  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | [description] |

<a name="State+fork"></a>

### scribe.fork() ⇒ [<code>State</code>](#State)
Creates a new child [State](#State), with `@parent` set to
the current [State](#State) by immutable identifier.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>fork</code>](#State+fork)  
<a name="State+get"></a>

### scribe.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>get</code>](#State+get)  

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

<a name="State+set"></a>

### scribe.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>set</code>](#State+set)  

| Param | Type | Description |
| --- | --- | --- |
| path | [<code>Path</code>](#Path) | Key to retrieve. |

<a name="State+commit"></a>

### scribe.commit()
Increment the vector clock, broadcast all changes as a transaction.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>commit</code>](#State+commit)  
<a name="State+render"></a>

### scribe.render() ⇒ <code>String</code>
Compose a JSON string for network consumption.

**Kind**: instance method of [<code>Scribe</code>](#Scribe)  
**Overrides**: [<code>render</code>](#State+render)  
**Returns**: <code>String</code> - JSON-encoded [String](String).  
<a name="Stash"></a>

## ~~Stash~~
***Deprecated***

Deprecated 2021-11-06.

**Kind**: global class  
