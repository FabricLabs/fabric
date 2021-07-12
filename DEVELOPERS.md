# Fabric Developer Resources
There's a lot of information to cover with regards to building decentralized
applications, so grab a coffee ☕ and settle in.

## Architecture
Fabric relies on `Message` objects passed between nodes to exchange information,
like transaction data and requests for computation (RFCs).

### Actors
The [`Actor`][actor-type] is the primary tool for interacting with Fabric. It uses the
familiar JavaScript `EventEmitter` pattern:

```js
const Actor = require('@fabric/core/types/actor');
const actor = new Actor();

actor.on('message', (msg) => {
  console.log('message from actor:', msg);
});
```

Actors carry with them cryptographic signatures, accessible via the `sign()` method:

```js
const Actor = require('@fabric/core/types/actor');
const actor = new Actor();
const signature = actor.sign().signature;
```

### Messages
The `Message` class provides a variety of message-formatting options.

### Services
Services are special Actors which can be used to interact with various external
networks.

See [the Services Overview][services] for more information.

[services]: ../SERVICES.html

[actor-type]: Actor.html