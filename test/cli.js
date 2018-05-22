'use strict';

import Fabric from '../';

const assert = require('assert');
const expect = require('chai').expect;

describe('CLI', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Fabric.CLI, 'function');
  });

  it('should create an CLI smoothly', async function () {
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
