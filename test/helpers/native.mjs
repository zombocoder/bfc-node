import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const nativeBinaryPath = join(root, "build", "Release", "bfc_node.node");

export function loadNative() {
  return require(nativeBinaryPath);
}
