## Classes

<dl>
<dt><a href="#App">App</a></dt>
<dd><p>Default interface to <a href="Fabric">Fabric</a>.  Provides immutable types for all
elements of the <code>components</code> option.</p>
</dd>
<dt><a href="#Chain">Chain</a></dt>
<dd><p>Chain.</p>
</dd>
<dt><a href="#CLI">CLI</a></dt>
<dd><p>Base class for a terminal-like interface to the Fabric network.</p>
</dd>
<dt><a href="#Compiler">Compiler</a> : <code>Object</code></dt>
<dd><p>Compilers build interfaces for users of Fabric applications.</p>
</dd>
<dt><a href="#Ledger">Ledger</a> ⇐ <code><a href="#Scribe">Scribe</a></code></dt>
<dd><p>An ordered stack of pages.</p>
</dd>
<dt><a href="#Machine">Machine</a></dt>
<dd><p>General-purpose state machine with <a href="#Vector">Vector</a>-based instructions.</p>
</dd>
<dt><a href="#Message">Message</a> : <code>Object</code></dt>
<dd><p>The <a href="#Message">Message</a> type defines the Application Messaging Protocol, or AMP.
Each <a href="Actor">Actor</a> in the network receives and broadcasts messages,
selectively disclosing new routes to peers which may have open circuits.</p>
</dd>
<dt><a href="#Oracle">Oracle</a> ⇐ <code>Store</code></dt>
<dd><p>An Oracle manages one or more collections, using a <code>mempool</code> for
transitive state.</p>
</dd>
<dt><a href="#Peer">Peer</a></dt>
<dd><p>An in-memory representation of a node in our network.</p>
</dd>
<dt><a href="#Remote">Remote</a> : <code><a href="#Remote">Remote</a></code></dt>
<dd><p>Interact with a remote <a href="#Resource">Resource</a>.</p>
</dd>
<dt><a href="#Resource">Resource</a></dt>
<dd><p>Generic interface for collections of digital objects.</p>
</dd>
<dt><a href="#Router">Router</a> ⇐ <code><a href="#Scribe">Scribe</a></code></dt>
<dd><p>Process incoming messages.</p>
</dd>
<dt><a href="#Scribe">Scribe</a></dt>
<dd><p>Simple tag-based recordkeeper.</p>
</dd>
<dt><a href="#Script">Script</a></dt>
<dd></dd>
<dt><a href="#State">State</a></dt>
<dd><p>The <a href="#State">State</a> is the core of most <a href="User">User</a>-facing interactions.  To
interact with the <a href="User">User</a>, simply propose a change in the state by
committing to the outcome.  This workflow keeps app design quite simple!</p>
</dd>
<dt><a href="#Storage">Storage</a></dt>
<dd><p>Persistent data storage.</p>
</dd>
<dt><a href="#Swarm">Swarm</a> : <code>String</code></dt>
<dd><p>The <a href="#Swarm">Swarm</a> represents a network of peers.</p>
</dd>
<dt><a href="#Vector">Vector</a></dt>
<dd></dd>
<dt><a href="#Walker">Walker</a></dt>
<dd></dd>
<dt><a href="#Worker">Worker</a></dt>
<dd><p>Workers are arbitrary containers for processing data.  They can be thought of
almost like &quot;threads&quot;, as they run asynchronously over the duration of a
contract&#39;s lifetime as &quot;fulfillment conditions&quot; for its closure.</p>
</dd>
</dl>

<a name="App"></a>

## App
Default interface to [Fabric](Fabric).  Provides immutable types for all
elements of the `components` option.

