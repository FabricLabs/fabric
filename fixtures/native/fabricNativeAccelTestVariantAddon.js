'use strict';

/**
 * Test-only addon: behavior selected via FABRIC_NATIVE_TEST_ADDON when functions run.
 * See tests/functions.fabricNativeAccel.js.
 */
const base = require('./fabricNativeAccelMockAddon.js');

function mode () {
  return typeof process.env.FABRIC_NATIVE_TEST_ADDON === 'string'
    ? process.env.FABRIC_NATIVE_TEST_ADDON.trim()
    : '';
}

module.exports = {
  doubleSha256: base.doubleSha256,
  bech32Encode (hrp, wordsBuf, enc) {
    if (mode() === 'bech32_encode_throw') throw new Error('bech32Encode test throw');
    return base.bech32Encode(hrp, wordsBuf, enc);
  },
  bech32Decode (str) {
    const m = mode();
    if (m === 'bech32_decode_throw') throw new Error('bech32Decode test throw');
    if (m === 'bech32_bad_words') return { hrp: 'bc', words: 'not-array-like', spec: 'bech32' };
    if (m === 'bech32_words_uint8') {
      return { hrp: 'id', words: new Uint8Array([0, 1, 2]), spec: 'bech32m' };
    }
    if (m === 'bech32_words_js_array') {
      return { hrp: 'id', words: [0, 1, 2, 3], spec: 'bech32m' };
    }
    if (m === 'bech32_bad_spec') {
      const d = base.bech32Decode(str);
      return d ? { hrp: d.hrp, words: d.words, spec: 'invalid-spec' } : null;
    }
    return base.bech32Decode(str);
  },
  segwitAddrEncode (hrp, version, programBuf) {
    if (mode() === 'segwit_encode_throw') throw new Error('segwit encode test throw');
    return base.segwitAddrEncode(hrp, version, programBuf);
  },
  segwitAddrDecode (hrp, addr) {
    const m = mode();
    if (m === 'segwit_decode_throw') throw new Error('segwit decode test throw');
    if (m === 'segwit_bad_version') {
      const d = base.segwitAddrDecode(hrp, addr);
      return d ? { version: 99, program: d.program } : null;
    }
    return base.segwitAddrDecode(hrp, addr);
  }
};
