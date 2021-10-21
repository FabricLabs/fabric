# Fabric Quickstart

## Prerequisites
0. (optional) Install NVM: `https://nvm.sh`
1. Install Node 12.16 (use `nvm install 12.16` if using `nvm`)

## Instructions
0. Meet the prerequisites (above)
1. Install Fabric Core: `npm i --save @fabric/core`

_**Note:** for development releases, use `npm i --save FabricLabs/fabric#develop` instead._

## Sample Program
Create the file `scripts/quickstart.js` using the following code:

```js
const Bitcoin = require('@fabric/core/services/bitcoin');

async function main () {
  const bitcoin = new Bitcoin({
    verbosity: 3
  });

  await bitcoin.start();
}

main().catch((exception) => {
  console.error('[QUICKSTART]', 'Quick Start failed:', exception);
});
```

Finally, run the program:

```
> node scripts/quickstart.js
[AUDIT] Generating new HD key for wallet...
[AUDIT] Wallet account: {
  id: 'WLTTtuqaMtxMRiP33gLf1BN2js5HESWxHEhE',
  wid: 1,
  name: 'default',
  network: 'main',
  initialized: true,
  witness: false,
  watchOnly: false,
  type: 'pubkeyhash',
  m: 1,
  n: 1,
  accountIndex: 0,
  receiveDepth: 1,
  changeDepth: 1,
  nestedDepth: 0,
  lookahead: 10,
  receiveAddress: '1CxaBhXMiyNPGZ2K2gNprxY6BnCnKVoEgW',
  changeAddress: '1L3LYaPmHfUhLDtsjzw77bsqhzC5esx9qf',
  nestedAddress: null,
  accountKey: 'xpub6Cn1n6iWaPYRqoD4Ss9Sx4i2FLmdZ4ZSwb5NULg6DGCNXMVikaoRk3KFRihqRqLSPiNTDmVHgj7Ff1LMLidcveMf8kPHSX51CjBtZtCqiDU',
  keys: []
}
```
