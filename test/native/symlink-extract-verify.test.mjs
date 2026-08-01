import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { open, readFile } from "node:fs/promises";
import { loadNative } from "../helpers/native.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

const native = loadNative();

async function buildArchive(dir) {
  const out = join(dir, "a.bfc");
  const writer = await native.Writer.create(out, 0);
  await writer.addFileFromBuffer("readme.md", Buffer.from("# hi\n"), 0o644, 0n);
  await writer.addSymlink("link.md", "readme.md", 0o777, 0n);
  await writer.finish();
  writer.close();
  return out;
}

test("stores symlinks with their target readable as content", async () => {
  await withTempDir(async (dir) => {
    const archive = await native.Archive.open(await buildArchive(dir));

    const entry = await archive.stat("link.md");
    assert.equal(entry.type, "symlink");

    const target = await archive.read("link.md", 0, -1);
    assert.equal(target.toString(), "readme.md");

    archive.close();
  });
});

test("extractToFd writes entry content to the given descriptor", async () => {
  await withTempDir(async (dir) => {
    const archive = await native.Archive.open(await buildArchive(dir));

    const dest = join(dir, "out.md");
    const handle = await open(dest, "w");
    try {
      await archive.extractToFd("readme.md", handle.fd);
    } finally {
      await handle.close();
    }

    assert.equal(await readFile(dest, "utf8"), "# hi\n");
    archive.close();
  });
});

test("verify passes on a freshly written archive, shallow and deep", async () => {
  await withTempDir(async (dir) => {
    const archive = await native.Archive.open(await buildArchive(dir));
    await archive.verify(false);
    await archive.verify(true);
    archive.close();
  });
});

test("extractToFd rejects with NOT_FOUND for a missing entry", async () => {
  await withTempDir(async (dir) => {
    const archive = await native.Archive.open(await buildArchive(dir));
    const handle = await open(join(dir, "out2.md"), "w");
    try {
      await assert.rejects(
        () => archive.extractToFd("missing", handle.fd),
        (err) => {
          assert.equal(err.code, "NOT_FOUND");
          return true;
        },
      );
    } finally {
      await handle.close();
    }
    archive.close();
  });
});
