# Fabric
We introduce a new peer-to-peer protocol for the trade of arbitrary data in
exchange for value tokens.  We implement an overlay network utilizing this
protocol on top of the Bitcoin network, using rapidly-adjusted micropayment
channels and other smart contracts to create a new, provably free market for the
offering and delivering of Application Resource Contracts (ARCs), and present a
new model for a distributed web.

## Abstract
We present a protocol for a distributed messaging system as an alternative to
the current client-server model of the World Wide Web.  We extend the
document-oriented approach provided by Timothy Berners-Lee with a new
transactional messaging model, and also provide a mechanism for incentivizing
the continued servicing of particular documents. 

## Introduction
Fabric implements a versioned, strongly-typed, and content-addressable network
that stores and registers content by its unique hash. Furthermore, a protocol
for broadcasting mutations to content is provided, a consequence of which is a
mechanism for rewinding, replaying, and even forking the state history of
individual documents.

The fundamental principle of Fabric is that it does _not_ require consensus, and
in fact encourages the emergence of curators and natural monopolies, much in the
same way that many online communities already have monopolies over individual
publishing formats and content types.  Consumers of Fabric applications maintain
explicit control over the content they consume, and, instead of being forced to
form a quorum with their peers, may in fact deliver value to the network by
sharing their content moderation decisions in exchange for subscriber subsidies.

We introduce this emergent concept as a "Fuzzchain", where there is no single
source of "truth", instead being replaced by a more individually-oriented
"perspective" of truth.  In aggregate, these truths become quite "fuzzy",
requiring a specific frame of reference to discern a relative truth.

Fabric facilitates this value exchange by using cryptographic tokens, which
provide a medium of exchange that is free of outside influence or external
requirements.

### Bitcoin
The emergence of Bitcoin, a new peer-to-peer digital cash system in 2008 by
Satoshi Nakamoto, catalyzed the development of what is now a burgeoning industry
surrounding digital payments, identity, and information security.  Fabric would
not be possible without a reliable, independently-secured value token, and
Bitcoin has to date achieve the widest success [cite: network size] and greatest
security [cite: hash power] in this field.  For this reason, we explicitly
select the Bitcoin as the bond that secures all Fabric contracts.

Bitcoin works by enforcing a quorum of majority rule, whereby voting on the
state of a shared database takes place in the form of a "proof of work".  To
vote on the consensus is to provide computational capacity towards the security
of the network, expending energy to complete proofs in exchange for the minting
of new value tokens, known as "bitcoins", which ostensibly represent the amount
of energy spent in their creation.

This clever arrangement of incentives allows for the implementation of a
triple-entry accounting system, wherein changes to the ledger must be broadcast
publicly to the entire network and are subsequently independently verified for
correctness by every participant before being relayed to the next.  Once a
modification has been verified, it can then move to a second phase, the
"commit", whereby it and other currently outstanding transactions are appended
in a new "page" to the ledger, known as a "block".  This is isomorphic to the
two-phase commit introduced by J. Gray [Gray78] in 1978.

With the addition of proof of work, Bitcoin presents a security profile
reasonably defensible against outside parties, arranging a set of incentive
mechanisms that ensure fair participation while keeping it reasonably secure
against irrational or outright malicious participants.  We find that the Bitcoin
network demonstrates the principle that security of a network is directly
correlated with the decentralization of the network, and also that the security
of a network is function of its size [cite: altcoin failures].  Fabric requires
such a system, and cannot provide provable fairness without it.

### Information Markets
Fundamentally, Fabric aims to facilitate an information market.  By addressing
content across the network, and furthermore positively identifying it by
utilizing cryptographic hashes, we can construct a market for information with
the addition of an intrinsic payment mechanism. Actors participating in this
market can independently price the delivery of the data, and consumers of these
information bundles can independently choose which data provider they'd like to
retrieve the data from.

We can think of Fabric in economic terms as a clearing house for computational
resources, wherein contracts (termed "Service Contracts") are broadcast and
claimed by individual actors on the network.  These contracts can have varying
levels of complexity, and are paid for by the consumers most interested in their
results.

Payments between nodes on the network are made using the Bitcoin network,
specifically using a special construction of transactions termed "duplex payment
channels".  This allows for a zero-risk commitment of monetary value, in
addition to offering an extremely high rate of change – to be broadcast and
committed to the Bitcoin transaction only once, at the end of a peer session (or
longer).

#### Provable Fairness
- principle of isolation
- perfect hashing (uniformity guarantees)

~~Bitcoin works by establishing a linked list of finalized pages, known as
"blocks", in a distributed ledger, the "blockchain".  Actors within the network
perform a resource-intensive operation in competition with one another to
derive newly-minted tokens, known as "bitcoins", in an operation that is
difficult to duplicate, but trivial to verify.  The allocation of new tokens in
this system is known as the "block subsidy", and it is the incentive mechanism
by which outside parties are rewarded for providing the network with security
through their efforts.~~

### The Semantic Web
Timothy Berners-Lee introduced the idea of hypertext in 198~ [citation needed].
With it came the promise of a new era of context in the blossoming world of
interconnected networks.  Other, similar ideas emerged at roughly the same time,
including Project Xanadu and ??? [citation needed].

With the introduction of XMLHTTPRequest by Microsoft in ??? [citation needed],
the doors to a new era of the Web opened as new, interesting, and compelling
use-cases became possible like never before.  A new wave of dynamic "shell"
applications that had the ability to modify documents _after_ they had been
retrieved  emerged, including Twitter, MySpace, Friendster [???] [citation
needed].  However, these applications very quickly became isolated silos with
barely-working interfaces for integration, as their proprietary bundles of
application-specific code had finite, acute focii.

