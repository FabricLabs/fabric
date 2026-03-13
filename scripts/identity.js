'use strict';

const {
  FIXTURE_SEED
} = require('../constants');

// const DERIVATION = `m/44'/7777'/0'/0/0`;
const DERIVATION = `m/44'/0'/0'/0/0`;
const PREFIX = 'id'; // <Buffer 69, 64>
const X_PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

const crypto = require('crypto');

// const settings = require('../settings/local');
const Bech32 = require('../types/bech32');
const Hash256 = require('../types/hash256');
const Identity = require('../types/identity');
const Key = require('../types/key');

async function verifyKey (key) {
  if (!key) throw new Error('No key provided for verification');
  if (!key.pubkey) throw new Error('Key missing public key');
  if (!key.private) throw new Error('Key missing private key');

  // Verify key can sign and verify
  const message = 'Fabric Identity Verification';
  const signature = key.sign(message);
  const verified = key.verify(message, signature);
  if (!verified) throw new Error('Key verification failed');

  return true;
}

async function verifyIdentity (identity) {
  if (!identity) throw new Error('No identity provided for verification');
  if (!identity.id) throw new Error('Identity missing ID');
  if (!identity.pubkey) throw new Error('Identity missing public key');

  // Verify identity string format
  const decoded = Bech32.decode(identity.id);
  if (!decoded) throw new Error('Invalid identity string format');

  return true;
}

function logSection (level, section, content) {
  if (level > 0) {
    console.log(`\n${section}:`);
    console.log('-------------------');
    if (typeof content === 'function') {
      content();
    } else {
      console.log(content);
    }
  }
}

async function main (input = {}) {
  // Get environment variables
  const seed = process.env.FABRIC_SEED || process.env.SEED;
  const xprv = process.env.FABRIC_XPRV || process.env.XPRV;
  const xpub = process.env.FABRIC_XPUB || process.env.XPUB;
  const identity = process.env.FABRIC_IDENTITY;
  const verbosity = parseInt(process.env.FABRIC_VERBOSE || input.verbosity || 0, 10);

  // Create key based on available inputs
  let key;
  if (identity) {
    // Use existing identity string
    const existing = Identity.fromString(identity);
    await verifyIdentity(existing);
    key = existing.key;
  } else if (xprv) {
    // Use extended private key
    key = new Key({ xprv });
  } else if (xpub) {
    // Use extended public key
    key = new Key({ xpub });
  } else if (seed) {
    // Use seed phrase
    key = new Key({ seed });
  } else {
    // Generate new key
    key = new Key();
  }

  // Verify key
  await verifyKey(key);

  // Derive child key
  const child = key.derive(input.derivation || DERIVATION);
  await verifyKey(child);

  // Create identity
  const id = new Identity({ key });
  await verifyIdentity(id);

  // Level 0: Just the identity string
  console.log('[IDENTITY]', id.toString());

  // Level 1: Basic identity information
  logSection(verbosity, 'Identity Information', () => {
    console.log('ID:', id.id);
    console.log('Public Key:', key.pubkey);
    console.log('Address:', id.toString());
  });

  // Level 2: Extended identity information
  logSection(verbosity - 1, 'Extended Information', () => {
    console.log('Public Key Hash:', id.pubkeyhash);
    console.log('Derivation Path:', input.derivation || DERIVATION);
    console.log('Child Public Key:', child.pubkey);
  });

  // Level 3: Environment variables
  logSection(verbosity - 2, 'Environment Variables', () => {
    console.log(`export FABRIC_SEED="${key.seed || ''}"`);
    console.log(`export FABRIC_XPRV="${key.xprv || ''}"`);
    console.log(`export FABRIC_XPUB="${key.xpub || ''}"`);
    console.log(`export FABRIC_IDENTITY="${id.toString()}"`);
  });

  // Level 4: Test values
  logSection(verbosity - 3, 'Test Values', () => {
    const pubkeyhash = Hash256.digest(X_PUBKEY);
    const truth = crypto.createHash('sha256').update(Buffer.from(X_PUBKEY, 'hex')).digest('hex');
    console.log('pubkeyhash:', pubkeyhash);
    console.log('pubkeyhash size:', pubkeyhash.length);
    console.log('truth:', truth);
  });

  // Level 5: Reference values
  logSection(verbosity - 4, 'Reference Values', () => {
    const frompub = new Identity({ public: X_PUBKEY });
    console.log('Reference ID:', frompub.id);
    console.log('Reference ID Size:', frompub.id.length);
    console.log('Reference Address:', frompub.toString());
    console.log('Reference Key X:', frompub.key.public.x.toString('hex'));
    console.log('Reference Key Y:', frompub.key.public.y.toString('hex'));
    console.log('Reference Pubkey:', frompub.key.public.encodeCompressed('hex'));
  });

  return {
    id: id.toString(),
    identity: {
      pubkey: id.pubkey
    },
    derivation: input.derivation || DERIVATION,
    verified: true
  };
}

main().catch((exception) => {
  console.error('[FABRIC:IDENTITY]', 'Main Process Exception:', exception);
  process.exit(1);
}).then((output) => {
  if (output) {
    process.exit(0);
  }
});
