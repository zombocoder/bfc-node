import test from "node:test";
import assert from "node:assert/strict";
import { getNativePackageName, loadNative } from "../src/loader.ts";
import { BfcError, isBfcError } from "../src/errors.ts";

test("maps every supported platform to its package", () => {
  assert.equal(getNativePackageName("darwin", "arm64", false), "@bfc-node/darwin-arm64");
  assert.equal(getNativePackageName("darwin", "x64", false), "@bfc-node/darwin-x64");
  assert.equal(getNativePackageName("win32", "x64", false), "@bfc-node/win32-x64-msvc");
  assert.equal(getNativePackageName("win32", "arm64", false), "@bfc-node/win32-arm64-msvc");
  assert.equal(getNativePackageName("freebsd", "x64", false), "@bfc-node/freebsd-x64");
  assert.equal(getNativePackageName("linux", "x64", false), "@bfc-node/linux-x64-gnu");
  assert.equal(getNativePackageName("linux", "x64", true), "@bfc-node/linux-x64-musl");
  assert.equal(getNativePackageName("linux", "arm64", false), "@bfc-node/linux-arm64-gnu");
  assert.equal(getNativePackageName("linux", "arm64", true), "@bfc-node/linux-arm64-musl");
});

test("throws UNSUPPORTED_PLATFORM for an unknown target", () => {
  assert.throws(
    () => getNativePackageName("sunos", "sparc64", false),
    (err: unknown) => {
      assert.ok(isBfcError(err));
      assert.equal(err.code, "UNSUPPORTED_PLATFORM");
      assert.match(err.message, /sunos\/sparc64/);
      return true;
    },
  );
});

test("BfcError carries name, code and optional path", () => {
  const err = new BfcError("boom", "IO", "/tmp/x");
  assert.equal(err.name, "BfcError");
  assert.equal(err.code, "IO");
  assert.equal(err.path, "/tmp/x");
  assert.ok(err instanceof Error);
  assert.ok(isBfcError(err));
});

test("isBfcError rejects plain errors", () => {
  assert.equal(isBfcError(new Error("nope")), false);
  assert.equal(isBfcError("nope"), false);
});

test("loadNative returns the built addon", () => {
  const native = loadNative();
  assert.equal(typeof native.nativeBuildInfo, "function");
  assert.equal(typeof native.Writer.create, "function");
  assert.equal(typeof native.Archive.open, "function");
});
