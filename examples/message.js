#!/usr/bin/env node
'use strict';

/**
 * @fileoverview Message wire demo — create, sign, verify, dump size — plus
 * UTF-8 P2P_CHAT_MESSAGE smoke (`npm run example:chat`). Interactive REPL:
 *   node examples/message.js --interactive
 *
 * Run: `node examples/message.js`
 */

const readline = require('readline');
const Key = require('../types/key');
const Message = require('../types/message');
const {
  chatTextOf,
  formatChatLogLine
} = require('../functions/fabricChatText');

function createSignedChat (key, text) {
  const message = Message.fromVector(['P2P_CHAT_MESSAGE', String(text)]);
  message.signWithKey(key);
  if (!message.verifyWithKey(key)) {
    throw new Error('chat signature verification failed');
  }
  return message;
}

function summarizeChat (key, message) {
  const author = message.raw.author.toString('hex');
  const text = message.data ? message.data.toString('utf8') : chatTextOf({ text: '' });
  return {
    author,
    text,
    type: message.type,
    hash: message.raw.hash.toString('hex'),
    line: formatChatLogLine(author, null, text)
  };
}

async function chatSmoke (key) {
  const samples = [
    'Hello, Fabric!',
    'Chat bodies are raw UTF-8 on the wire.',
    'Authors are x-only public keys; messages use BIP-340 Schnorr signatures.'
  ];
  const history = [];
  for (const text of samples) {
    const message = createSignedChat(key, text);
    const row = summarizeChat(key, message);
    history.push(row);
    console.log('[EXAMPLES:CHAT]', row.line);
  }
  console.log('[EXAMPLES:CHAT] messages:', history.length);
  console.log('[EXAMPLES:CHAT] pubkey:', key.pubkey ? String(key.pubkey).slice(0, 18) + '…' : '(ok)');
  console.log('[EXAMPLES:CHAT] smoke ok');
  return history;
}

async function interactiveChat (key) {
  const history = [];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  console.log('[EXAMPLES:CHAT] Interactive mode. Commands: send <text> | history | help | quit');
  while (true) {
    const line = String(await ask('> ')).trim();
    if (!line) continue;
    if (line === 'quit' || line === 'exit') break;
    if (line === 'help') {
      console.log('  send <text>  — sign and verify a P2P_CHAT_MESSAGE');
      console.log('  history      — list signed messages');
      console.log('  quit         — exit');
      continue;
    }
    if (line === 'history') {
      history.forEach((row, i) => {
        console.log(`  [${i}]`, row.line, row.hash.slice(0, 12) + '…');
      });
      continue;
    }
    if (line.startsWith('send ')) {
      const text = line.slice(5).trim();
      if (!text) {
        console.log('[EXAMPLES:CHAT] empty message');
        continue;
      }
      try {
        const message = createSignedChat(key, text);
        const row = summarizeChat(key, message);
        history.push(row);
        console.log('[EXAMPLES:CHAT]', row.line);
        console.log('[EXAMPLES:CHAT] hash:', row.hash.slice(0, 16) + '…');
      } catch (error) {
        console.error('[EXAMPLES:CHAT]', error.message);
      }
      continue;
    }
    console.log('[EXAMPLES:CHAT] unknown command — try help');
  }
  rl.close();
  console.log('[EXAMPLES:CHAT] bye');
}

async function messageDemo (key) {
  const message = Message.fromVector(['P2P_BASE_MESSAGE', 'Hello, world!']);
  message.signWithKey(key);
  const verified = message.verifyWithKey(key);
  if (!verified) throw new Error('message signature invalid');
  const raw = message.asRaw();
  const output = {
    type: message.type,
    verified,
    author: message.raw.author.toString('hex').slice(0, 16) + '…',
    hash: message.raw.hash.toString('hex').slice(0, 16) + '…',
    bytes: Buffer.isBuffer(raw) ? raw.length : 0
  };
  console.log('[EXAMPLES:MESSAGE]', 'Main Process Output:', output);
  return output;
}

async function main () {
  const key = new Key();
  const interactiveMode = process.argv.includes('--interactive') || process.argv.includes('-i');
  const chatOnly = process.argv.includes('--chat');
  if (interactiveMode) {
    await interactiveChat(key);
    return;
  }
  if (!chatOnly) await messageDemo(key);
  await chatSmoke(key);
}

main().catch((exception) => {
  console.error('[EXAMPLES:MESSAGE]', 'Main Process Exception:', exception);
  process.exitCode = 1;
});
