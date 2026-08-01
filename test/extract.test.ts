import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { lstat, mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { createArchive, openArchive, openWriter, safeJoin } from "../src/index.ts";
import { withTempDir } from "./helpers/tmp.mjs";
import { hasPosixModes } from "./helpers/platform.mjs";

test("safeJoin rejects paths that escape the destination", () => {
  // resolve, not join: safeJoin returns an absolute path, and on Windows
  // join("/tmp/out", ...) has no drive letter while resolve() does.
  assert.equal(safeJoin("/tmp/out", "a/b.txt"), resolve("/tmp/out", "a/b.txt"));

  for (const evil of ["../evil.txt", "a/../../evil.txt", "/etc/passwd", "."]) {
    assert.throws(
      () => safeJoin("/tmp/out", evil),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, "INVAL");
        return true;
      },
      `expected ${evil} to be rejected`,
    );
  }
});

test("extractAll restores files, directories, symlinks and modes", async () => {
  await withTempDir(async (dir: string) => {
    const root = join(dir, "src");
    await mkdir(join(root, "nested"), { recursive: true });
    await writeFile(join(root, "a.txt"), "alpha");
    await writeFile(join(root, "nested", "b.txt"), "beta");
    await symlink("a.txt", join(root, "link.txt"));

    const out = join(dir, "t.bfc");
    await createArchive({ output: out, inputs: [root] });

    const dest = join(dir, "restored");
    const archive = await openArchive(out);
    await archive.extractAll(dest);
    await archive.close();

    assert.equal(await readFile(join(dest, "a.txt"), "utf8"), "alpha");
    assert.equal(await readFile(join(dest, "nested", "b.txt"), "utf8"), "beta");
    assert.equal(await readlink(join(dest, "link.txt")), "a.txt");
    assert.ok((await lstat(join(dest, "nested"))).isDirectory());
    if (hasPosixModes) {
      assert.equal((await lstat(join(dest, "a.txt"))).mode & 0o777, 0o644);
    }
  });
});

// Defence in depth has two layers. BFC refuses to store a traversing path in
// the first place, so a malicious archive cannot be built through the public
// API — which is why extractAll's own guard is covered by the safeJoin unit
// tests above rather than end to end.
test("the writer refuses to store a path that escapes the container root", async () => {
  await withTempDir(async (dir: string) => {
    const writer = await openWriter({ output: join(dir, "evil.bfc") });
    for (const evil of ["../escaped.txt", "a/../../escaped.txt"]) {
      await assert.rejects(
        () => writer.addFile(evil, Buffer.from("nope")),
        (err: unknown) => {
          assert.equal((err as { code?: string }).code, "INVAL");
          return true;
        },
        `expected ${evil} to be rejected`,
      );
    }
    await writer.close();
  });
});

test("extractAll honours the prefix option", async () => {
  await withTempDir(async (dir: string) => {
    const root = join(dir, "src");
    await mkdir(join(root, "keep"), { recursive: true });
    await mkdir(join(root, "skip"), { recursive: true });
    await writeFile(join(root, "keep", "k.txt"), "k");
    await writeFile(join(root, "skip", "s.txt"), "s");

    const out = join(dir, "p.bfc");
    await createArchive({ output: out, inputs: [root] });

    const dest = join(dir, "dest");
    const archive = await openArchive(out);
    await archive.extractAll(dest, { prefix: "keep" });
    await archive.close();

    assert.equal(await readFile(join(dest, "keep", "k.txt"), "utf8"), "k");
    await assert.rejects(() => lstat(join(dest, "skip", "s.txt")));
  });
});

test("extractAll restores an encrypted archive", async () => {
  await withTempDir(async (dir: string) => {
    const root = join(dir, "src");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "secret.txt"), "classified");

    const out = join(dir, "e.bfc");
    await createArchive({ output: out, inputs: [root], password: "hunter2" });

    const dest = join(dir, "dest");
    const archive = await openArchive(out, { password: "hunter2" });
    await archive.extractAll(dest);
    await archive.close();

    assert.equal(await readFile(join(dest, "secret.txt"), "utf8"), "classified");
  });
});
