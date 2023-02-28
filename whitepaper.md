# Fabric
## A Secure Compute Substrate for Self-Enforcing Contracts

E. Martindale, J. Paul Morrison, J. Dilley
**Reviewers:** J. Paul Morrison, J. Dilley

`0.1.0-drafting`

**Warning!**
This document is a draft and has not received significant review. Implement these ideas at your own risk!

## Abstract
We introduce Fabric, a new protocol for securely establishing and executing peer-to-peer
agreements surrounding the exchange of arbitrary information. Coupled with a resilient trust
anchor, such as the Bitcoin blockchain, Fabric enables secure multi-party computations which
preserve the privacy of their participants while retaining integrity across otherwise disparate
networks.

We present a distributed messaging protocol as an alternative to the current client-server model of
the World Wide Web, instead implementing an "information market" for voluntary participants
which agree upon a common point of reference. We further extend the document-oriented basis of
the Web with a cryptographically-secure version control system, enabling accurate and reliable
updates to applications which may require shared state.

## 1. Introduction
Despite the backdrop of a fundamentally free market, modern economies remain tightly
constrained by monopolies on contract enforcement. Recent developments in distributed systems
have offered reprieve from the requirements of these centralized services, but leave much to be
desired with regards to awareness & adoption. Significant capital investment has been made into
infrastructure which relies on these monopolies, creating momentum which further reinforces their
authority.

Any approach to developing a privacy-preserving contract enforcement platform should operate
effectively in adversarial environments, obviating the use of components which already reliably
solve this problem. One such system is the Bitcoin network, which secures & maintains a
distributed ledger by way of economic incentives. In this environment, fraud is expensive, allowing
for the accumulation of trust over time without requiring a central coordinator.

### 1.1. Bitcoin
Bitcoin was introduced by Satoshi Nakamoto in 2008 as an to alternative fiat currency, and has
since garnered international attention as a catalyst for significant economic change. By replacing
the role of a central bank in the issuance of money, it sets the foundation for a new market
structure, one backed by thermodynamic assurances and cryptographic guarantees. These newly
available properties manifest a wide array of applications, but also serve to expand the availability
of financial services to a global market.

One of Bitcoin's most interesting components is its blockchain, a highly replicated data structure
which preserves a history for its consumers. Using Bitcoin's blockchain, we can reliably timestamp
information and assert the existence of a document in a mathematically-provable fashion, all
without revealing the contents of the document itself.

By relying on Bitcoin to address the challenges in achieving global consensus over a unified
record of history, we can turn our attention to solving the problem of securely computing
meaningful results from encrypted information.

#### 1.1.1. Smart Contracts
Bitcoin also offers Script, a stack-based programming language for describing validation
requirements to as-of-yet unknown parties. Script offers a list of pre-defined instructions known as
"opcodes", which can be composed into larger programs which may exhibit more complex
behavior. A typical Bitcoin script looks as follows:

```
OP_DUP OP_HASH160 <RecipientPubKeyHash> OP_EQUAL OP_CHECKSIG
```

When combined with a digital signature, this small program can be used to construct a new
transaction which will be checked for validity by the network before being accepted as a "spend"
of funds previously sent to the recipient. This enables a form of "carry-forward" state management,
where changes to global state are only accepted by the network upon the provision of a valid
proof.

As Script does not offer the ability to iterate over arbitrary collections, it lends itself easily to highvolume finite-state computations with predictable costs and behaviors. These properties are
convenient for efficiently validating monetary transactions, which allows for a separation of
concerns when building more complex applications.

##### 1.1.1.1. Multi-Signature Transactions
One of Script's most powerful features is its ability to lock funds into smart contracts which can
only become spendable when signed by a specific group of parties in a pre-defined subset. While
Bitcoin's implementation leaves much to be desired (limited in size of the participating group,
some bugs are also preserved intentionally to maintain compatibility with legacy implementations).

