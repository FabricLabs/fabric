# Install & npm warnings

_Generated: 2026-03-21T08:03:50.408Z_

## From `reports/install.log`

_No warning-shaped lines in `install.log`._

## From `npm ci --dry-run`

_Skipped (`SKIP_NPM_DRY_RUN=1`)._

## npm stderr probe (`npm config get prefix`)

Catches environment/config notices (for example IDE-set `devdir`) that may not appear in `install.log`.

```
npm warn Unknown env config "devdir". This will stop working in the next major version of npm.
```

---

Refresh install log: `npm run report:install-ci`.
Disable dry-run section: `SKIP_NPM_DRY_RUN=1 npm run report:warnings`.