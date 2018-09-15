## Classes

<dl>
<dt><a href="#Fabric">Fabric</a></dt>
<dd></dd>
<dt><a href="#Machine">Machine</a></dt>
<dd></dd>
<dt><a href="#Peer">Peer</a></dt>
<dd></dd>
<dt><a href="#Remote">Remote</a> : <code>Vector</code></dt>
<dd></dd>
<dt><a href="#Resource">Resource</a></dt>
<dd></dd>
<dt><a href="#Storage">Storage</a></dt>
<dd></dd>
<dt><a href="#Walker">Walker</a></dt>
<dd></dd>
<dt><a href="#Worker">Worker</a></dt>
<dd></dd>
</dl>

## Members

<dl>
<dt><a href="#App">App</a></dt>
<dd><p>Default interface to <a href="#Fabric">Fabric</a>.  Exposes immutable types for all
requisite <a href="Component">Component</a> elements of the <code>components</code> option.</p>
</dd>
<dt><a href="#CLI">CLI</a></dt>
<dd><p>Base class for a terminal-like interface to the Fabric network.</p>
</dd>
<dt><a href="#Scribe">Scribe</a></dt>
<dd><p>Implementation of a simple tag-based recordkeeper.</p>
</dd>
</dl>

<a name="Fabric"></a>

## Fabric
**Kind**: global class  
**Emits**: <code>Fabric#event:thread</code>, <code>Fabric#event:step Emitted on a &#x60;compute&#x60; step.</code>  

