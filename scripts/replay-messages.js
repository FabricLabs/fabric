#!/usr/bin/env node
'use strict';

/**
 * Collect / replay Fabric AMP Message collections.
 *
 * Canonical bytes are `Message.toBuffer()` hex — not JSON application objects.
 * See `functions/fabricMessageCollection.js` and `docs/MESSAGE_COLLECTION.md`.
 */

const { runCli } = require('../functions/fabricMessageCollection');

const code = runCli(process.argv.slice(2));
if (code) process.exit(code);
