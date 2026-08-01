import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadNative } from "../helpers/native.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

const native = loadNative();

// Highly repetitive payload — compresses to a fraction of its size.
const payload = Buffer.from("bfc".repeat(20_000));

test("zstd compression shrinks the entry and round-trips exactly", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "c.bfc");
    const writer = await native.Writer.create(out, 0);
    writer.setCompression(native.COMP_ZSTD, 3);
    writer.setCompressionThreshold(64);
    await writer.addFileFromBuffer("big.txt", payload, 0o644, 0n);
    await writer.finish();
    writer.close();

    const archive = await native.Archive.open(out);
    const entry = await archive.stat("big.txt");
    assert.equal(entry.compression, "zstd");
    assert.equal(entry.size, payload.length);
    assert.ok(
      Number(entry.objSize) < payload.length,
      `compressed object (${entry.objSize}) should be smaller than ${payload.length}`,
    );

    const data = await archive.read("big.txt", 0, -1);
    assert.ok(data.equals(payload));
    archive.close();
  });
});

test("entries below the threshold stay uncompressed", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "c.bfc");
    const writer = await native.Writer.create(out, 0);
    writer.setCompression(native.COMP_ZSTD, 3);
    writer.setCompressionThreshold(1_000_000);
    await writer.addFileFromBuffer("small.txt", payload, 0o644, 0n);
    await writer.finish();
    writer.close();

    const archive = await native.Archive.open(out);
    assert.equal((await archive.stat("small.txt")).compression, "none");
    archive.close();
  });
});

test("setCompression throws INVAL for an unknown compression type", async () => {
  await withTempDir(async (dir) => {
    const writer = await native.Writer.create(join(dir, "c.bfc"), 0);
    assert.throws(
      () => writer.setCompression(99, 3),
      (err) => {
        assert.equal(err.code, "INVAL");
        return true;
      },
    );
    writer.close();
  });
});
