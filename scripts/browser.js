'use strict';

const Peer = require('../types/peer');

async function main () {
  const component = document.createElement('fabric-component');
  component.peer = new Peer();
  console.log('component:', component);
  document.appendChild(component);
}

main().catch((exception) => {
  console.error('[FABRIC:EDGE]', 'Main Process Error:', exception);
}).then((output) => {
  console.log('[FABRIC:EDGE]', 'Main Process Output:', output);
});
