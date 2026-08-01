import test from "node:test";
import assert from "node:assert/strict";
import { loadNative, nativeBinaryPath } from "../helpers/native.mjs";
import { canInspectLinkage, dynamicLibs } from "../helpers/linkage.mjs";

test("addon reports the vendored libsodium version", () => {
  const native = loadNative();
  assert.match(native.sodiumVersion(), /^\d+\.\d+\.\d+$/);
});

test("libsodium is linked statically", { skip: canInspectLinkage ? false : "no linkage inspector on windows" }, () => {
  const libs = dynamicLibs(nativeBinaryPath);
  const offenders = libs.filter((l) => l.includes("libsodium"));
  assert.deepEqual(offenders, [], `expected no dynamic libsodium, found: ${offenders.join(", ")}`);
});
