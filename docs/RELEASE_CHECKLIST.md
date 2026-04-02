# Release checklist — `@fabric/core`
Use before tagging **v0.1.0-RC1** (or subsequent RCs/releases).

- [ ] Clean tree on the agreed branch (`feature/v0.1.0-RC1` or `main` per team process).
- [ ] `npm ci` on **Node 24.14.x**.
- [ ] **`npm run ci`** (full test suite).
- [ ] Confirm **native** modules build on a fresh Linux image if you ship to production servers.
- [ ] Update **CHANGELOG.md** with version, date, breaking vs additive notes.
- [ ] Bump **version** in `package.json`.
- [ ] **Downstream:** bump **`@fabric/core`** references in [fabric-http](https://github.com/FabricLabs/fabric-http) and [hub.fabric.pub](https://github.com/FabricLabs/hub.fabric.pub); run their `npm run ci`. Hub requires **`functions/publishedDocumentEnvelope`** for document/payment binding.
- [ ] Tag and push: `git tag -a v0.1.0-RC1 -m "…"`.
- [ ] Publish **npm** `@fabric/core` when ready, or document Git install ref for integrators.
