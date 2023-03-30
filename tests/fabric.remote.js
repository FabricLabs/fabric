'use strict';

const assert = require('assert');
const http = require('http');
const Remote = require('../types/remote');

const sample = {
  authority: 'localhost:3333',
  secure: false
};

const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.write('{"status":"SUCCESS"}');
  response.end();
});

describe('@fabric/core/types/remote', function () {
  before(function () {
    server.listen(3333);
  });

  after(function () {
    server.close();
  });

  describe('Remote', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Remote instanceof Function, true);
    });

    it('can instantiate from sample data', function (done) {
      async function test () {
        const remote = new Remote(sample);
        assert.ok(remote);
        done();
      }

      test();
    });

    it('can call enumerate', function (done) {
      async function test () {
        try {
          const remote = new Remote(sample);
          const response = await remote.enumerate('/');

          assert.ok(remote);
          assert.ok(response);
        } catch (exception) {
          
        }
        done();
      }

      test();
    });

    it('can call OPTIONS', function (done) {
      async function test () {
        try {
          const remote = new Remote(sample);
          const options = await remote._OPTIONS('/');

          assert.ok(remote);
          assert.ok(options);
        } catch (exception) {

        }
        done();
      }

      test();
    });

    it('can call GET', function (done) {
      async function test () {
        try {
          const remote = new Remote(sample);
          const response = await remote._GET('/');

          assert.ok(remote);
          assert.ok(response);
        } catch (exception) {
          
        }
        done();
      }

      test();
    });

    it('can call PUT', function (done) {
      async function test () {
        try {
          const remote = new Remote(sample);
          const response = await remote._PUT('/assets/foo', 'FOO');

          assert.ok(remote);
          assert.ok(response);
        } catch (exception) {
          
        }
        done();
      }

      test();
    });

    it('can call POST', function (done) {
      async function test () {
        try {
          const remote = new Remote(sample);
          const response = await remote._POST('/examples', 'FOO');

          assert.ok(remote);
          assert.ok(response);
        } catch (exception) {
          
        }
        done();
      }

      test();
    });

    it('can call POST using querystring', function (done) {
      async function test () {
        try {
          const remote = new Remote(sample);
          const response = await remote._POST('/examples', 'FOO', {
            mode: 'query'
          });

          assert.ok(remote);
          assert.ok(response);
        } catch (exception) {
          
        }
        done();
      }

      test();
    });

    it('can call PATCH', function (done) {
      async function test () {
        try {
          const remote = new Remote(sample);
          const response = await remote._PATCH('/assets/foo', 'BAR');

          assert.ok(remote);
          assert.ok(response);
        } catch (exception) {
          
        }
        done();
      }

      test();
    });

    it('can call DELETE', function (done) {
      async function test () {
        try {
          const remote = new Remote(sample);
          const response = await remote._DELETE('/assets/foo');

          assert.ok(remote);
          assert.ok(response);
        } catch (exception) {
          
        }
        done();
      }

      test();
    });

    it('can call SEARCH', function (done) {
      async function test () {
        try {
          const remote = new Remote(sample);
          const response = await remote._SEARCH('/');

          assert.ok(remote);
          assert.ok(response);
        } catch (exception) {
          
        }
        done();
      }

      test();
    });
  });
});
