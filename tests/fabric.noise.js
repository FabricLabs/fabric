'use strict';

const Key = require('../types/key');
const assert = require('assert');
const noise = require('noise-protocol-stream');
const crypto = require('crypto');

const SAMPLE = {
  seed: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  private: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
};

describe('@fabric/core/types/noise', function () {
  describe('NOISE Protocol Integration', function () {
    it('can create a NOISE handshake with Fabric Key', function () {
      const key = new Key({
        private: SAMPLE.private
      });

      // Create NOISE handler
      const handler = noise({
        prologue: Buffer.from('fabric'),
        verify: (localPrivateKey, localPublicKey, remotePublicKey, done) => {
          // Verify the remote public key using our Key class
          const remoteKey = new Key({ public: remotePublicKey.toString('hex') });
          const message = 'Hello, Fabric!';
          const signature = key.signSchnorr(message);
          const verified = remoteKey.verifySchnorr(message, signature);
          done(null, verified);
        }
      });

      assert.ok(handler);
    });

    it('can perform a NOISE handshake between two Fabric Keys', function () {
      // Create two keys
      const key1 = new Key({
        private: SAMPLE.private
      });
      const key2 = new Key({
        seed: SAMPLE.seed
      });

      // Create NOISE handlers
      const handler1 = noise({
        prologue: Buffer.from('fabric'),
        verify: (localPrivateKey, localPublicKey, remotePublicKey, done) => {
          const remoteKey = new Key({ public: remotePublicKey.toString('hex') });
          const message = 'Hello, Fabric!';
          const signature = key1.signSchnorr(message);
          const verified = remoteKey.verifySchnorr(message, signature);
          done(null, verified);
        }
      });

      const handler2 = noise({
        prologue: Buffer.from('fabric'),
        verify: (localPrivateKey, localPublicKey, remotePublicKey, done) => {
          const remoteKey = new Key({ public: remotePublicKey.toString('hex') });
          const message = 'Hello, Fabric!';
          const signature = key2.signSchnorr(message);
          const verified = remoteKey.verifySchnorr(message, signature);
          done(null, verified);
        }
      });

      assert.ok(handler1);
      assert.ok(handler2);
    });

    it('can encrypt and decrypt messages using NOISE with Fabric Keys', function () {
      const key = new Key({
        private: SAMPLE.private
      });

      const handler = noise({
        prologue: Buffer.from('fabric'),
        verify: (localPrivateKey, localPublicKey, remotePublicKey, done) => {
          const remoteKey = new Key({ public: remotePublicKey.toString('hex') });
          const message = 'Hello, Fabric!';
          const signature = key.signSchnorr(message);
          const verified = remoteKey.verifySchnorr(message, signature);
          done(null, verified);
        }
      });

      const message = 'Hello, Fabric!';

      // Write to encrypt stream
      handler.encrypt.write(Buffer.from(message));

      // Read from decrypt stream
      handler.decrypt.on('data', (data) => {
        assert.equal(data.toString(), message);
      });

      // Pipe encrypt to decrypt to simulate a connection
      handler.encrypt.pipe(handler.decrypt);
    });
  });
});