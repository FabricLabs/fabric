'use strict';

/**
 * @fileoverview AMP opcodes are unique. Fabric owns the low numbers; Lightning
 * AMP types live in 0x2000–0x2FFF (POLICY.md). Encode name round-trips to the
 * same decode label.
 */

const assert = require('assert');
const Message = require('../types/message');
const {
  P2P_IDENT_REQUEST,
  P2P_IDENT_RESPONSE,
  P2P_PING,
  P2P_PONG,
  P2P_GENERIC,
  P2P_START_CHAIN,
  P2P_INSTRUCTION,
  P2P_STATE_COMMITTMENT,
  P2P_SESSION_ACK,
  LIGHTNING_WARNING,
  LIGHTNING_INIT,
  LIGHTNING_ERROR,
  LIGHTNING_PING,
  LIGHTNING_PONG,
  LIGHTNING_OPEN_CHANNEL,
  LIGHTNING_ACCEPT_CHANNEL,
  LIGHTNING_UPDATE_ADD_HTLC
} = require('../constants');

describe('@fabric/core AMP opcode catalog', function () {
  it('every WIRE_TYPE_DECODE_ORDER opcode is unique', function () {
    const seen = Object.create(null);
    for (const pair of Message.WIRE_TYPE_DECODE_ORDER) {
      const code = pair[0];
      const name = pair[1];
      if (typeof code !== 'number' || !Number.isFinite(code)) continue;
      assert.strictEqual(seen[code], undefined, `duplicate opcode ${code}: ${seen[code]} and ${name}`);
      seen[code] = name;
      assert.strictEqual(Message.canonicalTypeName(code), name);
    }
  });

  it('Fabric low numbers are not Lightning AMP opcodes', function () {
    const fabric = [
      [P2P_IDENT_REQUEST, 'P2P_IDENT_REQUEST'],
      [P2P_IDENT_RESPONSE, 'P2P_IDENT_RESPONSE'],
      [P2P_PING, 'P2P_PING'],
      [P2P_PONG, 'P2P_PONG'],
      [P2P_INSTRUCTION, 'P2P_INSTRUCTION'],
      [P2P_START_CHAIN, 'P2P_START_CHAIN'],
      [P2P_GENERIC, 'P2P_GENERIC'],
      [P2P_STATE_COMMITTMENT, 'P2P_STATE_COMMITTMENT'],
      [P2P_SESSION_ACK, 'P2P_SESSION_ACK']
    ];
    for (const row of fabric) {
      assert.strictEqual(Message.canonicalTypeName(row[0]), row[1]);
      assert.ok(row[0] < 0x2000 || row[0] === P2P_SESSION_ACK);
    }
    assert.strictEqual(P2P_SESSION_ACK, 0x4200);
  });

  it('Lightning AMP types occupy 0x2000–0x2013 and round-trip by name', function () {
    const rows = [
      ['LightningInit', LIGHTNING_INIT, 'LIGHTNING_INIT'],
      ['LightningError', LIGHTNING_ERROR, 'LIGHTNING_ERROR'],
      ['OpenChannel', LIGHTNING_OPEN_CHANNEL, 'LIGHTNING_OPEN_CHANNEL'],
      ['AcceptChannel', LIGHTNING_ACCEPT_CHANNEL, 'LIGHTNING_ACCEPT_CHANNEL'],
      ['UpdateAddHTLC', LIGHTNING_UPDATE_ADD_HTLC, 'LIGHTNING_UPDATE_ADD_HTLC'],
      ['LightningWarning', LIGHTNING_WARNING, 'LIGHTNING_WARNING'],
      ['LightningPing', LIGHTNING_PING, 'LIGHTNING_PING'],
      ['LightningPong', LIGHTNING_PONG, 'LIGHTNING_PONG']
    ];
    for (const row of rows) {
      assert.ok(row[1] >= 0x2000 && row[1] <= 0x2013, row[0]);
      const msg = Message.fromVector([row[0], 'x']);
      assert.strictEqual(msg.type, row[2]);
      assert.strictEqual(Message.fromBuffer(msg.toBuffer()).type, row[2]);
      assert.strictEqual(Message.canonicalTypeName(row[1]), row[2]);
    }
  });

  it('PeerInstruction round-trips as P2P_INSTRUCTION, not OpenChannel', function () {
    const msg = Message.fromVector(['PeerInstruction', 'x']);
    assert.strictEqual(msg.type, 'P2P_INSTRUCTION');
    assert.strictEqual(Message.fromBuffer(msg.toBuffer()).type, 'P2P_INSTRUCTION');
    assert.notStrictEqual(P2P_INSTRUCTION, LIGHTNING_OPEN_CHANNEL);
    const open = Message.fromVector(['OpenChannel', 'x']);
    assert.strictEqual(open.type, 'LIGHTNING_OPEN_CHANNEL');
  });
});
