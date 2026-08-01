import test from "node:test";
import assert from "node:assert/strict";
import { loadNative, nativeBinaryPath } from "../helpers/native.mjs";
import { canInspectLinkage, dynamicLibs } from "../helpers/linkage.mjs";

test("addon reports the vendored zstd version", () => {
  const native = loadNative();
  assert.match(native.zstdVersion(), /^\d+\.\d+\.\d+$/);
  assert.equal(native.zstdVersion(), "1.5.7");
});

test("zstd is linked statically", { skip: canInspectLinkage ? false : "no linkage inspector on windows" }, () => {
  const libs = dynamicLibs(nativeBinaryPath);
  const offenders = libs.filter((l) => l.includes("libzstd"));
  assert.deepEqual(offenders, [], `expected no dynamic libzstd, found: ${offenders.join(", ")}`);
});
