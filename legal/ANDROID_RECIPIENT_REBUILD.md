# Android recipient rebuild and CAD replacement

This is a technical recipe, not a claim that the distribution review is closed.
The matching source archive must be supplied to recipients before distribution.
Never provide Kea3D's upload key or its password.

1. Extract the matching Core source archive into a new directory.
2. Install Node/npm, Rust with `aarch64-linux-android`, JDK 17, and the Android
   SDK/NDK required by the included Gradle and Tauri configuration.
3. Run `npm ci`. The lockfile references the included `vendor/cad-wasm` package.
4. To modify the CAD library, follow `native/cad-wasm/README.md`. It records the
   exact importer, OCCT and Emscripten revisions. The build script copies the
   rebuilt JS/WASM into `vendor/cad-wasm/dist`. Do not use
   `-PackageExistingBuild` as evidence of compiling a modification.
5. Run `npm run check` and `npm run build`, then
   `npm run mobile:android:build -- --debug --apk --target aarch64`.
   Set `JAVA_HOME` and `ANDROID_HOME` to your own installations first.
6. Install your independently signed debug APK. Its package name is
   `com.kea3d.app.debug`. No owner's upload key is required. A release build
   signed with your own key cannot update an existing official installation
   signed by another key; use a separate application ID or uninstall it first
   after exporting any local data you need.

Android assets may be embedded in a signed package. This workflow replaces the
library before packaging; it does not promise in-place replacement inside the
installed Play application. There is no license-check mechanism intended to
prevent a recipient from rebuilding with a modified CAD library.

Verification still required before approval: compile a deliberately modified
CAD library, build from the isolated source snapshot, install on a real Android
device, and confirm the modified library executes. Desktop frontend tests do
not establish this result.
