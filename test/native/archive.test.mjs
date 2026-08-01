import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { loadNative } from "../helpers/native.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

const native = loadNative();

async function makeArchive(dir, build) {
  const out = join(dir, "a.bfc");
  const writer = await native.Writer.create(out, 0);
  await build(writer);
  await writer.finish();
  writer.close();
  return out;
}

test("round-trips a directory entry through list and stat", async () => {
  await withTempDir(async (dir) => {
    const out = await makeArchive(dir, async (w) => {
      await w.addDir("assets", 0o755, 1700000000000000000n);
    });

    const archive = await native.Archive.open(out);
    const entries = await archive.list("");
    assert.equal(entries.length, 1);

    const [entry] = entries;
    assert.equal(entry.path, "assets");
    assert.equal(entry.type, "dir");
    assert.equal(entry.mode & 0o777, 0o755);
    assert.equal(entry.mtimeNs, 1700000000000000000n);
    assert.equal(entry.compression, "none");
    assert.equal(entry.encryption, "none");

    const stated = await archive.stat("assets");
    assert.equal(stated.path, "assets");
    assert.equal(stated.type, "dir");

    archive.close();
  });
});

test("stat rejects with NOT_FOUND for a missing entry", async () => {
  await withTempDir(async (dir) => {
    const out = await makeArchive(dir, async (w) => {
      await w.addDir("assets", 0o755, 0n);
    });

    const archive = await native.Archive.open(out);
    await assert.rejects(
      () => archive.stat("missing"),
      (err) => {
        assert.equal(err.name, "BfcError");
        assert.equal(err.code, "NOT_FOUND");
        assert.equal(err.path, "missing");
        return true;
      },
    );
    archive.close();
  });
});

test("open rejects with BAD_MAGIC for a non-BFC file", async () => {
  await withTempDir(async (dir) => {
    const bogus = join(dir, "bogus.bfc");
    await writeFile(bogus, "definitely not a bfc container");
    await assert.rejects(
      () => native.Archive.open(bogus),
      (err) => {
        assert.equal(err.code, "BAD_MAGIC");
        return true;
      },
    );
  });
});

test("open rejects with IO for a missing file", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      () => native.Archive.open(join(dir, "nope.bfc")),
      (err) => {
        assert.equal(err.code, "IO");
        return true;
      },
    );
  });
});

test("methods on a closed archive reject with CLOSED", async () => {
  await withTempDir(async (dir) => {
    const out = await makeArchive(dir, async (w) => {
      await w.addDir("d", 0o755, 0n);
    });
    const archive = await native.Archive.open(out);
    archive.close();
    await assert.rejects(
      () => archive.list(""),
      (err) => {
        assert.equal(err.code, "CLOSED");
        return true;
      },
    );
  });
});
