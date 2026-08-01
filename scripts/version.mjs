#!/usr/bin/env node
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Set the version of the main package and every platform package. They must
 * always move together, or npm resolves a platform binary from a different
 * release.
 *
 * optionalDependencies are not touched here: they are absent from the
 * committed package.json on purpose and injected at publish time by
 * scripts/apply-optional-deps.mjs, which also asserts the versions match.
 */
export async function setVersion(root, version) {
  const targets = (await readdir(join(root, "npm"), { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const target of targets) {
    const path = join(root, "npm", target, "package.json");
    const pkg = JSON.parse(await readFile(path, "utf8"));
    pkg.version = version;
    await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  const mainPath = join(root, "package.json");
  const main = JSON.parse(await readFile(mainPath, "utf8"));
  main.version = version;
  await writeFile(mainPath, `${JSON.stringify(main, null, 2)}\n`);

  return targets;
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const version = process.argv[2];
  if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    console.error("usage: version.mjs <semver>");
    process.exit(1);
  }
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const targets = await setVersion(root, version);
  console.log(
    `set version ${version} on the main package and ${targets.length} platform packages`,
  );
}
