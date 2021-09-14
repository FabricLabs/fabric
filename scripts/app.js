#!/usr/bin/env node
'use strict';

// Settings
const settings = require('../settings/default');

// Fabric Types
const App = require('../types/app');

// Fabric Services
const Matrix = require('../services/matrix');
const Lightning = require('../services/lightning');

// Functions
const _handleMessage = require('../functions/_handleMessage');
const _handleWarning = require('../functions/_handleWarning');
const _handleError = require('../functions/_handleError');

async function main () {
  // Instantiate Application
  const app = new App(settings);

  // Define Resources
  await app.define('Example', {
    components: {
      list: 'example-list',
      view: 'example-view'
    }
  });

  // Register Services
  await app._registerService('lightning', Lightning);
  await app._registerService('matrix', Matrix);

  // Attach Listeners
  app.on('message', _handleMessage);
  app.on('warning', _handleWarning);
  app.on('error', _handleError);

  // Start the Application
  await app.start();

  // Render the UI
  return app.render();
}

main().catch((exception) => {
  console.error('[SCRIPTS:MAIN]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[SCRIPTS:MAIN]', 'Main Process Output:', output);
});
