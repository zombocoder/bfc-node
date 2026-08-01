import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { open } from "node:fs/promises";
import { loadNative } from "../helpers/native.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

const native = loadNative();
const content = Buffer.from("A".repeat(5000));

/** Build a one-entry archive and flip a byte inside the stored payload. */
async function makeCorruptedArchive(dir) {
  const out = join(dir, "c.bfc");
  const writer = await native.Writer.create(out, 0);
  await writer.addFileFromBuffer("data.txt", content, 0o644, 0n);
  await writer.finish();
  writer.close();

  const probe = await native.Archive.open(out);
  const entry = await probe.stat("data.txt");
  probe.close();

  const handle = await open(out, "r+");
  try {
    const byte = Buffer.alloc(1);
    const pos = Number(entry.objOffset) + 200;
    await handle.read(byte, 0, 1, pos);
    byte[0] ^= 0xff;
    await handle.write(byte, 0, 1, pos);
  } finally {
    await handle.close();
  }
  return out;
}

test("deep verify reports corrupted content with code CRC", async () => {
  await withTempDir(async (dir) => {
    const archive = await native.Archive.open(await makeCorruptedArchive(dir));
    await assert.rejects(
      () => archive.verify(true),
      (err) => {
        assert.equal(err.name, "BfcError");
        assert.equal(err.code, "CRC");
        return true;
      },
    );
    archive.close();
  });
});

test("shallow verify only checks the index, so it passes on corrupted content", async () => {
  await withTempDir(async (dir) => {
    const archive = await native.Archive.open(await makeCorruptedArchive(dir));
    await archive.verify(false);
    archive.close();
  });
});

test("extractToFile refuses corrupted content with code CRC", async () => {
  await withTempDir(async (dir) => {
    const archive = await native.Archive.open(await makeCorruptedArchive(dir));
    await assert.rejects(
      () => archive.extractToFile("data.txt", join(dir, "out.bin")),
      (err) => {
        assert.equal(err.code, "CRC");
        return true;
      },
    );
    archive.close();
  });
});

test("deep verify covers compressed entries too", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "z.bfc");
    const writer = await native.Writer.create(out, 0);
    writer.setCompression(native.COMP_ZSTD, 3);
    writer.setCompressionThreshold(16);
    await writer.addFileFromBuffer("data.txt", content, 0o644, 0n);
    await writer.finish();
    writer.close();

    const archive = await native.Archive.open(out);
    const entry = await archive.stat("data.txt");
    assert.equal(entry.compression, "zstd");
    assert.ok(Number(entry.objSize) < content.length, "it should really have shrunk");

    // The stored bytes are a zstd frame, so this only passes if verify decodes
    // before checksumming.
    await archive.verify(true);
    archive.close();
  });
});

test("deep verify reports PERM when an encrypted archive has no key", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "e.bfc");
    const writer = await native.Writer.create(out, 0);
    writer.setEncryptionKey(Buffer.alloc(32, 7));
    await writer.addFileFromBuffer("secret.txt", content, 0o600, 0n);
    await writer.finish();
    writer.close();

    const archive = await native.Archive.open(out);
    await assert.rejects(
      () => archive.verify(true),
      (err) => {
        // "could not check" rather than "found corrupt" — the distinction matters.
        assert.equal(err.code, "PERM");
        return true;
      },
    );

    archive.setEncryptionKey(Buffer.alloc(32, 7));
    await archive.verify(true);
    archive.close();
  });
});

test("list and stat agree on compression and encryption", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "m.bfc");
    const writer = await native.Writer.create(out, 0);
    writer.setCompression(native.COMP_ZSTD, 3);
    writer.setCompressionThreshold(16);
    writer.setEncryptionKey(Buffer.alloc(32, 3));
    await writer.addFileFromBuffer("both.txt", content, 0o600, 0n);
    await writer.finish();
    writer.close();

    const archive = await native.Archive.open(out);
    archive.setEncryptionKey(Buffer.alloc(32, 3));

    const listed = (await archive.list("")).find((e) => e.path === "both.txt");
    const stated = await archive.stat("both.txt");

    assert.equal(listed.compression, stated.compression);
    assert.equal(listed.encryption, stated.encryption);
    assert.equal(listed.encryption, "chacha20-poly1305");
    archive.close();
  });
});

// Documented upstream behaviour, asserted so a future change is noticed:
// bfc_read supports arbitrary offsets, and a partial read cannot be checked
// against the whole-object CRC, so plain reads return whatever is stored.
// Callers who need integrity must use verify({deep:true}) or extract().
test("read does NOT validate CRC and returns corrupted bytes as-is", async () => {
  await withTempDir(async (dir) => {
    const archive = await native.Archive.open(await makeCorruptedArchive(dir));
    const data = await archive.read("data.txt", 0, -1);
    assert.equal(data.length, content.length);
    assert.ok(!data.equals(content), "corruption should be visible in the returned bytes");
    archive.close();
  });
});
