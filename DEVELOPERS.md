# Fabric Developer Resources
There's a lot of information to cover with regards to building decentralized
applications, so grab a coffee ☕ and settle in.

## Quick Start
See also [`QUICKSTART.md`][quickstart-guide] for up-to-date instructions.

0. `nvm use 18.19.0` (you can get `nvm` from [nvm.sh][nvm-official])
1. `npm install -g @fabric/core` to add `fabric` to your path
2. (optional) `fabric setup` to set up your environment (generates a new master key)
3. `fabric` should now be enough to get you up and running!

That's it!  Let's take a look at overall Fabric system and how you, as a developer, might interact with it.

## Architecture
Fabric is two things — a protocol for machines to exchange information ("the Fabric Protocol"), and a sotware library (`@fabric/core`) offering up many tools and utilities for building your own networks which speak this protocol.

Typically, you will need the following:

  - a Bitcoin Node (bitcoind and/or bcoin with `bcoin --only=127.0.0.1`)

### Overview
Using Fabric to interface securely with decentralized systems, you'll start by following the instructions above to obtain a globally-available version of the `fabric` command-line client, which provides the majority of tools you'll need along the way.

The `@fabric/core` library consists of a few key components:

0. `assets`<sup>~</sup> \[???\] — this may or may not be included in the final release (function may change).  Contains the static build.
1. `contracts` — a list of Maintainer-reviewed smart contracts, written in any of: `.pur` for Purity (our own language), `.bsc` for Bitcoin Script, `.msc` for [Minsc][minsc-home], and even `.sol` for Solidity).  We may choose to remove some of these before launch, your mileage may vary.
2. `components` — generic "interface" elements for describing Types to users.
3. `resources` — Fabric-based definitions for `@fabric/core/types/resource`.
4. `services` — Maintainer-accepted definitions of the `Service` class.  Yes, you can submit your own!
5. `types` — a library of ES6 classes implementing various bits; `Actor`, `Channel`, `Oracle`, `Service`, and `Signer` are all interesting. :)

Let's go over each in more detail.

#### 0. Assets
All files in this folder will be imported to the default "inventory" for the `0.1` release.  Additionally, when using `@fabric/http/types/server` all of these files will be available directly at the root path, `/` (configurable).  Used for any generated files required for the _default_ Fabric runtime (not downstream), including binaries and other important media.  Don't commit here unless absolutely necessary!

##### 0.1: Inventory
We're focused on enabling Lightning-based document exchange for `0.1` — the upcoming, first "official" release of Fabric.  Fabric nodes (anyone running `fabric chat`) will be able to:

1. Load a file from disk into local inventory by using `/import <filename>`
2. Offer up that file to peers by using `/publish <documentID> <rate>`
3. Request a file from the network by using `/request <documentID> <rate>`

Once this core set of features is complete and sufficiently covered by tests, we'll begin pushing for `0.1.0-RC1` and triggering the formal security audit.  `0.1.0-RC2` will surely exist afterwards, but hopefully it'll be the last one before `v0.1.0` itself.

##### 0.2: The Future
You can use [the Official Fabric Roadmap][fabric-roadmap] to look ahead to what we have planned. :)

#### 1. Contracts
Peer-to-peer applications (or, "agreements") are self-enforcing; the two peers in any particular arrangement (a `Channel` usually) agree to update their contract's state (or "status" for legal folks) after reliably responding to their counterparty's requests (in the form of a Layer 2, spendable UTXO to which you hold the secret) for the duration of the contract.  Should the contract expire, an "exit" clause is provided and all parties are able to spend funds at Layer 1 again.  In all cases, both parties have already signed the latest, most-valid state, and maintain full control over their own deposit.

Before establishing an agreement, Fabric-speaking peers must first establish a "Payment Channel" using Lightning, Raiden, or something similar.<sup>[Note]</sup>

<small>**Note:** for security's sake, we're only implementing Bitcoin.  PRs welcome.</small>

##### 1.1: Application Resource Contracts
All agreements in Fabric are represented as well-formed descriptions of **Resources**<sup>[TODO: link here]</sup> — a term we use to describe a standardized service a peer might offer.  Each node in the Fabric network decides which resources they provide (determining which contracts they run), and what prices they accept for participation.  This, in concert with the bidders requesting these resources, forms the "Information Market" discussed in Fabric's whitepaper.

