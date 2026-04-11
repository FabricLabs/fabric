'use strict';

// Dependencies
const bitcoin = require('bitcoinjs-lib');
const { tryParseWireJson } = require('../functions/wireJson');

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
    this.subject = this.settings.subject ? this.settings.subject : this.ephemera.keypair.getPublic(true, 'hex');

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

    return Buffer.from(input, 'base64').toString('utf8');
  }

  static base64UrlDecodeToBuffer (input) {
    let s = input.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return Buffer.from(s, 'base64');
  }

  static base64UrlEncodeBuffer (input) {
    const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
    return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * Create a cryptographically signed token string.
   * Format: base64url(payload).base64url(signature)
   * Payload: { cap, iss, sub, iat, exp }. Signature: Schnorr over payload JSON.
   * @param {Object} [options]
   * @param {number} [options.expiresInSeconds=31536000] Token lifetime (default 1 year).
   * @returns {string}
   */
  toSignedString (options = {}) {
    const expiresInSeconds = options.expiresInSeconds ?? 365 * 24 * 60 * 60;
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + expiresInSeconds;
    const iss = this.issuer.public ? this.issuer.public.encodeCompressed('hex') : this.issuer.keypair.getPublic(true, 'hex');
    const payload = {
      cap: this.capability,
      iss,
      sub: this.settings.subject ?? this.subject,
      iat,
      exp
    };
    const payloadStr = JSON.stringify(payload);
    const payloadB64 = Token.base64UrlEncode(payloadStr);
    const signature = this.issuer.sign(payloadStr);
    const sigB64 = Token.base64UrlEncodeBuffer(Buffer.isBuffer(signature) ? signature : Buffer.from(signature));
    return `${payloadB64}.${sigB64}`;
  }

  /**
   * Verify a signed token string. Returns parsed payload if valid, null otherwise.
   * @param {string} tokenString
   * @param {Key} verificationKey Key used to verify the signature (must match issuer).
   * @returns {{ cap: string, iss: string, sub: string, iat: number, exp: number }|null}
   */
  static verifySigned (tokenString, verificationKey) {
    if (!tokenString || typeof tokenString !== 'string') return null;
    if (!verificationKey) return null;
    const parts = tokenString.split('.');
    if (parts.length !== 2) return null;
    try {
      const payloadStr = Token.base64UrlDecode(parts[0]);
      const pr = tryParseWireJson(payloadStr);
      if (!pr.ok) return null;
      const payload = pr.value;
      const sig = Token.base64UrlDecodeToBuffer(parts[1]);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !payload.iss || payload.exp == null) return null;
      if (Date.now() / 1000 > payload.exp) return null;
      const ourIss = verificationKey.public ? verificationKey.public.encodeCompressed('hex') : verificationKey.keypair.getPublic(true, 'hex');
      if (payload.iss !== ourIss) return null;
      if (!verificationKey.verify(payloadStr, sig)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  static fromString (input) {
    const parts = input.split('.');
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
    // Fabric Key: keypair.getPublic returns hex string; elliptic: returns Point with encodeCompressed
    const pub = this.issuer.keypair.getPublic(true);
    const issuer = typeof pub === 'string' ? pub : (pub && typeof pub.encodeCompressed === 'function' ? pub.encodeCompressed('hex') : '');
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
    const hash = bitcoin.crypto.sha256(Buffer.from(this.capability, 'utf8'));
    if (!this.issuer || typeof this.issuer.signSchnorrHash !== 'function') {
      throw new Error('Token.sign requires issuer Key with private material');
    }
    this.signature = this.issuer.signSchnorrHash(hash);
  }

  verify () {
    const hash = bitcoin.crypto.sha256(Buffer.from(this.capability, 'utf8'));
    if (!this.issuer || typeof this.issuer.verifySchnorrHash !== 'function') {
      return false;
    }
    if (!this.signature) return false;
    return this.issuer.verifySchnorrHash(hash, this.signature);
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
