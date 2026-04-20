'use strict';

const crypto = require('crypto');

const Actor = require('../actor');
const Key = require('../key');
// TODO: PSBTs
// PSBT support remains future work (see JS-PLAN / Bitcoin service).
function rawTransactionBuffer (raw) {
  if (raw == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(raw)) return raw;
  const s = String(raw).replace(/\s+/g, '');
  if (!s.length || s.length % 2 !== 0) return Buffer.alloc(0);
  try {
    return Buffer.from(s, 'hex');
  } catch {
    return Buffer.alloc(0);
  }
}

function bitcoinTxidHex (buf) {
  const h = crypto.createHash('sha256').update(buf).digest();
  const h2 = crypto.createHash('sha256').update(h).digest();
  return Buffer.from(h2).reverse().toString('hex');
}

function doubleSha256Hex (buf) {
  const h = crypto.createHash('sha256').update(buf).digest();
  return crypto.createHash('sha256').update(h).digest('hex');
}

class BitcoinTransaction extends Actor {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      raw: null
    }, settings);

    this.holder = new Key(this.settings.key);

    this.inputs = [];
    this.outputs = [];
    this.script = null;
    this.signature = null;

    this._state = {
      content: {
        raw: this.settings.raw != null ? this.settings.raw : null
      },
      status: 'PAUSED'
    };

    return this;
  }

  _rawBuf () {
    return rawTransactionBuffer(this.settings.raw);
  }

  get hash () {
    return doubleSha256Hex(this._rawBuf());
  }

  get id () {
    return this.txid;
  }

  get txid () {
    return bitcoinTxidHex(this._rawBuf());
  }

  signAsHolder () {
    const digestHex = doubleSha256Hex(this._rawBuf());
    this.signature = this.holder.sign(digestHex);
    return this;
  }
}

module.exports = BitcoinTransaction;
