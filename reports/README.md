# Reports
Various reports are kept in this directory.

| Report | Command |
| --- | --- |
| Install log (CI-shaped) | `npm run report:install-ci` → `install.log` |
| **Warnings** (install log + optional `npm ci --dry-run`) | `npm run report:warnings` → [`WARNINGS.md`](./WARNINGS.md) |
| **Deprecations** (lockfile + `settings/deprecations.js` + `@deprecated` scan) | `npm run report:deprecations` → [`DEPRECATIONS.md`](./DEPRECATIONS.md) |
| **Security** (full `npm audit --json` + summary) | `npm run report:security` → [`SECURITY-AUDIT.md`](./SECURITY-AUDIT.md), [`npm-audit.json`](./npm-audit.json) |
| All of the above | `npm run report:quality` |

Legacy: `npm run audit` writes only **critical**-level JSON to `AUDIT.json` (narrower than `report:security`).

See also: [`TODO.txt`](./TODO.txt), [`COVERAGE-BASELINE.md`](./COVERAGE-BASELINE.md) (after `npm run report:coverage-baseline`).

Book / dev server links: `npm run make:dev` then `npm run check:book-links` — see [`docs/DOCUMENTATION-AUDIT.md`](../docs/DOCUMENTATION-AUDIT.md).
