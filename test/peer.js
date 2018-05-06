'use strict';

import Fabric from '../';

const assert = require('assert');
const expect = require('chai').expect;

const crypto = require('crypto');
const net = require('net');

const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

const Peer = require('../lib/peer');
const Message = require('../lib/message');

// const key = '/test';
const data = require('../data/message');

const TEST_PORT = 7775;
const GENESIS_DATA = 'Hello, world!';
const BULK_COUNT = 1000;

describe('Peer', function () {
  it('should expose a constructor', function () {
    assert.equal(Peer instanceof Function, true);
  });

  it('should be able to identify itself', function (done) {
    let server = new Peer({ port: TEST_PORT });
    let client = new net.Socket();

    client.on('data', function (msg) {
      client.destroy();
      server.stop();

      // console.log('[CLIENT]', 'data packet:', msg);

      let message = Message.fromRaw(msg);
      let sample = Buffer.from(GENESIS_DATA).toString('hex');

      // TODO: use Fabric's stack machine
      let stack = message.data.split(' ');

      // TODO: convert to using Fabric.key
      let key = ec.keyFromPublic(server.key.public);
      let valid = key.verify(sample, stack[0]);

      assert.equal(valid, true);

      done();
    });

    server.listen();

    client.connect(TEST_PORT, '127.0.0.1', function () {
      // TODO: define instruction vectors
      let data = Buffer.from(GENESIS_DATA).toString('hex');
      let script = [data, 'SIGN'].join(' '); // TODO: encode over the wire as big-endian
      let payload = Buffer.from(script);
      let message = Message.fromVector([0x20, payload]);

      // send the message!
      client.write(message.asRaw());
    });
  });

  it('should correctly disconnect on an invalid message', function (done) {
    let server = new Peer({ port: TEST_PORT });
    let client = new net.Socket();

    client.on('end', function (msg) {
      client.destroy();
      server.stop();
      done();
    });

    server.listen();

    client.connect(TEST_PORT, '127.0.0.1', function () {
      client.write(Buffer.from('fake data'));
    });
  });

  it('should respond to PING with PONG message', function (done) {
    let server = new Peer({ port: TEST_PORT });
    let client = new net.Socket();
    let message = Message.fromVector([0x12]);

    client.on('data', function (msg) {
      let input = Message.fromRaw(msg);
      if (input.type === 0x13) {
        client.destroy();
        server.stop();
        assert.equal(input.data, message.id);
        done();
      }
    });

    server.listen();

    client.connect(TEST_PORT, '127.0.0.1', function () {
      client.write(message.asRaw());
    });
  });

  xit('should be reasonably fast', function (done) {
    let server = new Peer({ port: TEST_PORT });
    let client = new net.Socket();
    let counter = 0;

    client.on('data', function (msg) {
      let input = Message.fromRaw(msg);

      if (input.type === 0x13) {
        counter++;
      }

      if (counter === BULK_COUNT) {
        client.destroy();
        server.stop();
        done();
      }
    });

    server.listen();

    client.connect(TEST_PORT, '127.0.0.1', function () {
      for (let i = 1; i <= BULK_COUNT; i++) {
        let message = Message.fromVector([0x12]);
        client.write(message.asRaw());
      }
    });
  });
});
