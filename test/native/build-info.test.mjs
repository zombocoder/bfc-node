import test from "node:test";
import assert from "node:assert/strict";
import { loadNative, nativeBinaryPath } from "../helpers/native.mjs";
import { canInspectLinkage, dynamicLibs } from "../helpers/linkage.mjs";

test("nativeBuildInfo reports compile-time metadata", () => {
  const info = loadNative().nativeBuildInfo();

  assert.equal(info.napiVersion, 8);
  assert.equal(typeof info.bfcVersion, "string");
  assert.ok(info.bfcVersion.length > 0, "bfcVersion must not be empty");
  assert.match(info.bfcCommit, /^[0-9a-f]{7,40}$/);
  assert.equal(info.compression, true);
  assert.equal(info.encryption, true);
  assert.equal(info.platform, process.platform);
  assert.equal(info.architecture, process.arch);
});

test("libc is glibc or musl on linux, null elsewhere", () => {
  const info = loadNative().nativeBuildInfo();
  if (process.platform === "linux") {
    assert.ok(["glibc", "musl"].includes(info.libc), `unexpected libc: ${info.libc}`);
  } else {
    assert.equal(info.libc, null);
  }
});

test("libbfc is linked statically", { skip: canInspectLinkage ? false : "no linkage inspector on windows" }, () => {
  const libs = dynamicLibs(nativeBinaryPath);
  const offenders = libs.filter((l) => l.includes("libbfc"));
  assert.deepEqual(offenders, [], `expected no dynamic libbfc, found: ${offenders.join(", ")}`);
});
