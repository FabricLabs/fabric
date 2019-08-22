# Fabric
![Project Status](https://img.shields.io/badge/status-experimental-rainbow.svg?style=flat-square)
[![Build Status](https://img.shields.io/travis/FabricLabs/fabric.svg?branch=master&style=flat-square)](https://travis-ci.org/FabricLabs/fabric)
[![Coverage Status](https://img.shields.io/codecov/c/github/FabricLabs/fabric.svg?style=flat-square)](https://codecov.io/gh/FabricLabs/fabric)
[![GitHub contributors](https://img.shields.io/github/contributors/FabricLabs/fabric.svg?style=flat-square)](https://github.com/FabricLabs/fabric/graphs/contributors)
[![Community](https://img.shields.io/matrix/hub:fabric.pub.svg?style=flat-square)](https://chat.fabric.pub)

Fabric is an experimental approach to the secure establishment and execution of
peer-to -peer agreements, up to and including financial transactions.  With a
robust library of common components, `npm i @fabric/core` provides all the tools
one might `require` during the development of a well-researched application of
decentralization technology.

| 🚨 Heads up! |
|--------------|
| Use of Fabric in production is **not recommended** in its current state.  Please wait for [an official release][releases] before deploying to production environments. |

## Getting Started
If you're already familiar with `node` and have a project already started, try
`npm install --save @fabric/core` to install [Fabric Core](https://fabric.pub),
the primary library used for most Fabric-based applications.

Fork and clone [the Fabric GitHub repository][fabric-github] and launch a local
web server with `npm run examples` to view the examples, or `npm run docs` once
you're ready to integrate Fabric into your application.

## Available Commands
- `npm run cli` provides a direct command-line interface to the Fabric network.
- `npm run docs` creates a local HTTP server for browsing documentation.
- `npm run examples` creates a local HTTP server for interacting with examples.
- `npm start` creates a local Fabric node.

## API
The Fabric reference implementation exposes a simple message-passing interface
using [the actor model][actor-model].

### Using as a Library
#### Simple Example
```js
const Fabric = require('fabric');
const service = new Fabric();
```

`service` now contains a full instance of Fabric, including `SET` and `GET`
methods for publishing and retrieving documents.  Use `npm run examples` to see
more.

## Other Fabrics
Several other projects have used the name Fabric, as it's a great way to
describe a network of things, conjuring feelings of _nets_ and _webs_.  Here are
some links to them, as they offer some interesting things completely unrelated
to our goals.

- Fabric python project (#fabric on Freenode)
- Fabric application framework by Twitter

## Learning More
The best place to get started is in [the #learning channel][learning], a
collection of empassioned educators eager to help you.

Fabric on Twitter: [@FabricProtocol][twitter]

[learning]: https://maki.io/topics/learning
[development]: https://maki.io/topics/development

[everything-is-broken]: https://medium.com/message/everything-is-broken-81e5f33a24e1
[coordination]: https://i.imgur.com/Ki3fbTh.gif
[bitcoin-donations]: bitcoin:3CHGLadfbcKrM1sS5uYtASaq75VAuMSMpb
[bitcoin-donations-image]: https://fabric.pub/assets/3CHGLadfbcKrM1sS5uYtASaq75VAuMSMpb.png
[twitter]: https://twitter.com/FabricProtocol
[join]: https://maki.io/community
[actor-model]: http://hdl.handle.net/1721.1/6935
[specification]: https://dev.fabric.pub/snippets/specification.html
[releases]: https://github.com/FabricLabs/fabric/releases
