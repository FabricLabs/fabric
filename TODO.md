# Things to Do
## Current Goals
- [ ] Release `@fabric/core#v0.1.0-RC1`
  - [ ] Document development process
    - [ ] `reports/`
    - [ ] `scripts/`
- [ ] Document configuration
  - [ ] Document use of environment variables
  - [ ] Document use of `settings/local.js`
  - [ ] Document use of `~/.fabric`
- [ ] Enable Lightning support

See also [GOALS.md][goals].

## Short List
- [x] `npm audit --production`
- [ ] `npm audit --dev`
- [x] Test with Node 16
- [ ] Clean up outstanding warnings
- [ ] Tests passing on Travis
- [ ] Tests passing on GitHub Actions
- [ ] Test Coverage 70%
- [ ] Clean install from @portal/feed
- [x] Install Time < 300s
- [ ] Install Time < 30s

## Annoyances:
Upon running `rm -rf node_modules && npm i` from `@portal/feed` repo:
```
npm WARN deprecated source-map-url@0.4.1: See https://github.com/lydell/source-map-url#deprecated
npm WARN deprecated urix@0.1.0: Please see https://github.com/lydell/urix#deprecated
npm WARN deprecated resolve-url@0.2.1: https://github.com/lydell/resolve-url#deprecated
npm WARN deprecated source-map-resolve@0.5.3: See https://github.com/lydell/source-map-resolve#deprecated
npm WARN deprecated gulp-util@3.0.8: gulp-util is deprecated - replace it, following the guidelines at https://medium.com/gulpjs/gulp-util-ca3b1f9f9ac5
npm WARN deprecated fsevents@1.2.13: fsevents 1 will break on node v14+ and could be using insecure binaries. Upgrade to fsevents 2.
npm WARN deprecated chokidar@2.1.8: Chokidar 2 does not receive security updates since 2019. Upgrade to chokidar 3 with 15x fewer dependencies
npm WARN deprecated uuid@3.4.0: Please upgrade  to version 7 or higher.  Older versions may use Math.random() in certain circumstances, which is known to be problematic.  See https://v8.dev/blog/math-random for details.
npm WARN deprecated viz.js@1.8.2: no longer supported

added 1598 packages, and audited 1599 packages in 2m

94 packages are looking for funding
  run `npm fund` for details

22 vulnerabilities (13 moderate, 4 high, 5 critical)
```

**@fabric/core:**
```
npm WARN deprecated har-validator@5.1.5: this library is no longer supported
npm WARN deprecated uuid@3.4.0: Please upgrade  to version 7 or higher.  Older versions may use Math.random() in certain circumstances, which is known to be problematic.  See https://v8.dev/blog/math-random for details.
npm WARN deprecated request@2.88.2: request has been deprecated, see https://github.com/request/request/issues/3142

added 746 packages, and audited 747 packages in 30s

62 packages are looking for funding
  run `npm fund` for details

9 vulnerabilities (5 moderate, 4 high)
```

[goals]: GOALS.md
