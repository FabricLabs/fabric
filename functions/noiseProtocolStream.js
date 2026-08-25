'use strict';

/**
 * @fileoverview Patched `noise-protocol-stream` 1.1.3 session factory.
 *
 * Upstream keeps one WASM EventEmitter for every session and only removes the
 * three `noise_stream_handshake_{write,read,split}` listeners from
 * `end-of-stream` with `{ error: false }`. Handshake `destroy(err)` plus the
 * wait-for-both-streams path after a successful split leave those listeners
 * (and `noise_stream` native ptrs) behind. Public Hub hit MaxListeners 65>64
 * within ~1h while named Hub retainers stayed flat.
 *
 * This copy: drop handshake listeners as soon as the split callback runs (the
 * session no longer needs the bus); always `noise_stream_free` when either
 * duplex is destroyed.
 */

const util = require('util');
const through = require('through2');
const lpStream = require('length-prefixed-stream');
const Duplexify = require('duplexify');
const each = require('stream-each');
const eos = require('end-of-stream');

const createNoiseLib = require('noise-protocol-stream/noise-stream');

const PTR_SIZE = 4;
const MESSAGE_SIZE = 65535;

const lib = createNoiseLib();
const heap = lib.heap;

const HANDSHAKE_WRITE = 'noise_stream_handshake_write';
const HANDSHAKE_READ = 'noise_stream_handshake_read';
const HANDSHAKE_SPLIT = 'noise_stream_handshake_split';

let liveNativeStreams = 0;

/**
 * @returns {{ write: number, read: number, split: number }}
 */
function countHandshakeListeners () {
  if (!lib || typeof lib.listenerCount !== 'function') {
    return { write: 0, read: 0, split: 0 };
  }
  return {
    write: lib.listenerCount(HANDSHAKE_WRITE),
    read: lib.listenerCount(HANDSHAKE_READ),
    split: lib.listenerCount(HANDSHAKE_SPLIT)
  };
}

/**
 * In-process count of `noise_stream_new` pointers not yet `noise_stream_free`.
 * @returns {number}
 */
function countNativeStreams () {
  return liveNativeStreams;
}

function createError (s, code) {
  return new Error(s + (code != null ? (' ' + code) : ''));
}

function pointer () {
  return lib.malloc(PTR_SIZE);
}

function dereference (ptr) {
  const buf = Buffer.from(heap.buffer, ptr, PTR_SIZE);
  return buf.readUInt32LE(0);
}

function copymem (src, srcOffset, ptr, size) {
  if (!Buffer.isBuffer(src)) src = Buffer.from(src);
  src = src.slice(srcOffset, srcOffset + size);
  heap.set(src, ptr);
}

function writemem (src) {
  if (!Buffer.isBuffer(src)) src = Buffer.from(src);
  const ptr = lib.malloc(src.length);
  if (ptr) heap.set(src, ptr);
  return ptr;
}

function readmem (ptr, size, dest, destOffset) {
  const buf = heap.slice(ptr, ptr + size);
  if (!dest) dest = Buffer.from(buf);
  else dest.set(buf, destOffset || 0);
  return dest;
}

function DecryptStream () {
  Duplexify.call(this);

  const self = this;
  const decode = lpStream.decode();
  const pass = through();

  decode.on('end', function () {
    pass.end();
  });

  each(decode, function (data, next) {
    if (self.destroyed) {
      if (typeof next === 'function') next();
      return;
    }
    if (self._streamPtr) {
      self._writeOutput(data, next);
    } else if (self._handshakeCb) {
      const cb = self._handshakeCb;
      self._handshakeCb = null;
      cb(data);
      next();
    } else {
      self._inputData = data;
      self._inputCb = next;
    }
  });

  this._input = decode;
  this._output = pass;
  this._inputData = null;
  this._inputCb = null;
  this._handshakeCb = null;
  this._streamPtr = null;
  this._macSize = 0;

  this.setWritable(decode);
  this.setReadable(pass);
}

util.inherits(DecryptStream, Duplexify);

DecryptStream.prototype._readHandshake = function (cb) {
  const ondrain = function (data, next) {
    cb(data);
    next();
  };

  if (this._inputData) this._drainInput(ondrain);
  else this._handshakeCb = cb;
};

DecryptStream.prototype._splitHandshake = function (ptr, macSize) {
  this._streamPtr = ptr;
  this._macSize = macSize;
  if (this._inputData) this._drainInput(this._writeOutput.bind(this));
};

