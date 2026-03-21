# Documentation audit (living)
_Last pass: 2026-03-20_

## Scope
| Area | Role | Maintainer notes |
| --- | --- | --- |
| Root `*.md` | Handbook sources for HonKit (`SUMMARY.md`) | Fix broken refs here first. |
| `guides/*.md` | Linked from SUMMARY | Paths must match real files (`guides/SETTINGS.md`, etc.). |
| `docs/*.md` | Curated parity / checklists | Safe to edit by hand. |
| `docs/*.html` | JSDoc output (`npm run make:docs`) | Regenerated; do not hand-edit. |
| `API.md` | jsdoc2md (`npm run make:api`) | Regenerated. |

## Fixes applied (this round)
- **`SUMMARY.md`** — Guide targets pointed at non-existent root files (`SETTINGS.md`, `SERVICES.md`, …). Updated to **`guides/…`** and added **Actors** / **Contracts** to the outline.

## Outstanding / verify manually
- **`dev.fabric.pub`** links in `SUMMARY.md` (`api-docs`, `api-examples`) — confirm host still serves expected content; run `CHECK_BOOK_EXTERNAL=1 npm run check:book-links` after `npm run make:dev`.
- **`book.json` `edit-link`** — `base` still references `master`; branch may be `main` or feature branches.
- **Typos** — `package.json` `review:todo` / disclosures string uses `securiy@` (known typo); align with security contacts doc when you touch it.
- **Node version** — `.nvmrc` is **22.14.0**; scrub docs that still mention Node 16 for *this* repo.

## Commands
```bash
# TODO/FIXME index (excludes generated docs tree)
npm run report:todo

# Dev book (same tree as npm run dev)
npm run make:dev
npm run check:book-links
```

`check:book-links` **skips `docs/`** under `_book` by default (JSDoc HTML references missing `App.html` stubs — fix upstream in jsdoc templates later). To include that tree: `BOOK_LINK_SKIP_PREFIXES= npm run check:book-links`.

Optional: probe external https links (slow, needs network):

`CHECK_BOOK_EXTERNAL=1 npm run check:book-links`

## Related
- [`GOALS.md`](../GOALS.md) — immediate engineering goals.
- [`reports/README.md`](../reports/README.md) — warnings, deprecations, coverage baseline.
