'use strict';

/**
 * @fileoverview CLI `--password` / `FABRIC_PASSWORD` reader for the `fabric` binary.
 * @module functions/cliPasswordArgv
 *
 * Commander’s `--password <PASSWORD>` is a separate token; operators also
 * pass `--password=VALUE`. Generic `PASSWORD` is ignored (wallet lock follow-up).
 */

/**
 * @param {string[]} argv
 * @param {Object} [env]
 * @returns {string}
 */
function readCliPasswordFromArgv (argv, env = process.env) {
  const list = Array.isArray(argv) ? argv : [];
  const inline = list.find((a) => String(a).startsWith('--password='));
  if (inline) return String(inline).slice('--password='.length);
  const i = list.indexOf('--password');
  if (i >= 0 && list[i + 1] && !String(list[i + 1]).startsWith('-')) {
    return String(list[i + 1]);
  }
  return String((env && env.FABRIC_PASSWORD) || '');
}

module.exports = {
  readCliPasswordFromArgv
};
