# The Fabric Welcome Package
Welcome to Fabric!  We're building [an operating system][operating-system] for
the world's most powerful supercomputer, [the Bitcoin network][bitcoin-network].

Right now, we need your help.  Building a system of this scale requires as many
people as possible, and since you're here...

## Quick Links
Here are a few links you can read to bring yourself up to speed:

- [Why Are We Here][why-are-we-here]
- [Fabric Overview][fabric-overview]
- [Introduction to Maki, an experimental app framework][maki-intro]
- [Resource-Driven Design, the core philosophy of Maki][resources]

## General Background
Traditionally, collaborative software often requires the use of a central point
of coordination.  Fabric is a form of _distributed supercomputer_, allowing
programs to be divided into small bundles and run by the network — with each
participating node receiving fair payment for the use of their resources.

Fabric implements an _information market_, in which participants buy and sell
computations using self-enforcing smart contracts.  This market for processing
time is used to store and retrieve information locked in
cryptographically-sealed envelopes, which require unique proofs-of-work to
break their seals and reveal their contents.

### Critical Mass
For a market like this to function, a certain _critical mass_ is required for
network effects to manifest.  We are bootstrapping this mass by building our own
programs, deploying them to Fabric, and relying on them to do our work.  We call
it **dogfooding** — and we'd like to help you do the same by teaching everyone
to code, even if it is just a little.

To this end, we're investing in our community by
running [the #learning channel][learning] for anyone who'd like to build
something for themselves (or others!) — we're always around to answer questions
and provide resources for your journey.  Come say hello!

### Where's the Blockchain?
Fabric is not a blockchain!  We've designed a peer-to-peer protocol for
establishing and executing large cryptographic agreements, and the
`@fabric/core` library provides one such implementation — [**blockchain not included.**][running-a-node]

If you're ready to learn more, try [the technical specification][specification].

[bitcoin-network]: https://bitcoin.org
[operating-system]: https://fabric.pub
[why-are-we-here]: https://maki.fabric.pub/snippets/why-are-we-here.html
[fabric-overview]: https://maki.fabric.pub/snippets/fabric-overview.html
[maki-intro]: https://maki.fabric.pub/guides/what-is-maki
[resources]: https://maki.fabric.pub/docs/resources
[running-a-node]: https://bitcoin.org/en/full-node
[institute]: http://nakamotoinstitute.org/mempool/proof-that-proof-of-work-is-the-only-solution-to-the-byzantine-generals-problem/
[product]: https://maki.fabric.pub/topics/product
[learning]: https://maki.fabric.pub/topics/learning
[specification]: snippets/specification.md
