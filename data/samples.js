'use strict';

const fabric = require('./fabric');
const hello = 'Hello, world!';
const sample = { input: 'test' };

class NamedCollections {
  static get input () {
    return {
      fabric: JSON.stringify(fabric['@data']),
      hello: JSON.stringify(hello),
      sample: JSON.stringify(sample)
    };
  }

  static get names () {
    return {
      'array': '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
      'empty': '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
      'fabric': '1c866bf97f233de116bb311f47c9a432f2c3d5efc944dda1f33ff4b8e24313e3',
      'hello': '315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd3',
      'object': '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
      'sample': '156403d8f795a18e92f5d4377c84f49bdb321700289f1ab01ee7c58e7c994317',
      'stackWithSingleValidFrame': '1c28f2eb0958c3d15db1f0f0e7f2b8998ca2b8f67ab426a1fbb3d561fe76fad9'
    };
  }

  static get hashes () {
    return {
      '156403d8f795a18e92f5d4377c84f49bdb321700289f1ab01ee7c58e7c994317': JSON.stringify(sample),
      '1c28f2eb0958c3d15db1f0f0e7f2b8998ca2b8f67ab426a1fbb3d561fe76fad9': '[true]',
      '315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd3': 'Hello, world!',
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a': '{}',
      '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945': '[]',
      'f8c3bf62a9aa3e6fc1619c250e48abe7519373d3edf41be62eb5dc45199af2ef': 'Hello, world.',
      '1c866bf97f233de116bb311f47c9a432f2c3d5efc944dda1f33ff4b8e24313e3': JSON.stringify(fabric['@data'])
    };
  }

  map (id) {
    return NamedCollections.hashes[NamedCollections.names[id]];
  }
}

module.exports = NamedCollections;