DecryptStream.prototype._drainInput = function (cb) {
  const data = this._inputData;
  const next = this._inputCb;
  this._inputData = this._inputCb = null;
  cb(data, next);
};

DecryptStream.prototype._writeOutput = function (data, cb) {
  if (!this._streamPtr) {
    cb(createError('noise_stream_decrypt', 'stream freed'));
    return;
  }
  let n;
  let dataPtr;
  let buffer;
  let dataOffset;
  let dataSize;
  let err;

  n = Math.ceil(data.length / MESSAGE_SIZE);
  dataPtr = writemem(data);

  if (dataPtr) {
    buffer = Buffer.alloc(data.length - n * this._macSize);

    error: {
      for (let i = 0; i < n; i++) {
        dataOffset = dataPtr + i * MESSAGE_SIZE;
        dataSize = i === (n - 1)
          ? (data.length - (n - 1) * MESSAGE_SIZE)
          : MESSAGE_SIZE;

        err = lib.noise_stream_decrypt(this._streamPtr, dataOffset, dataSize, 0);

        if (!err) {
          readmem(dataOffset, dataSize - this._macSize, buffer, i * (MESSAGE_SIZE - this._macSize));
        } else {
          cb(createError('noise_stream_decrypt', err));
          break error;
        }
      }

      this._output.write(buffer, cb);
    }

    lib.free(dataPtr);
  } else {
    cb(createError('malloc'));
  }
};

function EncryptStream () {
  Duplexify.call(this);

  const pass = through();
  const encode = lpStream.encode();

  pass.on('end', function () {
    encode.end();
  });

  this._input = pass;
  this._output = encode;

  this.setWritable(pass);
  this.setReadable(encode);
  this._streamPtr = null;
}

util.inherits(EncryptStream, Duplexify);

EncryptStream.prototype._writeHandshake = function (data) {
  this._output.write(data);
};

EncryptStream.prototype._splitHandshake = function (ptr, macSize) {
  const self = this;
  this._streamPtr = ptr;

  each(this._input, function (data, next) {
    if (self.destroyed || !self._streamPtr) {
      if (typeof next === 'function') next();
      return;
    }

    let n;
    let totalSize;
    let dataPtr;
    let dataOffset;
    let dataSize;
    let err;
    const sessionPtr = self._streamPtr;

    n = Math.ceil(data.length / (MESSAGE_SIZE - macSize));
    totalSize = data.length + n * macSize;
    dataPtr = lib.malloc(totalSize);

    if (dataPtr) {
      error: {
        for (let i = 0; i < n; i++) {
          dataOffset = dataPtr + i * MESSAGE_SIZE;
          dataSize = i === (n - 1)
            ? (data.length - (n - 1) * (MESSAGE_SIZE - macSize))
            : (MESSAGE_SIZE - macSize);

          copymem(data, i * (MESSAGE_SIZE - macSize), dataOffset, dataSize);

          err = lib.noise_stream_encrypt(sessionPtr, dataOffset, dataSize, 0);

          if (err) {
            next(createError('noise_stream_encrypt', err));
            break error;
          }
        }

        self._output.write(readmem(dataPtr, totalSize), next);
      }

      lib.free(dataPtr);
    } else {
      next(createError('malloc'));
    }
  });
};

/**
 * @param {Object} [options]
 * @returns {{ decrypt: stream.Duplex, encrypt: stream.Duplex }}
 */
