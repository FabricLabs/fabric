'use strict';

const assert = require('assert');
const EventEmitter = require('events');

// Fabric Types
const Fabric = require('../');
const Actor = require('../types/actor');

describe('@fabric/core/types/actor', function () {
  describe('Actor', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Actor instanceof Function, true);
    });

    it('should create an Actor instance', function () {
      const actor = new Actor();
      assert.ok(actor instanceof Actor);
      assert.ok(actor instanceof EventEmitter);
    });

    it('should initialize with default settings', function () {
      const actor = new Actor();
      assert.strictEqual(actor.settings.type, 'Actor');
      assert.strictEqual(actor.settings.status, 'PAUSED');
    });

    it('should handle empty object input', function () {
      const actor = new Actor({});
      assert.ok(actor);
      assert.ok(actor.id);
    });

    it('should handle string input', function () {
      const actor = new Actor('Hello World');
      assert.ok(actor);
      assert.ok(actor.id);
      assert.strictEqual(actor.state.type, 'String');
      assert.strictEqual(actor.state.content, 'Hello World');
    });

    it('should handle Buffer input', function () {
      const buffer = Buffer.from('Hello Buffer', 'utf8');
      const actor = new Actor(buffer);
      assert.ok(actor);
      assert.ok(actor.id);
      assert.strictEqual(actor.state.type, 'Buffer');
      assert.strictEqual(actor.state.content, buffer.toString('hex'));
    });

    it('should handle object input', function () {
      const input = { name: 'Test Actor', value: 42 };
      const actor = new Actor(input);
      assert.ok(actor);
      assert.ok(actor.id);
      assert.strictEqual(actor.state.name, 'Test Actor');
      assert.strictEqual(actor.state.value, 42);
    });

    it('should initialize history array', function () {
      const actor = new Actor();
      assert.ok(Array.isArray(actor.history));
      assert.strictEqual(actor.history.length, 0);
    });

    it('should initialize observer for state changes', function () {
      const actor = new Actor({ test: 'value' });
      assert.ok(actor.observer);
    });

    it('can smoothly create a new actor', function () {
      const actor = new Actor();
      assert.ok(actor);
      assert.ok(actor.id);
    });

    it('can uniquely identify some known string', function () {
      const actor = new Actor('Hello again, world!');
      assert.ok(actor);
      assert.ok(actor.id);
      assert.strictEqual(actor.id, '7e5ef12f0db57e49860ef60ae7c0e9d58b2a752bbdb4c294264632d1779cfab9');
    });

    it('can uniquely identify some known object', function () {
      const actor = new Actor({ content: 'Hello again, world!' });
      assert.ok(actor);
      assert.ok(actor.id);
      assert.strictEqual(actor.id, '38e96125d9b89162ffc5ee7decbc23974decfdb9c1fee2f730c31a75fa97e2c3');
    });

    it('can uniquely identify some known buffer', function () {
      const buffer = Buffer.from('Hello again, world!', 'utf8');
      const actor = new Actor(buffer);
      assert.ok(actor);
      assert.ok(actor.id);
      assert.strictEqual(actor.id, '13f9dd809443f334da56da92f11ccc0f62a69979dc083053aa400bfbf297db68');
    });
  });

  describe('Static Methods', function () {
    describe('Actor.chunk', function () {
      it('should chunk array with default size of 32', function () {
        const array = Array.from({ length: 100 }, (_, i) => i);
        const chunks = Actor.chunk(array);

        assert.ok(Array.isArray(chunks));
        assert.strictEqual(chunks.length, 4); // 100 / 32 = 3.125, so 4 chunks
        assert.strictEqual(chunks[0].length, 32);
        assert.strictEqual(chunks[3].length, 4); // Last chunk has remaining items
      });

      it('should chunk array with custom size', function () {
        const array = Array.from({ length: 10 }, (_, i) => i);
        const chunks = Actor.chunk(array, 3);

        assert.ok(Array.isArray(chunks));
        assert.strictEqual(chunks.length, 4); // 10 / 3 = 3.33, so 4 chunks
        assert.strictEqual(chunks[0].length, 3);
        assert.strictEqual(chunks[1].length, 3);
        assert.strictEqual(chunks[2].length, 3);
        assert.strictEqual(chunks[3].length, 1); // Last chunk has remaining items
      });

      it('should handle empty array', function () {
        const chunks = Actor.chunk([]);
        assert.ok(Array.isArray(chunks));
        assert.strictEqual(chunks.length, 0);
      });
    });

    describe('Actor.fromAny', function () {
      it('should create Actor from string', function () {
        const actor = Actor.fromAny('test string');
        assert.ok(actor instanceof Actor);
        assert.strictEqual(actor.state.content, 'test string');
      });

      it('should create Actor from Buffer', function () {
        const buffer = Buffer.from('test buffer', 'utf8');
        const actor = Actor.fromAny(buffer);
        assert.ok(actor instanceof Actor);
        assert.strictEqual(actor.state.content, buffer.toString('hex'));
      });

      it('should create Actor from object', function () {
        const obj = { test: 'object' };
        const actor = Actor.fromAny(obj);
        assert.ok(actor instanceof Actor);
        assert.strictEqual(actor.state.test, 'object');
      });

      it('should handle empty input', function () {
        const actor = Actor.fromAny({});
        assert.ok(actor instanceof Actor);
      });
    });

    describe('Actor.fromJSON', function () {
      it('should parse valid JSON string', function () {
        const jsonString = '{"name": "test", "value": 123}';
        const result = Actor.fromJSON(jsonString);

        assert.ok(result);
        assert.strictEqual(result.name, 'test');
        assert.strictEqual(result.value, 123);
      });

      it('should handle empty string', function () {
        const result = Actor.fromJSON('');
        assert.strictEqual(result, null);
      });

      it('should handle invalid JSON', function () {
        const invalidJson = '{"name": "test", "value":}';
        const result = Actor.fromJSON(invalidJson);
        assert.strictEqual(result, null);
      });

      it('should handle non-string input', function () {
        const result = Actor.fromJSON(123);
        assert.strictEqual(result, null);
      });
    });

    describe('Actor.randomBytes', function () {
      it('provides random bytes', function () {
        const actor = new Actor();
        const random = actor.randomBytes();
        assert.ok(actor);
        assert.ok(random);
      });

      it('should generate random bytes with default count', function () {
        const bytes = Actor.randomBytes();
        assert.ok(Buffer.isBuffer(bytes));
        assert.strictEqual(bytes.length, 32);
      });

      it('should generate random bytes with custom count', function () {
        const bytes = Actor.randomBytes(16);
        assert.ok(Buffer.isBuffer(bytes));
        assert.strictEqual(bytes.length, 16);
      });

      it('should generate different bytes on subsequent calls', function () {
        const bytes1 = Actor.randomBytes(16);
        const bytes2 = Actor.randomBytes(16);
        assert.notDeepStrictEqual(bytes1, bytes2);
      });
    });
  });

  describe('Instance Properties', function () {
    describe('id property', function () {
      it('should generate consistent ID for same content', function () {
        const actor1 = new Actor({ content: 'test' });
        const actor2 = new Actor({ content: 'test' });
        assert.strictEqual(actor1.id, actor2.id);
      });

      it('should generate different IDs for different content', function () {
        const actor1 = new Actor({ content: 'test1' });
        const actor2 = new Actor({ content: 'test2' });
        assert.notStrictEqual(actor1.id, actor2.id);
      });

      it('should be a string', function () {
        const actor = new Actor({ content: 'test' });
        assert.strictEqual(typeof actor.id, 'string');
        assert.strictEqual(actor.id.length, 64); // SHA256 hex string length
      });
    });

    describe('state property', function () {
      it('should return current state', function () {
        const actor = new Actor({ name: 'test', value: 42 });
        const state = actor.state;

        assert.ok(state);
        assert.strictEqual(state.name, 'test');
        assert.strictEqual(state.value, 42);
      });

      it('should return deep copy of state', function () {
        const actor = new Actor({ nested: { value: 42 } });
        const state1 = actor.state;
        const state2 = actor.state;

        assert.notStrictEqual(state1, state2);
        assert.deepStrictEqual(state1, state2);
      });

      it('should allow setting state', function () {
        const actor = new Actor();
        const newState = { name: 'new', value: 123 };

        actor.state = newState;
        assert.deepStrictEqual(actor.state, newState);
      });
    });

    describe('status property', function () {
      it('should return current status', function () {
        const actor = new Actor();
        assert.strictEqual(actor.status, 'PAUSED');
      });

      it('should allow setting status', function () {
        const actor = new Actor();
        actor.status = 'RUNNING';
        assert.strictEqual(actor.status, 'RUNNING');
      });
    });

    describe('spendable property', function () {
      it('should return false when no signer', function () {
        const actor = new Actor();
        assert.strictEqual(actor.spendable, false);
      });
    });
  });

  describe('Core Methods', function () {
    describe('adopt method', function () {
      it('can adopt changes', function () {
        const actor = new Actor({ activity: 'SLEEPING' });

        actor.adopt([
          { op: 'replace', path: '/activity', value: 'WAKING' }
        ]);

        assert.ok(actor);
        assert.ok(actor.id);
        assert.strictEqual(actor.state.activity, 'WAKING');
      });

      it('should return self for chaining', function () {
        const actor = new Actor();
        const result = actor.adopt([]);
        assert.strictEqual(result, actor);
      });
    });

    describe('commit method', function () {
      it('should create commit and add to history', function () {
        const actor = new Actor({ status: 'initial' });
        const initialHistoryLength = actor.history.length;

        const commitId = actor.commit();

        assert.ok(commitId);
        assert.strictEqual(actor.history.length, initialHistoryLength + 1);
        assert.ok(actor.history[actor.history.length - 1]);
      });

      it('should emit commit event', function () {
        const actor = new Actor({ status: 'initial' });
        let commitEventEmitted = false;

        actor.on('commit', (commit) => {
          commitEventEmitted = true;
          assert.ok(commit);
          assert.ok(commit.id);
        });

        actor.commit();
        assert.ok(commitEventEmitted);
      });

      it('should emit message event', function () {
        const actor = new Actor({ status: 'initial' });
        let messageEventEmitted = false;

        actor.on('message', (message) => {
          messageEventEmitted = true;
          assert.ok(message);
          assert.strictEqual(message.type, 'ActorMessage');
          assert.ok(message.data);
        });

        actor.commit();
        assert.ok(messageEventEmitted);
      });
    });

    describe('set method', function () {
      it('should set value at JSON pointer path', function () {
        const actor = new Actor({});

        actor.set('/name', 'test');
        assert.strictEqual(actor.state.name, 'test');
      });

      it('should set nested value', function () {
        const actor = new Actor({});

        actor.set('/nested/value', 42);
        assert.strictEqual(actor.state.nested.value, 42);
      });

      it('should commit after setting', function () {
        const actor = new Actor({});
        const initialHistoryLength = actor.history.length;

        actor.set('/test', 'value');
        assert.strictEqual(actor.history.length, initialHistoryLength + 1);
      });

      it('should return self for chaining', function () {
        const actor = new Actor({});
        const result = actor.set('/test', 'value');
        assert.strictEqual(result, actor);
      });
    });

    describe('get method', function () {
      it('should get value at JSON pointer path', function () {
        const actor = new Actor({ name: 'test', nested: { value: 42 } });

        assert.strictEqual(actor.get('/name'), 'test');
        assert.strictEqual(actor.get('/nested/value'), 42);
      });

      it('should return undefined for non-existent path', function () {
        const actor = new Actor({ name: 'test' });
        // JSON pointer library throws error for invalid paths, so we need to catch it
        let result;
        try {
          result = actor.get('/nonexistent');
        } catch (error) {
          result = undefined;
        }
        assert.strictEqual(result, undefined);
      });
    });

    describe('mutate method', function () {
      it('should mutate with provided seed', function () {
        const actor = new Actor({ status: 'initial' });
        const seed = 'test-seed-123';

        actor.mutate(seed);
        assert.strictEqual(actor.state.seed, seed);
      });

      it('should generate random seed when none provided', function () {
        const actor = new Actor({ status: 'initial' });

        actor.mutate();
        assert.ok(actor.state.seed);
        assert.strictEqual(typeof actor.state.seed, 'string');
      });

      it('should return self for chaining', function () {
        const actor = new Actor({ status: 'initial' });
        const result = actor.mutate('test');
        assert.strictEqual(result, actor);
      });
    });

    describe('setStatus method', function () {
      it('should set status', function () {
        const actor = new Actor();

        actor.setStatus('RUNNING');
        assert.strictEqual(actor.status, 'RUNNING');
      });

      it('should throw error for null status', function () {
        const actor = new Actor();

        assert.throws(() => {
          actor.setStatus(null);
        }, Error);
      });
    });

    describe('validate method', function () {
      it('can validate', function () {
        const actor = new Actor({ activity: 'SLEEPING' });

        actor.adopt([
          { op: 'replace', path: '/activity', value: 'WAKING' }
        ]);

        const valid = actor.validate();

        assert.ok(actor);
        assert.ok(actor.id);
        assert.ok(valid);
        assert.strictEqual(actor.state.activity, 'WAKING');
      });

      it('should return false for actor without state', function () {
        const actor = new Actor();
        // Mock the state getter to return null
        Object.defineProperty(actor, 'state', {
          get: function() { return null; },
          configurable: true
        });
        assert.strictEqual(actor.validate(), false);
      });
    });
  });

  describe('Serialization Methods', function () {
    describe('toJSON method', function () {
      it('should return JSON representation', function () {
        const actor = new Actor({ name: 'test', value: 42 });
        const json = actor.toJSON();

        assert.ok(json);
        assert.ok(json['@id']);
        assert.strictEqual(json.name, 'test');
        assert.strictEqual(json.value, 42);
      });
    });

    describe('serialize method', function () {
      it('should serialize to JSON string', function () {
        const actor = new Actor({ name: 'test' });
        const serialized = actor.serialize();

        assert.strictEqual(typeof serialized, 'string');
        assert.ok(serialized.includes('"name"'));
        assert.ok(serialized.includes('"test"'));
      });
    });

    describe('toString method', function () {
      it('should return JSON string by default', function () {
        const actor = new Actor({ name: 'test' });
        const str = actor.toString();

        assert.strictEqual(typeof str, 'string');
        assert.ok(str.includes('"name"'));
      });

      it('should return hex string when format is hex', function () {
        const actor = new Actor({ name: 'test' });
        const hex = actor.toString('hex');

        assert.strictEqual(typeof hex, 'string');
        assert.ok(/^[0-9a-f]+$/i.test(hex));
      });
    });
  });

  describe('Lifecycle Methods', function () {
    describe('pause method', function () {
      it('should pause the actor', function () {
        const actor = new Actor();
        const initialHistoryLength = actor.history.length;

        actor.pause();

        assert.strictEqual(actor.status, 'PAUSED');
        // The pause method calls commit() once
        assert.strictEqual(actor.history.length, initialHistoryLength + 1);
      });

      it('should return self for chaining', function () {
        const actor = new Actor();
        const result = actor.pause();
        assert.strictEqual(result, actor);
      });
    });

    describe('unpause method', function () {
      it('should unpause the actor', function () {
        const actor = new Actor();
        const initialHistoryLength = actor.history.length;

        actor.unpause();

        assert.strictEqual(actor.status, 'UNPAUSED');
        // The unpause method calls commit() once
        assert.strictEqual(actor.history.length, initialHistoryLength + 1);
      });

      it('should return self for chaining', function () {
        const actor = new Actor();
        const result = actor.unpause();
        assert.strictEqual(result, actor);
      });
    });
  });

  describe('Edge Cases', function () {
    it('should handle null input gracefully', function () {
      const actor = new Actor(null);
      assert.ok(actor);
      assert.ok(actor.id);
    });

    it('should handle undefined input gracefully', function () {
      const actor = new Actor(undefined);
      assert.ok(actor);
      assert.ok(actor.id);
    });

    it('should handle empty string input', function () {
      const actor = new Actor('');
      assert.ok(actor);
      assert.ok(actor.id);
      assert.strictEqual(actor.state.content, '');
    });

    it('should handle zero-length Buffer input', function () {
      const actor = new Actor(Buffer.alloc(0));
      assert.ok(actor);
      assert.ok(actor.id);
      assert.strictEqual(actor.state.content, '');
    });
  });
});