##### 1.1.1.2. Hash Time-Locked Transactions
In addition to simple transfers, smart contracts deployed to the Bitcoin network may be invalid until
some future date using a mechanism known as Hash Time-Locked Transactions, or HTLCs.
These specially-crafted transactions can be used to construct simple logic trees dependent upon
network state, such as offering a "failover" mode for funds not spent by a particular date. One such
example:

```
<AnchorBlockHeight+1008> OP_CHECKLOCKTIMEVERIFY OP_IF
<SenderPubKey> OP_EQUALVERIFY
OP_ELSE
<RecipientPubKey> OP_EQUALVERIFY
OP_ENDIF
OP_CHECKSIG
```

This program allows a payment to be returned to its sender after 1008 blocks, or roughly 1 week
assuming Bitcoin continues to operation normally. Combined with other features of the Script
language, this becomes an incredibly powerful tool for building complex decision trees which are
dependent upon information outside of the control of the originator.

#### 1.1.1.3: Zero-Knowledge Contingent Payments
Script further offers the ability to compute simple hashes in the form of the OP_SHA256 opcode,
which eponymously produces the SHA256 digest of some input data. By combining this with other
elements, we can construct a powerful form of smart contract known as a "Zero-Knowledge
Contingent Payment", or ZKCP.

This tool enables a buyer to publish an order for an arbitrary asset, including documents and other
information, without knowing the seller ahead of time. Any seller with access to the desired
information may construct a new transaction which fulfills the order by revealing the document to
the buyer. Such a contract might appear as follows:

```
OP_SHA256
<Y> OP_EQUAL
OP_IF
<Seller Pubkey>
OP_ELSE
<AnchorBlockHeight+1008> OP_CHECKLOCKTIMEVERIFY OP_DROP
<Buyer Pubkey>
OP_ENDIF
OP_CHECKSIG
```

This program returns funds to the buyer after a specified number of blocks (again, roughly one
week), but allows a seller to redeem the funds by supplying the document as the RedeemScript
(not provided) before executing the contract.

#### 1.1.2. Limitations
Script, and Bitcoin at large, contain several limititations which deserve further improvement. For
example, limited capability for manipulating data is provided by Script, which has historically
restricted the growth of chain storage requirements, but makes the construction of useful data
difficult. Future improvements have been discussed with regards to enabling these behaviors, but
further research is required before safely enabling these changes on the main Bitcoin network
without endangering user funds.

For simplicity's sake, we restrict our scope to applications which can run on the Bitcoin network
today.

### 1.2: Homomorphic Encryption
Cryptographers have long been excited about the prospect of computing over encrypted
information, which has widespread implications surrounding data privacy and information security.
Known as "homomorphic" encryption, programs implementing these schemes never have to
decrypt application state, allowing for the participation of untrusted parties in untrusted systems.
One of Fabric's applications is to implement Fully Homomorphic Encryption, or FHE, so first we
provide some background on the math.

#### 1.2.1: Pallier Systems
One basic composition which provides useful functionality is the Paillier cryptosystem, introduce
by Pascal Paillier in 1999. This probabilistic method offers addition and multiplication of hidden
values, returning sums and products respectively without revealing their values.

#### 1.2.2: Partially Homomorphic Encryption
TODO

#### 1.2.3: Fully Homomorphic Encryption
In addition to the general schemes above, an algorithm which can compute arbitrary functions is
known as a Fully Homomorphic Encryption scheme, or FHE. As these systems do not require

### 1.3: Multi-Party Computations
Fabric aims to provide data security across a fully decentralized network, that is, one without any
requisite third party. As participants in such a network are not necessarily favorable actors, a
strategy to protect data while simultaneously allowing for computations on said data is necessary
for such a system to be viable.

We build on Baum's work on secure computations, taking advantage of recent advances to extend
existing models to include _n_-party computations. Specifically, we utilize a hierarchical secure
multi-party computation, which splits our network into a hierarchy of equally-sized MPCs which
are then used in sum to compute the finalized output. As these units are completely independent,
we can parallelize the work at each level of the hierarchy.

Traditional software programs are composed as a list of instructions which are typically executed
in single-machine, single-process environments. Workloads in these environments typically do not
scale beyond the resources available to single machines, roughly 4GB for 32-bit architectures and
otherwise prohibitively expensive for average users at scales beyond 32GB.

