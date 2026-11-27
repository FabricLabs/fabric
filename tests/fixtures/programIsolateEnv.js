'use strict';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    sawXprv: Object.prototype.hasOwnProperty.call(process.env, 'FABRIC_XPRV'),
    isolate: process.env.FABRIC_PROGRAM_ISOLATE || null
  }));
});
