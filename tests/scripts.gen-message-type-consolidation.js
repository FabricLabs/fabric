'use strict';

/**
 * @fileoverview FABRIC_MESSAGE_TYPE_CONSOLIDATION.md is generated from
 * WIRE_TYPE_DECODE_ORDER. Regenerate with npm run docs:message-types.
 */

const assert = require('assert');
const fs = require('fs');
const Message = require('../types/message');
const {
  OUTPUT_PATH,
  collectCatalog,
  renderMarkdown
} = require('../scripts/gen-message-type-consolidation');

describe('FABRIC_MESSAGE_TYPE_CONSOLIDATION.md', function () {
  it('matches live WIRE_TYPE_DECODE_ORDER', function () {
    const rows = collectCatalog();
    assert.strictEqual(rows.length, Message.WIRE_TYPE_DECODE_ORDER.length);
    for (let i = 0; i < rows.length; i++) {
      const pair = Message.WIRE_TYPE_DECODE_ORDER[i];
      assert.strictEqual(rows[i].opcode, pair[0], rows[i].name);
      assert.strictEqual(rows[i].name, pair[1]);
    }
    const seen = Object.create(null);
    for (const row of rows) {
      assert.strictEqual(seen[row.opcode], undefined, `duplicate opcode ${row.opcode}`);
      seen[row.opcode] = row.name;
    }
    const ping = rows.find((row) => row.name === 'P2P_PING');
    assert.ok(ping && ping.aliases.indexOf('Ping') !== -1);
    const instruction = rows.find((row) => row.name === 'P2P_INSTRUCTION');
    assert.ok(instruction && instruction.aliases.indexOf('PeerInstruction') !== -1);
    const publish = rows.find((row) => row.name === 'CONTRACT_PUBLISH');
    assert.ok(publish && publish.aliases.indexOf('P2P_CONTRACT_PUBLISH') !== -1);
    const expected = renderMarkdown(rows);
    const actual = fs.readFileSync(OUTPUT_PATH, 'utf8');
    assert.strictEqual(actual, expected);
  });
});