One approach to tackling this problem is to divide complex programs into smaller components,
which is useful for workloads which do not require extensive iteration over large quantities of data.
Fabric adopts this philosophy, requiring that programs be implemented as pure functions, wherein
a single input is passed to the program, some computation is performed, and a singular output
provided as the return value.

Fabric's computational model can be described in the following context:

```
ƒ(x) ⇒ Δx'
```

Where some program ƒ produces an output equivalent to the delta between input x and
resulting state x' .

In a technique known as function composition, complex behaviors can be described using
simple primitives, a core tenet of the UNIX philosophy.

#### An Example

Suppose some set of participants _P_ each have a collection of private documents _D_, with

#### 1.3.1: Simple Circuits
#### 1.3.2: Polynomial Circuits

### 1.4: Market Dynamics
Participants in a Fabric-speaking network may compete for contracts, earning digital currency in
exchange for processing "work orders" made available to them through the peer-to-peer network.
Included is a simple programming language for the construction of deterministic, formallyverifiable smart contracts, which are then broadcast to network participants for execution.

#### 1.4.1: Information Asymmetry

## 2: Architecture
Orders in the Fabric network are effectively "requests for computation": cryptographic
commitments to payment, known as a [Zero-Knowledge Contingent Payment][zkcp], in exchange
for the output of a requested program. When the required computation is complete, the fulfilling
party is able to claim the payment in the network — represented as an unspent transaction output
to be later broadcast on the anchor chain.

Contracts requiring secure execution may be divided into smaller sub-programs, broadcast to the
network as discrete instructions, and later re-composed into a finalized output. In this way, Fabric
implements secure, multi-party computations for general-purpose programs, allowing for a wide
range of privacy-protecting applications.

Figure 1: an overview of process flow in Fabric

Fabric Architecture Overview
Layer 2
Layer 3
block n block n+1 block n+2 ...
L1: Trust Anchor (the Bitcoin Blockchain)
block n block n+1 block n+2 ...
L2: Domain-Specific Sidechain (RSK, Drivechain, etc.)
HTLC 0 HTLC+1 HTLC+2 ...
L2: Lightning
φ0 φ1 φ2 φ3 φ3 φ...
root n root n+1 root n+2
L3: State Bubble
φ0 φ1 φ2 φ3 φ3 φ...
root n root n+1 root n+2
L3: State Bubble (...)
Charlie David Eve Frank ...
Workers
loop

**Definitions:**
**ARC**: Application Resource Contract — source code for
**CAN**: Content-Addressable Network — long-term storage for documents indexed by their
hash

## 2.1: Network Topology
### 2.2: Encryption
To preserve user privacy, all connections are encrypted after an initial handshake using an
ephemeral key which rotates on a per-message basis. While we do not detail the encryption
protocol in this paper, the Noise Protocol can be used as a reference implementation.

## 3: Protocol
### 3.1: Primitives
#### 3.1.1: Channels
Channels are duplex communication streams between objects in Fabric. They are exposed to the
user as Subscriptions, as channels typically involve an exchange of value.

##### 3.1.1.1: Mechanics
Following a Channel creates a Subscription object, which contains a commitment to the
contract specified in the Channel . At any point in time, the signatory for the Channel may "settle"
the contract, claiming the funds agreed upon as per the series of events (Operations) sent across
the Channel .

Similarly, the subscriber (creator of the Subscription object) may settle the contract at any time,
closing out any further agreements by broadcasting the latest commitment to the channel.

A simple algorithm is proposed for computing trust between peers, using quadratic expansion to
compose a stable network over long periods of time.

### 3.2: Message Semantics
The definition of our messaging language is intended to human-readable, as debugging
distributed systems is notoriously difficult. All logs are stored unencrypted, as they should be
thrown away within a reasonable timeframe as disk utilization remains in high demand (see § 8:
Economics)

