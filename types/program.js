'use strict';

/**
 * Multi-language Program — executable artifact for {@link Machine}, with optional
 * L1 Bitcoin redeem scaffolding for `bitcoin-script`.
 *
 * Languages: `fabric-opcodes` | `javascript` | `bitcoin-script` | `solidity` | `asm`
 * (solidity/asm compile stubs until Compiler frontends land).
 *
 * @see docs/PROGRAM.md
 */

const crypto = require('crypto');
const Circuit = require('./circuit');
const Script = require('./script');
const Hash256 = require('./hash256');
const fabricCanonicalJson = require('../functions/fabricCanonicalJson');
const { jsonSafe } = fabricCanonicalJson;

const LANGUAGES = Object.freeze([
  'fabric-opcodes',
  'javascript',
  'bitcoin-script',
  'solidity',
  'asm'
]);

class Program extends Circuit {
  /**
   * @param {object} [settings]
   * @param {string} [settings.language]
   * @param {string|object} [settings.source]
   * @param {*} [settings.bytecode]
   * @param {string[]} [settings.steps]
   * @param {string} [settings.programId]
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      language: 'fabric-opcodes',
      source: null,
      bytecode: null,
      steps: [],
      instructions: [],
      programId: null
    }, settings);

    this.circuit = new Circuit();
    this.script = new Script();
    this.state = {};

    if (Array.isArray(this.settings.instructions) && this.settings.instructions.length &&
        !(this.settings.steps && this.settings.steps.length)) {
      this.settings.steps = this.settings.instructions.slice();
    }

    return this;
  }

  /**
   * @param {Object} [opts]
   * @param {string} [opts.language]
   * @param {*} [opts.source]
   * @param {*} [opts.bytecode]
   * @param {Array.<string>} [opts.steps]
   * @param {string} [opts.programId]
   * @returns {Program}
   */
  static from (opts = {}) {
    return new Program(opts);
  }

  get language () {
    return String(this.settings.language || 'fabric-opcodes');
  }

  get source () {
    return this.settings.source;
  }

  get bytecode () {
    return this.settings.bytecode;
  }

  get steps () {
    return Array.isArray(this.settings.steps) ? this.settings.steps : [];
  }

  get programId () {
    if (this.settings.programId) return String(this.settings.programId);
    return this.programHash.slice(0, 32);
  }

  get programHash () {
    return this.hash();
  }

  /**
   * Content-address of language + source/bytecode/steps.
   * @returns {string} 64-char hex
   */
  hash () {
    const body = fabricCanonicalJson({
      language: this.language,
      source: this.settings.source != null ? jsonSafe(this.settings.source) : null,
      bytecode: this.settings.bytecode != null ? jsonSafe(this.settings.bytecode) : null,
      steps: this.steps
    });
    return Hash256.compute(Buffer.from(body, 'utf8'));
  }

  toJSON () {
    return {
      language: this.language,
      source: this.settings.source,
      bytecode: this.settings.bytecode,
      steps: this.steps.slice(),
      programId: this.programId,
      programHash: this.programHash
    };
  }

  /**
   * Normalize language-specific form into `steps` / `bytecode`.
   * @returns {{ok: boolean, error: (string|undefined), program: (Program|undefined)}}
   */
  compile () {
    const lang = this.language;
    if (!LANGUAGES.includes(lang)) {
      return { ok: false, error: `unsupported language: ${lang}` };
    }

    if (lang === 'fabric-opcodes') {
      let steps = this.steps.slice();
      if (!steps.length && typeof this.settings.source === 'string') {
        steps = this.settings.source.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      } else if (!steps.length && Array.isArray(this.settings.source)) {
        steps = this.settings.source.map(String);
      }
      this.settings.steps = steps;
      this.settings.bytecode = steps.slice();
      this.settings.instructions = steps.slice();
      return { ok: true, program: this };
    }

    if (lang === 'javascript') {
      let steps = this.steps.slice();
      if (!steps.length && typeof this.settings.source === 'string') {
        steps = this.settings.source.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      } else if (!steps.length && this.settings.source && typeof this.settings.source === 'object') {
        steps = Object.keys(this.settings.source);
      }
      this.settings.steps = steps;
      this.settings.bytecode = steps.slice();
      return { ok: true, program: this };
    }

    if (lang === 'bitcoin-script') {
      try {
        const bitcoin = require('bitcoinjs-lib');
        let compiled = null;
        if (Buffer.isBuffer(this.settings.bytecode)) {
          compiled = this.settings.bytecode;
        } else if (typeof this.settings.bytecode === 'string' && /^[0-9a-fA-F]+$/.test(this.settings.bytecode)) {
          compiled = Buffer.from(this.settings.bytecode, 'hex');
        } else if (Array.isArray(this.settings.source)) {
          compiled = bitcoin.script.compile(this.settings.source);
        } else if (typeof this.settings.source === 'string') {
          const parts = this.settings.source.trim().split(/\s+/).filter(Boolean);
          const chunks = parts.map((p) => {
            if (p.startsWith('OP_') && bitcoin.opcodes[p] != null) return bitcoin.opcodes[p];
            if (/^[0-9a-fA-F]+$/.test(p) && p.length % 2 === 0) return Buffer.from(p, 'hex');
            throw new Error(`unrecognized script token: ${p}`);
          });
          compiled = bitcoin.script.compile(chunks);
        } else {
          return { ok: false, error: 'bitcoin-script requires source asm string, opcode array, or bytecode hex' };
        }
        this.settings.bytecode = compiled;
        this.settings.steps = ['OP_CHECKREDEEM'];
        return { ok: true, program: this };
      } catch (err) {
        return {
          ok: false,
          error: err && err.message ? err.message : 'bitcoin-script compile failed'
        };
      }
    }

    if (lang === 'solidity' || lang === 'asm') {
      return {
        ok: false,
        error: `${lang} compile not implemented — use Compiler frontend when available`
      };
    }

    return { ok: false, error: `unsupported language: ${lang}` };
  }

  /**
   * L1 redeem script scaffold (bitcoin-script only).
   * @returns {{ok: boolean, error: (string|undefined), scriptHex: (string|undefined), asm: (string|undefined)}}
   */
  toRedeemScript () {
    if (this.language !== 'bitcoin-script') {
      return { ok: false, error: 'toRedeemScript requires language bitcoin-script' };
    }
    const compiled = this.compile();
    if (!compiled.ok) return { ok: false, error: compiled.error };
    const buf = Buffer.isBuffer(this.settings.bytecode)
      ? this.settings.bytecode
      : Buffer.from(String(this.settings.bytecode || ''), 'hex');
    let asm = null;
    try {
      const bitcoin = require('bitcoinjs-lib');
      asm = bitcoin.script.toASM(buf);
    } catch (_) {
      asm = null;
    }
    return {
      ok: true,
      scriptHex: buf.toString('hex'),
      asm
    };
  }

  /**
   * Stable digest binding program identity to a compute result (L1 / OP_RETURN / witness).
   * @param {*} result
   * @returns {string} 64-char hex
   */
  runCommitmentHex (result) {
    const body = fabricCanonicalJson({
      version: 1,
      kind: 'FabricProgramRun',
      programHash: this.programHash,
      result: jsonSafe(result == null ? null : result)
    });
    return crypto.createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
  }

  step () {
    return this;
  }

  async start () {
    return this;
  }
}

Program.LANGUAGES = LANGUAGES;

module.exports = Program;
