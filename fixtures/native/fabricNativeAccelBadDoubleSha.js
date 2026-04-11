'use strict';

/** Minimal addon stub: wrong-length `doubleSha256` output exercises JS fallback in fabricNativeAccel. */
module.exports = {
  doubleSha256 () {
    return Buffer.alloc(31);
  },
  bech32Encode () {
    return '';
  },
  bech32Decode () {
    return null;
  },
  segwitAddrEncode () {
    return null;
  },
  segwitAddrDecode () {
    return null;
  }
};