### 3.3: Message Ordering
#### 3.3.1: Phase 0: Bonding
#### 3.3.2: Phase 1: Initialization
#### 3.3.3: Phase 2: Order Construction
#### 3.3.4: Phase 3: Order Publishing
#### 3.3.5: Phase 4: Order Fulfillment
##### 3.3.5.1: Contract Execution
##### 3.3.5.2: Complex Contracts
##### 3.3.5.3: External Resources
##### 3.3.5.4: Failure Modes
###### 3.3.5.4.1: Timeout
###### 3.3.5.4.2: Fraud
###### 3.3.5.4.3: State Collapse
###### 3.3.5.4.4: Chain Re-organization
#### 3.3.6: Phase 5: Contract Finality

### 3.4: State Machine
As all programs in Fabric are modeled as finite-state graphs, the Fabric State Machine (FSM)

#### 3.4.4: Visualizer
Directed graphs such as Fabric's computational model can easily be rep

### 3.4.5: Flow-Based Programming
Originally invented by J. Paul Morrison

## 4: Language
Fabric utilizes a simple syntax for denoting program behavior, named "Purity".

```
application example { # `application` with parameter `example`
  start 0 # call `start` with parameter `0`
  add example # call `add` with parameter `example`
}
```

The above program represents a simple addition function, with syntactic sugar added for
familiarity. Curly braces are optional, but indentation must be used within definitions. More simply:

```
application example
  start 0
  add example
```

Running the above program is as follows:

```
⚡ example 1
Running [8ee89711330c1ccf39a2e65ad12bbd7df4a4a2ee857f53b4823f00fecb7bd252]…
Δ 1
```

As expected, the primitive identify function 1 returns itself, 1 . Let's try adding two numbers.

```
⚡ example example 1
Running [1b5879d683819f2a623049e9d0e4bd954d9f228da000d2774f58652af1f3c882]…
Δ 2
```

Great! We've incremented an integer. You might notice that the middle line has also changed —
Fabric identifies all programs by the hash of their source code.

```
contract {
  // identity
  function identity (a) ⇒ a
  // unit
  function unit ⇒ start! // behavior needs to be defined
  // compositions
  function compose (a b) ⇒ a & b
  // products
  function pair (a b) ⇒ [a b]
  function take (unit a b) ⇒ a
  function drop (unit a b) ⇒ b
  // sums
  function injl (a b) ⇒ b | c
  function injr (a b) ⇒ a | c
  function case (a b) ⇒ 1 | 0
}
```

## 5: Components
## 6: Security

## 7: Scalability
As signatures are aggregated into fixed-size

## 8: Economics
Resources are scarce. Incentives in Fabric are aligned such that resources are maximally utilized,
providing monetary value in exchange for meaningful work.
Network capacity including processing power, random-access memory, long-term storage, and
various highly-specialized services is by definition unknowable, but all participants are rewarded
for efficient utilization of their available resources.

### 8.1 Routing
Fabric leverages these market economics to encourage a healthy network topology, rewarding
participants for detecting and repairing inefficient routes.

## 9: Drawbacks
Existing platforms have gained varying degrees of traction, fragmenting attention across a number
of disparate initiatives. Any such system can only function effectively at scale, so it is likely that a
lower bounds exists for a desired security threshold.

## 10: Applications
### 10.1: Example RPG

#### Figure 1: An Example ARC
```
MPC (Layer 2)
ARC (Layer 3)
Trust Anchor (Layer 1)
/users
/assets
1000 SAT
/items
CREATE { id }
/transactions
100.00 INK (100 @ 1)
to: /universes/{id}
/instances
ISSUE { id: '/items{id}' }
/players
BUY /items/{id} (1.00 INK)
PUBLISH { id }
```


An Example ARC
MPC (Layer 2)
ARC (Layer 3)
Trust Anchor (Layer 1)
/users
/assets
1000 SAT
/items
CREATE { id }
/transactions
100.00 INK (100 @ 1)
to: /universes/{id}
/instances
ISSUE { id: '/items{id}' }
/players
BUY /items/{id} (1.00 INK)
PUBLISH { id }

