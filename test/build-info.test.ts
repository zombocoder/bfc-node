import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildInfo } from "../src/index.ts";

test("buildInfo exposes package and native metadata", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };

  assert.equal(buildInfo.packageVersion, pkg.version);
  assert.equal(buildInfo.napiVersion, 8);
  assert.ok(buildInfo.bfcVersion.length > 0);
  assert.match(buildInfo.bfcCommit, /^[0-9a-f]{7,40}$/);
  assert.equal(buildInfo.platform, process.platform);
  assert.equal(buildInfo.architecture, process.arch);
  assert.equal(buildInfo.compression, true);
  assert.equal(buildInfo.encryption, true);
});

test("buildInfo is stable across accesses and spreads like a plain object", () => {
  assert.deepEqual({ ...buildInfo }, { ...buildInfo });
  assert.ok(Object.keys(buildInfo).includes("bfcCommit"));
  assert.ok("napiVersion" in buildInfo);
  assert.equal(JSON.parse(JSON.stringify(buildInfo)).napiVersion, 8);
});

// The README shows `console.log(buildInfo)` printing every field. Without the
// custom inspect hook Node inspects the proxy target and prints `{}`.
test("console.log(buildInfo) shows the fields, not an empty object", async () => {
  const { inspect } = await import("node:util");
  const rendered = inspect(buildInfo);
  assert.notEqual(rendered, "{}");
  for (const field of ["napiVersion", "bfcVersion", "bfcCommit", "platform"]) {
    assert.ok(rendered.includes(field), `inspect output should mention ${field}`);
  }
});

test("importing the package does not load the addon", async () => {
  // A bare import must never throw on an unsupported platform; the addon is
  // only resolved when something actually touches it.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { fileURLToPath } = await import("node:url");

  const script = `
    process.env.BFC_NODE_NATIVE_PATH = "/nonexistent/definitely-not-here.node";
    const mod = await import(${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)});
    if (typeof mod.createArchive !== "function") throw new Error("missing export");
    console.log("imported-without-loading");
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    // URL.pathname is not a usable path on Windows ("/D:/a/..."), so convert it.
    { cwd: fileURLToPath(new URL("..", import.meta.url)) },
  );
  assert.match(stdout, /imported-without-loading/);
});
