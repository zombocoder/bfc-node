#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BLOCK = /set\(\s*BFC_LIB_SOURCES\s*([\s\S]*?)\)/;

/** Extract the file list from an upstream `set(BFC_LIB_SOURCES ...)` block. */
export function parseUpstreamSources(cmakeText) {
  const match = BLOCK.exec(cmakeText);
  if (!match) {
    throw new Error("BFC_LIB_SOURCES block not found in vendor/bfc/src/lib/CMakeLists.txt");
  }
  return match[1]
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line.length > 0);
}

/** Compare our canonical list against the pinned submodule. */
export function checkDrift(root) {
  const upstream = parseUpstreamSources(
    readFileSync(join(root, "vendor/bfc/src/lib/CMakeLists.txt"), "utf8"),
  );
  const ours = JSON.parse(readFileSync(join(root, "cmake/bfc-sources.json"), "utf8")).sources;

  const missing = upstream.filter((f) => !ours.includes(f));
  const extra = ours.filter((f) => !upstream.includes(f));
  return { ok: missing.length === 0 && extra.length === 0, missing, extra, upstream };
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const { ok, missing, extra, upstream } = checkDrift(root);
  if (!ok) {
    console.error("BFC source list drifted from the pinned submodule.");
    if (missing.length) console.error("  Add to cmake/bfc-sources.json:", missing.join(", "));
    if (extra.length) console.error("  Remove from cmake/bfc-sources.json:", extra.join(", "));
    process.exit(1);
  }
  console.log(`BFC source list is in sync (${upstream.length} files).`);
}
