'use strict';

const fabric = require('./fabric');
const sample = { input: 'test' };

class NamedCollections {
  static get names () {
    return {
      'array': '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
      'empty': '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
      'fabric': '71b4b2f3376f3e5ca9f2642335811aead89dc30f0f327727695227599cd3a503',
      'object': '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
      'sample': '156403d8f795a18e92f5d4377c84f49bdb321700289f1ab01ee7c58e7c994317',
      'stackWithSingleValidFrame': '1c28f2eb0958c3d15db1f0f0e7f2b8998ca2b8f67ab426a1fbb3d561fe76fad9'
    };
  }

  static get hashes () {
    return {
      '156403d8f795a18e92f5d4377c84f49bdb321700289f1ab01ee7c58e7c994317': JSON.stringify(sample),
      '1c28f2eb0958c3d15db1f0f0e7f2b8998ca2b8f67ab426a1fbb3d561fe76fad9': '[true]',
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a': '{}',
      '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945': '[]',
      '71b4b2f3376f3e5ca9f2642335811aead89dc30f0f327727695227599cd3a503': JSON.stringify(fabric['@data'])
    };
  }

  map (id) {
    return NamedCollections.hashes[NamedCollections.names[id]];
  }
}

module.exports = NamedCollections;
