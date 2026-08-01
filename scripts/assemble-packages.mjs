#!/usr/bin/env node
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy CI build artifacts into the platform package directories.
 * `artifactsDir` holds one subdirectory per target, each containing bfc_node.node.
 */
export async function assemblePackages(artifactsDir, root) {
  const targets = (await readdir(artifactsDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (targets.length === 0) {
    throw new Error(`No target directories found in ${artifactsDir}`);
  }

  for (const target of targets) {
    const dest = join(root, "npm", target);
    // Fails loudly on an unknown target rather than creating a stray package.
    await stat(join(dest, "package.json"));

    await mkdir(dest, { recursive: true });
    await copyFile(join(artifactsDir, target, "bfc_node.node"), join(dest, "bfc_node.node"));
    for (const file of ["LICENSE", "NOTICE"]) {
      await copyFile(join(root, file), join(dest, file));
    }
    console.log(`assembled npm/${target}`);
  }
  return targets;
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const artifactsDir = process.argv[2];
  if (!artifactsDir) {
    console.error("usage: assemble-packages.mjs <artifacts-dir>");
    process.exit(1);
  }
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  await assemblePackages(resolve(artifactsDir), root);
}
