'use strict';

/**
 * @fileoverview Chat-shaped demo — UTF-8 P2P_CHAT_MESSAGE create / sign / verify / format.
 *
 * Default is a short smoke run (CI-safe). Interactive REPL:
 *   node examples/fabric-chat-app.js --interactive
 *
 * Run: `npm run example:chat`
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

function summarize (key, message) {
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

async function smoke (key) {
  const samples = [
    'Hello, Fabric!',
    'Chat bodies are raw UTF-8 on the wire.',
    'Authors are x-only public keys; messages use BIP-340 Schnorr signatures.'
  ];
  const history = [];

  for (const text of samples) {
    const message = createSignedChat(key, text);
    const row = summarize(key, message);
    history.push(row);
    console.log('[EXAMPLES:CHAT]', row.line);
  }

  console.log('[EXAMPLES:CHAT] messages:', history.length);
  console.log('[EXAMPLES:CHAT] pubkey:', key.pubkey ? String(key.pubkey).slice(0, 18) + '…' : '(ok)');
  console.log('[EXAMPLES:CHAT] smoke ok');
  return history;
}

async function interactive (key) {
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
        const row = summarize(key, message);
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

async function main () {
  const key = new Key();
  const interactiveMode = process.argv.includes('--interactive') || process.argv.includes('-i');
  if (interactiveMode) {
    await interactive(key);
  } else {
    await smoke(key);
  }
}

main().catch((exception) => {
  console.error('[EXAMPLES:CHAT]', 'Main Process Exception:', exception);
  process.exitCode = 1;
});
