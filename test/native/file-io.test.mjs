import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { loadNative } from "../helpers/native.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

const native = loadNative();

test("round-trips file content added from disk", async () => {
  await withTempDir(async (dir) => {
    const src = join(dir, "hello.txt");
    await writeFile(src, "hello bfc");

    const out = join(dir, "a.bfc");
    const writer = await native.Writer.create(out, 0);
    await writer.addFile("hello.txt", src, 0o644, 1700000000000000000n);
    await writer.finish();
    writer.close();

    const archive = await native.Archive.open(out);
    const entry = await archive.stat("hello.txt");
    assert.equal(entry.type, "file");
    assert.equal(entry.size, 9);
    assert.equal(entry.mode & 0o777, 0o644);

    const all = await archive.read("hello.txt", 0, -1);
    assert.equal(all.toString(), "hello bfc");

    const slice = await archive.read("hello.txt", 6, 3);
    assert.equal(slice.toString(), "bfc");

    archive.close();
  });
});

test("round-trips file content added from a buffer", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "a.bfc");
    const writer = await native.Writer.create(out, 0);
    await writer.addFileFromBuffer("data.bin", Buffer.from([1, 2, 3, 4]), 0o644, 0n);
    await writer.finish();
    writer.close();

    const archive = await native.Archive.open(out);
    const data = await archive.read("data.bin", 0, -1);
    assert.deepEqual([...data], [1, 2, 3, 4]);
    archive.close();
  });
});

test("stores empty files as zero-length entries, from buffer and from disk", async () => {
  await withTempDir(async (dir) => {
    const emptySrc = join(dir, "empty-src.txt");
    await writeFile(emptySrc, "");

    const out = join(dir, "a.bfc");
    const writer = await native.Writer.create(out, 0);
    await writer.addFileFromBuffer("from-buffer.txt", Buffer.alloc(0), 0o644, 0n);
    await writer.addFile("from-disk.txt", emptySrc, 0o644, 0n);
    await writer.finish();
    writer.close();

    const archive = await native.Archive.open(out);
    for (const path of ["from-buffer.txt", "from-disk.txt"]) {
      assert.equal((await archive.stat(path)).size, 0, `${path} should be empty`);
      assert.equal((await archive.read(path, 0, -1)).length, 0);
    }
    archive.close();
  });
});

test("read rejects with NOT_FOUND for a missing entry", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "a.bfc");
    const writer = await native.Writer.create(out, 0);
    await writer.addFileFromBuffer("x", Buffer.from("x"), 0o644, 0n);
    await writer.finish();
    writer.close();

    const archive = await native.Archive.open(out);
    await assert.rejects(
      () => archive.read("missing", 0, -1),
      (err) => {
        assert.equal(err.code, "NOT_FOUND");
        return true;
      },
    );
    archive.close();
  });
});

test("read past the end returns an empty buffer", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "a.bfc");
    const writer = await native.Writer.create(out, 0);
    await writer.addFileFromBuffer("x", Buffer.from("abc"), 0o644, 0n);
    await writer.finish();
    writer.close();

    const archive = await native.Archive.open(out);
    const data = await archive.read("x", 99, -1);
    assert.equal(data.length, 0);
    archive.close();
  });
});

test("addFile rejects with IO when the source file is missing", async () => {
  await withTempDir(async (dir) => {
    const writer = await native.Writer.create(join(dir, "a.bfc"), 0);
    await assert.rejects(
      () => writer.addFile("x", join(dir, "nope.txt"), 0o644, 0n),
      (err) => {
        assert.equal(err.code, "IO");
        return true;
      },
    );
    writer.close();
  });
});
