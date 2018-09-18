'use strict';

const Fabric = require('../');

const assert = require('assert');
const expect = require('chai').expect;

describe('CLI', function () {
  xit('should expose a constructor', function () {
    assert.equal(typeof Fabric.CLI, 'function');
  });

  xit('should create an CLI smoothly', async function () {
    let cli = new Fabric.CLI();

    try {
      await cli.start();
      await cli.stop();
      assert.ok(cli);
    } catch (E) {
      await cli.stop();
      console.error(E);
    }
  });
});
