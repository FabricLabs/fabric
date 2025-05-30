# `@fabric/core` — the Fabric Reference Client
![Project Status][badge-status]
[![Coverage Status][badge-coverage]][coverage]
[![GitHub contributors][badge-contributors]][contributors]

[The `@fabric/core` project][fabric-github] provides an API for building peer-to-peer applications on [Bitcoin][bitcoin].

Fabric is an experimental approach to the secure establishment and execution of
peer-to-peer agreements ("contracts") using Bitcoin as a bonding mechanism. The
`@fabric/core` project provides a robust set of implementations as JavaScript
classes, enabling the rapid prototyping and testing of Bitcoin-based
applications for downstream developers.

## Quick Start
`npm i -g FabricLabs/fabric#master`

Install Fabric CLI to your system using the above command, then run:
```
fabric setup
```

| 🚨 Stop here! |
|--------------|
| The output of the above command will include your SEED, which should never be shared. |

Once complete, you'll have a fully configured Fabric client available by running:
```
fabric
```

For help, try entering "insert mode" by pressing the "i" key then typing `/help` and pressing enter — you'll get a short help prompt followed by a list of available commands.  Feel free to explore!

If you run into any trouble, read on for clues, then [join the chat][chat-help] with any remaining questions.

You'll also want `bitcoind` installed, and fully synchronized with your
preferred network.  You can use `scripts/playnet.sh` to run a local playnet
node, for which you can use the faucet: https://faucet.playnet.fabric.pub

## What is Fabric?
`@fabric/core` provides the reference implementation for [the Fabric Protocol][protocol], a "language" for exchanging information through peer-to-peer networks.  Written in JavaScript, it is meant to be well-documented and easy to understand — but not the final implementation.

## Contributing
Fork and clone [the Fabric GitHub repository][fabric-github] and launch a local
web server with `npm run examples` to view the examples, or `npm run docs` once
you're ready to integrate Fabric into your application.

### Compiling from Source
See also [`BUILD.md`][build-guide] for a full guide, including Bitcoin and Lightning.

```
git clone git@github.com:FabricLabs/fabric.git
cd fabric
git checkout feature/v0.1.0-RC1
npm install -g
npm run build
```

## Available Commands
- `npm run cli` provides a direct command-line interface to the Fabric network.
- `npm run dev` serves a developer interface over localhost HTTP.
- `npm run docs` creates a local HTTP server for browsing documentation.
- `npm run examples` creates a local HTTP server for interacting with examples.
- `npm start` creates a local Fabric node.

## Native Dependencies
Installing Fabric from npm (`npm i @fabric/core` or
`npm i FabricLabs/fabric#develop`) will generally compile the following
dependencies from the local system:
- `secp256k1`
- `level`
- `zeromq`

## API
The Fabric reference implementation exposes a simple message-passing interface
using [the actor model][actor-model], enabling your downstream applications to
subscribe to simple events for rapid prototyping of distributed applications.

### Using as a Library
Using the `EventEmitter` pattern, you can create an instance of Fabric to use
it as an event source.

#### Simple Example
```js
const Peer = require('@fabric/core/types/peer');

async function main () {
  const peer = new Peer({
    alias: 'Example',
    peers: ['hub.fabric.pub:7777']
  });

  peer.on('message', (message) => {
    console.log('Received message from Fabric:', message);
  });

  peer.start();
  return { peer };
}

main().catch((exception) => {
  console.error('Example error:', exception);
}).then((output) => {
  console.log('Example output:', output);
});
```

## Plugins
Fabric is an extensible framework, supporting a variety of plugins.

| Package                            | Description                                | Status                                                               |
|------------------------------------|--------------------------------------------|----------------------------------------------------------------------|
| [`@fabric/http`][http-plugin]      | serve Fabric apps to the legacy web (HTTP) | [![Coverage Status][badge-http-coverage]][badge-http-coverage]       |
| [`@fabric/hub`][hub-plugin]        | run your own Fabric Hub                    | [![Coverage Status][badge-hub-coverage]][badge-hub-coverage]         |
| [`@fabric/doorman`][doorman]       | an artificially intelligent assistant      | [![Coverage Status][badge-doorman-coverage]][doorman-coverage-home]  |

## Running on Fabric
Several successful projects are built with or are running on Fabric, including:

- [Doorman][doorman], an artificially intelligent assistant
- [IdleRPG][idlerpg], a simple RPG game which rewards you for remaining idle
- [Verse][verse], a virtual universe simulator

To add your project to the list, [read the API docs][api-docs], create a public
repository for the source code, then [edit this file][edit-readme] to include a
link to your work.

### Edge Nodes
Full Fabric nodes connected to the World Wide Web (WWW).  Only SSL (port 443) is supported.

| Host | Status |
| ---- | ------ |
| `hub.fabric.pub` | `ONLINE`
| `labs.fabric.pub` | `OFFLINE`

### Fabric Projects
Either Fabric libraries or projects running Fabric, this list encompasses the most interesting work in the ecosystem.

