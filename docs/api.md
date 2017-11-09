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
<dt><a href="#Vector">Vector</a></dt>
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

<a name="Vector"></a>

## Vector
**Kind**: global class  

* [Vector](#Vector)
    * [new Vector(init)](#new_Vector_new)
    * [._serialize(input)](#Vector+_serialize) ⇒ <code>String</code>
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

<a name="Vector+compute"></a>

### vector.compute(input) ⇒ [<code>Vector</code>](#Vector)
Computes the next "step" for our current Vector.

**Kind**: instance method of [<code>Vector</code>](#Vector)  
**Returns**: [<code>Vector</code>](#Vector) - - Makes this Vector chainable.  Possible antipattern.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | Input state, undefined if desired. |

