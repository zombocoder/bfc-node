# Building from source

Users of `@bfc-node/core` never need this — `npm install` ships a prebuilt binary. Follow
this guide only to work on the bindings, or to produce a binary for a platform that has
no prebuilt package yet.

## Prerequisites

- Node.js 22 or newer. (The published package supports Node 18.17+; development needs 22
  because the test runner expands the glob patterns in `npm test`.)
- CMake 3.20 or newer.
- A C17 and C++17 compiler.
- On macOS and Linux: autoconf, automake and libtool — a libsodium git checkout ships no
  `./configure`, and `autogen.sh` generates it.
- On Windows: Visual Studio 2022 with the C++ workload, and `msbuild` on `PATH`.
  libsodium has no autotools build there; it is built from the Visual Studio solution it
  ships in `builds/msvc/vs2022`.

```bash
# macOS
brew install cmake autoconf automake libtool

# Debian / Ubuntu
sudo apt-get install -y cmake autoconf automake libtool
```

## Clone and build

The BFC, Zstandard and libsodium sources come in as Git submodules, so clone
recursively:

```bash
git clone --recursive https://github.com/zombocoder/bfc-node.git
cd bfc-node
npm ci
npm run build:native   # compiles zstd, libsodium, libbfc and the addon
npm run build          # bundles dist/ and emits declarations
npm test
```

If you already cloned without `--recursive`:

```bash
git submodule update --init --recursive
```

The addon lands at `build/Release/bfc_node.node`. The first build takes a few minutes
because libsodium is configured and compiled from scratch; later builds are cached.

`npm run ci` runs the exact chain CI runs: drift check, native build, bundle, typecheck,
declaration check, tests.

## Using your own binary

The loader looks for the addon in this order:

1. `BFC_NODE_NATIVE_PATH` — an explicit path to a `.node` file.
2. `build/Release/bfc_node.node` relative to the package root — a local build.
3. The platform package, e.g. `@bfc-node/darwin-arm64/bfc_node.node`.

So to use a self-built binary with an installed copy of the package:

```bash
BFC_NODE_NATIVE_PATH=/path/to/bfc_node.node node your-script.mjs
```

## How the native build is wired

`CMakeLists.txt` pulls in three modules:

- `cmake/BuildZstd.cmake` — adds `vendor/zstd/build/cmake` as a subdirectory with only
  the static library enabled, producing `libzstd_static`.
- `cmake/BuildSodium.cmake` — on Unix runs libsodium's autotools build through
  `ExternalProject_Add` (`autogen.sh -s`, then `configure --enable-static --disable-shared
  --with-pic`); on Windows invokes MSBuild on the bundled `vs2022` project with
  `Configuration=ReleaseLIB` and an explicit `/p:OutDir`, because the default output path
  embeds the platform toolset version. Either way the result is imported as
  `sodium::static`.
- `cmake/BuildBfc.cmake` — compiles the eight `libbfc` sources listed in
  `cmake/bfc-sources.json` into `bfc_static`, with `BFC_WITH_ZSTD` and `BFC_WITH_SODIUM`
  defined, and generates `bfc_node_build_info.h` from the pinned submodule's Git
  description.

`native/CMakeLists.txt` then links the addon against `bfc_static`, which propagates the
two static dependencies.

### Why not use BFC's own CMakeLists

BFC's top-level `CMakeLists.txt` requires *system* libzstd and libsodium through
pkg-config, unconditionally builds the CLI, and sets a global `-Werror` that makes the
build depend on the compiler version. Compiling the library sources directly avoids all
three while keeping upstream's architecture flags.

The risk is that upstream adds a source file and our list silently goes stale.
`scripts/check-drift.mjs` guards against that: it parses `BFC_LIB_SOURCES` from the
pinned submodule and fails the CMake configure step on any mismatch. When that happens,
reconcile `cmake/bfc-sources.json` with upstream and rebuild.

## How platform packages are wired

The root `package.json` deliberately has **no** `optionalDependencies`. npm cannot record
a package that is not yet on the registry into `package-lock.json`, so listing our own
platform packages there makes `npm ci` fail with `Missing: @bfc-node/... from lock file` —
on the first release, and again every time a platform is added.

`scripts/apply-optional-deps.mjs` writes them into `package.json` during the release job,
just before publishing, deriving the list from the `npm/*` directories and asserting every
version matches the main package. The published tarball therefore declares them; the repo
stays installable.

`package-lock.json` must be generated with **npm 11**. npm 10 records only the current
platform's optional binaries, so a lockfile made on macOS lacks
`@rollup/rollup-linux-x64-gnu` and `npm ci` fails on Linux. Use `npx npm@11 install` when
updating dependencies.

## Adding a platform

The loader already knows about musl, Windows, macOS x64 and FreeBSD targets. Adding one
means:

1. Create `npm/<target>/package.json` with matching `os` and `cpu`, plus a `README.md`.
2. Add a matrix entry to `.github/workflows/ci.yml` and `.github/workflows/release.yml`.
3. Extend the target list in `test/packaging.test.mjs`.

There is no step for `optionalDependencies` — they are derived from `npm/*` at publish time.

Two known porting details:

- `native/src/entry.cc` uses `S_IFMT`, `S_IFDIR` and `S_IFLNK`, which MSVC does not
  provide; a Windows port needs its own constants.
- `native/src/writer.cc` uses `fmemopen` to add files from memory. It is POSIX-only, so
  Windows needs a temporary-file fallback.
