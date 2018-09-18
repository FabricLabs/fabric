# Fabric
![Project Status](https://img.shields.io/badge/status-experimental-rainbow.svg?style=flat-square)
[![Build Status](https://img.shields.io/travis/FabricLabs/fabric.svg?branch=master&style=flat-square)](https://travis-ci.org/FabricLabs/fabric)
[![Coverage Status](https://img.shields.io/codecov/c/github/FabricLabs/fabric.svg?style=flat-square)](https://codecov.io/gh/FabricLabs/fabric)
[![GitHub contributors](https://img.shields.io/github/contributors/FabricLabs/fabric.svg?style=flat-square)](https://github.com/FabricLabs/fabric/graphs/contributors)

Fabric is an experimental protocol for distributing and executing arbitrary
proofs of work (smart contracts) as secure multi-party computations.

| 🚨 Heads up! |
|--------------|
| Use of Fabric in production is **not recommended** in its current state.  Please wait for [an official release][releases] before deploying to production environments. |

## The Serverless Web
Fabric implements a peer-to-peer network over which participants may define
arbitrary types, compose them into more complex programs, and provide meaningful
services to users — all without requiring a trusted third party.  Rather than
relying on a server, applications deployed to Fabric are "offline first",
allowing them to operate independent of network availability or consensus.

### An Information Market
Participants in a Fabric-speaking network may compete for contracts, earning
digital currency in exchange for processing "work orders" made available to them
through the peer-to-peer network.  Included is a simple programming language for
the construction of deterministic, formally-verifiable smart contracts, which
are then broadcast to network participants for execution.

Contracts requiring secure execution may be divided into smaller sub-programs,
broadcast to the network as discrete instructions, and later re-composed into a
finalized output.  In this way, Fabric implements secure, multi-party
computations for general-purpose programs, allowing for a wide range of
privacy-protecting applications.

## Quick Start
To install Fabric, ensure `node -v >= 8.0.0` and `npm i FabricLabs/fabric` into
whichever repository you intend to publish.

## Available Commands
- `npm run cli` provides a direct command-line interface to the Fabric network.
- `npm run docs` creates a local HTTP server for browsing documentation.
- `npm run examples` creates a local HTTP server for interacting with examples.
- `npm start` creates a local Fabric node.

## API
The Fabric reference implementation exposes a simple message-passing interface
using [the actor model][actor-model].  Message handlers are defined as pure
functions — singular input and output values — which can then be composed to
form complex state trees known as "state bubbles".

```js
let Fabric = require('fabric');
let app = new Fabric();

function add (base, number) {
  return base + number;
}

app.use('ADD', add, 'Integer');
```

`app.compute('1 1 ADD')` may now be called to compute the result of calling
`add` on `1`, the first instruction on the stack.

## Resource Contracts
Each Fabric contract, known as an Application Resource Contract, defines a list
of types and their definitions, which contain references to immutable data types
exposed by the underlying vector machine.

```fabric
contract User {
  "Name" -> "String" -> "Vector"
  "ID" -> "Vector"
}
```

In the above `User` contract, two attributes are provided; `Name`, which
resolves to `String`, an aggregation pipeline of type `Vector`, and `ID`,
resolving to the same fundamental `Vector` type.  "Pipelines" are accumulators
over an input `Vector`, in this case defining a new type `String` as a sequence
of input messages using Fabric's fundamental data type, `Vector`.

A typical message in the Fabric protocol is a vector of form `[ x , y ]`, where
`x` and `y` are `2^16`-bit integers, providing a maximum message size of around
16 kilobytes.  Messages are applied to a shared reference prime `Q`, provided at
runtime, using the `OP_ADD` instruction to accumulate state over time before
resolving to a final outcome.

Messages are ordered by integer `x` and applied in sequence using the `+`
operand, while subgroup `I` is defined as set `[0 ... 512]`, reserved for
internal use.

### Vectors
`Vector` is a static type implemented by the Fabric Virtual Machine, a
deterministic set of operands satisfying the following conditions:

- For every `Vector` `x`, `y`, and `z` in set `X`, operand `+` (`OP_ADD`) satisfies
  - `x + y = y + x`
  - `(x + y) + z = x + (y + z)`
  - `0 + x = x + 0 = x`
- For every `Vector` `a`, `b`, and `c` in set `X`, operand `×` (`OP_MULTIPLY`) satisfies
  - `0 × a = 0`
  - `1 × a = a`
  - `(a × b) × c = a × (b × c)`
- For every `Vector` `a` and `b` in set `X` and integers `p` and `q`
  - `p × (a + b) = (p × a) + (p × b)`
  - `(p + q) × a = (p × a) + (q × a)`

## Reference Implementation
The Fabric Reference Implementation (this project) provides a canonical
definition of [the Fabric Protocol][specification], and is recommended as the
core library for any developer building decentralized applications ("dapps").

### Using as a Library
Fabric exposes a constructor with several components which are convenient for
including in your existing applications.  Convenient functions exist for common
frameworks such as React and Angular.

#### Simple Example
```js
const Fabric = require('fabric');
const service = new Fabric();
```

`service` now contains a full instance of Fabric, including `SET` and `GET`
methods for publishing and retrieving documents.  Use `npm run examples` to see
more.

## Why?
Legacy systems are [constantly failing][everything-is-broken],
resulting in the loss of some really cool things!  Some are rushing to save the
good stuff, from content (see the great folks at Archive.org) to infrastructure
and even the applications themselves.  When systems fail, they often take value
with them as _collateral damage_.  Fabric is an attempt at solving this problem.

It's more than content — it's how we approach it, too.  Society has a complex
relationship with technology, and a good technology is an extension of our
humanity.  A _great_ technology is one that **improves** our humanity. If we're
designing systems that must be saved, how can we change our approach so that
they survive on their own?

It turns out our technology has been designed around old paradigms, and in some
cases it _wasn't_ the best idea or design that "won".  Some parts of the world's
most important infrastructure (the Internet) are incredibly vulnerable, and in
some cases even directly endanger people's **lives**.

It's time we started building software that is **secure by default**, made
widely available (especially to those in need), and empowering in a deeply
personal way.

### Who are we?
We're the people behind projects like the Maki application framework, the
DECENTRALIZE podcast, and the Bitcoin Strategy Group.  Our community comes from
all around the globe, but we've all been connected by a powerful technology like
none before: the Internet.  We want to protect the value that the Internet
offers society.

## Our Approach
We believe that secure decentralized systems play an essential role in creating
the trust necessary for a future society to rely on infrastructure that operates
outside of their direct control.  We believe that for such a society to exist,
the default mode should be `local`, wherein the user is most empowered to effect
change.

We believe in the power of the people to create better things in collaboration,
and have ideas about general improvements to quality of life that derive from
the mathematical quality of _superadditivity_.  "A sum greater than its parts"
is the famous anecdote, a feeling often evoked upon observing [the beauty in
coordination][coordination].

![Flock of Birds][coordination]

We believe that collaboration begins with the author, who has the power to
publish their own content and right to benefit from its use.  Intermediaries
offering little or no value should be removed, and efficiencies gained.

## Other Fabrics
Several other projects have used the name Fabric, as it's a great way to
describe a network of things, conjuring feelings of _nets_ and _webs_.  Here are
some links to them, as they offer some interesting things completely unrelated
to our goals.

- Fabric python project (#fabric on Freenode)
- Fabric application framework by Twitter (ours is called Maki)

## Learning More
The best place to get started is in the [#learning][learning] community, a
collection of empassioned educators eager to help you.

## Getting Involved
Fabric is an open-source project, meaning we rely on volunteer time to develop
and maintain our initiative.  We collect donations [through a publicly-auditable
system][bitcoin-donations] (hint, it's Bitcoin!), but the most valuable thing
you can do _right now_ is to [participate in the conversation][join], and if
you're so inclined — consider contributing some code!

Developers, head on over to [#development][development] to dive straight in.
We've got a lot of cool things to build, so please come help. :)

### Donations
Bitcoin donations may be sent to
[3Nc9HqZdfQR7W6c1JN926Rc7vU6eT1wxxn][bitcoin-donations], or perhaps even [set up
a recurring donation through Gratipay][gratipay].  

### Elsewhere
We love social media.  Connect and chat with us.

Twitter: [@FabricProtocol][twitter]

[learning]: https://maki.io/topics/learning
[development]: https://maki.io/topics/development

[everything-is-broken]: https://medium.com/message/everything-is-broken-81e5f33a24e1
[coordination]: https://i.imgur.com/Ki3fbTh.gif
[bitcoin-donations]: bitcoin:3CHGLadfbcKrM1sS5uYtASaq75VAuMSMpb
[bitcoin-donations-image]: https://fabric.pub/assets/3CHGLadfbcKrM1sS5uYtASaq75VAuMSMpb.png
[gratipay]: https://gratipay.com/fabric
[twitter]: https://twitter.com/FabricProtocol
[join]: https://maki.io/community
[actor-model]: http://hdl.handle.net/1721.1/6935
[specification]: https://dev.fabric.pub/snippets/specification.html
[releases]: https://github.com/FabricLabs/fabric/releases
