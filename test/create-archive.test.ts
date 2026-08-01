import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { createArchive, openArchive } from "../src/index.ts";
import { withTempDir } from "./helpers/tmp.mjs";

async function buildTree(dir: string): Promise<string> {
  const root = join(dir, "site");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), "<h1>hi</h1>");
  await writeFile(join(root, "assets", "app.js"), "console.log(1)");
  await symlink("index.html", join(root, "home.html"));
  return root;
}

test("archives a directory tree preserving structure, modes and symlinks", async () => {
  await withTempDir(async (dir: string) => {
    const root = await buildTree(dir);
    const out = join(dir, "site.bfc");

    const result = await createArchive({ output: out, inputs: [root] });
    assert.equal(result.path, out);
    assert.equal(result.entries, 4);
    assert.ok(result.bytesWritten > 0);

    const archive = await openArchive(out);
    const byPath = new Map((await archive.list()).map((e) => [e.path, e]));

    assert.equal(byPath.get("assets")?.type, "dir");
    assert.equal(byPath.get("index.html")?.type, "file");
    assert.equal(byPath.get("assets/app.js")?.type, "file");
    assert.equal(byPath.get("home.html")?.type, "symlink");

    assert.equal((await archive.read("index.html")).toString(), "<h1>hi</h1>");
    assert.equal((await archive.read("home.html")).toString(), "index.html");

    await archive.close();
  });
});

test("produces the same entry list on repeated runs", async () => {
  await withTempDir(async (dir: string) => {
    const root = await buildTree(dir);
    const listOf = async (name: string) => {
      const out = join(dir, name);
      await createArchive({ output: out, inputs: [root] });
      const archive = await openArchive(out);
      const paths = (await archive.list()).map((e) => e.path);
      await archive.close();
      return paths;
    };
    assert.deepEqual(await listOf("one.bfc"), await listOf("two.bfc"));
  });
});

test("filter excludes entries and prunes directories", async () => {
  await withTempDir(async (dir: string) => {
    const root = await buildTree(dir);
    const out = join(dir, "filtered.bfc");

    await createArchive({
      output: out,
      inputs: [root],
      filter: (relPath) => !relPath.startsWith("assets"),
    });

    const archive = await openArchive(out);
    const paths = (await archive.list()).map((e) => e.path);
    assert.ok(!paths.some((p) => p.startsWith("assets")), `unexpected: ${paths.join(", ")}`);
    assert.ok(paths.includes("index.html"));
    await archive.close();
  });
});

test("followSymlinks stores link targets as regular files", async () => {
  await withTempDir(async (dir: string) => {
    const root = await buildTree(dir);
    const out = join(dir, "followed.bfc");

    await createArchive({ output: out, inputs: [root], followSymlinks: true });

    const archive = await openArchive(out);
    const entry = await archive.stat("home.html");
    assert.equal(entry.type, "file");
    assert.equal((await archive.read("home.html")).toString(), "<h1>hi</h1>");
    await archive.close();
  });
});

test("a single file input uses its parent directory as the base", async () => {
  await withTempDir(async (dir: string) => {
    const root = await buildTree(dir);
    const out = join(dir, "one-file.bfc");

    const result = await createArchive({ output: out, inputs: [join(root, "index.html")] });
    assert.equal(result.entries, 1);

    const archive = await openArchive(out);
    assert.deepEqual(
      (await archive.list()).map((e) => e.path),
      ["index.html"],
    );
    await archive.close();
  });
});

test("multiple inputs are stored relative to their common parent", async () => {
  await withTempDir(async (dir: string) => {
    const root = await buildTree(dir);
    const out = join(dir, "multi.bfc");

    await createArchive({
      output: out,
      inputs: [join(root, "index.html"), join(root, "assets")],
    });

    const archive = await openArchive(out);
    const paths = (await archive.list()).map((e) => e.path).sort();
    assert.deepEqual(paths, ["assets", "assets/app.js", "index.html"]);
    await archive.close();
  });
});

test("onProgress reports every entry", async () => {
  await withTempDir(async (dir: string) => {
    const root = await buildTree(dir);
    const seen: string[] = [];
    await createArchive({
      output: join(dir, "p.bfc"),
      inputs: [root],
      onProgress: (p) => {
        seen.push(p.path);
      },
    });
    assert.ok(seen.includes("index.html"));
    assert.ok(seen.includes("assets/app.js"));
  });
});

test("compression and encryption options reach the archive", async () => {
  await withTempDir(async (dir: string) => {
    const root = join(dir, "big");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "big.txt"), "y".repeat(50_000));

    const out = join(dir, "enc.bfc");
    await createArchive({
      output: out,
      inputs: [root],
      compression: true,
      password: "hunter2",
    });

    const archive = await openArchive(out, { password: "hunter2" });
    const entry = await archive.stat("big.txt");
    assert.equal(entry.compression, "zstd");
    assert.equal(entry.encryption, "chacha20-poly1305");
    assert.equal((await archive.read("big.txt")).toString(), "y".repeat(50_000));
    await archive.close();
  });
});
