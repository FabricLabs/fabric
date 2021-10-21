# Fabric Protocol Specification
Fabric is a peer-to-peer protocol for routing "work orders" in a mesh-style
topology. Peers hold open "payment channels" with one another, adjusting
settlement terms over time as orders are filled and routed for others.

Settlement may be performed by any "anchor chain", as each order contains an
unspent payment commitment, which becomes spendable to anyone computing the work
contained within the order.  A complete description of each "work program" is
referenced in the order, which can be kept secret from the worker (expensive) or
pre-computed and thus asking for verification (cheap).

A storage protocol is provided for sparse local node retention (SLNR) which can
be used to share a sparse or complete representation of a globally distributed
state.  Each operation within the Fabric network has a complete state chain,
which comprises a network of "potential states" we describe as a "state bubble."
By storing a history, nodes can make local decisions whether to retain or prune
portions of their state chain based on their own economic evaluation of
available resources.

## Introduction
Orders in the Fabric network are effectively "requests for computation":
cryptographic commitments to payment, known as a [Zero-Knowledge Contingent
Payment][zkcp], in exchange for the output of a requested program.  When the
required computation is complete, the fulfilling party is able to claim the
payment in the network — represented as an unspent transaction output to be
later broadcast on the anchor chain.

We rely initially on the Bitcoin blockchain as a trust anchor, an external point
of reference for shared state, but anticipate the reliance on this system to
reduce over time as trust increases in the competitive coordination guarantees
offered by the network itself.

## General Overview
Participants in the Fabric network are arbitrarily divided into "Users", which
broadcast state mutations, and "Workers", which validate proofs as broadcast by
the users.  In return, workers earn INK, which is then used to pay for future
work.  We use the sidechain mechanism to ensure a consistent state, and with the
execution of the underlying cryptographic challenges as our Proof of Work (PoW).

### Architecture
Users pay Workers to compute proofs, which are then amended to the Fabric
sidechain.

![Fabric Architecture](images/architecture.png)

The Fabric sidechain maintains an ordered sequence of events that led to the
current "tip" of the chain.  A valid Fabric block contains 1) a timelocked
transaction output containing signed inputs of all valid state chains, 2) a
transaction output as a fee to the Bitcoin mainchain.  The ordered sequence is
stored as a merkle tree, ensuring index integrity.

## Transactions
### Order Creation
The creator of the order, the "Submitter", defines a computation to be performed
as `f`, a series of instructions, `r`, the pre-computation state, `k`, a public
key from which payment will be sent, and `g`, the desired outcome.

### Order Fulfillment
Workers must compute over `M`, the set of all possible states for value `r`, and
present a solution `s` as a sequence of instructions used to arrive upon the
corresponding answer `g`.

Each potential computation in set `M` is attempted until such time as a solution
is found.  Workers may use any strategy for exploring vector space `M`, and may
claim the payment by broadcasting their solution with an unspent payment
commitment to the sidechain miners.

### Message Security
All messages are signed with `k_priv`, the corresponding private key to `k`, offering signature `p`.

### Work Subdivision
As many potential paths exist in the computation tree for any particular contract, work may be subdivided and even negotiated with nearby peers.

### Merkle Proofs
Arbitrary computer programs can be compiled into a merkleized syntax tree, with each step in the program computable independently and deterministically.


## Network

### Peer Types
#### Edge Nodes
Edge Nodes in the Fabric network expose application namespaces over an existing HTTP-speaking network, for example via an IPv6 address or a public domain name.  These take on the responsibility of rendering the initial application and delivering to a normal HTML browser for consumption and, wherever possible, bootstrapping into a Light Node.

#### Light Nodes
Light Nodes are operational messaging actors, which involves maintaining a local database of the documents they are interacting with and active connections to the peer-to-peer network.  These applications can now consume transactions from the network, apply them to their local database, and service requests for content at specific states.

Light Nodes are most frequently users in the network, including bootstrapped browsers that have executed the application code and have connected to the peer network via a WebRTC tunnel.

#### Full Nodes
In addition to the database maintained by a Light Node, a Full Node maintains a full transactional history of a Fabric namespace, and can replay that transaction history to a peer that requests it.

Full Nodes are most frequently dedicated processes that service Light Node connections.

## Consensus
Consensus is not required in the Fabric network.  Should any individual namespace require consensus, it can quite easily be implemented within the message validation rules exposed by the definition of the namespace.

We propose one such method, based on Bitcoin's existing Proof of Work.

### Mining
Miners aggregate transactions, validate their proofs, and sign them into a
proof-of-work-powered block before broadcasting to the network for inclusion in
the blockchain.

### Variability
Fabric offers varying levels of consensus, defined on a per-namespace basis.  Consensus levels range from `NONE`, where any actor may mutate state, to `FULL`, where all actors must agree that the state mutation is valid.  Interesting levels include `MAJORITY`, which offers a simple majority of contract responses to become valid, and `PLURALITY`, where the single largest voting block offers the validity.

In this way, all participants become functional participants in the consensus of the network.