* [Fabric](#Fabric)
    * [new Fabric(config)](#new_Fabric_new)
    * [.bootstrap(vector, notify)](#Fabric+bootstrap)
    * [.trust(source)](#Fabric+trust) ⇒ [<code>Fabric</code>](#Fabric)
    * [.render()](#Fabric+render) ⇒ <code>String</code>

<a name="new_Fabric_new"></a>

### new Fabric(config)
The [module:Fabric](module:Fabric) type implements the Fabric Protocol, a formally-defined language for the establishment and settlement of mutually-agreed upon proofs of work.

Utilizing


| Param | Type | Description |
| --- | --- | --- |
| config | <code>Vector</code> | Initial configuration for the Fabric engine.  This can be considered the "genesis" state for any contract using the system.  If a chain of events is maintained over long periods of time, `state` can be considered "in contention", and it is demonstrated that the outstanding value of the contract remains to be settled. |

<a name="Fabric+bootstrap"></a>

### fabric.bootstrap(vector, notify)
Consume an application definition (configure resources + services)

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type | Description |
| --- | --- | --- |
| vector | <code>object</code> | Object representation of the application definition. |
| notify | <code>function</code> | Callback function (err, result) |

<a name="Fabric+trust"></a>

### fabric.trust(source) ⇒ [<code>Fabric</code>](#Fabric)
Blindly consume messages from a `source`, relying on `Chain` to verify.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: [<code>Fabric</code>](#Fabric) - Returns itself.  

| Param | Type | Description |
| --- | --- | --- |
| source | <code>EventEmitter</code> | Any object which implements the `EventEmitter` pattern. |

<a name="Fabric+render"></a>

### fabric.render() ⇒ <code>String</code>
Serialize the current network state and provide it as output.

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  
**Returns**: <code>String</code> - Serialized output for consumption.  
<a name="Machine"></a>

## Machine
**Kind**: global class  
<a name="new_Machine_new"></a>

### new Machine(config)
General-purpose state machine with [Vector](Vector)-based instructions.


| Param | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | Run-time configuration. |

<a name="Peer"></a>

## Peer
**Kind**: global class  

* [Peer](#Peer)
    * [new Peer(config)](#new_Peer_new)
    * [.listen()](#Peer+listen) ⇒ [<code>Peer</code>](#Peer)

<a name="new_Peer_new"></a>

### new Peer(config)
An in-memory representation of a node in our network.


| Param | Type | Description |
| --- | --- | --- |
| config | <code>Vector</code> | Initialization Vector for this peer. |

<a name="Peer+listen"></a>

### peer.listen() ⇒ [<code>Peer</code>](#Peer)
Start listening for connections.

**Kind**: instance method of [<code>Peer</code>](#Peer)  
**Returns**: [<code>Peer</code>](#Peer) - Chainable method.  
**Emits**: <code>Peer#event:ready</code>  
<a name="Remote"></a>

## Remote : <code>Vector</code>
**Kind**: global class  

* [Remote](#Remote) : <code>Vector</code>
    * [new Remote(target)](#new_Remote_new)
    * [._PUT](#Remote+_PUT) ⇒ <code>Mixed</code>
    * [._GET](#Remote+_GET) ⇒ <code>Mixed</code>
    * [._POST](#Remote+_POST) ⇒ <code>Mixed</code>
    * [._OPTIONS](#Remote+_OPTIONS) ⇒ <code>Object</code>

<a name="new_Remote_new"></a>

### new Remote(target)
An in-memory representation of a node in our network.


| Param | Type | Description |
| --- | --- | --- |
| target | <code>Object</code> | Target object. |
| target.host | <code>String</code> | Named host, e.g. "localhost". |
| target.secure | <code>String</code> | Require TLS session. |

<a name="Remote+_PUT"></a>

### remote._PUT ⇒ <code>Mixed</code>
HTTP PUT against the configured Authority.

**Kind**: instance property of [<code>Remote</code>](#Remote)  
**Returns**: <code>Mixed</code> - [description]  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| obj | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_GET"></a>

### remote._GET ⇒ <code>Mixed</code>
HTTP GET against the configured Authority.

**Kind**: instance property of [<code>Remote</code>](#Remote)  
**Returns**: <code>Mixed</code> - [description]  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| params | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_POST"></a>

### remote._POST ⇒ <code>Mixed</code>
HTTP POST against the configured Authority.

**Kind**: instance property of [<code>Remote</code>](#Remote)  
**Returns**: <code>Mixed</code> - [description]  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| params | <code>Object</code> | Map of parameters to supply. |

<a name="Remote+_OPTIONS"></a>

### remote._OPTIONS ⇒ <code>Object</code>
HTTP OPTIONS on the configured Authority.

**Kind**: instance property of [<code>Remote</code>](#Remote)  
**Returns**: <code>Object</code> - - Full description of remote resource.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | HTTP Path to request. |
| params | <code>Object</code> | Map of parameters to supply. |

<a name="Resource"></a>

## Resource
**Kind**: global class  

* [Resource](#Resource)
    * [new Resource(definition)](#new_Resource_new)
    * [.create](#Resource+create) ⇒ <code>Vector</code>
    * [.update](#Resource+update) ⇒ <code>Vector</code>
    * [.trust(store)](#Resource+trust) ⇒ [<code>Resource</code>](#Resource)

<a name="new_Resource_new"></a>

### new Resource(definition)
Generic interface for collections of digital objects.


| Param | Type | Description |
| --- | --- | --- |
| definition | <code>Object</code> | Initial parameters |

<a name="Resource+create"></a>

### resource.create ⇒ <code>Vector</code>
Create an instance of the Resource's type.

**Kind**: instance property of [<code>Resource</code>](#Resource)  
**Returns**: <code>Vector</code> - Resulting Vector with deterministic identifier.  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>Object</code> | Map of the instance's properties and values. |

<a name="Resource+update"></a>

### resource.update ⇒ <code>Vector</code>
Modify an existing instance of a Resource by its unique identifier.  Produces a new instance.

**Kind**: instance property of [<code>Resource</code>](#Resource)  
**Returns**: <code>Vector</code> - Resulting Vector instance with updated identifier.  

| Param | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Unique ID to update. |
| update | <code>Object</code> | Map of change to make (keys -> values). |

<a name="Resource+trust"></a>

### resource.trust(store) ⇒ [<code>Resource</code>](#Resource)
Trust a datastore.

**Kind**: instance method of [<code>Resource</code>](#Resource)  
**Returns**: [<code>Resource</code>](#Resource) - Bound instance of the Resource.  

| Param | Type | Description |
| --- | --- | --- |
| store | <code>Store</code> | Instance to trust. |

<a name="Storage"></a>

## Storage
**Kind**: global class  
<a name="new_Storage_new"></a>

### new Storage(config)
Persistent data storage.


| Param | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | Configuration for internal datastore. |

<a name="Walker"></a>

## Walker
**Kind**: global class  

* [Walker](#Walker)
    * [new Walker(init)](#new_Walker_new)
    * [._define](#Walker+_define) ⇒ <code>Object</code>
    * [._explore(path, [map])](#Walker+_explore) ⇒ <code>Object</code>

<a name="new_Walker_new"></a>

### new Walker(init)
The Walker explores a directory tree and maps it to memory.


| Param | Type | Description |
| --- | --- | --- |
| init | <code>Vector</code> | Initial state tree. |

<a name="Walker+_define"></a>

### walker._define ⇒ <code>Object</code>
Explores a directory tree on the local system's disk.

**Kind**: instance property of [<code>Walker</code>](#Walker)  
**Returns**: <code>Object</code> - A hashmap of directory contents.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| dir | <code>String</code> |  | Path to crawl on local disk. |
| [map] | <code>Object</code> | <code>{}</code> | Pointer to previous step in stack. |

<a name="Walker+_explore"></a>

### walker._explore(path, [map]) ⇒ <code>Object</code>
Explores a directory tree on the local system's disk.

**Kind**: instance method of [<code>Walker</code>](#Walker)  
**Returns**: <code>Object</code> - [description]  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| path | <code>String</code> |  | [description] |
| [map] | <code>Object</code> | <code>{}</code> | [description] |

<a name="Worker"></a>

## Worker
**Kind**: global class  

* [Worker](#Worker)
    * [new Worker(method)](#new_Worker_new)
    * [.compute(input)](#Worker+compute) ⇒ <code>String</code>

<a name="new_Worker_new"></a>

### new Worker(method)
Workers are arbitrary containers for processing data.  They can be thought of
almost like "threads", as they run asynchronously over the duration of a
contract's lifetime as "fulfillment conditions" for its closure.


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
| input | <code>Vector</code> | Input vector. |

<a name="App"></a>

## App
Default interface to [Fabric](#Fabric).  Exposes immutable types for all
requisite [Component](Component) elements of the `components` option.

**Kind**: global variable  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| config | <code>Configuration</code> | Initial [Vector](Vector). |
| config.components | <code>Map</code> | Transformation function of `Σ ⇒ Δ`. |


* [App](#App)
    * [._defer](#App+_defer) ⇒ [<code>App</code>](#App)
    * [._consume(resources)](#App+_consume) ⇒ [<code>App</code>](#App)
    * [.attach(element)](#App+attach) ⇒ [<code>App</code>](#App)

<a name="App+_defer"></a>

### app._defer ⇒ [<code>App</code>](#App)
Defer control of this application to an outside authority.

**Kind**: instance property of [<code>App</code>](#App)  
**Returns**: [<code>App</code>](#App) - The configured application as deferred to `authority`.  

| Param | Type | Description |
| --- | --- | --- |
| authority | <code>String</code> | Hostname to trust. |

<a name="App+_consume"></a>

### app._consume(resources) ⇒ [<code>App</code>](#App)
Define the Application's resources from an existing resource map.

**Kind**: instance method of [<code>App</code>](#App)  
**Returns**: [<code>App</code>](#App) - Configured instance of the Application.  

| Param | Type | Description |
| --- | --- | --- |
| resources | <code>Object</code> | Map of resource definitions by name. |

<a name="App+attach"></a>

### app.attach(element) ⇒ [<code>App</code>](#App)
Configure the Application to use a specific element.

**Kind**: instance method of [<code>App</code>](#App)  
**Returns**: [<code>App</code>](#App) - Configured instance of the Application.  

| Param | Type | Description |
| --- | --- | --- |
| element | <code>DOMElement</code> | DOM element to bind to. |

<a name="CLI"></a>

## CLI
Base class for a terminal-like interface to the Fabric network.

**Kind**: global variable  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| config | <code>Configratione</code> | Initial [Vector](Vector). |
| oracle | <code>Oracle</code> | Instance of [Oracle](Oracle). |

<a name="CLI+_handleChanges"></a>

### clI._handleChanges(msg) ⇒ [<code>CLI</code>](#CLI)
Update UI as necessary based on changes from Oracle.

**Kind**: instance method of [<code>CLI</code>](#CLI)  

| Param | Type | Description |
| --- | --- | --- |
| msg | <code>Message</code> | Incoming [Message](Message). |

<a name="Scribe"></a>

## Scribe
Implementation of a simple tag-based recordkeeper.

**Kind**: global variable  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | Current configuration. |

