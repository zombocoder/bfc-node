import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
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

test("extractToFile writes entry content to the given path", async () => {
  await withTempDir(async (dir) => {
    const archive = await native.Archive.open(await buildArchive(dir));

    const dest = join(dir, "out.md");
    await archive.extractToFile("readme.md", dest);

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

test("extractToFile rejects with NOT_FOUND for a missing entry", async () => {
  await withTempDir(async (dir) => {
    const archive = await native.Archive.open(await buildArchive(dir));
    await assert.rejects(
      () => archive.extractToFile("missing", join(dir, "out2.md")),
      (err) => {
        assert.equal(err.code, "NOT_FOUND");
        return true;
      },
    );
    archive.close();
  });
});
