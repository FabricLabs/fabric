'use strict';

const fs = require('fs');
const assert = require('assert');
const Logger = require('../types/logger');

const path = './logs/test';

describe('@fabric/core/types/logger', function () {
  describe('Logger', function () {
    it('should handle strings', async function () {
      const start = (new Date()).toISOString();
      const logger = new Logger({ path });
      await logger.start();
      await logger.log(`${start} [TEST] Hello, world!`);
      await logger.stop();
      assert.ok(logger);
      assert.ok(fs.existsSync(logger.path));
    });

    it('should handle pure objects', async function () {
      const start = (new Date()).toISOString();
      const logger = new Logger({ path });
      await logger.start();
      await logger.log({
        content: `${start} [TEST] Hello, world!`
      });
      await logger.stop();
      assert.ok(logger);
      assert.ok(fs.existsSync(logger.path));
    });
  });
});
