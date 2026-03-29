# Non-canonical and historical documentation

Some Markdown files in the repository root (and a few under **`examples/`**) are **not** part of the maintained documentation set. They may be interesting as background—benchmarks, experiments, phase write-ups—but they are **not** kept in sync with **`@fabric/core`** releases.

**Prefer, in order:** **[VISION.md](../VISION.md)**, **[README.md](../README.md)**, **[QUICKSTART.md](../QUICKSTART.md)**, **[DEVELOPERS.md](../DEVELOPERS.md)**, **[CHANGELOG.md](../CHANGELOG.md)**, **[docs/README.md](README.md)**.

## Patterns (typical cruft)

| Pattern | Role |
|--------|------|
| `PHASE_*_COMPLETION_REPORT.md`, `*_COMPLETION_REPORT.md` | Milestone snapshots; may contradict current code. |
| `*_IMPLEMENTATION_COMPLETE.md`, `IMPLEMENTATION_FINAL_SUMMARY.md` | Historical “done” claims; verify against **`npm test`** / **`npm run ci`**. |
| `FABRIC_*_ANALYSIS.md`, `MESSAGING_PROTOCOL_*.md`, `PROJECT_ANALYSIS.md` | Design notes; cross-check **PROTOCOL.md** / **MESSAGES.md** / **constants**. |
| `BENCHMARK_RESULTS.md`, `FINAL_BENCHMARK_SUMMARY.md`, `PEER_TEST_RESULTS.md` | Point-in-time numbers; not release criteria by themselves. |
| `WEBGPU_*`, `examples/README-WEBGPU.md` | Research / optional track (see **VISION.md** § Experimental). |
| `YELLOWPAPER.md`, `fabric-whitepaper.md`, `snippets/*.md` | Narrative and drafts; not API truth. |

## What we do with these over time

- **Do not** delete aggressively without maintainer review (some items are referenced in issues or chats).
- **Do** add new narrative docs under **`docs/`** or **`guides/`** when they become real references, and link them from **docs/README.md** and **VISION.md**.
- **Shrink surface:** prefer one **CHANGELOG** entry and **VISION** updates over new root-level “completion” files.
