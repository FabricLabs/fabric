'use strict';

const crypto = require('crypto');
const fabric = require('../lib/fabric');
const hello = 'Hello, world!';
const encoded = JSON.stringify(hello);
const sample = { input: encoded };
const output = crypto.createHash('sha256').update(sample.input, 'utf8').digest('hex');

const collection = '["Hello, world!"]';

class NamedCollections {
  static get input () {
    return {
      alias: 'Nickname?', // TODO: CLI to prompt for Commit
      bare: hello,
      collection: collection,
      fabric: JSON.stringify(fabric['@data']),
      hello: JSON.stringify(hello),
      sample: JSON.stringify(sample),
      seed: 'order jaguar stairs labor emotion pistol connect loan frame benefit forum deer tonight retire cheap describe basic ramp reunion siren episode victory latin mask',
      first: 'mhUfpvY2VvkDwk46kpmCmnfdXRsoc64vkd',
      foo: JSON.stringify('foo'),
      bar: JSON.stringify('bar'),
      output: output
    };
  }

  static get output () {
    return {
      fabric: 'fb2d32b746ef3dbd71da161fa39587c9a9171cd70b2fb1cc23c9c27fab189986',
      collection: '94ec79adc2d418f8cda62a337189342344cd43201e6066309caee18d1464584e',
      hello: '19270ea4f98808a63fbb99bc26a5ee6f0fe8df9c8182cf1d710b115d57250578',
      sample: '156403d8f795a18e92f5d4377c84f49bdb321700289f1ab01ee7c58e7c994317',
      foo: 'b2213295d564916f89a6a42455567c87c3f480fcd7a1c15e220f17d7169a790b',
      bar: '4c293ff010a730f0972761331d1b5678478d425c2dc5cefd16d8f20059e497f3'
    };
  }

  static get names () {
    return {
      array: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
      empty: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
      fabric: 'fb2d32b746ef3dbd71da161fa39587c9a9171cd70b2fb1cc23c9c27fab189986',
      hello: '315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd3',
      object: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
      sample: '156403d8f795a18e92f5d4377c84f49bdb321700289f1ab01ee7c58e7c994317',
      stackWithSingleValidFrame: '1c28f2eb0958c3d15db1f0f0e7f2b8998ca2b8f67ab426a1fbb3d561fe76fad9',
      encodedStackWithSingleValidFrame: 'e3afdf82129d8f4d06b680dbf7fda32d34741ecd2fa41f81bcb7eed6d71f6b8e'
    };
  }

  static get hashes () {
    return {
      '156403d8f795a18e92f5d4377c84f49bdb321700289f1ab01ee7c58e7c994317': JSON.stringify(sample),
      '1c28f2eb0958c3d15db1f0f0e7f2b8998ca2b8f67ab426a1fbb3d561fe76fad9': '[true]',
      '315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd3': 'Hello, world!',
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a': '{}',
      '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945': '[]',
      f8c3bf62a9aa3e6fc1619c250e48abe7519373d3edf41be62eb5dc45199af2ef: 'Hello, world.',
      '1c866bf97f233de116bb311f47c9a432f2c3d5efc944dda1f33ff4b8e24313e3': JSON.stringify(fabric['@data']),
      e3afdf82129d8f4d06b680dbf7fda32d34741ecd2fa41f81bcb7eed6d71f6b8e: '{"@type":"Array","@data":[true]}'
    };
  }

  map (id) {
    return NamedCollections.hashes[NamedCollections.names[id]];
  }
}

module.exports = NamedCollections;
