# bfc-node

[![CI](https://github.com/zombocoder/bfc-node/actions/workflows/ci.yml/badge.svg)](https://github.com/zombocoder/bfc-node/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@bfc-node/core.svg)](https://www.npmjs.com/package/@bfc-node/core)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

Node.js bindings for [BFC](https://github.com/zombocoder/bfc) — a single-file container
format with POSIX metadata, ZSTD compression and ChaCha20-Poly1305 encryption.

## Installation

```bash
npm install @bfc-node/core
```

That is the whole setup. You do **not** need Git, CMake, a C or C++ compiler, Python,
node-gyp, the BFC sources, or ZSTD/libsodium development headers. The package ships
prebuilt binaries and picks the right one for your platform; ZSTD and libsodium are
linked statically into the addon.

## Quick start

```ts
import { createArchive, openArchive } from "@bfc-node/core";

await createArchive({
  output: "./frontend.bfc",
  inputs: ["./dist"],
});

const archive = await openArchive("./frontend.bfc");
const entries = await archive.list();

await archive.close();
```

## Supported platforms

| Platform | Architecture | libc  | Package |
| -------- | ------------ | ----- | ------- |
| macOS    | arm64        | —     | `@bfc-node/darwin-arm64` |
| Linux    | x64          | glibc | `@bfc-node/linux-x64-gnu` |
| Linux    | arm64        | glibc | `@bfc-node/linux-arm64-gnu` |
| Windows  | x64          | —     | `@bfc-node/win32-x64-msvc` |

Requires Node.js 18.17 or newer. The addon is built against Node-API 8, so it keeps
working across Node major versions without a rebuild.

macOS x64, Windows arm64, Linux musl and FreeBSD are planned. The loader already resolves
those package names, so adding a target is a build-matrix change rather than an API
change. Until then those platforms raise `UNSUPPORTED_PLATFORM` — see
[building from source](#building-from-source).

On Windows, `extractAll` creates symbolic links, which needs either Developer Mode or an
elevated process. Archives without symlinks extract normally either way. POSIX permission
bits are stored faithfully in the archive but cannot be fully applied to a Windows
filesystem on extraction.

## API

### `createArchive(options)`

Recursively archives `inputs`, preserving POSIX permissions, nanosecond `mtime`,
directories and symbolic links. Entries are added in sorted order, so two runs over an
unchanged tree produce the same archive contents.

```ts
await createArchive({
  output: "./site.bfc",
  inputs: ["./dist"],
  compression: true,
  password: "correct horse",
  filter: (relPath) => !relPath.startsWith("node_modules"),
  onProgress: ({ path, entriesDone }) => console.log(entriesDone, path),
});
```

| Option | Default | Notes |
| ------ | ------- | ----- |
| `output` | — | Path of the archive to create. |
| `inputs` | — | Files and directories to archive. |
| `baseDir` | common parent of `inputs` | A single directory input becomes the base itself, so `inputs: ["./dist"]` stores `index.html`, not `dist/index.html`. A single file input uses its parent directory. |
| `blockSize` | BFC default | Container block size in bytes. |
| `compression` | `false` | `true` means `{ type: "zstd", level: 3, threshold: 64 }`. |
| `password` / `key` | none | Enables encryption. `key` must be exactly 32 bytes. Passing both is an `INVAL` error. |
| `followSymlinks` | `false` | When `true`, links are stored as regular files. |
| `filter` | none | Return `false` to skip an entry; a skipped directory is not descended into. |
| `onProgress` | none | Called once per stored entry. |

Returns `{ path, entries, bytesWritten }`.

### `openArchive(path, options?)`

```ts
const archive = await openArchive("./site.bfc", { password: "correct horse" });
```

| Member | Description |
| ------ | ----------- |
| `archive.path` | Path the archive was opened from. |
| `archive.encrypted` | Whether any entry is encrypted. |
| `list(prefix?)` | All entries, optionally limited to a directory prefix. Recursive. |
| `stat(path)` | One entry. Rejects with `NOT_FOUND` if absent. |
| `read(path, { offset?, length? })` | Entry content as a `Buffer`. |
| `extract(path, destPath)` | Write one entry to disk, creating parent directories. Validates CRC. |
| `extractAll(destDir, { prefix? })` | Restore entries, recreating directories, symlinks, modes and timestamps. |
| `verify({ deep? })` | Check the index, or with `deep` the content checksums too. |
| `close()` | Release the file handle. |

### `openWriter(options)`

Lower-level writing, when you want to add entries one at a time rather than walk a tree.

```ts
const writer = await openWriter({ output: "./out.bfc", compression: true });
await writer.addDir("assets", { mode: 0o755 });
await writer.addFile("assets/app.js", Buffer.from("console.log(1)"));
await writer.addFile("index.html", "./dist/index.html"); // path keeps mode and mtime
await writer.addSymlink("latest.html", "index.html");
await writer.finish();
await writer.close();
```

`finish()` writes the index and footer. Without it the archive cannot be opened.

### `buildInfo`

```ts
import { buildInfo } from "@bfc-node/core";
console.log(buildInfo);
```

```js
{
  packageVersion: '0.1.0',
  napiVersion: 8,
  bfcVersion: 'v1.3.0-2-gb3777f3',
  bfcCommit: 'b3777f3',
  platform: 'darwin',
  architecture: 'arm64',
  libc: null,
  compression: true,
  encryption: true
}
```

Everything except `packageVersion` is baked in when the binary is built, so it describes
the binary you actually loaded rather than the machine you are running on.

### Errors

Failures reject with an error named `BfcError` carrying a `code`, and a `path` where one
applies. Use the exported `isBfcError` helper rather than `instanceof`: errors crossing
the native boundary are tagged plain `Error` objects.

| Code | Meaning |
| ---- | ------- |
| `BAD_MAGIC` | Not a BFC container. |
| `IO` | Filesystem or read/write failure. |
| `CRC` | Checksum mismatch — content is corrupted. |
| `INVAL` | Invalid argument, including a path that escapes the container root. |
| `EXISTS` | Entry already present. |
| `NOT_FOUND` | No such entry. |
| `PERM` | Missing decryption key. |
| `CLOSED` | Handle already closed. |
| `UNSUPPORTED_PLATFORM` | No prebuilt binary for this platform. |

## Behaviour notes

**Concurrency.** BFC handles are not thread-safe, so operations on one `Archive` or
`Writer` are serialised by a mutex held for the whole operation. Different handles run in
parallel. Every heavy operation runs on the libuv thread pool and does not block the
event loop.

**Integrity.** `verify({ deep: true })` and `extract()` validate CRC32C and fail with
`CRC` on corruption, compressed and encrypted entries included. When an archive is
encrypted and no key was supplied, `verify({ deep: true })` reports `PERM`: the content
could not be checked, which is a different statement from finding it corrupt. `read()`
does **not** validate — it supports arbitrary offsets, and a partial slice cannot be
checked against the whole-object checksum. Use `verify` or `extract` when integrity
matters.

**Extraction safety.** Archives are untrusted input. `extractAll` resolves every entry
path before writing anything and rejects with `INVAL` if one would land outside the
destination directory.

**Determinism.** `createArchive` sorts entries by path, so repeated runs over an
unchanged tree store the same entries in the same order.

## Building from source

Prebuilt binaries cover the platforms listed above. To build the addon yourself — for an
unsupported platform, or to work on the bindings — see [BUILDING.md](BUILDING.md).

Point the loader at your own binary with `BFC_NODE_NATIVE_PATH=/path/to/bfc_node.node`.

## License

Apache-2.0. Prebuilt packages statically link [Zstandard](https://github.com/facebook/zstd)
(BSD-3-Clause) and [libsodium](https://github.com/jedisct1/libsodium) (ISC); see
[NOTICE](NOTICE).