```
application RPG {
"/users" ⇒ "/assets" [label="1000 SAT"]
"/items" ⇒ "/transactions" [label=" 100.00 INK (100 @ 1)\nto: /universes/{id}"]
"/users" ⇒ "/items" [label=" CREATE { id }"]
"/items" ⇒ "/instances" [label=" ISSUE { id: '/items{id}' }"]
"/instances" ⇒ "/players" [label=" BUY /items/{id} (1.00 INK)"]
"/players" ⇒ "/transactions" [label=" PUBLISH { id }"]
subgraph cluster_mpc {
label = "MPC (Layer 2)"
"/assets"
"/items"
}
subgraph cluster_arc {
label = "ARC (Layer 3)"
"/instances"
"/players"
"/transactions"
}
subgraph cluster_anchor {
label = "Trust Anchor (Layer 1)"
"/users"
}
}
```

## 11: Future Work
## 12: Conclusion
Fabric implements a peer-to-peer network over which participants may define arbitrary types,
compose them into more complex programs, and provide meaningful services to users — all
without requiring a trusted third party. Rather than relying on a server, applications deployed to
Fabric are "offline first", allowing them to operate independent of network availability or
consensus.

## Appendix A: Ephemera
In contrast with other networks, Fabric does not require network consensus or otherwise .
Consumers of Fabric applications maintain explicit control over the content they consume, and,
instead of being forced to form a quorum with their peers, may in fact deliver value to the network
by sharing their content moderation decisions in exchange for subscriber subsidies.
We introduce this emergent concept as a "Fuzzchain", where there is no single source of "truth",
instead being replaced by a more individually-oriented "perspective" of truth. In aggregate, these
truths become quite "fuzzy", requiring a specific frame of reference to discern a relative truth.
Fabric facilitates this value exchange by using cryptographic tokens, which provide a medium of
exchange that is free of outside influence or external requirements.

Bitcoin
The emergence of Bitcoin, a new peer-to-peer digital cash system in 2008 by Satoshi Nakamoto,
catalyzed the development of what is now a burgeoning industry surrounding digital payments,
identity, and information security. Fabric would not be possible without a reliable, independentlysecured value token, and Bitcoin has to date achieve the widest success [cite: network size] and
greatest security [cite: hash power] in this field. For this reason, we explicitly select the Bitcoin as
the bond that secures all Fabric contracts.

Bitcoin works by enforcing a quorum of majority rule, whereby voting on the state of a shared
database takes place in the form of a "proof of work". To vote on the consensus is to provide
computational capacity towards the security of the network, expending energy to complete proofs
in exchange for the minting of new value tokens, known as "bitcoins", which ostensibly represent
the amount of energy spent in their creation.

This clever arrangement of incentives allows for the implementation of a triple-entry accounting
system, wherein changes to the ledger must be broadcast publicly to the entire network and are
subsequently independently verified for correctness by every participant before being relayed to
the next. Once a modification has been verified, it can then move to a second phase, the "commit",
whereby it and other currently outstanding transactions are appended in a new "page" to the
ledger, known as a "block". This is isomorphic to the two-phase commit introduced by J. Gray
[Gray78] in 1978.

With the addition of proof of work, Bitcoin presents a security profile reasonably defensible against
outside parties, arranging a set of incentive mechanisms that ensure fair participation while
keeping it reasonably secure against irrational or outright malicious participants. We find that the
Bitcoin network demonstrates the principle that security of a network is directly correlated with the
decentralization of the network, and also that the security of a network is function of its size [cite:
altcoin failures]. Fabric requires such a system, and cannot provide provable fairness without it.

Information Markets
Fundamentally, Fabric aims to facilitate an information market. By addressing content across the
network, and furthermore positively identifying it by utilizing cryptographic hashes, we can
construct a market for information with the addition of an intrinsic payment mechanism. Actors
participating in this market can independently price the delivery of the data, and consumers of
these information bundles can independently choose which data provider they'd like to retrieve the
data from.

