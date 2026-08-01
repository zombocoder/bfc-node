#!/usr/bin/env node
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Write the platform packages into the main package.json as optionalDependencies.
 *
 * These are deliberately absent from the committed package.json. npm cannot put
 * a package that is not yet on the registry into package-lock.json, so listing
 * them in the repo makes `npm ci` fail with "Missing: @bfc-node/... from lock
 * file" — for the very first release, and again every time a new platform is
 * added. Injecting them at publish time keeps the repo's dependency graph
 * resolvable while the published tarball still declares them.
 */
export async function applyOptionalDeps(root) {
  const targets = (await readdir(join(root, "npm"), { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (targets.length === 0) {
    throw new Error(`No platform packages found in ${join(root, "npm")}`);
  }

  const mainPath = join(root, "package.json");
  const main = JSON.parse(await readFile(mainPath, "utf8"));

  const deps = {};
  for (const target of targets) {
    const pkg = JSON.parse(await readFile(join(root, "npm", target, "package.json"), "utf8"));
    if (pkg.version !== main.version) {
      throw new Error(
        `${pkg.name} is at ${pkg.version} but the main package is at ${main.version}; ` +
          `run scripts/version.mjs to move them together`,
      );
    }
    deps[pkg.name] = main.version;
  }

  main.optionalDependencies = deps;
  await writeFile(mainPath, `${JSON.stringify(main, null, 2)}\n`);
  return deps;
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const deps = await applyOptionalDeps(root);
  for (const [name, version] of Object.entries(deps)) {
    console.log(`optionalDependency ${name}@${version}`);
  }
}
