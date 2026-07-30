'use strict';

const assert = require('assert');
const path = require('path');
const Module = require('module');
const { describe, it } = require('mocha');

/**
 * Patch Module._load so requires matching `match` throw `error`.
 * Restores the original loader in `finally`.
 * @param {(request: string) => boolean} match
 * @param {Error} error
 * @param {() => void} fn
 */
function withModuleLoadFailure (match, error, fn) {
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    if (match(String(request))) throw error;
    return orig.call(this, request, parent, isMain);
  };
  try {
    return fn();
  } finally {
    Module._load = orig;
  }
}

function isSettingsLocal (request) {
  const n = request.replace(/\\/g, '/');
  return n.includes('/settings/local') && !n.includes('local.example');
}

function isSettingsLocalExample (request) {
  const n = request.replace(/\\/g, '/');
  return n.includes('/settings/local.example');
}

describe('@fabric/core functions/loadLocalSettings', function () {
  const { loadLocalSettings } = require('../functions/loadLocalSettings');

  it('returns an object (local.js or packaged local.example.js)', function () {
    const settings = loadLocalSettings();
    assert.ok(settings && typeof settings === 'object');
    assert.ok(!Array.isArray(settings));
  });

  it('local.example.js is requireable for npm packaging', function () {
    const example = require('../settings/local.example');
    assert.strictEqual(typeof example, 'object');
    assert.ok(example.port === 7777 || typeof example.port === 'string' || typeof example.port === 'number');
  });

  it('example path is under settings/ for package files whitelist', function () {
    const abs = require.resolve('../settings/local.example');
    assert.ok(abs.includes(`${path.sep}settings${path.sep}local.example`));
  });

  it('falls back to local.example when settings/local is MODULE_NOT_FOUND', function () {
    const err = new Error("Cannot find module '../settings/local'");
    err.code = 'MODULE_NOT_FOUND';
    const settings = withModuleLoadFailure(isSettingsLocal, err, () => loadLocalSettings());
    assert.ok(settings && typeof settings === 'object');
    assert.strictEqual(settings.port, process.env.FABRIC_PORT || 7777);
    assert.ok('network' in settings);
  });

  it('returns {} when both local and local.example are missing', function () {
    const missing = new Error('missing');
    missing.code = 'MODULE_NOT_FOUND';
    const settings = withModuleLoadFailure(
      (r) => isSettingsLocal(r) || isSettingsLocalExample(r),
      missing,
      () => loadLocalSettings()
    );
    assert.deepStrictEqual(settings, {});
  });

  it('rethrows non-MODULE_NOT_FOUND errors from settings/local', function () {
    const err = new Error('permission denied');
    err.code = 'EACCES';
    assert.throws(
      () => withModuleLoadFailure(isSettingsLocal, err, () => loadLocalSettings()),
      (e) => e && e.code === 'EACCES'
    );
  });

  it('rethrows non-MODULE_NOT_FOUND errors from local.example after local miss', function () {
    const missing = new Error('no local');
    missing.code = 'MODULE_NOT_FOUND';
    const boom = new Error('example corrupt');
    boom.code = 'ERR_INVALID_PACKAGE_CONFIG';
    const orig = Module._load;
    Module._load = function (request, parent, isMain) {
      if (isSettingsLocal(String(request))) throw missing;
      if (isSettingsLocalExample(String(request))) throw boom;
      return orig.call(this, request, parent, isMain);
    };
    try {
      assert.throws(() => loadLocalSettings(), (e) => e && e.code === 'ERR_INVALID_PACKAGE_CONFIG');
    } finally {
      Module._load = orig;
    }
  });

  it('local.example reads FABRIC_DEBUG and FABRIC_NETWORK from env', function () {
    const prevDebug = process.env.FABRIC_DEBUG;
    const prevNet = process.env.FABRIC_NETWORK;
    try {
      process.env.FABRIC_DEBUG = '1';
      process.env.FABRIC_NETWORK = 'signet';
      delete require.cache[require.resolve('../settings/local.example')];
      const example = require('../settings/local.example');
      assert.strictEqual(example.debug, true);
      assert.strictEqual(example.network, 'signet');
    } finally {
      if (prevDebug === undefined) delete process.env.FABRIC_DEBUG;
      else process.env.FABRIC_DEBUG = prevDebug;
      if (prevNet === undefined) delete process.env.FABRIC_NETWORK;
      else process.env.FABRIC_NETWORK = prevNet;
      delete require.cache[require.resolve('../settings/local.example')];
    }
  });

  it('contracts/shell loads without throwing (uses loadLocalSettings)', function () {
    assert.doesNotThrow(() => {
      const shell = require('../contracts/shell');
      assert.strictEqual(typeof shell, 'function');
    });
  });
});
