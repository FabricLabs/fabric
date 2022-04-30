'use strict';

// Test Dependency
const assert = require('assert');

// Schema-specific Dependencies
const validator = require('is-my-json-valid');
const Actor = require('../types/actor');

// Schema Validation
const schemas = require('../schemas');
const samples = require('../samples');

const validate = validator(schemas.Actor);

describe('JSON Schema Compliance', function () {
  describe('@fabric/core/types/actor', function () {
    it('produces valid JSON', function () {
      const actor = new Actor({
        name: 'Satoshi Nakamoto'
      });

      const json = samples.Actor;
      const valid = validate(json);

      assert.ok(valid);
      assert.ok(actor);
      assert.ok(actor.id);
    });
  });
});