| Name | Description | Status | v0.1.0-RC1 ready
| ---- | ----------- | ------ | ----------
| [`@fabric/core`][fabric-github] | Core Library
| [`@fabric/http`][http-plugin] | Edge Nodes
| [`hub.fabric.pub`](https://hub.fabric.pub) |
| [`labs.fabric.pub`](https://labs.fabric.pub) |
| `sensemaker.io` | | | `FALSE`
| `verse.pub` | | |

## Learning More
The best place to get started is in [the #learning channel][learning], a
collection of empassioned educators eager to help you.

Fabric on Twitter: [@FabricProtocol][twitter]

[fabric]: fabric:

[bitcoin]: https://bitcoin.org
[build-guide]: BUILD.md
[chat]: https://grove.chat
[chat-help]: https://grove.chat/#/room/#help:fabric.pub
[chat-support]: https://grove.chat/#/room/#help:fabric.pub
[coverage]: https://codecov.io/gh/FabricLabs/fabric
[development]: https://grove.chat/#/room/#development:fabric.pub
[fabric-fm]: https://fabric.fm
[fabric-pub]: https://fabric.pub
[fabric-github]: https://github.com/FabricLabs/fabric
[fabric-http]: https://github.com/FabricLabs/fabric-http
[protocol]: PROTOCOL.md
[learning]: https://grove.chat/#/room/#learning:fabric.pub

[api-docs]: https://dev.fabric.pub

[fabric-github]: https://github.com/FabricLabs/fabric
[http-plugin]: https://github.com/FabricLabs/fabric-http
[hub-plugin]: https://github.com/FabricLabs/hub.fabric.pub
[twilio-plugin]: https://github.com/FabricLabs/fabric-twilio
[zapier-plugin]: https://github.com/FabricLabs/fabric-zapier
[github-plugin]: https://github.com/FabricLabs/fabric-github

[edit-readme]: https://github.com/FabricLabs/fabric/edit/master/README.md
[contributors]: https://github.com/FabricLabs/fabric/graphs/contributors
[build-status]: https://app.travis-ci.com/github/FabricLabs/fabric

[badge-status]: https://img.shields.io/badge/status-experimental-rainbow.svg?style=flat-square
[badge-build]: https://img.shields.io/travis/FabricLabs/fabric.svg?branch=master&style=flat-square
[badge-coverage]: https://img.shields.io/codecov/c/github/FabricLabs/fabric.svg?style=flat-square
[badge-contributors]: https://img.shields.io/github/contributors/FabricLabs/fabric.svg?style=flat-square

[badge-doorman-status]: https://img.shields.io/travis/FabricLabs/doorman.svg?branch=master&style=flat-square
[badge-doorman-coverage]: https://img.shields.io/codecov/c/github/FabricLabs/doorman.svg?style=flat-square
[badge-http-status]: https://img.shields.io/travis/FabricLabs/fabric-http.svg?branch=master&style=flat-square
[badge-hub-status]: https://img.shields.io/travis/FabricLabs/fabric-hub.svg?branch=master&style=flat-square
[badge-http-coverage]: https://img.shields.io/codecov/c/github/FabricLabs/fabric-http.svg?style=flat-square
[badge-hub-coverage]: https://img.shields.io/codecov/c/github/FabricLabs/fabric-hub.svg?style=flat-square
[badge-twilio-status]: https://img.shields.io/travis/FabricLabs/fabric-twilio.svg?branch=master&style=flat-square
[badge-twilio-coverage]: https://img.shields.io/codecov/c/github/FabricLabs/fabric-twilio.svg?style=flat-square
[badge-zapier-status]: https://img.shields.io/travis/FabricLabs/fabric-zapier.svg?branch=master&style=flat-square
[badge-zapier-coverage]: https://img.shields.io/codecov/c/github/FabricLabs/fabric-zapier.svg?style=flat-square
[badge-soundtrack-status]: https://img.shields.io/travis/FabricLabs/soundtrack.svg?branch=master&style=flat-square
[badge-soundtrack-coverage]: https://img.shields.io/codecov/c/github/FabricLabs/soundtrack.svg?style=flat-square
[badge-github-status]: https://img.shields.io/travis/FabricLabs/fabric-github.svg?branch=master&style=flat-square
[badge-github-coverage]: https://img.shields.io/codecov/c/github/FabricLabs/fabric-github.svg?style=flat-square

[doorman-test-status]: https://app.travis-ci.com/github/FabricLabs/doorman
[http-test-status]: https://app.travis-ci.com/github/FabricLabs/fabric-http
[twilio-test-status]: https://app.travis-ci.com/github/FabricLabs/fabric-twilio
[zapier-test-status]: https://app.travis-ci.com/github/FabricLabs/fabric-zapier
[soundtrack-test-status]: https://app.travis-ci.com/github/FabricLabs/soundtrack
[github-test-status]: https://app.travis-ci.com/github/FabricLabs/fabric-github

[doorman-coverage-home]: https://codecov.io/gh/FabricLabs/doorman
[http-coverage-home]: https://codecov.io/gh/FabricLabs/fabric-http
[soundtrack-coverage-home]: https://codecov.io/gh/FabricLabs/soundtrack
[github-coverage-home]: https://codecov.io/gh/FabricLabs/fabric-github

[soundtrack.io]: https://soundtrack.io
[soundtrack]: https://github.com/FabricLabs/soundtrack
[doorman]: https://github.com/FabricLabs/doorman
[idlerpg]: https://to.fabric.pub/#idlerpg:verse.im
[verse]: https://github.com/FabricLabs/verse

[everything-is-broken]: https://medium.com/message/everything-is-broken-81e5f33a24e1
[coordination]: https://i.imgur.com/Ki3fbTh.gif
[bitcoin-donations]: bitcoin:3CHGLadfbcKrM1sS5uYtASaq75VAuMSMpb
[bitcoin-donations-image]: https://fabric.pub/assets/3CHGLadfbcKrM1sS5uYtASaq75VAuMSMpb.png
[twitter]: https://twitter.com/FabricProtocol
[join]: https://chat.fabric.pub#register
[actor-model]: http://hdl.handle.net/1721.1/6935
[specification]: https://dev.fabric.pub/snippets/specification.html
[releases]: https://github.com/FabricLabs/fabric/releases
