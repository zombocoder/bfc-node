import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { BfcError } from "./errors.ts";
import type { NativeBinding } from "./types.ts";

const require = createRequire(import.meta.url);

const PACKAGES: Record<string, string> = {
  "darwin-arm64": "@bfc-node/darwin-arm64",
  "darwin-x64": "@bfc-node/darwin-x64",
  "win32-x64": "@bfc-node/win32-x64-msvc",
  "win32-arm64": "@bfc-node/win32-arm64-msvc",
  "freebsd-x64": "@bfc-node/freebsd-x64",
};

/** True when the running Node links against musl rather than glibc. */
export function isMusl(): boolean {
  const report = process.report?.getReport();
  if (report && typeof report === "object" && "header" in report) {
    const header = (report as { header?: { glibcVersionRuntime?: string } }).header;
    return !header?.glibcVersionRuntime;
  }
  return false;
}

export function getNativePackageName(platform: string, arch: string, musl: boolean): string {
  if (platform === "linux" && (arch === "x64" || arch === "arm64")) {
    return `@bfc-node/linux-${arch}-${musl ? "musl" : "gnu"}`;
  }
  const name = PACKAGES[`${platform}-${arch}`];
  if (!name) {
    throw new BfcError(`Unsupported BFC platform: ${platform}/${arch}`, "UNSUPPORTED_PLATFORM");
  }
  return name;
}

let cached: NativeBinding | undefined;

/**
 * Resolve and load the platform-specific addon. Called lazily on first use so
 * that merely importing this package never throws on an unsupported platform.
 */
export function loadNative(): NativeBinding {
  if (cached) return cached;

  const override = process.env["BFC_NODE_NATIVE_PATH"];
  if (override) {
    cached = require(override) as NativeBinding;
    return cached;
  }

  // Local development: prefer the freshly compiled addon when it is present.
  // The path is the same whether this file runs from src/ or from dist/.
  const localBuild = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "build",
    "Release",
    "bfc_node.node",
  );
  if (existsSync(localBuild)) {
    cached = require(localBuild) as NativeBinding;
    return cached;
  }

  const packageName = getNativePackageName(process.platform, process.arch, isMusl());
  try {
    cached = require(`${packageName}/bfc_node.node`) as NativeBinding;
    return cached;
  } catch {
    throw new BfcError(
      `Failed to load the native BFC addon from "${packageName}". ` +
        `Your platform (${process.platform}/${process.arch}) may not have a prebuilt binary yet. ` +
        `See https://github.com/zombocoder/bfc-node#building-from-source to build one locally.`,
      "UNSUPPORTED_PLATFORM",
    );
  }
}
