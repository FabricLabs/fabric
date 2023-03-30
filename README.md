# `@fabric/core` — the Fabric Reference Client
![Project Status][badge-status]
[![Build Status][badge-build]][build-status]
[![Coverage Status][badge-coverage]][coverage]
[![GitHub contributors][badge-contributors]][contributors]
[![Community][badge-chat]][chat]

Fabric is an experimental approach to the secure establishment and execution of
peer-to-peer agreements, up to and including financial transactions.  With a
robust library of common components, `npm i @fabric/core` provides all the tools
one might `require` during the development of a well-researched application of
decentralization technology.

| 🚨 Heads up! |
|--------------|
| Use of Fabric in production is **not recommended** in its current state.  Please wait for [an official release][releases] before deploying to production environments, or proceed at your own risk. |

## Getting Started
If you're already familiar with `node` and have a project already started, try
`npm install --save @fabric/core` to install [Fabric Core](https://fabric.pub),
the primary library used for most Fabric-based applications.

You'll also want `bitcoind` installed, and fully synchronized with your
preferred network.  You can use `scripts/playnet.sh` to run a local playnet
node, for which you can use the faucet: https://faucet.playnet.fabric.pub

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
Installing Fabric from npm (`npm i @fabric/core`) will generally compile the 
following dependencies from the local system:

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
const Fabric = require('@fabric/core');
const fabric = new Fabric();

fabric.on('message', function (message) {
  console.log('Received message from Fabric:', message);
});

fabric.start();
```

`service` now contains a full instance of Fabric, including `SET` and `GET`
methods for publishing and retrieving documents.  Use `npm run examples` to see
more.

### Message Types
Message types are as follows:

#### `message`
The generic message event.

**Properties:**
- `@type` name of the event type.
- `@data` the content of the event, if any.

### Using Fabric in the Browser
Fabric generates a `fabric.min.js` bundle, which can be included with any HTML
document to expose the API in a browser.

## Other Fabrics
Several other projects have used the name Fabric, as it's a great way to
describe a network of things, conjuring feelings of _nets_ and _webs_.  Here are
some links to them, as they offer some interesting things completely unrelated
to our goals.

- Fabric python project (#fabric on Freenode)
- Fabric application framework by Twitter
- HyperLedger Fabric, by IBM


## Plugins
Fabric is an extensible framework, supporting a variety of plugins.

| Package                            | Description                                | Status                                                                                                                                       |
|------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| [`@fabric/http`][http-plugin]      | serve Fabric apps to the legacy web (HTTP) | [![Build Status][badge-http-status]][http-test-status] [![Coverage Status][badge-http-coverage]][badge-http-coverage]                        |
| [`@fabric/github`][github-plugin]  | interact with GitHub through Fabric        | [![Build Status][badge-github-status]][github-test-status] [![Coverage Status][badge-github-coverage]][github-coverage-home]                 |
| [`@fabric/matrix`][matrix-plugin]  | connect to Matrix servers                  | [![Build Status][badge-matrix-status]][matrix-test-status] [![Coverage Status][badge-matrix-coverage]][badge-matrix-coverage]                |
| [`@fabric/twilio`][twilio-plugin]  | send (and receive) SMS and phone calls     | [![Build Status][badge-twilio-status]][twilio-test-status] [![Coverage Status][badge-twilio-coverage]][badge-twilio-coverage]                |
| [`@fabric/zapier`][zapier-plugin]  | interact with arbitrary zapier triggers    | [![Build Status][badge-zapier-status]][zapier-test-status] [![Coverage Status][badge-zapier-coverage]][badge-zapier-coverage]                |
| [`@fabric/doorman`][doorman]       | an artificially intelligent assistant      | [![Build Status][badge-doorman-status]][doorman-test-status] [![Coverage Status][badge-doorman-coverage]][doorman-coverage-home]             |

## Running on Fabric
Several successful projects are built with or are running on Fabric, including:

- [Doorman][doorman], an artificially intelligent assistant
- [IdleRPG][idlerpg], a simple RPG game which rewards you for remaining idle
- [Verse][verse], a virtual universe simulator

To add your project to the list, [read the API docs][api-docs], create a public
repository for the source code, then [edit this file][edit-readme] to include a
link to your work.

## Learning More
The best place to get started is in [the #learning channel][learning], a
collection of empassioned educators eager to help you.

Fabric on Twitter: [@FabricProtocol][twitter]

[bitcoin]: https://bitcoin.org
[build-guide]: BUILD.md
[chat]: https://grove.chat
[chat-support]: https://grove.chat/#/room/#help:fabric.pub
[coverage]: https://codecov.io/gh/FabricLabs/fabric
[development]: https://grove.chat/#/room/#development:fabric.pub
[fabric-github]: https://github.com/FabricLabs/fabric
[protocol]: PROTOCOL.md
[learning]: https://grove.chat/#/room/#learning:fabric.pub

[api-docs]: https://dev.fabric.pub

[fabric-github]: https://github.com/FabricLabs/fabric
[http-plugin]: https://github.com/FabricLabs/fabric-http
[matrix-plugin]: https://github.com/FabricLabs/fabric-matrix
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
[badge-chat]: https://img.shields.io/matrix/hub:fabric.pub.svg?server_fqdn=matrix.org&style=flat-square

[badge-doorman-status]: https://img.shields.io/travis/FabricLabs/doorman.svg?branch=master&style=flat-square
[badge-doorman-coverage]: https://img.shields.io/codecov/c/github/FabricLabs/doorman.svg?style=flat-square
[badge-http-status]: https://img.shields.io/travis/FabricLabs/fabric-http.svg?branch=master&style=flat-square
[badge-http-coverage]: https://img.shields.io/codecov/c/github/FabricLabs/fabric-http.svg?style=flat-square
[badge-matrix-status]: https://img.shields.io/travis/FabricLabs/fabric-matrix.svg?branch=master&style=flat-square
[badge-matrix-coverage]: https://img.shields.io/codecov/c/github/FabricLabs/fabric-matrix.svg?style=flat-square
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
[matrix-test-status]: https://app.travis-ci.com/github/FabricLabs/fabric-matrix
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
