'use strict';

const Fabric = require('../');
const Resource = require('../types/resource');
const assert = require('assert');

describe('@fabric/core/types/resource', function () {
  describe('Resource', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Resource instanceof Function, true);
    });

    it('constructs with default routes and components', function () {
      const resource = new Resource({ name: 'Document' });
      assert.strictEqual(resource.routes.list, '/documents');
      assert.strictEqual(resource.routes.view, '/documents/:id');
      assert.strictEqual(resource.components.list, 'document-list');
      assert.strictEqual(resource.components.view, 'document-view');
    });

    it('hash is deterministic and render includes definition', function () {
      const def = { name: 'Document', fields: { title: 'String' } };
      const a = new Resource(def);
      const b = new Resource(def);
      assert.strictEqual(a.hash, b.hash);
      assert.ok(a.render().includes('fabric-resource'));
      assert.ok(a.render().includes('"name":"Document"'));
    });

    it('attach binds store from application stash', function () {
      const resource = new Resource({ name: 'Document' });
      const stash = { get: async () => [] };
      resource.attach({ stash });
      assert.strictEqual(resource.store, stash);
    });

    it('list and query delegate to store', async function () {
      const resource = new Resource({ name: 'Document' });
      const store = {
        get: async (path) => [`list:${path}`],
        _GET: async (path) => [`query:${path}`]
      };
      resource.store = store;
      const listed = await resource.list();
      const queried = await resource.query({});
      assert.deepStrictEqual(listed, ['list:/documents']);
      assert.deepStrictEqual(queried, ['query:/documents']);
    });

    it('create/update call store and return expected values', async function () {
      const resource = new Resource({ name: 'Document' });
      const calls = [];
      resource.store = {
        _POST: async (path, value) => {
          calls.push(['_POST', path, value]);
          return '/documents/id1';
        },
        _PATCH: async (path, value) => {
          calls.push(['_PATCH', path, value]);
          return true;
        },
        _GET: async (path) => {
          calls.push(['_GET', path]);
          return { id: 'id1', title: 'next' };
        }
      };

      const created = await resource.create({ title: 'hello' });
      const updated = await resource.update('id1', { title: 'next' });

      assert.ok(created && created.id);
      assert.deepStrictEqual(updated, { id: 'id1', title: 'next' });
      assert.deepStrictEqual(calls[0][0], '_POST');
      assert.deepStrictEqual(calls[1][0], '_PATCH');
      assert.deepStrictEqual(calls[2][0], '_GET');
    });

    it('describe wires HTTP routes to router', async function () {
      const resource = new Resource({
        name: 'Document',
        routes: {
          set: '/documents',
          get: '/documents/:id',
          insert: '/documents',
          update: '/documents/:id',
          delete: '/documents/:id',
          options: '/documents'
        }
      });
      const calls = [];
      resource.router = function noop () {};
      resource.http = {
        put: (route, handler) => calls.push(['put', route, handler]),
        get: (route, handler) => calls.push(['get', route, handler]),
        post: (route, handler) => calls.push(['post', route, handler]),
        patch: (route, handler) => calls.push(['patch', route, handler]),
        delete: (route, handler) => calls.push(['delete', route, handler]),
        options: (route, handler) => calls.push(['options', route, handler])
      };

      await resource.describe();
      assert.strictEqual(calls.length, 6);
      assert.strictEqual(calls[0][0], 'put');
      assert.strictEqual(calls[5][0], 'options');
      assert.strictEqual(typeof calls[0][2], 'function');
    });

    it('asStruct exposes prototype with class name', function () {
      const out = Resource.asStruct();
      assert.ok(out);
      assert.strictEqual(out.name, 'Resource');
    });

    it('create and update use normalized route paths', async function () {
      const resource = new Resource({ name: 'Entry' });
      const seen = [];
      resource.store = {
        _POST: async (path) => {
          seen.push(path);
          return '/entries/id1';
        },
        _PATCH: async (path) => {
          seen.push(path);
          return true;
        },
        _GET: async (path) => {
          seen.push(path);
          return { id: 'id1' };
        }
      };

      await resource.create({ hello: 'world' });
      await resource.update('id1', { hello: 'again' });
      assert.strictEqual(seen[0], '/entries');
      assert.strictEqual(seen[1], '/entries/id1');
      assert.strictEqual(seen[2], '/entries/id1');
    });
  });
});
