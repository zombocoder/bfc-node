import test from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { loadNative } from "../helpers/native.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

const native = loadNative();

test("Writer.create returns a writer and finish produces a non-empty file", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "a.bfc");
    const writer = await native.Writer.create(out, 0);
    await writer.finish();
    writer.close();

    const st = await stat(out);
    assert.ok(st.size > 0, "archive file should not be empty");
  });
});

test("Writer.create rejects with code IO when the directory does not exist", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "nope", "a.bfc");
    await assert.rejects(
      () => native.Writer.create(out, 0),
      (err) => {
        assert.equal(err.name, "BfcError");
        assert.equal(err.code, "IO");
        assert.equal(err.path, out);
        return true;
      },
    );
  });
});

test("methods on a closed writer throw code CLOSED", async () => {
  await withTempDir(async (dir) => {
    const writer = await native.Writer.create(join(dir, "a.bfc"), 0);
    await writer.finish();
    writer.close();

    await assert.rejects(
      () => writer.finish(),
      (err) => {
        assert.equal(err.code, "CLOSED");
        return true;
      },
    );
  });
});

test("close is idempotent", async () => {
  await withTempDir(async (dir) => {
    const writer = await native.Writer.create(join(dir, "a.bfc"), 0);
    await writer.finish();
    writer.close();
    writer.close();
  });
});
