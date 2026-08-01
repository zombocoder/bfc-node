import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("vendor/bfc submodule is checked out", () => {
  assert.ok(
    existsSync(join(root, "vendor/bfc/include/bfc.h")),
    "vendor/bfc/include/bfc.h missing — run: git submodule update --init --recursive",
  );
});

test("vendor/zstd submodule is checked out", () => {
  assert.ok(
    existsSync(join(root, "vendor/zstd/lib/zstd.h")),
    "vendor/zstd/lib/zstd.h missing",
  );
});

test("vendor/libsodium submodule is checked out", () => {
  assert.ok(
    existsSync(join(root, "vendor/libsodium/src/libsodium/include/sodium.h")),
    "vendor/libsodium/src/libsodium/include/sodium.h missing",
  );
});
