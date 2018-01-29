# Building Your First Blockchain
In this example, we'll build a blockchain with Fabric.

## Quick Start
Here's the complete code for launching a local chain, appending some data, and
logging these events as they are received.

```js
'use strict';

const Chain = require('fabric').Chain;
const chain = new Chain();

async function main () {
  await chain.storage.open();

  chain.on('block', function (block) {
    console.log('[CHAIN]', 'new block:', block);
  });

  chain.append({ input: 'foo' });
  chain.append({ input: 'bar' });

  await chain.storage.close();
}

main();
```

In practice, you'll want to add some validation function for the chain's `Block`
definition.