**Kind**: global class  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| config | <code>Configuration</code> | Initial [Vector](#Vector). |
| config.components | <code>Map</code> | Transformation function of `Σ ⇒ Δ`. |


* [App](#App)
    * [new App([config])](#new_App_new)
    * [.render()](#App+render) ⇒ <code>Mixed</code>

<a name="new_App_new"></a>

### new App([config])
Create a new instance of the Fabric App.


| Param | Type | Description |
| --- | --- | --- |
| [config] | <code>Object</code> | Configuration object. |
| [config.store] | <code>Object</code> | Path to local storage. |
| [config.components] | <code>Object</code> | Map of components. |
| [config.components.list] | <code>Object</code> | Name of "list" component. |
| [config.components.view] | <code>Object</code> | Name of "view" component. |

<a name="App+render"></a>

### app.render() ⇒ <code>Mixed</code>
Draw the application to canvas (display).

**Kind**: instance method of [<code>App</code>](#App)  
<a name="Chain"></a>

## Chain
Chain.

**Kind**: global class  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | Current name. |
| indices | <code>Map</code> |  |
| ledger | [<code>Ledger</code>](#Ledger) |  |
| storage | [<code>Storage</code>](#Storage) |  |

<a name="new_Chain_new"></a>

### new Chain(genesis)
Holds an immutable chain of events.


| Param | Type | Description |
| --- | --- | --- |
| genesis | [<code>Vector</code>](#Vector) | Initial state for the chain of events. |

<a name="CLI"></a>

## CLI
Base class for a terminal-like interface to the Fabric network.

**Kind**: global class  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | Initial [Vector](#Vector). |
| oracle | [<code>Oracle</code>](#Oracle) | Instance of [Oracle](#Oracle). |


* [CLI](#CLI)
    * [new CLI(configuration)](#new_CLI_new)
    * [._handleChanges(msg)](#CLI+_handleChanges) ⇒ [<code>CLI</code>](#CLI)

<a name="new_CLI_new"></a>

### new CLI(configuration)
Base class for a terminal-like interface to the Fabric network.


| Param | Type | Description |
| --- | --- | --- |
| configuration | <code>Object</code> | Configuration object for the CLI. |

<a name="CLI+_handleChanges"></a>

### clI.\_handleChanges(msg) ⇒ [<code>CLI</code>](#CLI)
Update UI as necessary based on changes from Oracle.

**Kind**: instance method of [<code>CLI</code>](#CLI)  

| Param | Type | Description |
| --- | --- | --- |
| msg | [<code>Message</code>](#Message) | Incoming [Message](#Message). |

<a name="Compiler"></a>

## Compiler : <code>Object</code>
Compilers build interfaces for users of Fabric applications.

**Kind**: global class  
<a name="new_Compiler_new"></a>

### new Compiler([settings])
Create a new Compiler.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | Configuration. |

<a name="Ledger"></a>

## Ledger ⇐ [<code>Scribe</code>](#Scribe)
An ordered stack of pages.

**Kind**: global class  
**Extends**: [<code>Scribe</code>](#Scribe)  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| memory | <code>Buffer</code> | The ledger's memory (4096 bytes). |
| stack | <code>Stack</code> | The ledger's stack. |
| tip | <code>Mixed</code> | The most recent page in the ledger. |


* [Ledger](#Ledger) ⇐ [<code>Scribe</code>](#Scribe)
    * [.append(item)](#Ledger+append) ⇒ <code>Promise</code>
    * [.trust(source)](#Scribe+trust) ⇒ [<code>Scribe</code>](#Scribe)
    * [.inherits(scribe)](#Scribe+inherits) ⇒ [<code>Scribe</code>](#Scribe)

<a name="Ledger+append"></a>

### ledger.append(item) ⇒ <code>Promise</code>
Attempts to append a [Page](Page) to the ledger.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Returns**: <code>Promise</code> - Resolves after the change has been committed.  

| Param | Type | Description |
| --- | --- | --- |
| item | <code>Mixed</code> | Item to store. |

<a name="Scribe+trust"></a>

### ledger.trust(source) ⇒ [<code>Scribe</code>](#Scribe)
Blindly bind event handlers to the [Source](Source).

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Returns**: [<code>Scribe</code>](#Scribe) - Instance of the [Scribe](#Scribe).  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>Source</code> | Event stream. |

<a name="Scribe+inherits"></a>

### ledger.inherits(scribe) ⇒ [<code>Scribe</code>](#Scribe)
Use an existing Scribe instance as a parent.

**Kind**: instance method of [<code>Ledger</code>](#Ledger)  
**Returns**: [<code>Scribe</code>](#Scribe) - The configured instance of the Scribe.  

| Param | Type | Description |
| --- | --- | --- |
| scribe | [<code>Scribe</code>](#Scribe) | Instance of Scribe to use as parent. |

<a name="Machine"></a>

## Machine
General-purpose state machine with [Vector](#Vector)-based instructions.

**Kind**: global class  

* [Machine](#Machine)
    * [new Machine(config)](#new_Machine_new)
    * [.sip([n])](#Machine+sip) ⇒ <code>Number</code>
    * [.compute(input)](#Machine+compute) ⇒ <code>Promise</code>

<a name="new_Machine_new"></a>

### new Machine(config)
Create a Machine.


| Param | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | Run-time configuration. |

<a name="Machine+sip"></a>

### machine.sip([n]) ⇒ <code>Number</code>
Get `n` bits of entropy.

**Kind**: instance method of [<code>Machine</code>](#Machine)  
**Returns**: <code>Number</code> - Random bits from [Generator](Generator).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [n] | <code>Number</code> | <code>32</code> | Number of bits to retrieve (max = 32). |

<a name="Machine+compute"></a>

### machine.compute(input) ⇒ <code>Promise</code>
Computes the next "step" for our current Vector.  Analagous to `sum`.
The top item on the stack is always the memory held at current position,
so counts should always begin with 0.

**Kind**: instance method of [<code>Machine</code>](#Machine)  

| Param | Type | Description |
| --- | --- | --- |
| input | [<code>Vector</code>](#Vector) | Input state, undefined if desired. |

<a name="Message"></a>

## Message : <code>Object</code>
The [Message](#Message) type defines the Application Messaging Protocol, or AMP.
Each [Actor](Actor) in the network receives and broadcasts messages,
selectively disclosing new routes to peers which may have open circuits.

**Kind**: global class  

* [Message](#Message) : <code>Object</code>
    * [new Message(message)](#new_Message_new)
    * [.asRaw()](#Message+asRaw) ⇒ <code>Buffer</code>

<a name="new_Message_new"></a>

### new Message(message)
The `Message` type is standardized in [Fabric](Fabric) as a [Vector](#Vector), which can be added to any other vector to compute a resulting state.


| Param | Type | Description |
| --- | --- | --- |
| message | [<code>Vector</code>](#Vector) | Message vector.  Will be serialized by [_serialize](#Vector+_serialize). |

<a name="Message+asRaw"></a>

### message.asRaw() ⇒ <code>Buffer</code>
Returns a [Buffer](Buffer) of the complete message.

**Kind**: instance method of [<code>Message</code>](#Message)  
**Returns**: <code>Buffer</code> - Buffer of the encoded [Message](#Message).  
<a name="Oracle"></a>

## Oracle ⇐ <code>Store</code>
An Oracle manages one or more collections, using a <code>mempool</code> for
transitive state.

**Kind**: global class  
**Extends**: <code>Store</code>  

* [Oracle](#Oracle) ⇐ <code>Store</code>
    * [new Oracle(initial)](#new_Oracle_new)
    * [.broadcast(msg)](#Oracle+broadcast) ⇒ <code>Boolean</code>

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

<a name="Peer"></a>

## Peer
An in-memory representation of a node in our network.

**Kind**: global class  

* [Peer](#Peer)
    * [new Peer(config)](#new_Peer_new)
    * [.listen()](#Peer+listen) ⇒ [<code>Peer</code>](#Peer)

<a name="new_Peer_new"></a>

### new Peer(config)
Create an instance of [Peer](#Peer).


| Param | Type | Description |
| --- | --- | --- |
| config | [<code>Vector</code>](#Vector) | Initialization Vector for this peer. |

<a name="Peer+listen"></a>

### peer.listen() ⇒ [<code>Peer</code>](#Peer)
Start listening for connections.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Peer</code>](#Peer) - Chainable method.  
**Emits**: <code>Peer#event:ready</code>  
<a name="Remote"></a>

## Remote : [<code>Remote</code>](#Remote)
Interact with a remote [Resource](#Resource).

**Kind**: global class  
**Properties**

| Name | Type |
| --- | --- |
| config | <code>Object</code> | 
| secure | <code>Boolean</code> | 


* [Remote](#Remote) : [<code>Remote</code>](#Remote)
    * [new Remote(target)](#new_Remote_new)
    * [.enumerate()](#Remote+enumerate) ⇒ <code>Configuration</code>
    * [._PUT(path, obj)](#Remote+_PUT) ⇒ <code>Mixed</code>
    * [._GET(path, params)](#Remote+_GET) ⇒ <code>Mixed</code>
    * [._POST(path, params)](#Remote+_POST) ⇒ <code>Mixed</code>
    * [._OPTIONS(path, params)](#Remote+_OPTIONS) ⇒ <code>Object</code>
    * [._PATCH(path, params)](#Remote+_PATCH) ⇒ <code>Object</code>
    * [._DELETE(path, params)](#Remote+_DELETE) ⇒ <code>Object</code>

<a name="new_Remote_new"></a>

### new Remote(target)
An in-memory representation of a node in our network.


| Param | Type | Description |
| --- | --- | --- |
| target | <code>Object</code> | Target object. |
| target.host | <code>String</code> | Named host, e.g. "localhost". |
| target.secure | <code>String</code> | Require TLS session. |

<a name="Remote+enumerate"></a>

### remote.enumerate() ⇒ <code>Configuration</code>
Enumerate the available Resources on the remote host.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
<a name="Remote+_PUT"></a>

### remote.\_PUT(path, obj) ⇒ <code>Mixed</code>
HTTP PUT against the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Mixed</code> - [description]  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| obj | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_GET"></a>

### remote.\_GET(path, params) ⇒ <code>Mixed</code>
HTTP GET against the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Mixed</code> - [description]  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| params | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_POST"></a>

### remote.\_POST(path, params) ⇒ <code>Mixed</code>
HTTP POST against the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Mixed</code> - [description]  

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

### remote.\_PATCH(path, params) ⇒ <code>Object</code>
HTTP PATCH on the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - - Full description of remote resource.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| params | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_DELETE"></a>

### remote.\_DELETE(path, params) ⇒ <code>Object</code>
HTTP DELETE on the configured Authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - - Full description of remote resource.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| params | <code>Object</code> | Map of parameters to supply. |

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
    * [.trust(source)](#Scribe+trust) ⇒ [<code>Scribe</code>](#Scribe)
    * [.inherits(scribe)](#Scribe+inherits) ⇒ [<code>Scribe</code>](#Scribe)

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

<a name="Scribe+trust"></a>

### router.trust(source) ⇒ [<code>Scribe</code>](#Scribe)
Blindly bind event handlers to the [Source](Source).

**Kind**: instance method of [<code>Router</code>](#Router)  
**Returns**: [<code>Scribe</code>](#Scribe) - Instance of the [Scribe](#Scribe).  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>Source</code> | Event stream. |

<a name="Scribe+inherits"></a>

### router.inherits(scribe) ⇒ [<code>Scribe</code>](#Scribe)
Use an existing Scribe instance as a parent.

**Kind**: instance method of [<code>Router</code>](#Router)  
**Returns**: [<code>Scribe</code>](#Scribe) - The configured instance of the Scribe.  

| Param | Type | Description |
| --- | --- | --- |
| scribe | [<code>Scribe</code>](#Scribe) | Instance of Scribe to use as parent. |

<a name="Scribe"></a>

## Scribe
Simple tag-based recordkeeper.

**Kind**: global class  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | Current configuration. |


* [Scribe](#Scribe)
    * [new Scribe(config)](#new_Scribe_new)
    * [.trust(source)](#Scribe+trust) ⇒ [<code>Scribe</code>](#Scribe)
    * [.inherits(scribe)](#Scribe+inherits) ⇒ [<code>Scribe</code>](#Scribe)

<a name="new_Scribe_new"></a>

### new Scribe(config)
The "Scribe" is a simple tag-based recordkeeper.


| Param | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | General configuration object. |
| config.verbose | <code>Boolean</code> | Should the Scribe be noisy? |

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

<a name="State"></a>

## State
The [State](#State) is the core of most [User](User)-facing interactions.  To
interact with the [User](User), simply propose a change in the state by
committing to the outcome.  This workflow keeps app design quite simple!

**Kind**: global class  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| size | <code>Number</code> | Size of state in bytes. |
| @buffer | <code>Buffer</code> | Byte-for-byte memory representation of state. |
| @type | <code>String</code> | Named type. |
| @data | <code>Mixed</code> | Local instance of the state. |
| @id | <code>String</code> | Unique identifier for this data. |


* [State](#State)
    * [new State(data)](#new_State_new)
    * _instance_
        * [.toString()](#State+toString) ⇒ <code>String</code>
        * [.serialize([input])](#State+serialize) ⇒ <code>Buffer</code>
        * [.deserialize(input)](#State+deserialize) ⇒ [<code>State</code>](#State)
        * [.render()](#State+render) ⇒ <code>String</code>
    * _static_
        * [.fromJSON(input)](#State.fromJSON) ⇒ [<code>State</code>](#State)

<a name="new_State_new"></a>

### new State(data)
Creates a snapshot of some information.


| Param | Type | Description |
| --- | --- | --- |
| data | <code>Mixed</code> | Input data. |

<a name="State+toString"></a>

### state.toString() ⇒ <code>String</code>
Unmarshall an existing state to an instance of a [Blob](Blob).

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>String</code> - Serialized [Blob](Blob).  
<a name="State+serialize"></a>

### state.serialize([input]) ⇒ <code>Buffer</code>
Convert to [Buffer](Buffer).

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>Buffer</code> - [Store](Store)-able blob.  

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

<a name="Storage"></a>

## Storage
Persistent data storage.

**Kind**: global class  
<a name="new_Storage_new"></a>

### new Storage(config)

| Param | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | Configuration for internal datastore. |

<a name="Swarm"></a>

## Swarm : <code>String</code>
The [Swarm](#Swarm) represents a network of peers.

**Kind**: global class  

* [Swarm](#Swarm) : <code>String</code>
    * [new Swarm(config)](#new_Swarm_new)
    * [.start()](#Swarm+start) ⇒ <code>Promise</code>

<a name="new_Swarm_new"></a>

### new Swarm(config)
Create an instance of a [Swarm](#Swarm).


| Param | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | Configuration object. |

<a name="Swarm+start"></a>

### swarm.start() ⇒ <code>Promise</code>
Begin computing.

**Kind**: instance method of [<code>Swarm</code>](#Swarm)  
**Returns**: <code>Promise</code> - Resolves to instance of [Swarm](#Swarm).  
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