We can think of Fabric in economic terms as a clearing house for computational resources,
wherein contracts (termed "Service Contracts") are broadcast and claimed by individual actors on
the network. These contracts can have varying levels of complexity, and are paid for by the
consumers most interested in their results.

Payments between nodes on the network are made using the Bitcoin network, specifically using a
special construction of transactions termed "duplex payment channels". This allows for a zero-risk
commitment of monetary value, in addition to offering an extremely high rate of change – to be
broadcast and committed to the Bitcoin transaction only once, at the end of a peer session (or
longer).

Provable Fairness
principle of isolation
perfect hashing (uniformity guarantees)
Bitcoin works by establishing a linked list of finalized pages, known as "blocks", in a distributed
ledger, the "blockchain". Actors within the network perform a resource-intensive operation in
competition with one another to derive newly-minted tokens, known as "bitcoins", in an operation
that is difficult to duplicate, but trivial to verify. The allocation of new tokens in this system is
known as the "block subsidy", and it is the incentive mechanism by which outside parties are
rewarded for providing the network with security through their efforts.

The Semantic Web
Timothy Berners-Lee introduced the idea of hypertext in 198~ [citation needed]. With it came the
promise of a new era of context in the blossoming world of interconnected networks. Other, similar
ideas emerged at roughly the same time, including Project Xanadu and ??? [citation needed].
With the introduction of XMLHTTPRequest by Microsoft in ??? [citation needed], the doors to a
new era of the Web opened as new, interesting, and compelling use-cases became possible like
never before. A new wave of dynamic "shell" applications that had the ability to modify documents
after they had been retrieved emerged, including Twitter, MySpace, Friendster [???] [citation
needed]. However, these applications very quickly became isolated silos with barely-working
interfaces for integration, as their proprietary bundles of application-specific code had finite, acute
focii.

A resurgent effort to restore the interoperability provided by purely semantic markup languages
such as HTML gave birth to initiatives such as Microformats and later Schema.org [citation
needed], but the overhead of their implementations gave too much resistance to their adoption.
Architecture

Trust Model
Users of the Fabric protocol are expected to share a trust anchor with their direct peers, which in
most cases will be the Bitcoin blockchain. Other systems can be used should both parties trust the
same entity, but our work has determined Bitcoin to be the most secure and likely to succeed over
time. On the other end of the spectrum, models may be constructed which require the trust of a
centralized Oracle, but for our purposes we assume all market participants maintain an up-to-date
copy of the Bitcoin blockchain.
Fabric relies the Zero Knowledge Contingent Payment ("ZKCP") approach used by Gregory
Maxwell et al to trustlessly purchase the solution to a Sudoku Puzzle, the first public
demonstration of such a transaction using the Bitcoin protocol.

Example ZKCP
OP_SHA256 <Y> OP_EQUAL OP_IF
<Seller Pubkey>
OP_ELSE
<block_height+1008> OP_CHECKLOCKTIMEVERIFY OP_DROP
<Buyer Pubkey>
OP_ENDIF
OP_CHECKSIG

Messaging
Alan Kay introduced the idea of messaging .... Today we observe many derivatives of this model,
including that of the Actor Model citation needed.

A messaging system provides .... It does not, however, provide any mechanism for ordering. This
is desirable when developing asynchronous systems. However, for conflict resolution, one might
want to identify which particular message came first. This leaves us with the timestamping
problem.

Protocol
The Fabric protocol implements a mechanism for representing a largely intangible idea, trust, as a
pre-established commitment in a slightly more tangible fashion, a value token. If a network is
composed primarily of honest, friendly nodes, then commitments increase over time until the
updates provided by the network cease to be valuable. Should a node cease being honest, it
destroys its ability to increase in value over time.

Security
Contract Signatures
Transactions as Functions
Given a transaction set _t_, there should also be a correlating inverse transaction set t^-1 such
that the state of a database prior to the application of _t_ can be completely derived after its
application by applying t^-1.

Further, individual patchsets, should be composable functions, with equivalent inverse functions.

