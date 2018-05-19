## Modules

<dl>
<dt><a href="#module_Fabric">Fabric</a> : <code><a href="#Fabric">Fabric</a></code></dt>
<dd><p>Fabric&#39;s Developer API.  Exposes immutable types for all requisite components.</p>
</dd>
</dl>

## Classes

<dl>
<dt><a href="#Fabric">Fabric</a></dt>
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

## Functions

<dl>
<dt><a href="#value">value(msg, [options])</a> ⇒ <code>string</code></dt>
<dd><p>Generates SHA-256 hash of string.</p>
</dd>
</dl>

<a name="module_Fabric"></a>

## Fabric : [<code>Fabric</code>](#Fabric)
Fabric's Developer API.  Exposes immutable types for all requisite components.


* [Fabric](#module_Fabric) : [<code>Fabric</code>](#Fabric)
    * [.App](#module_Fabric.App) : <code>App</code>
    * [.Block](#module_Fabric.Block) : <code>Block</code>
    * [.Chain](#module_Fabric.Chain) : <code>Chain</code>
    * [.CLI](#module_Fabric.CLI) : <code>CLI</code>
    * [.Datastore](#module_Fabric.Datastore) : <code>Datastore</code>
    * [.HTTP](#module_Fabric.HTTP) : <code>HTTP</code>
    * [.Machine](#module_Fabric.Machine) : <code>Machine</code>
    * [.Message](#module_Fabric.Message) : <code>Message</code>
    * [.Oracle](#module_Fabric.Oracle) : <code>Oracle</code>
    * [.Remote](#module_Fabric.Remote) : [<code>Remote</code>](#Remote)
    * [.Resource](#module_Fabric.Resource) : [<code>Resource</code>](#Resource)
    * [.Storage](#module_Fabric.Storage) : [<code>Storage</code>](#Storage)
    * [.Store](#module_Fabric.Store) : <code>Store</code>
    * [.Transaction](#module_Fabric.Transaction) : <code>Transaction</code>
    * [.Validator](#module_Fabric.Validator) : <code>Validator</code>
    * [.Vector](#module_Fabric.Vector) : <code>Vector</code>
    * [.Walker](#module_Fabric.Walker) : [<code>Walker</code>](#Walker)
    * [.Worker](#module_Fabric.Worker) : [<code>Worker</code>](#Worker)

<a name="module_Fabric.App"></a>

### Fabric.App : <code>App</code>
Offers complex functionality for managing user interfaces bound to real-time data.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.Block"></a>

### Fabric.Block : <code>Block</code>
A batch of Transactions.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.Chain"></a>

### Fabric.Chain : <code>Chain</code>
General mechanism for storing immutable events over time.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.CLI"></a>

### Fabric.CLI : <code>CLI</code>
Basic terminal interface for [Fabric](#module_Fabric).

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.Datastore"></a>

### Fabric.Datastore : <code>Datastore</code>
Persistent data storage for local environments.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.HTTP"></a>

### Fabric.HTTP : <code>HTTP</code>
Fully-functional HTTP server for providing oracle services.  See also [module:Oracle](module:Oracle).

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.Machine"></a>

### Fabric.Machine : <code>Machine</code>
General-purpose computer with verifiable execution.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.Message"></a>

### Fabric.Message : <code>Message</code>
[module:Vector](module:Vector) instances for potential application.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.Oracle"></a>

### Fabric.Oracle : <code>Oracle</code>
External point of trust for [module:Contract](module:Contract) instances.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.Remote"></a>

### Fabric.Remote : [<code>Remote</code>](#Remote)
Simple client which speaks the [Fabric](#module_Fabric) protocol.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.Resource"></a>

### Fabric.Resource : [<code>Resource</code>](#Resource)
Interactive datastore.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.Storage"></a>

### Fabric.Storage : [<code>Storage</code>](#Storage)
Abstract long-term storage with isomorphic support for various clients.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.Store"></a>

### Fabric.Store : <code>Store</code>
Simple storage class.  Uses LevelDB by default.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.Transaction"></a>

### Fabric.Transaction : <code>Transaction</code>
An atomic unit of change within the system.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.Validator"></a>

### Fabric.Validator : <code>Validator</code>
Validates known assumptions.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.Vector"></a>

### Fabric.Vector : <code>Vector</code>
Minimum possible unit.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.Walker"></a>

### Fabric.Walker : [<code>Walker</code>](#Walker)
Agent capable of walking a graph.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
<a name="module_Fabric.Worker"></a>

### Fabric.Worker : [<code>Worker</code>](#Worker)
Simple job processing agent.

**Kind**: static property of [<code>Fabric</code>](#module_Fabric)  
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
The [Fabric](#module_Fabric) type implements the Fabric Protocol, a formally-defined language for the establishment and settlement of mutually-agreed upon proofs of work.

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
<a name="Peer"></a>

## Peer
**Kind**: global class  
<a name="new_Peer_new"></a>

### new Peer(initial)
An in-memory representation of a node in our network.


| Param | Type | Description |
| --- | --- | --- |
| initial | <code>Vector</code> | Initialization Vector for this peer. |

<a name="Remote"></a>

## Remote : <code>Vector</code>
**Kind**: global class  

* [Remote](#Remote) : <code>Vector</code>
    * [new Remote(initial)](#new_Remote_new)
    * [._PUT](#Remote+_PUT) ⇒ <code>Mixed</code>
    * [._GET](#Remote+_GET) ⇒ <code>Mixed</code>
    * [._POST](#Remote+_POST) ⇒ <code>Mixed</code>
    * [._OPTIONS](#Remote+_OPTIONS) ⇒ <code>Object</code>

<a name="new_Remote_new"></a>

### new Remote(initial)
An in-memory representation of a node in our network.


| Param | Type | Description |
| --- | --- | --- |
| initial | <code>Object</code> | Target object. |

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
<a name="new_Resource_new"></a>

### new Resource(definition)
Generic interface for collections of digital objects.


| Param | Type | Description |
| --- | --- | --- |
| definition | <code>Object</code> | Initial parameters |

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
    * [new Worker(initial)](#new_Worker_new)
    * [.compute(input)](#Worker+compute) ⇒ <code>String</code>

<a name="new_Worker_new"></a>

### new Worker(initial)
Workers are arbitrary containers for processing data.  They can be thought of
almost like "threads", as they run asynchronously over the duration of a
contract's lifetime as "fulfillment conditions" for its closure.


| Param | Type | Description |
| --- | --- | --- |
| initial | <code>Object</code> | Configuration object |

<a name="Worker+compute"></a>

### worker.compute(input) ⇒ <code>String</code>
Handle a task.

**Kind**: instance method of [<code>Worker</code>](#Worker)  
**Returns**: <code>String</code> - Outcome of the requested job.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>Vector</code> | Input vector. |

<a name="value"></a>

## value(msg, [options]) ⇒ <code>string</code>
Generates SHA-256 hash of string.

**Kind**: global function  
**Returns**: <code>string</code> - Hash of msg as hex character string.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| msg | <code>string</code> |  | (Unicode) string to be hashed. |
| [options] | <code>Object</code> |  |  |
| [options.msgFormat] | <code>string</code> | <code>&quot;string&quot;</code> | Message format: 'string' for JavaScript string   (gets converted to UTF-8 for hashing); 'hex-bytes' for string of hex bytes ('616263' ≡ 'abc') . |
| [options.outFormat] | <code>string</code> | <code>&quot;hex&quot;</code> | Output format: 'hex' for string of contiguous   hex bytes; 'hex-w' for grouping hex bytes into groups of (4 byte / 8 character) words. |

