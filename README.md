# WebGBA

A Game Boy Advance emulator that runs entirely in your browser. The emulation is
[mGBA](https://mgba.io) 0.10.5 compiled to WebAssembly; the interface is React.

**Play:** https://erinpanes052204.github.io/WebGBA/

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
`07108af52f45b53943f76074102a86931cb096647447844ad2ddaadb4a2b36ea`