## Implementation
### Components
#### Fabric Layering Ontology (FLO)
The mechanics of Fabric can be thought of as a layered system, with a simple and bi-directional set of contractual obligations of each layer to the next:

1. **Application**, Maki as a reference client, a simple framework
1. **Behaviors**, References to known instructions
1. **Resources**, Contractual definition of the available object types
1. **Messages**, Events emitted from Resources and their instances
1. **Mutations**, Application Mutation Protocol (AMP)
1. **Consensus**, Chainstore / Homomorph
1. **Permanence**, Bitcoin blockchain

#### Application Resource Contracts (ARCs)
ARCs are bundles of instructions that define a Resource and its properties.

```
RESOURCE -> BEHAVIORS -> MESSAGES
```

#### Application Mutation Protocol (AMP)
Much like Bitcoin's original scripting language^[1][bitcoin scripting], Fabric
transactions are executed serially and evaluated in sum.  The language is
modeled after the JSON Patch specification^[2][json patch], and contains the
following operations:

```
0x01 ADD
0x02 REMOVE
0x03 REPLACE
0x04 MOVE
0x05 COPY
0x06 TEST
```

All of these operations are functionally identical to the [RFC 6902][rfc6902] definition of their uses.

#### Shared State
After sharing an initial state, a node in the network can apply series of instructions encoded in the mutation protocol to synchronize against an event source.

#### Fabric Service Layer
Nodes in the Fabric network have a special communication network made available to them to coordinate peer relationships, negotiate work contracts, and establish the overal health of the network.

The Fabric network implements a basic service contract namespace named `fabric`, which provides the following resources:

```
CONTRACTS: all known work contracts, stored by their hash
PEERS: all known peers
```

Consensus is not needed, or even desired, for these resources, as they should be expected to increase in size non-linearly.  In an eventual emergent market, peers will begin to charge for accessing these resources, and subsequently the emergence of specialized "data aggregators" should occur.

### Connecting
#### Initialization
When a new peer joins the Fabric network, he must connect to a known peer to advertise his availability for work.  This is done by first initializing direct TCP socket with that peer, and initializing a zero-value payment channel [?] to ensure the availability of the underlying computational resources.  The peer can indicate that he is removing himself from the network by closing this channel at any time, or re-establish an existing connection by simply sharing the unsigned transaction of that initial TCP connection.  This may have other benefits including the ability to multi-plex connections to peers, something that should perhaps be made invisible through the use of an underlying transport network (see ROUTING).

[?]: IS_THIS_POSSIBLE?


#### Peering

##### Reputation
Peers are responsible for tracking their own reputation state for known peers, and can request from their peers the reputation of others (web of trust).  Furthermore, peer reputations can be broadcast, but can safely be ignored if they do not originate from a peer you trust!

### Transactions
Every namespace begins with a GENESIS STATE.

Bundles of PATCH SETS can be addressed by their channel name, and this bundle can be referred to as a TRANSACTION.  Some additional information is required to form a valid transaction – such as references to the

```javascript
{
  channels: {
    '/votes': {
      parent: '9d73f8e89de9a1f2b431b574ed9346da6f25c783e61d09de09533d3bf2eb2ddb',
      ops: [
        { op: 'add', path: '/0', value: { ... } }
      ],
      signature: '8D05FBF26ADDD079E19D8B60CC43AE81...',
      output: 'someUnspentBitcoinTXkey'
    }
  }
}
```

`parent` is some standardized hash of the previous block.  Signature is the output of the signature by the broadcasting party (not the relay!).

