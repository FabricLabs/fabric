'use strict';

// Testing
const assert = require('assert');
const Service = require('../types/service');

describe('@fabric/core/types/service', function () {
  describe('Service', function () {
    it('is available from @fabric/core', function () {
      assert.strictEqual(Service instanceof Function, true);
    });

    it('can create an instance', async function provenance () {
      const service = new Service({
        name: 'Test'
      });

      assert.ok(service);
    });

    it('can start offering service', async function () {
      const service = new Service({
        name: 'fun'
      });

      try {
        await service.start();
      } catch (E) {
        console.error('Exception starting:', E);
      }

      try {
        await service.stop();
      } catch (E) {
        console.error('Exception stopping:', E);
      }

      assert.ok(service);
    });

    it('can run for 10 beats', function (done) {
      async function test () {
        const service = new Service({
          name: 'fun',
          interval: 0
        });

        for (let i = 0; i < 10; i++) {
          service.beat();
        }

        assert.ok(service);
        assert.strictEqual(service.clock, 10);
        done();
      }

      test();
    });

    it('can run in persistent mode', async function provenance () {
      const service = new Service({
        name: 'Test',
        persistent: true
      });

      assert.ok(service);
    });
  });

  describe('_registerActor()', function () {
    it('can register an actor successfully', async function () {
      const service = new Service();
      await service.start();
      const registration = await service._registerActor({ name: 'Sally' });
      await service.stop();
      assert.ok(service);
      assert.ok(registration);
    });

    it('emits the "actor" event', function (done) {
      async function test () {
        const service = new Service();

        service.on('actor', async function (actor) {
          if (actor.name && actor.name === 'Sally') {
            await service.stop();
            done();
          }
        });

        await service.start();
        await service._registerActor({ name: 'Sally' });
      }

      test();
    });

    it('create an empty actor', function (done) {
      async function test () {
        const service = new Service();

        service.on('actor', async function (actor) {
          if (actor.id && actor.id === 'a5b08f19adfd2918e354af8c11e1b4efd963b5f5a525900d63a01cd2fd28176f') {
            await service.stop();
            done();
          }
        });

        await service.start();
        await service._registerActor();
      }

      test();
    });

    it('create an actor from an object', function (done) {
      async function test () {
        const service = new Service();

        service.on('actor', async function (actor) {
          if (actor.id && actor.id === 'a5b08f19adfd2918e354af8c11e1b4efd963b5f5a525900d63a01cd2fd28176f') {
            await service.stop();
            done();
          }
        });

        await service.start();
        await service._registerActor({});
      }

      test();
    });

    it('create an actor from an array', function (done) {
      async function test () {
        const service = new Service();

        service.on('actor', async function (actor) {
          if (actor.id && actor.id === 'a5b08f19adfd2918e354af8c11e1b4efd963b5f5a525900d63a01cd2fd28176f') {
            await service.stop();
            done();
          }
        });

        await service.start();
        await service._registerActor([]);
      }

      test();
    });
  });

  describe('_registerChannel()', function () {
    it('can register a channel successfully', async function () {
      const service = new Service();
      await service.start();
      const registration = await service._registerChannel({ name: 'Chat of Chad' });
      await service.stop();
      assert.ok(service);
      assert.ok(registration);
    });
  });

  describe('_listChannels()', function () {
    xit('can list channels successfully', async function () {
      const service = new Service();
      await service.start();
      const registration = await service._registerChannel({ name: 'Chat of Chad' });
      const result = await service._listChannels();
      await service.stop();
      assert.ok(service);
      assert.ok(registration);
      assert.strictEqual(result.length, 1);
    });
  });

  describe('_listActors()', function () {
    it('can list channels successfully', async function () {
      const service = new Service();
      await service.start();
      const registration = await service._registerActor({ name: 'Chad' });
      const result = await service._listActors();
      await service.stop();
      assert.ok(service);
      assert.ok(registration);
      assert.strictEqual(result.length, 1);
    });
  });

  describe('_addMemberToChannel()', function () {
    xit('can add a member to a channel successfully', async function () {
      const service = new Service();
      await service.start();
      const channel = await service._registerChannel({ name: 'Chat of Chad' });
      const registration = await service._registerActor({ name: 'Chad' });
      const join = await service._addMemberToChannel(registration.id, channel.id);
      const after = await service._getChannel(channel.id);

      await service.stop();

      assert.ok(service);
      assert.ok(registration);
      assert.ok(join);
      assert.ok(after);
      assert.ok(after.members);

      assert.strictEqual(after.members.length, 1);
    });
  });

  describe('_getSubscriptions()', function () {
    xit('can retrieve actor subscriptions successfully', async function () {
      const service = new Service();
      await service.start();
      const channel = await service._registerChannel({ name: 'Chat of Chad' });
      const registration = await service._registerActor({ name: 'Chad' });
      const join = await service._addMemberToChannel(registration.id, channel.id);
      await service.stop();
      assert.ok(service);
      assert.ok(registration);
      assert.ok(join);
    });
  });

  describe('_getMembers()', function () {
    xit('can retrieve channel members successfully', async function () {
      const service = new Service();
      await service.start();
      const channel = await service._registerChannel({ name: 'Chat of Chad' });
      const registration = await service._registerActor({ name: 'Chad' });
      const members = await service._getMembers(channel.id);
      const join = await service._addMemberToChannel(registration.id, channel.id);
      await service.stop();
      assert.ok(service);
      assert.ok(registration);
      assert.ok(members);
      assert.ok(join);
    });
  });

  describe('_POST()', function () {
    it('can call _POST successfully', async function () {
      const service = new Service();
      await service.start();
      const link = await service._POST('/examples', { content: 'Hello, world!' });
      await service.stop();
      assert.strictEqual(link, '/examples/e3e7b6becc03c8a11a95bcbf6a4827bd9978c894d721b375bb8d9b0ba8a794ea');
      assert.ok(service);
    });

    it('provides a valid collection index', async function () {
      const service = new Service();
      await service.start();
      const link = await service._POST('/examples', { content: 'Hello, world!' });
      const result = await service._GET('/examples');
      await service.stop();
      assert.ok(result);
      assert.strictEqual(result.length, 1);
      assert.ok(service);
      assert.ok(link);
      assert.ok(result);
      assert.ok(result.length, 1);
    });

    it('provides the posted document in the expected location', async function () {
      const service = new Service();
      await service.start();
      const link = await service._POST('/examples', { content: 'Hello, world!' });
      const result = await service._GET(link);
      await service.stop();
      assert.ok(result);
      assert.strictEqual(result.address, 'e3e7b6becc03c8a11a95bcbf6a4827bd9978c894d721b375bb8d9b0ba8a794ea');
      assert.ok(service);
    });
  });
});
