# Security audit (npm)

_Generated: 2026-03-21T08:03:54.843Z_

Machine-readable: [`npm-audit.json`](./npm-audit.json) (full `npm audit --json`).

---

## Summary

info: 0 · low: 1 · moderate: 0 · high: 3 · critical: 0

## Advisories (name → severity)

- **flat-cache** — _high_ — flatted
- **flatted** — _high_ — flatted vulnerable to unbounded recursion DoS in parse() revive phase; Prototype Pollution via parse() in NodeJS flatted
- **honkit** — _high_ — flat-cache; send
- **send** — _low_ — send vulnerable to template injection that can lead to XSS

---

## `npm audit` (text)

```
# npm audit report

flatted  <=3.4.1
Severity: high
flatted vulnerable to unbounded recursion DoS in parse() revive phase - https://github.com/advisories/GHSA-25h7-pfq9-p65f
Prototype Pollution via parse() in NodeJS flatted - https://github.com/advisories/GHSA-rf6f-7fwh-wjgh
fix available via `npm audit fix`
node_modules/honkit/node_modules/flatted
  flat-cache  1.3.1 || 2.0.0 - 2.0.1
  Depends on vulnerable versions of flatted
  node_modules/honkit/node_modules/flat-cache

send  <0.19.0
send vulnerable to template injection that can lead to XSS - https://github.com/advisories/GHSA-m6fv-jmcg-4jfg
fix available via `npm audit fix --force`
Will install honkit@6.1.7, which is outside the stated dependency range
node_modules/send
  honkit  <=6.1.6
  Depends on vulnerable versions of flat-cache
  Depends on vulnerable versions of send
  node_modules/honkit

4 vulnerabilities (1 low, 3 high)

To address issues that do not require attention, run:
  npm audit fix

To address all issues, run:
  npm audit fix --force

npm warn Unknown env config "devdir". This will stop working in the next major version of npm.
```

---

CI / automation may use `npm audit --audit-level=...`. Legacy script `npm run audit` only wrote critical-level JSON to `AUDIT.json`.

Regenerate: `npm run report:security` or `npm run report:quality`.