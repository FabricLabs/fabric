# Things to Do
- [ ] Test with Node 14
- [ ] Clean up outstanding warnings
- [ ] Test Coverage 70%
- [ ] Clean install from @portal/feed
- [ ] Install Time < 300s

## Annoyances:
Upon running `rm -rf node_modules && npm i` from `@portal/feed` repo:
```
npm WARN notsup Unsupported engine for tiny-secp256k1@2.2.1: wanted: {"node":">=14.0.0"} (current: {"node":"12.20.2","npm":"6.14.17"})
npm WARN notsup Not compatible with your version of node/npm: tiny-secp256k1@2.2.1
npm WARN notsup Unsupported engine for uint8array-tools@0.0.7: wanted: {"node":">=14.0.0"} (current: {"node":"12.20.2","npm":"6.14.17"})
npm WARN notsup Not compatible with your version of node/npm: uint8array-tools@0.0.7
npm WARN notsup Unsupported engine for mocha@10.0.0: wanted: {"node":">= 14.0.0"} (current: {"node":"12.20.2","npm":"6.14.17"})
npm WARN notsup Not compatible with your version of node/npm: mocha@10.0.0

added 412 packages from 305 contributors in 587.198s

42 packages are looking for funding
  run `npm fund` for details
```

**@fabric/core:**
```
added 2352 packages from 1771 contributors in 414.351s

92 packages are looking for funding
  run `npm fund` for details
```

1. Need to test with Node 14.
2. 587 seconds is far too long.  Reduce dependencies.
3. Projects need funding.  Reduce dependencies and/or fund projects.
