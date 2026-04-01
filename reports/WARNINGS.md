# Install & npm warnings

_Generated: 2026-04-01T19:09:14.541Z_

## From `reports/install.log`

_No warning-shaped lines in `install.log`._

## From `npm ci --dry-run`

_`npm ci --dry-run` produced no warn/notice lines._

## npm stderr probe (`npm config get prefix`)

Catches environment/config notices (for example IDE-set `devdir`) that may not appear in `install.log`.

```
npm warn Unknown env config "devdir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
```

---

Refresh install log: `npm run report:install-ci`.
Disable dry-run section: `SKIP_NPM_DRY_RUN=1 npm run report:warnings`.