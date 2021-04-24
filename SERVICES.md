# Fabric Services
`@fabric/core` offers numerous Service implementations to provide basic
Oracle functionality to the network.  Requests made to Oracles can require
BTC payments, allowing consumers to pay their providers for their services.

## List of Services
- `@fabric/bitcoin`
- `@fabric/lightning`
- `@fabric/matrix`

## Quick Start
```
const Bitcoin = require('@fabric/core/services/bitcoin');
const bitcoin = new Bitcoin();

bitcoin.start();
```