To create an

##### 1.2a: Convergence
You'll read in the Components section about our thoughts on User Interface Design, especially Software Development Interface Design.  Maybe someday we'll have a blog to share this on, but my personal goal is to design my software one time, and have it adapt to each platform while still retaining complete, functionality — even if, for example, mobile and desktop users might have different access profiles (usage patterns).

This raises the question: **how should peer-to-peer contracts be written?**

We can easily take the philosophical route in saying "any way the users want" but... that's a lot of engineering, and we won't get there without help from a strong community of contributors.  My thoughts are that we start with something small (in terms of implementation cost), formalize it, then start offering up other contract types through the `type` setting of the `Machine` class.

##### 1.2b: JavaScript
**Right now, we're starting with a subset of JavaScript.**  Why?  Because it's the only tool non-developers can use _right now_ to get started on their learning journey.

But also aecause it's easy.  Yes yes, it's arbitrary code, and browsers are notably insecure; _sooooo_ we started work on a formal grammar, and hope to publish it as some kind of standalone language.

In any case, we're limiting everything to pure functions and a stack-based execution model.  This will lend itself to easy migration of existing work to other purely-functional languages, and even to _formal verification_ when we get the resources to accomplish that. :)

While Turing Completeness _is_ possible with a Fabric-based system (take note!), we've been careful to avoid any obvious footguns, and are doing our best to iron out all the cryptography-based gotchas.  Code review is everything!

#### 4. Components
Fabric aims to assist more than just developers, and in doing so we are seeking to build a visual composer for functional, reasonably-well secured applications, both on native platforms like `x86` and `ARM` but also for what we call [the "legacy" web][legacy-web].

As you may know, the World Wide Web is still an incredible place, but due in part to oversight in its design, it lacks a lot of the privacy and security guarantees that we've come to expect from Bitcoin and other decentralized systems.  The browser-based web is full of complexity, the enemy of security, so we've set out to define some kind of interface language that _isn't_ web first, not even NATIVE FIRST, but rather _terminal_ first.

You've probably encountered the Fabric CLI when you first installed Fabric: `npm i -g @fabric/core` — this is our barebones prototype for implementation in whatever we choose for the final version.  we've already identified a few off-the-shelf solutions which don't mandate a specific downstream package (Native Web Components, in particular, stand out).  Feel free to chat with about it in [Grove][grove] or using [GitHub Discussions][fabric-core-github-discussions] for more formality and structure.

#### 5. Resources
Fabric makes a truly decentralized web possible by establishing formal contracts surrounding the concept of a **Resource**.  Generally, a "Resource" is a committed agreement to provide some data, document or otherwise, in exchange for a pre-determined fee.  Providers of services within the Fabric network will deliver the document (or a proof of delivery) in the form of an HTLC ("Hash or Time Locked Contract") on the selected Layer 2 network.

In Fabric, we describe these broadly as "Application Resource Contracts" — or, just ARCs for short.  They are the complete set of "storyline arcs" any particular contract can take.

##### An Example Resource
`resources/document.json`
```json
{
  "name": "Document",
  "description": "A generic document resource.  All data treated as raw bytes, no additional protocols or parameters.",
  "creator": "022380f37b7479c224089be7156d25251db5136d24d030f1261b6e3a1f59a8b49b",
  "owner": "022380f37b7479c224089be7156d25251db5136d24d030f1261b6e3a1f59a8b49b",
  "labels": ["example", "bitcoin", "lightning", "fabric"],
  "paths": {
    "list": "/documents",
    "view": "/documents/:id"
  },
  "components": {
    "list": "DocumentList",
    "view": "DocumentView"
  },
  "constraints": {
    "state": {
      "clock": {
        "$lte": 1000
      }
    }
  },
  "roles": {
    "list": ["*"],
    "view": ["*"],
    "create": ["~owner"],
    "update": ["~owner"],
    "delete": ["~owner"],
  }
}
```

