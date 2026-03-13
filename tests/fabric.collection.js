'use strict';

const Fabric = require('../');
const assert = require('assert');

const samples = require('./fixtures/collection');

describe('@fabric/core/types/collection', function () {
  describe('Collection', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Collection instanceof Function, true);
    });

    xit('starts as empty', async function () {
      const set = new Fabric.Collection();
      assert.equal(set.render(), '[]');
    });

    it('can hold a single entity', async function () {
      let set = new Fabric.Collection();
      set.push('test');
      // console.log('the set:', set);
      let populated = await set.populate();
      // console.log('populated:', populated);
      assert.equal(JSON.stringify(populated), '["test"]');
    });

    it('can restore from an Array object', async function () {
      let set = new Fabric.Collection(['test']);
      let populated = await set.populate();
      assert.equal(JSON.stringify(populated), '["test"]');
    });

    it('can restore from a more complex Array object', async function () {
      let set = new Fabric.Collection(['test', { text: 'Hello, world!' }]);
      let populated = await set.populate();
      assert.equal(JSON.stringify(populated), '["test",{"text":"Hello, world!"}]');
    });

    it('manages a collection of objects', async function () {
      let set = new Fabric.Collection();

      set.push('Α');
      set.push('Ω');

      let populated = await set.populate();

      // console.log('set:', set);
      // console.log('populated:', populated);
      // console.log('rendered:', set.render());

      assert.equal(JSON.stringify(populated), '["Α","Ω"]');
      const expectedIDs = [new Fabric.Entity('Α').id, new Fabric.Entity('Ω').id];
      assert.equal(set.render(), JSON.stringify(expectedIDs));
    });

    xit('can import with commit', async () => {
      let set = new Fabric.Collection();
      let res = await set.import(samples.list[0]);
      assert.equal(set.len, 1);
    });

    xit('can import without commit', async () => {
      let set = new Fabric.Collection();
      let res = await set.import(samples.list[0], false);
      assert.equal(set.len, 1);
    });

    it('can import list', async () => {
      let set = new Fabric.Collection();
      let res = await set.importList(samples.list);
      assert.equal(set.len, 3);
    });

    xit('can create with commit', async () => {
      let set = new Fabric.Collection();
      let res = await set.create(samples.list[0]);

      assert.equal(set.len, 1);
    });

    xit('can create without commit', async () => {
      let set = new Fabric.Collection();
      let res = await set.create(samples.list[0], false);

      assert.equal(set.len, 1);
    });

    // let converters = ['map', 'typedMap', 'toTypedArray', 'list'];
    let converters = ['map', 'typedMap', 'list'];

    converters.forEach(converter => {
      xit('can convert to ' + converter, async () => {
        let set = new Fabric.Collection();
        let res = await set.importList(samples.list);
        let map = set[converter]();

        for (var i in map) {
          let item = map[i];
          for (var k in item) {
            let j = converter == 'toTypedArray' ? i : i - 1;
            assert.equal(item[k], samples.list[j][k]);
          }
        }
      });
    });

    it('starts empty and exposes empty map/list views', function () {
      const set = new Fabric.Collection();
      assert.deepStrictEqual(set.map(), {});
      assert.deepStrictEqual(set.list(), {});
      assert.deepStrictEqual(set.typedMap(), {});
      assert.deepStrictEqual(set.toTypedArray(), []);
      assert.equal(set.len, 0);
    });

    it('can create and retrieve entities by id', async function () {
      const set = new Fabric.Collection({ name: 'widget' });
      const created = await set.create({ name: 'alpha', symbol: 'ALP' });

      assert.ok(created.id);
      assert.equal(set.len, 1);

      const fetched = set.getByID(created.id);
      assert.ok(fetched);
      assert.equal(fetched.id, created.id);
      assert.equal(fetched.name, 'alpha');
      assert.equal(fetched.symbol, 'ALP');
    });

    it('can import one item and import a list', async function () {
      const set = new Fabric.Collection({ name: 'sample' });

      const one = await set.import(samples.list[0], false);
      assert.equal(one.id, samples.list[0].id);
      assert.equal(set.len, 1);

      const ids = await set.importList(samples.list.slice(1));
      assert.equal(ids.length, 2);
      assert.equal(set.len, 3);
    });

    it('can find and convert imported entries', async function () {
      const set = new Fabric.Collection({ name: 'thing' });
      await set.importList([
        { id: 'a1', name: 'alpha', symbol: 'ALP' },
        { id: 'b2', name: 'beta', symbol: 'BET' }
      ]);

      const mapped = set.map();
      const ids = Object.keys(mapped);
      assert.equal(ids.length, 2);

      const foundByName = set.findByName('beta');
      assert.ok(foundByName);
      assert.equal(foundByName.symbol, 'BET');

      const foundByField = set.findByField('symbol', 'ALP');
      assert.ok(foundByField);
      assert.equal(foundByField.name, 'alpha');

      const foundBySymbol = set.findBySymbol('BET');
      assert.ok(foundBySymbol);
      assert.equal(foundBySymbol.name, 'beta');

      const matches = set.match({ symbol: 'ALP' });
      assert.equal(matches.length, 1);
      assert.equal(matches[0].name, 'alpha');

      const typed = set.toTypedArray();
      assert.equal(typed.length, 2);
    });

    it('can patch an existing target path', async function () {
      const set = new Fabric.Collection({ name: 'patch' });
      const created = await set.create({ id: 'p1', name: 'before' }, false);
      const link = `${set.path}/${created.id}`;

      const updated = await set._patchTarget(link, [
        { op: 'replace', path: '/name', value: 'after' }
      ]);

      const root = set.path.slice(1);
      assert.equal(updated[root][created.id].name, 'after');
      assert.equal(set.getByID(created.id).name, 'after');
    });

    it('covers accessors and map helpers', async function () {
      const set = new Fabric.Collection({ name: 'route' });
      set.settings.routes = ['/foo'];
      assert.deepStrictEqual(set.routes, ['/foo']);

      set._setKey('customId');
      assert.equal(set.settings.key, 'customId');
      set.path = '/route-custom';
      assert.equal(set.path, '/route-custom');
      set.path = '/routes';

      await set.importList([
        { id: 'x1', name: 'x' },
        { id: 'x2', name: 'y' }
      ]);

      const latest = set.getLatest();
      // Collection stores keyed objects, so getLatest currently returns undefined.
      assert.strictEqual(latest, undefined);

      const queryResult = await set.query(`${set.path}/x1/name`);
      assert.strictEqual(queryResult, null);
      const rendered = set.render();
      assert.equal(typeof rendered, 'string');
      assert.equal(JSON.parse(rendered).length, 2);
      const typedMap = set.typedMap();
      assert.equal(Object.keys(typedMap).length, 2);

      const tree = set.asMerkleTree();
      assert.ok(tree);
      assert.ok(Buffer.isBuffer(tree.getRoot()));
    });

    it('can import from a map', async function () {
      const set = new Fabric.Collection({ name: 'map' });
      const ids = await set.importMap({
        a: { id: 'm1', name: 'alpha' },
        b: { id: 'm2', name: 'beta' }
      });

      assert.deepStrictEqual(ids, ['m1', 'm2']);
      assert.equal(set.len, 2);
    });

    it('supports custom create method and listener hook', async function () {
      let listenerCalled = false;
      const set = new Fabric.Collection({
        name: 'hook',
        deterministic: false,
        methods: {
          create: async function (input) {
            return {
              data: Object.assign({}, input, { transformed: true })
            };
          }
        },
        listeners: {
          create: async function () {
            listenerCalled = true;
          }
        }
      });

      const created = await set.create({ id: 'h1', name: 'hooked' });
      assert.equal(created.id.length, 64);
      assert.equal(created.transformed, true);
      assert.equal(created.name, 'hooked');
      assert.equal(typeof created.created, 'number');
      assert.equal(listenerCalled, true);
    });

    it('handles create commit failures without throwing', async function () {
      const set = new Fabric.Collection({ name: 'createfail' });
      const originalCommit = set.commit.bind(set);
      const originalError = console.error;
      let commitCalls = 0;
      let errorCalls = 0;

      set.commit = async function () {
        commitCalls++;
        if (commitCalls >= 2) throw new Error('commit-failed-create');
        return originalCommit();
      };

      console.error = function () {
        errorCalls++;
      };

      try {
        const created = await set.create({ id: 'cf1', name: 'create-fail' }, true);
        assert.equal(created.name, 'create-fail');
        assert.ok(errorCalls >= 1);
      } finally {
        console.error = originalError;
      }
    });

    it('handles import commit failures without throwing', async function () {
      const set = new Fabric.Collection({ name: 'importfail' });
      const originalCommit = set.commit.bind(set);
      const originalError = console.error;
      let commitCalls = 0;
      let errorCalls = 0;

      set.commit = async function () {
        commitCalls++;
        if (commitCalls >= 2) throw new Error('commit-failed-import');
        return originalCommit();
      };

      console.error = function () {
        errorCalls++;
      };

      try {
        const imported = await set.import({ id: 'if1', name: 'import-fail' }, true);
        assert.equal(imported.id, 'if1');
        assert.ok(errorCalls >= 1);
      } finally {
        console.error = originalError;
      }
    });

    it('covers verbosity, catch, and branch-heavy paths', async function () {
      class WrappedType {
        constructor (input) {
          this.payload = input;
        }
      }

      const set = new Fabric.Collection({
        name: 'branch',
        type: WrappedType,
        verbosity: 5
      });

      const originalLog = console.log;
      const originalError = console.error;
      let logCalls = 0;
      let errorCalls = 0;

      console.log = function () {
        logCalls++;
      };
      console.error = function () {
        errorCalls++;
      };

      try {
        const first = await set.create({ id: 'dup', name: 'duplicate' }, false);
        const second = await set.create({ id: 'dup', name: 'duplicate' }, false);
        assert.ok(first.id);
        assert.ok(second.id);

        // getByID true path + wrapped result branch
        const wrapped = set.getByID(first.id);
        assert.ok(wrapped instanceof WrappedType);

        // getByID null short-circuit path
        assert.strictEqual(set.getByID(null), null);

        // getByID catch path via invalid pointer token in id
        set.getByID('bad~token');

        // get() catch branch via invalid pointer path
        assert.strictEqual(set.get('/bad~path'), null);

        // import() path for input['@data'] and verbosity-only logging paths
        const imported = await set.import({
          '@data': { id: 'wrapped', name: 'wrapped-import' }
        }, false);
        assert.equal(imported.id, 'wrapped');

        // _patchTarget catch path with invalid op
        const patchResult = await set._patchTarget(set.path, [
          { op: 'bad-op', path: '/nope', value: 1 }
        ]);
        assert.strictEqual(patchResult, null);

        // push() commit catch path (throw on commit call)
        const originalCommit = set.commit.bind(set);
        set.commit = async function () {
          throw new Error('forced-push-commit-error');
        };
        const pushLen = await set.push({ id: 'p', name: 'push' }, true);
        assert.ok(pushLen >= 1);
        set.commit = originalCommit;

        // match() catch branch by forcing Array.filter to throw
        const originalFilter = Array.prototype.filter;
        Array.prototype.filter = function () {
          throw new Error('forced-filter-error');
        };
        try {
          const matchResult = set.match({ id: 'x' });
          assert.strictEqual(matchResult, null);
        } finally {
          Array.prototype.filter = originalFilter;
        }
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }

      assert.ok(logCalls >= 1);
      assert.ok(errorCalls >= 1);
    });

    it('covers remaining branch alternatives', async function () {
      const set = new Fabric.Collection({ name: 'branches2' });
      await set.importList([
        { id: 'd1', name: 'dup', symbol: 'SYM' },
        { id: 'd2', name: 'dup', symbol: 'SYM' }
      ]);

      // Exercise ternary branch where result is already set.
      assert.equal(set.findByField('name', 'dup').id, 'd1');
      assert.equal(set.findByName('dup').id, 'd1');
      assert.equal(set.findBySymbol('SYM').id, 'd1');

      // Exercise input.id || entity.id fallback branches in import().
      const importedNoId = await set.import({ title: 'no-id' }, false);
      assert.ok(importedNoId.id);

      // Exercise result.data || result fallback branches in create().
      const custom = new Fabric.Collection({
        name: 'plain',
        methods: {
          create: async function (input) {
            return Object.assign({}, input, { transformed: true });
          }
        }
      });
      const created = await custom.create({ label: 'plain-object' }, false);
      assert.ok(created.id);
    });
  });
});
