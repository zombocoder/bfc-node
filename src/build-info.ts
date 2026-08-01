import { createRequire } from "node:module";

import { loadNative } from "./loader.ts";
import type { BuildInfo } from "./types.ts";

// Replaced by tsup at build time. Falls back to reading package.json when the
// sources are run directly (tests, tsx). `typeof` on an undeclared identifier
// is safe in JS, so the fallback works even though nothing defines it there.
declare const __PACKAGE_VERSION__: string | undefined;

function packageVersion(): string {
  if (typeof __PACKAGE_VERSION__ === "string") return __PACKAGE_VERSION__;
  const require = createRequire(import.meta.url);
  return (require("../package.json") as { version: string }).version;
}

let cached: BuildInfo | undefined;

function compute(): BuildInfo {
  if (!cached) {
    cached = { packageVersion: packageVersion(), ...loadNative().nativeBuildInfo() };
  }
  return cached;
}

const KEYS = [
  "packageVersion",
  "napiVersion",
  "bfcVersion",
  "bfcCommit",
  "platform",
  "architecture",
  "libc",
  "compression",
  "encryption",
] as const satisfies readonly (keyof BuildInfo)[];

/**
 * Metadata about this package and the BFC build inside it.
 *
 * Lazy getters rather than a plain value: importing the package must succeed
 * even where no prebuilt binary exists, so the addon is only loaded once a
 * field is actually read.
 *
 * A Proxy would be the obvious way to do this, but `util.inspect` detects
 * proxies and inspects the target directly without going through any trap, so
 * `console.log(buildInfo)` would print `{}`.
 */
const info = {} as BuildInfo;

for (const key of KEYS) {
  Object.defineProperty(info, key, {
    get: () => compute()[key],
    enumerable: true,
    configurable: true,
  });
}

Object.defineProperty(info, Symbol.for("nodejs.util.inspect.custom"), {
  value: () => ({ ...compute() }),
  enumerable: false,
});

export const buildInfo: BuildInfo = info;
