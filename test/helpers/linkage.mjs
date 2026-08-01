import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Windows has no equivalent that works without the Visual Studio developer
 * environment on PATH, so linkage tests declare themselves skipped there
 * rather than passing on no evidence. CI checks the shipped package for stray
 * DLLs instead.
 */
export const canInspectLinkage = process.platform !== "win32";

/**
 * Return the shared libraries the binary links against, lowercased.
 * Uses otool on macOS and ldd on Linux.
 *
 * Throws when the binary is missing: otherwise every "is X linked statically"
 * assertion would pass vacuously on an unbuilt tree.
 */
export function dynamicLibs(binaryPath) {
  if (!existsSync(binaryPath)) {
    throw new Error(`Cannot inspect linkage: ${binaryPath} does not exist`);
  }
  const tool = process.platform === "darwin" ? "otool" : "ldd";
  const args = process.platform === "darwin" ? ["-L", binaryPath] : [binaryPath];
  let out;
  try {
    out = execFileSync(tool, args, { encoding: "utf8" });
  } catch (err) {
    // ldd exits non-zero for "not a dynamic executable"; its output is still useful.
    out = err.stdout ?? "";
  }
  return out
    .toLowerCase()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
