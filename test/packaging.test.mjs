import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = ["darwin-arm64", "linux-x64-gnu", "linux-arm64-gnu", "win32-x64-msvc"];

const readJson = async (p) => JSON.parse(await readFile(join(root, p), "utf8"));

// npm cannot record an unpublished package in package-lock.json, so listing our
// own platform packages here breaks `npm ci` with "Missing: @bfc-node/... from
// lock file" — on the first release, and again whenever a platform is added.
// They are injected at publish time instead.
test("committed package.json declares no optionalDependencies", async () => {
  const pkg = await readJson("package.json");
  assert.equal(
    pkg.optionalDependencies,
    undefined,
    "optionalDependencies belong to the published tarball, not the repo",
  );
});

test("the publish step injects every platform package at the main version", async () => {
  const { applyOptionalDeps } = await import("../scripts/apply-optional-deps.mjs");
  const original = await readFile(join(root, "package.json"), "utf8");
  try {
    const deps = await applyOptionalDeps(root);
    const version = JSON.parse(original).version;
    assert.deepEqual(
      Object.keys(deps).sort(),
      TARGETS.map((t) => `@bfc-node/${t}`).sort(),
    );
    for (const [name, pinned] of Object.entries(deps)) {
      assert.equal(pinned, version, `${name} must be pinned to ${version}`);
    }
  } finally {
    await writeFile(join(root, "package.json"), original);
  }
});

test("main package has no install script", async () => {
  const pkg = await readJson("package.json");
  assert.equal(pkg.scripts.install, undefined);
  assert.equal(pkg.scripts.preinstall, undefined);
  assert.equal(pkg.scripts.postinstall, undefined);
});

test("main package ships dist and the legal files, but not sources", async () => {
  const pkg = await readJson("package.json");
  assert.deepEqual(pkg.files, ["dist", "README.md", "LICENSE", "NOTICE"]);
  assert.equal(pkg.main, "./dist/index.cjs");
  assert.equal(pkg.module, "./dist/index.js");
  assert.equal(pkg.types, "./dist/index.d.ts");
  assert.equal(pkg.exports["."].import, "./dist/index.js");
  assert.equal(pkg.exports["."].require, "./dist/index.cjs");
});

test("platform packages declare matching os, cpu, version and files", async () => {
  const mainVersion = (await readJson("package.json")).version;

  for (const target of TARGETS) {
    const pkg = await readJson(`npm/${target}/package.json`);
    const [platform, arch] = target.split("-");

    assert.equal(pkg.name, `@bfc-node/${target}`);
    assert.equal(pkg.version, mainVersion);
    assert.deepEqual(pkg.os, [platform]);
    assert.deepEqual(pkg.cpu, [arch]);
    assert.ok(pkg.files.includes("bfc_node.node"), `${target} must ship bfc_node.node`);
    assert.equal(pkg.license, "Apache-2.0");
    // No "exports" field: the loader resolves "<pkg>/bfc_node.node" directly,
    // and any exports map would block that subpath.
    assert.equal(pkg.exports, undefined);
  }
});

test("NOTICE credits every statically linked dependency", async () => {
  const notice = await readFile(join(root, "NOTICE"), "utf8");
  for (const name of ["BFC", "Zstandard", "libsodium"]) {
    assert.ok(notice.includes(name), `NOTICE must mention ${name}`);
  }
});
