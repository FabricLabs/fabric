#!/usr/bin/env node
'use strict';

const Fabric = require('../');

async function main () {
  let entropy = Math.random();
  let fabric = new Fabric();

  // add starts here
  let state = { entropy, fabric };
  fabric.log('state:', state);

  fabric.log('Defining Resources...');
  fabric.define('Track', {
    components: {
      list: 'track-list',
      view: 'track-view'
    }
  });

  fabric.log('Starting processes...');
  await fabric.start();

  return this;
}

main();
