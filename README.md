# WebGBA

A Game Boy Advance emulator that runs entirely in your browser. The emulation is
[mGBA](https://mgba.io) 0.10.5 compiled to WebAssembly; the interface is React.

**Play:** `https://YOUR-USERNAME.github.io/YOUR-REPO/` (replace with your own link)

- **Bring your own games.** No ROMs, BIOS files or cover art are included or ever will be.
  Use only games you own.
- **Private.** Everything runs locally. Your games, saves and settings stay in your browser
  (IndexedDB); nothing is uploaded. Use *Settings > Backup* to keep a copy.
- **Controller friendly.** Select + Start opens the game list; D-pad navigates; hold a button for turbo.
- Works best in Chrome / Edge. Firefox works; Safari is untested.

## Where the code comes from
- `core/mgba.wasm` is **unmodified** mGBA 0.10.5 ([source](https://github.com/mgba-emu/mgba/tree/0.10.5),
  MPL-2.0, see `LICENSE-mGBA.txt`) plus a small glue file, `build/wasm_api.c`.
  Rebuild it yourself with `build/build-core.sh` (needs Emscripten).
- `vendor/` holds React and htm (MIT), bundled so the page loads nothing from third parties.

### Verify the binary
`core/mgba.wasm` SHA-256:
`a646127e709cbd4c778fc26820b54eedbbc36975e771c58865f616ed98780e47`

It was rebuilt from scratch with `build/build-core.sh` on Ubuntu 24.04 (Emscripten 3.1.6 from the
distro package, `emscripten 3.1.6~dfsg-7`) and the result was byte-for-byte identical. A different
Emscripten version may produce a different (but equivalent) file.

## Tests
`cd tests && npm install && node run.js` runs 14 browser tests (saves, imports, backups, phone layout, ...)
against a real headless Chrome using generated test ROMs. `.github/workflows/test.yml` runs them on every push.
