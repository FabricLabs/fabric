'use strict';

const assert = require('assert');
const settings = require('../settings/test');
const Federation = require('../types/federation');
const Message = require('../types/message');
const Hash256 = require('../types/hash256');
const Key = require('../types/key');

describe('@fabric/core/types/federation', function () {
  this.timeout(180000);

  describe('Federation', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Federation instanceof Function, true);
    });

    it('can smoothly create a new federation', function () {
      const federation = new Federation();
      assert.ok(federation);
    });

    it('can start and stop', function () {
      const federation = new Federation();
      federation.start();
      assert.equal(federation._state.status, 'STARTED');
      federation.stop();
      assert.equal(federation._state.status, 'STOPPED');
    });

    it('can sign and verify messages between members', function () {
      const federation = new Federation();
      const message = 'test message';

      // Add a member with private key
      const member = new Key();

      federation.addMember({
        private: member.private.toString('hex'),
        public: member.public.encodeCompressed('hex')
      });

      // Sign and verify
      const signature = federation.sign(message);
      const isValid = federation.verify(message, signature);
      
      assert.ok(signature instanceof Buffer);
      assert.equal(signature.length, 64); // Schnorr signatures are 64 bytes
      assert.ok(isValid);
    });

    it('can handle multi-signature messages', function () {
      const federation = new Federation();
      const message = 'test message';
      
      // Add multiple members with private keys
      const members = [
        new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' }),
        new Key({ private: '2222222222222222222222222222222222222222222222222222222222222222' }),
        new Key({ private: '3333333333333333333333333333333333333333333333333333333333333333' })
      ];
      
      for (const member of members) {
        federation.addMember({
          private: member.private.toString('hex'),
          public: member.public.encodeCompressed('hex')
        });
      }
      
      // Create multi-signature
      const multiSig = federation.createMultiSignature(message);
      
      // Verify with different thresholds
      assert.ok(federation.verifyMultiSignature(multiSig, 1)); // At least 1 signature
      assert.ok(federation.verifyMultiSignature(multiSig, 2)); // At least 2 signatures
      assert.ok(federation.verifyMultiSignature(multiSig, 3)); // All signatures
      
      // Verify with invalid signature
      const invalidMultiSig = {
        message: message,
        signatures: {
          ...multiSig.signatures,
          [members[0].pubkey]: Buffer.alloc(64, 0) // Invalid signature
        }
      };
      
      assert.ok(!federation.verifyMultiSignature(invalidMultiSig, 3)); // Should fail with all valid signatures required
    });

    it('can handle Call messages with Schnorr signatures', function () {
      const federation = new Federation();
      const message = new Message({
        type: 'Call',
        data: {
          method: 'test',
          params: ['param1', 'param2']
        }
      });

      // Add a member with private key
      const member = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
      federation.addMember({
        private: member.private.toString('hex'),
        public: member.public.encodeCompressed('hex')
      });

      // Sign the message
      const signature = federation.sign(message.raw.data);
      message.raw.signature = signature;
      message.raw.author = Buffer.from(member.pubkey, 'hex');

      // Verify the signature
      const isValid = federation.verify(message.raw.data, signature);
      assert.ok(isValid);

      // Verify the message structure
      assert.equal(message.type, 'Call');
      assert.deepEqual(JSON.parse(message.raw.data.toString()), {
        method: 'test',
        params: ['param1', 'param2']
      });
    });

    it('can handle multi-signature Call messages', function () {
      const federation = new Federation();
      const message = new Message({
        type: 'Call',
        data: {
          method: 'test',
          params: ['param1', 'param2']
        }
      });

      // Add multiple members with private keys
      const members = [
        new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' }),
        new Key({ private: '2222222222222222222222222222222222222222222222222222222222222222' }),
        new Key({ private: '3333333333333333333333333333333333333333333333333333333333333333' })
      ];

      for (const member of members) {
        federation.addMember({
          private: member.private.toString('hex'),
          public: member.public.encodeCompressed('hex')
        });
      }

      // First member signs and sends to second
      const firstSignature = federation.sign(message.raw.data, members[0].pubkey);
      message.raw.signatures = {
        [members[0].pubkey]: firstSignature
      };
      message.raw.author = Buffer.from(members[0].pubkey, 'hex');

      // Second member receives, verifies, and adds their signature
      assert.ok(federation.verify(message.raw.data, firstSignature));
      const secondSignature = federation.sign(message.raw.data, members[1].pubkey);
      message.raw.signatures[members[1].pubkey] = secondSignature;

      // Third member receives, verifies, and adds their signature
      assert.ok(federation.verify(message.raw.data, firstSignature));
      assert.ok(federation.verify(message.raw.data, secondSignature));
      const thirdSignature = federation.sign(message.raw.data, members[2].pubkey);
      message.raw.signatures[members[2].pubkey] = thirdSignature;

      // Create multi-signature object for verification
      const multiSig = {
        message: message.raw.data,
        signatures: message.raw.signatures
      };

      // Verify with different thresholds
      assert.ok(federation.verifyMultiSignature(multiSig, 1)); // At least 1 signature
      assert.ok(federation.verifyMultiSignature(multiSig, 2)); // At least 2 signatures
      assert.ok(federation.verifyMultiSignature(multiSig, 3)); // All signatures

      // Verify the message structure
      assert.equal(message.type, 'Call');
      assert.deepEqual(JSON.parse(message.raw.data.toString()), {
        method: 'test',
        params: ['param1', 'param2']
      });
    });
  });
});
