'use strict';

/**
 * @fileoverview CLI `--password` / `FABRIC_PASSWORD` reader for the `fabric` binary.
 * @module functions/cliPasswordArgv
 *
 * Commander’s `--password <PASSWORD>` is a separate token; operators also
 * pass `--password=VALUE`. Generic `PASSWORD` is ignored (wallet lock follow-up).
 * Scanning stops at a standalone `--` terminator. `--password --flag` is not a
 * password; `--password -secret` is. An explicit `--password=` (empty) does not
 * fall back to the environment.
 *
 * @example
 * readCliPasswordFromArgv(['node', 'fabric', '--password=VALUE'], {});
 * readCliPasswordFromArgv(['node', 'fabric'], { FABRIC_PASSWORD: 'VALUE' });
 */

/**
 * @param {string[]} argv
 * @param {Object} [env]
 * @returns {string}
 */
function readCliPasswordFromArgv (argv, env = process.env) {
  const list = Array.isArray(argv) ? argv : [];
  const terminator = list.indexOf('--');
  const scan = terminator >= 0 ? list.slice(0, terminator) : list;
  const inline = scan.find((a) => String(a).startsWith('--password='));
  if (inline) return String(inline).slice('--password='.length);
  const i = scan.indexOf('--password');
  if (i >= 0) {
    if (i + 1 < scan.length) {
      const next = String(scan[i + 1]);
      if (!next.startsWith('--')) return next;
    }
    return '';
  }
  return String((env && env.FABRIC_PASSWORD) || '');
}

module.exports = {
  readCliPasswordFromArgv
};
