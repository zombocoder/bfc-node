import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadNative } from "../helpers/native.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

const native = loadNative();

test("concurrent reads on one archive are serialised and all succeed", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "a.bfc");
    const writer = await native.Writer.create(out, 0);
    for (let i = 0; i < 20; i++) {
      await writer.addFileFromBuffer(`f${i}.txt`, Buffer.from(`content ${i}`), 0o644, 0n);
    }
    await writer.finish();
    writer.close();

    const archive = await native.Archive.open(out);
    const reads = Array.from({ length: 20 }, (_, i) =>
      archive.read(`f${i}.txt`, 0, -1).then((b) => b.toString()),
    );
    const results = await Promise.all(reads);

    for (let i = 0; i < 20; i++) {
      assert.equal(results[i], `content ${i}`);
    }
    archive.close();
  });
});

test("a deep verify does not block the event loop", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "big.bfc");
    const chunk = Buffer.alloc(1024 * 1024, 0x61);

    const writer = await native.Writer.create(out, 0);
    for (let i = 0; i < 40; i++) {
      await writer.addFileFromBuffer(`chunk${i}.bin`, chunk, 0o644, 0n);
    }
    await writer.finish();
    writer.close();

    const archive = await native.Archive.open(out);

    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
    }, 1);
    try {
      await archive.verify(true);
    } finally {
      clearInterval(timer);
      archive.close();
    }

    // A blocking implementation would starve the timer completely and give
    // exactly zero ticks, so this threshold is a binary signal rather than a
    // timing guess — no need to tune it for slower CI machines.
    assert.ok(
      ticks > 0,
      "event loop never ticked during deep verify — the operation is blocking",
    );
  });
});