A resurgent effort to restore the interoperability provided by purely semantic
markup languages such as HTML gave birth to initiatives such as Microformats and
later Schema.org [citation needed], but the overhead of their implementations
gave too much resistance to their adoption.

### Messaging
Alan Kay introduced the idea of messaging ....  Today we observe many
derivatives of this model, including that of the Actor Model [citation
needed]().  

A messaging system provides ....  It does not, however, provide any mechanism
for ordering.  This is desirable when developing asynchronous systems.  However,
for conflict resolution, one might want to identify which particular message
came first.  This leaves us with the timestamping problem.

## Protocol
The Fabric protocol implements a mechanism for representing a largely
intangible idea, trust, as a pre-established commitment in a slightly more
tangible fashion, a value token.  If a network is composed primarily of honest,
friendly nodes, then commitments increase over time until the updates provided
by the network cease to be valuable.  Should a node cease being honest, it
destroys its ability to increase in value over time. 

### Security
#### Contract Signatures


## Transactions as Functions
Given a transaction set _t_, there should also be a correlating inverse
transaction set _t^-1_ such that the state of a database prior to the
application of _t_ can be completely derived after its application by applying
_t^-1_.

Further, individual patchsets, should be composable functions, with equivalent
inverse functions.

## Fuzzchains (WIP)
Since the constraint of a finite limit on information (such as a limit on token
supply) is not present in an information market, as new information can be
introduced at any time,  To implement a distributed datastore on a peer-to-peer
basis without compromising the freedom of speech of any individual node, we
must remove the constraint of consensus from the network.  

Without a need to enforce the availability of specific transaction sets, we can
derive a new type of blockchain we term a "fuzzchain".  This fuzzchain allows
for many divergent sequences of chains, which may or may not be in conflict at
any point in time.

 In the case of Fabric, we replace the direct block subsidy and transaction fee
market with a  











### Multi-Party Computations
Fabric aims to provide data security across a fully decentralized network, that
is, one without any requisite third party.  As participants in such a network
are not necessarily favorable actors, a strategy to protect data while
simultaneously allowing for computations on said data is necessary for such a
system to be viable.

We build on Baum's work on secure computations, taking advantage of recent
advances in computer science to extend existing models to include _n_-party
computations.  Specifically, we utilize a hierarchical secure multi-party
computation, which splits our network into a hierarchy of equally sized MPCs
which are then used in sum to compute the finalized output.  As these units are
completely independent, we can parallelize the work at each level of the
hierarchy.

Some optimizations from Enigma are included in Fabric to offer linear, rather
than quadratic, scalability.

- Yao, Andrew C. ”Protocols for secure computations.” 2013 IEEE 54th Annual Symposium on Foundations of Computer Science. IEEE, 1982.
- Baum, Carsten, Ivan Damgrd, and Claudio Orlandi. ”Publicly auditable secure multi-party computation.” Security and Cryptography for Networks. Springer International Publishing, 2014. 175-196.
- Cohen, Gil, et al. ”Efficient multiparty protocols via log-depth threshold formulae.” Advances in CryptologyCRYPTO 2013. Springer Berlin Heidelberg, 2013. 185-202.

-  Guy Zyskind, Oz Nathan, Alex ’Sandy’ Pentland.  "Enigma: Decentralized Computation Platform with Guaranteed Privacy"  MIT


### Application
The application layer of Fabric is the implementation of the underlying Resource contract.  We provide [Maki][maki], a reference implementation of the Application Resource Contracts (ARC) protocol,

### Resources
Fabric's

#### Semantic Linkability
Since Fabric exposes Resources in a descriptive fashion, applications can interact with one another.  By requesting a resource from a namespace other than one's own, information can cross the boundaries of individual applications and other interesting combinations of data can be constructed.

Furthermore, since applications can be described in their entirety with a simple contract, applications can discover one anothers' behaviors and resource definitions.  This can be used to build various forms of semantic interoperability, potentially including new forms of search engine behaviors.


### Mutations
Once an application's underlying Resources are defined, their state can be
manipulated in an atomic fashion.  Arbitrary rules can be defined about the
validity of a mutation, including various authorization models.

#### Mutation Blocks
Fabric, in contrast to traditional proof-of-work mechanisms, does not require
work to be bundled into "blocks".  Instead, consensus is achieved through the
bundling of atomic mutations to the chain state.  These atomic operations are
rolled up into groupings called, perhaps inconveniently, "transactions".  These
transactions are isomorphic to traditional blockchain transactions, in that
either a block is valid or it is not, as determined by the component operations
it contains.  If any one operation is invalid, so too must be the block.


### TODO: include content hashes of links as they appear at document compilation time.
[bitcoin scripting]: https://en.bitcoin.it/wiki/Script
[json patch]: http://tools.ietf.org/html/rfc6902
[homomorphic]: http://crypto.stanford.edu/craig/craig-thesis.pdf
[i2p]: https://geti2p.net/_static/pdf/i2p_philosophy.pdf
[cjdns]: https://github.com/cjdelisle/cjdns/blob/master/doc/Whitepaper.md
[maki]: https://github.com/martindale/maki
[rfc6902]: https://tools.ietf.org/html/rfc6902

OTHER CITATIONS TO INCLUDE:
[bitcoin]: http://bitcoin.org/bitcoin.pdf
[capability-based systems]: ???
[capability-based financial systems]: http://www.cypherpunks.to/erights/elib/capability/ode/ode.pdf
