'use strict';

// Dependencies
const bitcoin = require('bitcoinjs-lib');
const schnorr = require('bip-schnorr');

// Fabric Types
const Key = require('./key');

/**
 * Implements a capability-based security token.
 */
class Token {
  /**
   * Create a new Fabric Token.
   * @param {Object} [settings] Configuration.
   * @returns {Token} The token instance.
   */
  constructor (settings = {}) {
    // TODO: determine rounding preference (secwise)
    this.created = Date.now();
    this.settings = Object.assign({
      capability: 'OP_0',
      issuer: null,
      subject: null,
      state: {
        status: 'READY'
      }
    }, settings);

    // Capability
    this.capability = this.settings.capability;
    this.ephemera = new Key();

    // Trust Chain
    this.issuer = this.settings.issuer ? this.settings.issuer : this.ephemera;
    this.subject = this.settings.subject ? this.settings.subject : this.ephemera.keypair.getPublic(true).encodeCompressed('hex');

    // ECDSA Signature
    this.signature = null;

    // State
    this._state = {
      content: this.settings.state
    };

    return this;
  }

  get state () {
    return JSON.parse(JSON.stringify(this._state.content));
  }

  static base64UrlEncode (input) {
    const base64 = Buffer.from(input, 'utf8').toString('base64');
    return base64.replace('+', '-').replace('/', '_').replace(/=+$/, '');
  }

  static base64UrlDecode (input) {
    input = input.replace(/-/g, '+').replace(/_/g, '/');

    while (input.length % 4) {
      input += '=';
    }

    return Buffer.from(input, 'base64').toString();
  }

  static fromString (input) {
    const parts = input.split('.');
    const headers = parts[0];
    const payload = parts[1];
    const signature = parts[2];
    const inner = Token.base64UrlDecode(payload);

    return new Token({
      capability: inner.cap,
      issuer: inner.iss,
      subject: inner.sub,
      state: inner.state,
      signature: signature
    });
  }

  toString () {
    // TODO: determine rounding preference (secwise)
    const utime = Math.floor(this.created / 1000);
    const issuer = this.issuer.keypair.getPublic(true).encodeCompressed('hex');
    const header = {
      alg: 'ES256K',
      iss: issuer,
      typ: 'JWT'
    };

    const payload = {
      cap: this.capability,
      iat: utime,
      iss: issuer,
      sub: this.subject,
      state: this.state
    };

    // TODO: reconcile with JWT spec
    // alternatively, since we're already breaking spec,
    // we can diverge again here.
    // Secret: HS256
    const secret = 'ffff';

    // Encodings
    const encodedHeader = Token.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = Token.base64UrlEncode(JSON.stringify(payload));
    const signature = bitcoin.crypto.sha256(
      Buffer.from(`${encodedHeader}.${encodedPayload}.${secret}`)
    );

    return [
      encodedHeader,
      encodedPayload,
      Token.base64UrlEncode(signature.toString('hex'))
    ].join('.');
  }

  sign () {
    // Sign the capability using the private key
    const hash = bitcoin.crypto.sha256(this.capability);
    this.signature = schnorr.sign(this.issuer.privateKey, hash);
  }

  verify () {
    // Verify the signature using the public key
    const hash = bitcoin.crypto.sha256(this.capability);
    return schnorr.verify(this.issuer.publicKey, hash, this.signature);
  }

  add (other) {
    const combinedCapability = [this.capability, other.capability].join(' ');
    const combinedToken = new Token({
      capability: combinedCapability,
      issuer: this.issuer.publicKey
    });

    /* combinedToken.signature = schnorr.combine([
      this.signature,
      other.signature
    ]); */

    return combinedToken;
  }
}

module.exports = Token;
