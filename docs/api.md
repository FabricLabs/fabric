## Classes

<dl>
<dt><a href="#Contract">Contract</a></dt>
<dd></dd>
<dt><a href="#Fabric">Fabric</a></dt>
<dd></dd>
<dt><a href="#Oracle">Oracle</a></dt>
<dd></dd>
<dt><a href="#Peer">Peer</a></dt>
<dd></dd>
<dt><a href="#Remote">Remote</a></dt>
<dd></dd>
<dt><a href="#Vector">Vector</a></dt>
<dd></dd>
<dt><a href="#Walker">Walker</a></dt>
<dd></dd>
<dt><a href="#Worker">Worker</a></dt>
<dd></dd>
</dl>

<a name="Contract"></a>

## Contract
**Kind**: global class  
<a name="new_Contract_new"></a>

### new Contract(vector)
Self-executing multi-party agreement.

## Extra
Extra is metadata carried with an object, no matter what.  It is the
immutable core to the object's lifecycle, the "inventory" of the character
during their interaction with this Genesis Tablet.


| Param | Type | Description |
| --- | --- | --- |
| vector | [<code>Vector</code>](#Vector) | Input vector [description] |

<a name="Fabric"></a>

## Fabric
**Kind**: global class  

* [Fabric](#Fabric)
    * [new Fabric(config)](#new_Fabric_new)
    * [.render](#Fabric+render)
        * [new Fabric.prototype.render(config)](#new_Fabric+render_new)
    * [.bootstrap(vector, notify)](#Fabric+bootstrap)

<a name="new_Fabric_new"></a>

### new Fabric(config)
Fabric Core Library


| Param | Type | Description |
| --- | --- | --- |
| config | <code>object</code> | configuration object |

<a name="Fabric+render"></a>

### fabric.render
**Kind**: instance class of [<code>Fabric</code>](#Fabric)  
<a name="new_Fabric+render_new"></a>

#### new Fabric.prototype.render(config)
Consume a known state and


| Param | Type | Description |
| --- | --- | --- |
| config | <code>object</code> | configuration object |

<a name="Fabric+bootstrap"></a>

### fabric.bootstrap(vector, notify)
Consume an application definition (configure resources + services)

**Kind**: instance method of [<code>Fabric</code>](#Fabric)  

| Param | Type | Description |
| --- | --- | --- |
| vector | <code>object</code> | Object representation of the application definition. |
| notify | <code>function</code> | Callback function (err, result) |

<a name="Oracle"></a>

## Oracle
**Kind**: global class  

* [Oracle](#Oracle)
    * [new Oracle(initial)](#new_Oracle_new)
    * [._load](#Oracle+_load) ⇒ [<code>Vector</code>](#Vector)

<a name="new_Oracle_new"></a>

### new Oracle(initial)
Trusted point-of-reference for external services.


| Param | Type | Description |
| --- | --- | --- |
| initial | <code>Object</code> | Initialization vector. |

<a name="Oracle+_load"></a>

### oracle._load ⇒ [<code>Vector</code>](#Vector)
Synchronously reads a local path into memory.

**Kind**: instance property of [<code>Oracle</code>](#Oracle)  
**Returns**: [<code>Vector</code>](#Vector) - Computed vector.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | dir (path to read) |

<a name="Peer"></a>

## Peer
**Kind**: global class  
<a name="new_Peer_new"></a>

### new Peer(initial)
An in-memory representation of a node in our network.


| Param | Type | Description |
| --- | --- | --- |
| initial | [<code>Vector</code>](#Vector) | Initialization Vector for this peer. |

<a name="Remote"></a>

## Remote
**Kind**: global class  

* [Remote](#Remote)
    * [new Remote(initial)](#new_Remote_new)
    * [._GET](#Remote+_GET) ⇒ <code>Mixed</code>
    * [._OPTIONS](#Remote+_OPTIONS) ⇒ <code>Object</code>

<a name="new_Remote_new"></a>

### new Remote(initial)
An in-memory representation of a node in our network.


| Param | Type | Description |
| --- | --- | --- |
| initial | <code>Object</code> | Target object. |

<a name="Remote+_GET"></a>

### remote._GET ⇒ <code>Mixed</code>
HTTP GET against the configured Authority.

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

<a name="Vector"></a>

## Vector
**Kind**: global class  

* [Vector](#Vector)
    * [new Vector(init)](#new_Vector_new)
    * [._serialize(input)](#Vector+_serialize) ⇒ <code>String</code>
    * [._identify(entity)](#Vector+_identify) ⇒ <code>Object</code>
    * [.compute(input)](#Vector+compute) ⇒ [<code>Vector</code>](#Vector)

<a name="new_Vector_new"></a>

### new Vector(init)
An "Initialization" Vector.


| Param | Type | Description |
| --- | --- | --- |
| init | <code>object</code> | Input state (will map to `@data`.) |

<a name="Vector+_serialize"></a>

### vector._serialize(input) ⇒ <code>String</code>
_serialize is a placeholder, should be discussed.

**Kind**: instance method of [<code>Vector</code>](#Vector)  
**Returns**: <code>String</code> - - resulting string [JSON-encoded version of the local `@data` value.]  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | What to serialize.  Defaults to `this['@data']`. |

<a name="Vector+_identify"></a>

### vector._identify(entity) ⇒ <code>Object</code>
Compute the `sha256` hash of the input entity's `@data` field.

**Kind**: instance method of [<code>Vector</code>](#Vector)  
**Returns**: <code>Object</code> - Transformed entity with `@id` set to the `sha256` hash of `@data`.  

| Param | Type | Description |
| --- | --- | --- |
| entity | <code>Object</code> | Input object; expects `@data`. |

<a name="Vector+compute"></a>

### vector.compute(input) ⇒ [<code>Vector</code>](#Vector)
Computes the next "step" for our current Vector.

**Kind**: instance method of [<code>Vector</code>](#Vector)  
**Returns**: [<code>Vector</code>](#Vector) - - Makes this Vector chainable.  Possible antipattern.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | Input state, undefined if desired. |

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
| init | [<code>Vector</code>](#Vector) | Initial state tree. |

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
| input | [<code>Vector</code>](#Vector) | Input vector. |