function createNoiseStream (options) {
  if (!options) options = {};

  let streamPtr = null;
  let listenersDropped = false;
  let nativeFreed = false;
  const decrypt = new DecryptStream();
  const encrypt = new EncryptStream();

  const dropHandshakeListeners = function () {
    if (listenersDropped) return;
    listenersDropped = true;
    lib.removeListener('ready', onready);
    lib.removeListener(HANDSHAKE_WRITE, onhandshakewrite);
    lib.removeListener(HANDSHAKE_READ, onhandshakeread);
    lib.removeListener(HANDSHAKE_SPLIT, onhandshakesplit);
  };

  const freeNative = function () {
    dropHandshakeListeners();
    if (nativeFreed) return;
    nativeFreed = true;
    decrypt._streamPtr = null;
    encrypt._streamPtr = null;
    if (streamPtr) {
      try {
        lib.noise_stream_free(streamPtr);
      } catch (_) { /* ignore */ }
      streamPtr = null;
      if (liveNativeStreams > 0) liveNativeStreams -= 1;
    }
  };

  const sessionTornDown = function () {
    return nativeFreed || (decrypt.destroyed && encrypt.destroyed);
  };

  const onready = function () {
    if (sessionTornDown()) return;
    let err;
    let streamPtrPtr;
    let prologuePtr;
    let privateKeyPtr;

    streamPtrPtr = pointer();

    if (streamPtrPtr) {
      if (options.prologue != null) prologuePtr = writemem(options.prologue);
      if (options.prologue == null || prologuePtr) {
        if (options.privateKey != null) privateKeyPtr = writemem(options.privateKey);
        if (options.privateKey == null || privateKeyPtr) {
          err = lib.noise_stream_new(
            streamPtrPtr,
            options.initiator ? 1 : 0,
            prologuePtr,
            prologuePtr ? Buffer.byteLength(options.prologue) : 0,
            privateKeyPtr,
            privateKeyPtr ? Buffer.byteLength(options.privateKey) : 0);

          if (!err) {
            streamPtr = dereference(streamPtrPtr);
            if (sessionTornDown()) {
              try { lib.noise_stream_free(streamPtr); } catch (_) { /* ignore */ }
              streamPtr = null;
              decrypt._streamPtr = null;
              encrypt._streamPtr = null;
            } else {
              liveNativeStreams += 1;
              err = lib.noise_stream_initialize(streamPtr);
              if (err) destroy('noise_stream_initialize', err);
            }
          } else {
            destroy('noise_stream_new', err);
          }

          if (privateKeyPtr) lib.free(privateKeyPtr);
        } else {
          destroy('malloc');
        }

        if (prologuePtr) lib.free(prologuePtr);
      } else {
        destroy('malloc');
      }

      lib.free(streamPtrPtr);
    } else {
      destroy('malloc');
    }
  };

  const onhandshakewrite = function (ptr, buf) {
    if (ptr === streamPtr) encrypt._writeHandshake(buf);
  };

  const onhandshakeread = function (ptr) {
    if (ptr === streamPtr) {
      decrypt._readHandshake(function (buf) {
        let bufPtr;
        let err;

        bufPtr = writemem(buf);

        if (bufPtr) {
          err = lib.noise_stream_handhshake_read(ptr, bufPtr, buf.length);
          if (err) destroy('noise_stream_handhshake_read', err);
          lib.free(bufPtr);
        } else {
          destroy('malloc');
        }
      });
    }
  };

  const onhandshakesplit = function (ptr, macSize, localPrivateKey, localPublicKey, remotePublicKey) {
    if (ptr === streamPtr) {
      const onverify = function (err, accept) {
        // `options.verify` may be asynchronous, so both duplexes can be destroyed
        // (and the native session freed) before this runs. Never restore a pointer
        // that is no longer ours.
        if (sessionTornDown() || ptr !== streamPtr) return;
        if (!err && accept === true) {
          decrypt._splitHandshake(ptr, macSize);
          encrypt._splitHandshake(ptr, macSize);
          dropHandshakeListeners();
          decrypt.emit('handshake', localPrivateKey, localPublicKey, remotePublicKey);
          encrypt.emit('handshake', localPrivateKey, localPublicKey, remotePublicKey);
        } else {
          decrypt.destroy(err);
          encrypt.destroy(err);
        }
      };

      if (options.verify) options.verify(localPrivateKey, localPublicKey, remotePublicKey, onverify);
      else onverify(null, true);
    }
  };

  const destroy = function (s, code) {
    const err = createError(s, code);
    decrypt.destroy(err);
    encrypt.destroy(err);
  };

  const wrapDestroy = function (stream) {
    const orig = stream.destroy;
    if (typeof orig !== 'function') return;
    stream.destroy = function (err) {
      freeNative();
      return orig.call(this, err);
    };
  };

  wrapDestroy(decrypt);
  wrapDestroy(encrypt);

  lib.on(HANDSHAKE_WRITE, onhandshakewrite);
  lib.on(HANDSHAKE_READ, onhandshakeread);
  lib.on(HANDSHAKE_SPLIT, onhandshakesplit);

  eos(decrypt, { error: true }, function () { freeNative(); });
  eos(encrypt, { error: true }, function () { freeNative(); });

  if (lib.ready) process.nextTick(onready);
  else lib.once('ready', onready);
  return { decrypt: decrypt, encrypt: encrypt };
}

createNoiseStream.supported = createNoiseLib.supported;
createNoiseStream.countHandshakeListeners = countHandshakeListeners;
createNoiseStream.countNativeStreams = countNativeStreams;

module.exports = createNoiseStream;
module.exports.countHandshakeListeners = countHandshakeListeners;
module.exports.countNativeStreams = countNativeStreams;
module.exports.supported = createNoiseLib.supported;
