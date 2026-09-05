# Web distribution review — 0.1.97

Engineering evidence, not a legal warranty or native/store approval.

- The conservative npm notice collection includes production dependencies;
  main-bundle collection additionally covers development-listed runtime modules.
  Worker imports use the same pinned Three.js, fflate, AssimpJS and CAD packages.
  Workbox generated runtime is MIT and retains its generated header.
- react-remove-scroll-bar 2.3.8 declares MIT. All 24 dist files match npm 2.3.7
  byte-for-byte. GitHub comparison v2.3.7 through
  7301c160fda44cb8cf2b9fdfde61efad35736196 changes only LICENSE. The upstream
  notice is included unchanged. The unpublished 2.3.8 gitHead is not relied on.
- Basis supplemental LICENSES and zstd LICENSE are retained from
  051ad6d8a64bb95a79e8601c317055fd1782ad3e, alongside its main license.
  Draco main license contains supplemental upstream notices. Existing decoder
  hashes identify the unmodified Three.js redistribution artifacts.
- AssimpJS 0.0.10 pins Assimp cf7d36376658891c5abb0e9fb4fde8ee45be1db3.
  Its main and contrib license texts are conservatively included. No upstream
  test models or private customer files are distributed.
- The modified CAD source and exact upstream commit/build instructions are in
  native/cad-wasm/README.md. Web users may rebuild the module and the frontend
  and serve their own copy; no publisher signing key or account is required.
  This does not claim identical compiler output or native-device acceptance.
- Complete texts are accessible through About and public static license assets.
  The matching versioned Core archive must exist before public deployment.
- Native/Android/iOS dependency, device, signing and store checks remain
  separate. This review does not mark their general strict audit approved.

## Rebuilding the web viewer

Download the matching Core source ZIP, install Node.js and run `npm ci`,
`npm run check`, `npm run build`, then `npm run preview`. To modify the CAD
library first follow native/cad-wasm/README.md, replace vendor/cad-wasm/dist
with the rebuilt outputs and repeat the frontend build. Serve dist on your
own origin. The app does not check a publisher signature on these modules.