You can see this is a declarative, JSON-based description of a "generic document" resource.  It contains a human-friendly description, and a few other configuration values which we'll go over in more detail later.

##### Interesting Properties of a Fabric Resource Definition
- `components` — named list of user-sourced events to their corresponding user interface elements (currently all written for terminals, the Fabric CLI).
- `constraints` — limitations to hold the system accountable for.  Here, we specify that the clock<sup>Note</sup> never exceed 1000 cycles, so a single document stored in this collection could be served 999 other times before the resource is considered "consumed" — in this way we can also constrain other arbitrary aspects of the application state.

<small>**Note (a long one):** all classes in Fabric will carry with them a vector clock, incremented any time the state is updated using the `commit()` method found on anything inheriting from the `Actor` class.  Some incoming messages can generate multiple clock events, so be careful with your global event relay policies!  With each new state, channel balances will be updated (unless `NOOP`, a full burn of all bonds), so it will be important to test lower cycle times on high-latency and low-reliability connections.</small>

Importantly, the `Resource` type is used in combination with the `Service` type to define exactly what features that service provides to other consumers of its information.

#### 5. Services
Fabric relies on `Message` objects passed between nodes to exchange information,
like transaction data and requests for computation (RFCs).  Services offer up
one or more "Resources" as described above, emitting events for any listening consumer,
or sometimes, for connectivity with external networks (like the World Wide Web).

The `Service` class can be extended to add Fabric support to your favorite project.

##### An Example Fabric Service
```js
// Fabric Dependencies
const Service = require('@fabric/core/types/service');

// Class Definition
class MyClockService extends Service {
  constructor (input = {}) {
    // Mandatory
    super(input);

    // Try to configure, else return null
    try {
      // Apply the input to some defaults
      this.settings = Object.assign({
        clock: 0,    // vector clock start
        frequency: 1 // Hz
      }, input);
    } catch (exception) {
      // Failed to apply input to an object {}...
      // Maybe we should switch to TypeScript? ;)
      console.error('Could not create MyService:', exception);
      return null;
    }

    // Currently mandatory
    // TODO: make optional
    this._state = {
      content: null
    };

    // Chainable pattern
    return this;
  }

  // Called once per 
  tick () {
    const origin = this.get('clock');
    console.log('clock:', origin);
    this.set('clock', origin++);
    this.
  }

  // custom start function
  // you can obviously call `super.start()` and `super.stop()`
  // but this is an example :) and we haven't fully defined expected behaviors yet!
  async start () {
    // super.start(); // disabled for clean example
    
  }
}
```

Services will define how, if any, an ecosystem emerges and _actually_ succeeds at replacing the web.  They enable a common API between otherwise disparate projects, such as between Bitcoin and Ethereum.

See [the Services Overview][services] for more information.

#### 6. Types
`@fabric/core` is a NodeJS-targeted software library, but you don't need the whole kit-and-kaboodle.  Our pattern is to expose CommonJS-based ES6 classes, for several reasons, including maximum compatibility, so you will typically import a Fabric class like this:

```js
const Actor = require('@fabric/core/types/actor');
```

Grab what you need, use what you take. :)

##### Fabric Types by Example
Create and sign some string message using the built-in Schnorr `Signer` type:
```js
const Hash256 = require('@fabric/core/types/hash256');
const Signer = require('@fabric/core/types/signer');
const message = 'Hello, world!';
const signer = new Signer();
const signature = signer.sign(message);
console.log('Message:', message);
console.log('Message Hash:', Hash256.digest(message));
console.log('Signer Pubkey:', signer.public);
console.log('Purported Signature:', message);
```

[services]: ../SERVICES.html
[actor-type]: Actor.html
[fabric-core-github]: https://github.com/FabricLabs/fabric
[fabric-core-github-discussions]: https://github.com/FabricLabs/fabric/discussions
[fabric-roadmap]: https://github.com/FabricLabs/fabric/projects/1
[legacy-web]: https://web.fabric.pub
[minsc-home]: https://min.sc
[nvm-official]: https://nvm.sh

# Parking Lot
## TODO
- [ ] Write Markdown CMS
- [ ] Remove TODOs
- [ ] Commit and Publish

[quickstart-guide]: QUICKSTART.md