Fuzzchains (WIP)
Since the constraint of a finite limit on information (such as a limit on token supply) is not present
in an information market, new information can be introduced at any time, To implement a
distributed datastore on a peer-to-peer basis without compromising the freedom of speech of any
individual node, we must remove the constraint of consensus from the network.
Without a need to enforce the availability of specific transaction sets, we can derive a new type of
blockchain we term a "fuzzchain". This fuzzchain allows for many divergent sequences of chains,
which may or may not be in conflict at any point in time.

Multi-Party Computations
Applications
The application layer of Fabric is the implementation of the underlying Resource contract. We
provide Maki, a reference implementation of the Application Resource Contracts (ARC) protocol,
Resources

Fabric's
Semantic Linkability
Since Fabric exposes Resources in a descriptive fashion, programs deplo can discover and
interact with one another. By requesting a resource from a namespace other than one's own,
information can cross the boundaries of individual applications and other interesting combinations
of data can be constructed.

Furthermore, since applications can be described in their entirety with a simple contract,
applications can discover one anothers' behaviors and resource definitions. This can be used to
build various forms of semantic interoperability, potentially including new forms of search engine
behaviors.

Two-Way Links on the Web
An Introduction to Channels
The Web we know today is built on a simple construct: the <a> tag. In HTML, the a stands for
anchor — a point of reference, or hyperlink.

Using these hyperlinks, we've been able to navigate content published on the web contextually —
that is to say, we can choose to dig deeper into a "linked" subject based on the context provided.
This has proven helpful to the curious explorer, as the Web opened up the wealth of human
knowledge to a greater extent than ever before.

But what of the two-way conversation? How can a reader submit an improvement to the author's
content in a meaningful way? How can a publisher expect to be notified of reader feedback, in
comment form or even a proposal? How can we collaborate on content constructively?

Mutations
Once an application's underlying Resources are defined, their state can be manipulated in an
atomic fashion. Arbitrary rules can be defined about the validity of a mutation, including various
authorization models.

Mutation Blocks
Fabric, in contrast to traditional proof-of-work mechanisms, does not require work to be bundled
into "blocks". Instead, consensus is achieved through the bundling of atomic mutations to the
chain state. These atomic operations are rolled up into groupings called, perhaps inconveniently,
"transactions". These transactions are isomorphic to traditional blockchain transactions, in that
either a block is valid or it is not, as determined by the component operations it contains. If any
one operation is invalid, so too must be the block.

- Yao, Andrew C. ”Protocols for secure computations.” 2013 IEEE 54th Annual Symposium on Foundations of Computer Science. IEEE, 1982.
- Baum, Carsten, Ivan Damgrd, and Claudio Orlandi. ”Publicly auditable secure multi-party computation.” Security and Cryptography for Networks. Springer International Publishing, 2014. 175-196.
- Cohen, Gil, et al. ”Efficient multiparty protocols via log-depth threshold formulae.” Advances in CryptologyCRYPTO 2013. Springer Berlin Heidelberg, 2013. 185-202.
- Guy Zyskind, Oz Nathan, Alex ’Sandy’ Pentland. "Enigma: Decentralized Computation Platform with Guaranteed Privacy" MIT

TODO: include content hashes of links as they appear at
document compilation time.

OTHER CITATIONS TO INCLUDE:
[bitcoin]: http://bitcoin.org/bitcoin.pdf
[capability-based systems]: ???
[capability-based financial systems]: http://www.cypherpunks.to/erights/elib/capability/ode/ode.pdf

PARKING LOT:
[bitcoin scripting]: https://en.bitcoin.it/wiki/Script
[json patch]: http://tools.ietf.org/html/rfc6902
[homomorphic]: http://crypto.stanford.edu/craig/craig-thesis.pdf
[i2p]: https://geti2p.net/_static/pdf/i2p_philosophy.pdf
[cjdns]: https://github.com/cjdelisle/cjdns/blob/master/doc/Whitepaper.md
[maki]: https://github.com/martindale/maki
[rfc6902]: https://tools.ietf.org/html/rfc6902
[hypertext]: http://signallake.com/innovation/FileStructure65.pdf
[www-tbl]: http://www.w3.org/History/1989/proposal.html
