#!/usr/bin/env node
'use strict';

/**
 * @fileoverview Generate FABRIC_MESSAGE_TYPE_CONSOLIDATION.md from
 * Message.WIRE_TYPE_DECODE_ORDER. Run: npm run docs:message-types
 */

const fs = require('fs');
const path = require('path');
const Message = require('../types/message');
require('../functions/documentRegistrySidechain');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'FABRIC_MESSAGE_TYPE_CONSOLIDATION.md');

/**
 * @param {number} n
 * @returns {string}
 */
function hexOf (n) {
  const h = n.toString(16);
  if (n <= 0xffff) return '0x' + h.padStart(4, '0');
  return '0x' + h;
}

/**
 * @param {string} name
 * @param {number} code
 * @returns {string}
 */
function familyOf (name, code) {
  if (name.indexOf('LIGHTNING_') === 0) return 'lightning';
  if (name.indexOf('BITCOIN_') === 0) return 'bitcoin';
  if (name === 'SIDECHAIN_STATE_PATCH' || name.indexOf('CONTRACT_') === 0) return 'contracts';
  if (
    name.indexOf('DOCUMENT_') === 0 ||
    name === 'P2P_INVENTORY_REQUEST' ||
    name === 'P2P_INVENTORY_RESPONSE' ||
    name === 'P2P_FILE_SEND' ||
    name === 'P2P_DOCUMENT_PUBLISH'
  ) {
    return 'documents';
  }
  if (
    name === 'JSON_CALL' ||
    name === 'JSON_PATCH' ||
    name === 'GENERIC_MESSAGE' ||
    name === 'P2P_MESSAGE_RECEIPT' ||
    name === 'CHAT_MESSAGE'
  ) {
    return 'hub';
  }
  if (
    name.indexOf('P2P_SESSION_') === 0 ||
    name.indexOf('P2P_IDENT_') === 0 ||
    name.indexOf('P2P_MUSIG_') === 0 ||
    name === 'P2P_INSTRUCTION'
  ) {
    return 'session';
  }
  if (
    name === 'LOG_MESSAGE' ||
    name === 'GENERIC_LIST' ||
    name === 'BLOCK_CANDIDATE' ||
    name === 'PEER_CANDIDATE' ||
    name === 'SESSION_START' ||
    name === 'P2P_BASE_MESSAGE' ||
    name === 'P2P_GENERIC' ||
    name === 'P2P_START_CHAIN' ||
    name === 'P2P_STATE_ROOT' ||
    name === 'P2P_STATE_COMMITTMENT' ||
    name === 'P2P_STATE_CHANGE' ||
    name === 'P2P_STATE_REQUEST' ||
    name === 'P2P_TRANSACTION' ||
    name === 'P2P_CALL'
  ) {
    return 'legacy';
  }
  if (code >= 0x2000 && code <= 0x2fff) return 'lightning';
  return 'mesh';
}

/**
 * @returns {Array<{ name: string, opcode: number, hex: string, aliases: string[], schema: boolean, family: string }>}
 */
function collectCatalog () {
  const aliasesByCode = Object.create(null);
  // Instance getter: canonical names + LEGACY_MESSAGE_TYPE_ALIASES.
  const types = new Message().types;
  for (const name of Object.keys(types)) {
    const code = types[name];
    if (typeof code !== 'number' || !Number.isFinite(code)) continue;
    const decode = Message.canonicalTypeName(code);
    if (!decode || name === decode) continue;
    if (!aliasesByCode[code]) aliasesByCode[code] = [];
    if (aliasesByCode[code].indexOf(name) === -1) aliasesByCode[code].push(name);
  }
  for (const code of Object.keys(aliasesByCode)) {
    aliasesByCode[code].sort();
  }

  const rows = [];
  for (const pair of Message.WIRE_TYPE_DECODE_ORDER) {
    const code = pair[0];
    const name = pair[1];
    if (typeof code !== 'number' || !Number.isFinite(code)) continue;
    const schema = Message.getBodySchema(code) || Message.getBodySchema(name);
    rows.push({
      name,
      opcode: code,
      hex: hexOf(code),
      aliases: aliasesByCode[code] ? aliasesByCode[code].slice() : [],
      schema: Array.isArray(schema) && schema.length > 0,
      family: familyOf(name, code)
    });
  }
  return rows;
}

