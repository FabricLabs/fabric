'use strict';

import Fabric from '../';

const assert = require('assert');
const expect = require('chai').expect;

const Swarm = require('../lib/swarm');

describe('Swarm', function () {
  it('should expose a constructor', function () {
    assert.equal(Swarm instanceof Function, true);
  });

  it('can initialize without configuration', function (done) {
    let swarm = new Swarm();
    swarm.on('ready', async function () {
      await swarm.stop();
      done();
    }).start();
  });
});