SCRATCHPAD: Proof of Work might be introduced via aggregating these transactions, hashing them, and matching against some difficulty score (i.e., the Bitcoin network's).

### Advertising
Once a connection is established, newline-separated commands are served via a simple protocol.  Commands include:

```
PEER {hash|ipv6}: indicating a new peer
SYNC {hash}: requesting the state of a chain
BID {volume} {amount} {contract} {state}: indicating a new available work contract
FILL {hash} {opset}: indication of the completion of a BID, and the operations it produced
INQ {hash|ipv6}: request for a peer's reputation
REP {hash|ipv6} {value}: broadcast of a peer's reputation
```

### Tunneling (!)
High-volume relationships between specialized actors can utilize a contract tunnel, which is a specifically crafted payment channel between those peers.  For example, if Alice would like to compute the 1000th digit of the Fibonacci sequence, she would broadcast the `BID` operation as normal, but then Bob can initialize a payment channel to Alice by sending her a signed transaction `t1`.  If Alice trusts Bob to be reliable based on prior interactions, she can broadcast many transactions to Bob, and Bob will complete them and send their corresponding results in bulk.

1. Alice: initial bid
2. Bob: contract initiation
3. Alice: contract acceptance
4. Alice: [many] BID operations
5. Bob: [many] FILL operations
6. Alice or Bob: contract termination

### Routing
Fabric is agnostic as to which underlying transport network it utilizes, but it becomes apparent that the current BGP-based Internet is not appropriately suited for an organic computation network.  We intend to utilize a stronger network should it emerge, wherein [I2P][i2p] and [CJDNS][cjdns] both serve as promising replacements.  Fabric will not itself enforce an underlying transport, as it should be freely deployable in any environment, for any use.

### Code Store
Fabric applications are not required to publish their code, and may even utilize homomorphic encryption^[3][homomorphic] to deliver executable code, but not reveal their contents.  This will be an integral function to the wide-spread adoption of the Fabric network, and it should remain unopinionated in this regard.  A bidder's market will determine the value of auditable code (open source) against non-auditable code (zero knowledge).

The initial prototype utilizes mainline DHT to store code bundles by their hashes.  Any other storage mechanism could be utilized, but a DHT seems best suited for the widespread availability of the code samples.

A protocol is provided for the initiator to deliver a signed bundle of executable code.

#### Confidential Operations
Zero knowledge, building on confidential transactions (Gregory Maxwell, Adam Back, et al).

## Technical Specification
Resources must be addressable – the definition of a Resource must be accessible at all times to the network.

Resources must also be versioned.

### Protocol

```
OPEN_CHANNEL       # SIGHASH_SINGLE|ANYONECANPAY 2-of-2 multisig HTLC
PROPOSE_PROGRAM    # out-of-band negotiation with OP_RETURN address
AWAIT_CONFIRMATION # await block chain for corresponding bond
ACCEPT_PEER        # create and share swap transactions
AWAIT_CONFIRMATION # await block chain for thermodynamic security
PROCESS_WORK       # process incoming messages as work
AWAIT_CONFIRMATION # await block chain for thermodynamic security
CLOSE_CHANNEL      # settle final balances on chain
AWAIT_CONFIRMATION # await block chain for thermodynamic security
```

**Headers:**
NAMESPACE, NAME, VERSION, SIGNATURE
soundtrack, artist, 1, aedb1458acfgc14cc12...

**Body:**
DEFINITION (attributes, their validators, and the pipelines), UPGRADE SCRIPT
...FORMAT TO BE DETERMINED; ES6 Class with specific schema?  ProtoBufs?

**Footers:**


### Permanence

---


### Service Contracts
A namespace's definition can be serialized into a representation known as a Service Contract.

The bundling of


The syntax for an over-the-wire publishing of work is as follows:
```
BID      0001      00000000000800000000 work_hash         state_hash
^type    ^volume   ^amount              ^contract         ^input
```

We intend to utilize a DHT to store the work hashes, which are independently verifiable.

The generation of transactions by individual nodes on the Fabric network is driven by a







# SCRATCHPAD


~~Fabric is a decentralized alternative to existing application hosting offerings,
including Amazon Web Services, Google App Engine, and Rackspace Cloud. Arbitrary
applications can be compiled and deployed to the Fabric network, and any
consumer of the application can provide payment for the delivery of the
requested data's output.~~


### Expansion Tree
2^64 branches for each root;



The "root data" is shared with the network, as the latest "tip" of the computation tree; a protocol is then used to evaluate each of the next steps.

```
The function is now defined as a “circuit” over GF(p), as opposed to the binary circuits used for Yao. Such a circuit is called an arithmetic circuit in the literature, and it consists of addition and multiplication “gates” where the values operated on are defined over GF(p).

Secret sharing allows one to distribute a secret among a number of parties by distributing shares to each party. Three types of secret sharing schemes are commonly used; Shamir Secret Sharing, Replicated Secret Sharing and Additive Secret Sharing. In all three cases the shares are random elements of GF(p) that add up to the secret in GF(p); intuitively, security steams because any non-qualifying set shares looks randomly distributed. All three secret sharing schemes are linear, so the sum of two shared secrets, or multiplication a secret by a public constant, can be done locally. Thus linear functions can be evaluated for free.

Replicated Secret Sharing schemes are usually associated with passively secure MPC systems consisting of three parties, of which at most one can be adversarial; such as used in the Sharemind system. MPC systems based on Shamir Secret Sharing are generally associated with systems which can tolerate up to t adversaries out of n, so called threshold systems. In the case of information theoretic protocols actively secure protocols can be realised with Shamir Secret Sharing sharing if t<n/3, whilst passively secure ones are available if t<n/2. In the case of computationally secure protocols one can tolerate a threshold of t<n/2 for actively secure protocols. A practical system adopting this approach is the VIFF framework. Additive secret sharing is used when one wants to tolerate a dishonest majority, i.e. t<n, in which case we can only obtain MPC protocols "with abort".
```


```
// TODO: migrate script
As each step is an additional round of computation, verification in the tree is fast and cheap over;

Π

`\prod_{i=m}^n x_i`

`f(m_0) `
```

The fulfillment recipient, or the "Worker", computes the polynomial `f(r)` to satisfy `t(x) * f(r) = P(x)`

Where

`s ∈ M`



## The Fabric VM
The computations for Fabric are performed inside of a simple virtual machine, which receives input `x`,

[zkcp]: /zkcp.html
[homomorphic]: asdf
