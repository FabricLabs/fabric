'use strict';

import Fabric from '../';

const assert = require('assert');
const expect = require('chai').expect;

const sample = require('../data/message');

describe('Stack', function () {
  it('should correctly compute a known instruction', async function () {
    let fabric = new Fabric();

    try {
      fabric.use('OP_TEST', function (state) {
        return true;
      });

      fabric.push(new Fabric.Vector('OP_TEST')._sign());
      let result = await fabric.compute();

      assert.equal(result, true);
      assert.equal(fabric.output, true);
      assert.equal(fabric.clock, 1);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }
  });

  it('fails on an invalid script', async function () {
    let fabric = new Fabric();

    try {
      fabric.use('ADD', function (state) {
        return this.add(state);
      });

      fabric.push('NONINT');
      fabric.push('1');
      fabric.push('ADD');

      let result = await fabric.compute();

      assert.equal(result, false);
      assert.equal(fabric.output, false);
      assert.equal(fabric.clock, 1);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }
  });

  it('can add two numbers', async function () {
    let fabric = new Fabric();

    try {
      fabric.use('ADD', function (state) {
        return this.add(state);
      });

      fabric.push('1');
      fabric.push('1');
      fabric.push('ADD');

      let result = await fabric.compute();

      assert.equal(result, 2);
      assert.equal(fabric.output, 2);
      assert.equal(fabric.clock, 1);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }
  });

  it('can add two other numbers', async function () {
    let fabric = new Fabric();

    fabric.use('ADD', function (state) {
      return this.add(state);
    });

    fabric.push('123');
    fabric.push('456');
    fabric.push('ADD');

    let result = await fabric.compute();

    assert.equal(fabric.output, 579);
    assert.equal(fabric.clock, 1);
  });

  it('can perform composite addition', async function () {
    let fabric = new Fabric();

    fabric.use('ADD', function (state) {
      return this.add(state);
    });

    fabric.use('DUP', function (state) {
      let value = this.stack.pop()['@data'];
      let vector = new Fabric.Vector(value)._sign();

      this.stack.push(vector);
      this.stack.push(vector);

      return value;
    });

    fabric.push('123');
    fabric.push('456');
    fabric.push('ADD');
    fabric.push('DUP');
    fabric.push('ADD');

    let result = await fabric.compute();

    assert.equal(fabric.output, (123 + 456) * 2);
    assert.equal(fabric.output, 1158);
    assert.equal(fabric.clock, 1);
  });

  it('can carry state', async function () {
    let fabric = new Fabric();

    try {
      let sample = 'foo';
      let data = JSON.stringify(sample);
      let test = new Fabric.Vector(sample)._sign();
      let hash = require('crypto').createHash('sha256').update(data).digest('hex');

      fabric.use('PUT', function (input) {
        this['@data'] = input[0]['@data'] || 0;
        this._sign();
        return this['@id'];
      });

      fabric.push('foo');
      fabric.push('PUT');

      let result = await fabric.compute();

      assert.equal(result, hash);
      assert.equal(result, test['@id']);
      assert.equal(fabric.output, test['@id']);
      assert.equal(fabric.clock, 1);

    } catch (E) {
      console.error(E);
      assert.fail(E);
    }
  });

  it('can conditionally return true', async function () {
    let fabric = new Fabric();

    try {
      fabric.use('EQUAL', function (state) {
        let a = this.stack.pop();
        let b = this.stack.pop();

        return parseInt(a['@data']) === parseInt(b['@data']);
      });

      fabric.push('1');
      fabric.push('1');
      fabric.push('EQUAL');

      let result = await fabric.compute();

      assert.equal(result, true);
      assert.equal(fabric.clock, 1);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }
  });

  it('can conditionally return false', async function () {
    let fabric = new Fabric();

    try {
      fabric.use('EQUAL', function (state) {
        let a = this.stack.pop();
        let b = this.stack.pop();

        return parseInt(a['@data']) === parseInt(b['@data']);
      });

      fabric.push('1');
      fabric.push('0');
      fabric.push('EQUAL');

      let result = await fabric.compute();

      assert.equal(result, false);
      assert.equal(fabric.output, false);
      assert.equal(fabric.clock, 1);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }
  });

  it('can replicate OP_DUP', async function () {
    let fabric = new Fabric({
      name: 'wonderboy'
    });

    try {
      fabric.use('OP_DUP', function (input) {
        let value = this.stack.pop()['@data'];
        let vector = new Fabric.Vector(value)._sign();

        this.stack.push(vector);
        this.stack.push(vector);

        return JSON.parse(JSON.stringify(this.stack));
      });

      fabric.push('sample');
      fabric.push('OP_DUP');

      let output = await fabric.compute();

      assert.equal(fabric.stack[0]['@data'], 'sample');
      assert.equal(fabric.stack[1]['@data'], 'sample');
      //assert.equal(fabric.stack.length, 2);
      assert.equal(output.length, 2);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }
  });

  it('can arbitrarily combine scripts', async function () {
    let fabric = new Fabric();

    try {
      fabric.use('ADD', function (state) {
        return this.add(state);
      });

      fabric.push('7');
      fabric.push('3');
      fabric.push('ADD');
      fabric.push('1');
      fabric.push('ADD');

      let result = await fabric.compute();

      assert.equal(result, 11);
      assert.equal(fabric.output, 11);
      assert.equal(fabric.clock, 1);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }
  });
  
  xit('can emulate OP_CHECKSIG', async function () {
    let fabric = new Fabric();
    let key = new Fabric.Key();

    fabric.use('OP_CHECKSIG', async function (input) {
      let pubkey = this.stack.pop()['@data'];
      let signature = this.stack.pop()['@data'];

      console.log('CHECKSIG? pubkey:', pubkey);
      console.log('CHECKSIG? signature:', signature);
      //console.log('CHECKSIG? key:', key);

      let equal = pubkey === signature;
      let valid = await key._verify(pubkey, '0411db93e1dcdb8a016b49840f8c53bc1eb68a382e97b1482ecad7b148a6909a5cb2e0eaddfb84ccf9744464f82e160bfa9b8b64f9d4c03f999b8643f656b412a3', signature);

      return equal && valid;

      // TODO: implement Bitcoin's CHECKSIG
      //let valid = key._verify(key, '', signature);
      return false;

      return valid;
    });

    fabric.push('304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901');
    fabric.push('04ae1a62fe09c5f51b13905f07f06b99a2f7159b2225f374cd378d71302fa28414e7aab37397f554a7df5f142c21c1b7303b8a0626f1baded5c72a704f7e6cd84c');
    fabric.push('OP_CHECKSIG');

    //console.log('input script:', fabric.script);

    let result = await fabric.compute();

    //console.log('fabric:', fabric);
    console.log('result:', result);
    //console.log('result script:', fabric.script);
    console.log('result stack:', fabric.stack);

    assert.equal(fabric['@data'], true);
  });

  xit('can compute a P2PKH-like script', async function () {
    let fabric = new Fabric();
    let key = new Fabric.Key();

    // TODO: use bootstrap function to define this list
    fabric.use('OP_DUP', function (input) {
      let value = this.stack.pop()['@data'];
      let vector = new Fabric.Vector(value)._sign();

      this.stack.push(vector);
      this.stack.push(vector);

      return value;
    });

    fabric.use('OP_HASH160', function (input) {
      let op = this.stack.pop();
      let data = this.stack.pop();
      let hash = key._ripemd(data);
      let vector = new Fabric.Vector(hash);

      this.stack.push(vector);

      return data;
    });

    fabric.use('OP_EQUALVERIFY', function (input) {
      let op = this.stack.pop();
      let a = this.stack.pop()['@data'];
      let b = this.stack.pop();

      console.log('EQUALVERIFY? a:', a);
      console.log('EQUALVERIFY? b:', b);

      this.stack.push(true);

      console.log('stack:', this.stack);

      return true;
      return a === b;
    });

    fabric.use('OP_CHECKSIG', function (input) {
      let op = this.stack.pop();
      let signature = this.stack.pop();
      let hash = this.stack.pop();

      console.log('CHECKSIG? signature:', signature);
      console.log('CHECKSIG? hash:', hash);
      console.log('CHECKSIG? key:', key);

      let equal = signature === hash;
      let valid = key._verify(key, hash, signature);

      return equal && valid;

      // TODO: implement Bitcoin's CHECKSIG
      //let valid = key._verify(key, '', signature);
      return false;

      return valid;
    });

    let buffer = new Buffer(sample['@data']);
    let signature = await key._sign(buffer);

    let hash = key._ripemd(key.public);
    let input = new Fabric.Vector(key.public.toString('hex'));
    let redeemKey = new Fabric.Vector(hash);

    console.log('signature:', signature);
    console.log('hash:', hash);

    //fabric.push(new Vector(signature.toString('hex')));
    fabric.push(input);
    fabric.push('OP_DUP');
    fabric.push('OP_HASH160');
    fabric.push(redeemKey);
    fabric.push('OP_EQUALVERIFY');
    fabric.push('OP_CHECKSIG');

    //console.log('input script:', fabric.script);

    let result = await fabric.compute();

    //console.log('fabric:', fabric);
    console.log('result:', result);
    console.log('result stack:', fabric.stack);
    console.log('result script:', fabric.script);

    assert.equal(fabric['@data'], true);
  });
});