/**
 * @param {Array<{ name: string, opcode: number, hex: string, aliases: string[], schema: boolean, family: string }>} rows
 * @returns {string}
 */
function renderTable (rows) {
  const lines = [
    '| Decode name | Dec | Hex | Encode aliases | Field schema | Family |',
    '|---|---:|---|---|---|---|'
  ];
  for (const row of rows) {
    const aliases = row.aliases.length ? '`' + row.aliases.join('`, `') + '`' : '—';
    lines.push(
      `| \`${row.name}\` | ${row.opcode} | \`${row.hex}\` | ${aliases} | ${row.schema ? 'yes' : 'no'} | ${row.family} |`
    );
  }
  return lines.join('\n');
}

/**
 * @param {Array<{ name: string, opcode: number, hex: string, aliases: string[], schema: boolean, family: string }>} rows
 * @returns {string}
 */
function renderMarkdown (rows) {
  const unique = new Set(rows.map((row) => row.opcode));
  const withSchema = rows.filter((row) => row.schema).length;
  const lightning = rows.filter((row) => row.family === 'lightning').length;

  return `# Fabric Message Type Consolidation

Generated from \`types/message.js\` \`WIRE_TYPE_DECODE_ORDER\`. **Do not hand-edit the catalog table.**

\`\`\`
npm run docs:message-types
\`\`\`

Mocha asserts this file matches the live decode order (\`tests/scripts.gen-message-type-consolidation.js\`).

See also [\`MESSAGES.md\`](MESSAGES.md) (purpose notes), [\`POLICY.md\`](POLICY.md) (relay / Lightning AMP range), [\`docs/MESSAGE_BODY.md\`](docs/MESSAGE_BODY.md) (typed bodies).

## Purpose

V1 is a **freeze**, not a new opcode set. Wire version stays \`0x01\` (208-byte header). Consolidation means:

1. **One decode name per opcode.** Encode aliases are allowed; they must round-trip to that decode label.
2. **Typed field bodies** on mesh-originated types. JSON belongs at \`@fabric/http\`. Exceptions: chat/alias UTF-8, \`P2P_RELAY\` raw inner AMP, \`JSON_CALL\` at the Hub edge.
3. **Application events stay inside \`CONTRACT_MESSAGE\`.** Do not give MissionBroadcast, GroupChat, IdentityCrossSign, etc. their own outer opcodes.
4. **Do not pack Fabric types into a gapless \`0x01, 0x02, …\` sequence** — that would break playnet.

## Closed (opcode uniqueness)

Lightning Fabric-Message types live in \`0x2000–0x2013\` (\`POLICY.md\`). Fabric keeps the low numbers (\`P2P_PING\` \`0x12\`, \`P2P_INSTRUCTION\` \`0x20\`, \`P2P_GENERIC\` \`0x80\`, …). Duplicate opcodes fail at \`Message\` module load. \`P2P_INSTRUCTION\`, \`P2P_STATE_COMMITTMENT\`, and \`P2P_SESSION_ACK\` are first-class decode names.

BOLT-on-lightningd is unchanged. Old Lightning AMP frames that used BOLT numbers will not decode as Lightning types. Mesh chat / gossip / peering opcodes did not move.

This catalog: **${rows.length}** decode names, **${unique.size}** unique opcodes, **${withSchema}** with a registered field schema, **${lightning}** Lightning AMP rows.

## Dual carriers (do not merge numbers)

| Keep | Transitional / other | Rule |
|---|---|---|
| \`P2P_CHAT_MESSAGE\` \`0x68\` | \`CHAT_MESSAGE\` \`0x67\` | Originate mesh shoutbox on \`0x68\` only. \`0x67\` is Hub cache. |
| \`P2P_DOCUMENT_PUBLISH\` \`0x5a\` | \`DOCUMENT_PUBLISH\` \`998\` | Two jobs (mesh pricing vs document descriptor). Keep both opcodes. |
| \`P2P_INVENTORY_REQUEST\` / \`RESPONSE\` | JSON \`INVENTORY_*\` on \`P2P_BASE_MESSAGE\` / \`GENERIC_MESSAGE\` | Originate new inventory on the first-class opcodes. |
| \`CONTRACT_PUBLISH\` / \`CONTRACT_MESSAGE\` / \`CONTRACT_PROPOSAL\` | \`P2P_CONTRACT_*\` encode aliases | Decode names stay \`CONTRACT_*\`. Correct. |

Hub \`functions/fabricMessageRegistry.js\` still lists gossip, peering offer, and file send as inner-pending, and invents \`JSONBlob\` \`15104\`. Those rows are **not** in this catalog until core registers them.

## Not registered (by design)

| Name | Notes |
|---|---|
| \`HEARTBEAT\` | POLICY / examples only. Constructor logs if named. Do not register. |
| \`JSONBlob\` \`15104\` | Hub registry + some tests use \`GENERIC_MESSAGE + 1\`. Core \`Message.types\` has no \`JSON_BLOB\`. Do not add until core owns it. |
| \`P2P_STATE_ANNOUNCE\` | Generic JSON body \`type\`, not an opcode. Handled in \`Peer._handleGenericMessage\`. |

## Catalog (decode order)

${renderTable(rows)}

## Remaining work

Owner-gated. Protocol version stays \`0x01\`.

1. **Hub catalog** — Drop INNER pending rows that are already outer opcodes. Do not register \`JSONBlob\` until core owns \`15104\`.
2. **Dual-carrier kill** — Originate inventory / file / chat only on first-class opcodes. Mesh chat = \`0x68\` only.
3. **Field schemas** — Still JSON for session offer/open/ack, inventory, file send, document publish/request, contract publish/proposal, instruction, state commitment. \`CONTRACT_MESSAGE\` stays a JSON envelope \`{ contract, type, … }\`.
4. **Protocol-v1 matrix** — Add \`P2P_FORWARD\`, \`P2P_RELAY\`, \`P2P_PONG\`, \`P2P_INVENTORY_RESPONSE\`, \`P2P_SESSION_OPEN\`, \`P2P_DOCUMENT_PUBLISH\`, \`SIDECHAIN_STATE_PATCH\`, \`CONTRACT_PROPOSAL\`. MuSig2 stays directed.
5. **Not V1** — Gapless Fabric opcodes; wire version \`0x02\`; per-app outer types; folding \`DOCUMENT_PUBLISH\` into \`0x5a\`.

## V1 originate set

\`P2P_PING\`, \`P2P_PONG\`, \`P2P_CHAT_MESSAGE\`, \`P2P_PEER_ALIAS\`, \`P2P_PEER_GOSSIP\`, \`P2P_PEERING_OFFER\`, \`P2P_PEER_ANNOUNCE\`, \`P2P_RELAY\`, \`P2P_FORWARD\`, \`P2P_INSTRUCTION\`, \`P2P_INVENTORY_REQUEST\`, \`P2P_INVENTORY_RESPONSE\`, \`P2P_FILE_SEND\`, \`P2P_DOCUMENT_PUBLISH\`, \`DOCUMENT_PUBLISH\`, \`DOCUMENT_REQUEST\`, \`CONTRACT_PUBLISH\`, \`CONTRACT_MESSAGE\`, \`CONTRACT_PROPOSAL\`, \`SIDECHAIN_STATE_PATCH\`, \`P2P_SESSION_OFFER\`, \`P2P_SESSION_OPEN\`, \`P2P_SESSION_ACK\`, \`P2P_MUSIG_*\`, \`BITCOIN_BLOCK\`, \`JSON_CALL\`.

Lightning AMP \`0x2000+\` is a separate namespace, not mesh product traffic. \`GENERIC_MESSAGE\` / \`P2P_BASE_MESSAGE\` remain accepted inbound under the existing non-escalation rules.
`;
}

function writeConsolidation () {
  const rows = collectCatalog();
  fs.writeFileSync(OUTPUT_PATH, renderMarkdown(rows));
  return rows;
}

if (require.main === module) {
  const rows = writeConsolidation();
  process.stdout.write(`Wrote ${path.relative(ROOT, OUTPUT_PATH)} (${rows.length} decode names)\n`);
}

module.exports = {
  OUTPUT_PATH,
  collectCatalog,
  renderMarkdown,
  renderTable,
  writeConsolidation,
  hexOf,
  familyOf
};
