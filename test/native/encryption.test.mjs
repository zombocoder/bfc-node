import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadNative } from "../helpers/native.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

const native = loadNative();
const secret = Buffer.from("top secret payload");

async function writeEncrypted(out, configure) {
  const writer = await native.Writer.create(out, 0);
  configure(writer);
  await writer.addFileFromBuffer("secret.txt", secret, 0o600, 0n);
  await writer.finish();
  writer.close();
}

test("password round-trip", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "e.bfc");
    await writeEncrypted(out, (w) => w.setEncryptionPassword("correct horse"));

    const archive = await native.Archive.open(out);
    assert.equal(archive.hasEncryption(), true);
    archive.setEncryptionPassword("correct horse");
    assert.ok((await archive.read("secret.txt", 0, -1)).equals(secret));
    archive.close();
  });
});

test("32-byte key round-trip", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "e.bfc");
    const key = randomBytes(32);
    await writeEncrypted(out, (w) => w.setEncryptionKey(key));

    const archive = await native.Archive.open(out);
    archive.setEncryptionKey(key);
    assert.ok((await archive.read("secret.txt", 0, -1)).equals(secret));
    archive.close();
  });
});

test("reading with the wrong password fails", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "e.bfc");
    await writeEncrypted(out, (w) => w.setEncryptionPassword("correct horse"));

    const archive = await native.Archive.open(out);
    archive.setEncryptionPassword("wrong horse");
    await assert.rejects(
      () => archive.read("secret.txt", 0, -1),
      (err) => {
        assert.equal(err.name, "BfcError");
        return true;
      },
    );
    archive.close();
  });
});

test("reading an encrypted archive without a key fails", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "e.bfc");
    await writeEncrypted(out, (w) => w.setEncryptionPassword("correct horse"));

    const archive = await native.Archive.open(out);
    await assert.rejects(
      () => archive.read("secret.txt", 0, -1),
      (err) => {
        assert.equal(err.name, "BfcError");
        return true;
      },
    );
    archive.close();
  });
});

test("setEncryptionKey rejects keys that are not 32 bytes", async () => {
  await withTempDir(async (dir) => {
    const writer = await native.Writer.create(join(dir, "e.bfc"), 0);
    assert.throws(
      () => writer.setEncryptionKey(Buffer.alloc(16)),
      (err) => {
        assert.equal(err.code, "INVAL");
        return true;
      },
    );
    writer.close();
  });
});
