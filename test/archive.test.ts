import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { openArchive, openWriter } from "../src/index.ts";
import { withTempDir } from "./helpers/tmp.mjs";
import { hasPosixModes } from "./helpers/platform.mjs";

test("writer and archive round-trip through the TypeScript API", async () => {
  await withTempDir(async (dir: string) => {
    const out = join(dir, "a.bfc");

    const writer = await openWriter({ output: out });
    await writer.addDir("docs", { mode: 0o755 });
    await writer.addFile("docs/readme.md", Buffer.from("# hi\n"), { mode: 0o644 });
    await writer.addSymlink("docs/link.md", "readme.md");
    await writer.finish();
    await writer.close();

    const archive = await openArchive(out);
    assert.equal(archive.path, out);
    assert.equal(archive.encrypted, false);

    const entries = await archive.list();
    const paths = entries.map((e) => e.path).sort();
    assert.deepEqual(paths, ["docs", "docs/link.md", "docs/readme.md"]);

    const entry = await archive.stat("docs/readme.md");
    assert.equal(entry.type, "file");
    assert.ok(entry.mtime instanceof Date);

    assert.equal((await archive.read("docs/readme.md")).toString(), "# hi\n");
    assert.equal((await archive.read("docs/readme.md", { offset: 2 })).toString(), "hi\n");
    assert.equal((await archive.read("docs/readme.md", { length: 1 })).toString(), "#");

    const dest = join(dir, "nested", "extracted.md");
    await archive.extract("docs/readme.md", dest);
    assert.equal(await readFile(dest, "utf8"), "# hi\n");

    await archive.verify({ deep: true });
    await archive.close();
  });
});

test("mtime is derived from mtimeNs", async () => {
  await withTempDir(async (dir: string) => {
    const out = join(dir, "t.bfc");
    const writer = await openWriter({ output: out });
    await writer.addFile("f.txt", Buffer.from("x"), { mtimeNs: 1_700_000_000_000_000_000n });
    await writer.finish();
    await writer.close();

    const archive = await openArchive(out);
    const entry = await archive.stat("f.txt");
    assert.equal(entry.mtimeNs, 1_700_000_000_000_000_000n);
    assert.equal(entry.mtime.getTime(), 1_700_000_000_000);
    await archive.close();
  });
});

test("compression and encryption options flow through openWriter", async () => {
  await withTempDir(async (dir: string) => {
    const out = join(dir, "b.bfc");
    const payload = Buffer.from("x".repeat(50_000));

    const writer = await openWriter({ output: out, compression: true, password: "hunter2" });
    await writer.addFile("big.txt", payload);
    await writer.finish();
    await writer.close();

    const archive = await openArchive(out, { password: "hunter2" });
    assert.equal(archive.encrypted, true);
    const entry = await archive.stat("big.txt");
    assert.equal(entry.compression, "zstd");
    assert.ok((await archive.read("big.txt")).equals(payload));
    await archive.close();
  });
});

test("addFile reads mode and mtime from disk when given a path", async () => {
  await withTempDir(async (dir: string) => {
    const src = join(dir, "src.txt");
    const { writeFile, chmod } = await import("node:fs/promises");
    await writeFile(src, "from disk");
    await chmod(src, 0o600);

    const out = join(dir, "d.bfc");
    const writer = await openWriter({ output: out });
    await writer.addFile("src.txt", src);
    await writer.finish();
    await writer.close();

    const archive = await openArchive(out);
    const entry = await archive.stat("src.txt");
    if (hasPosixModes) {
      assert.equal(entry.mode & 0o777, 0o600);
    }
    assert.ok(entry.mtimeNs > 0n, "mtime should come from the source file");
    assert.equal((await archive.read("src.txt")).toString(), "from disk");
    await archive.close();
  });
});

test("passing both password and key is rejected", async () => {
  await withTempDir(async (dir: string) => {
    await assert.rejects(
      () => openWriter({ output: join(dir, "c.bfc"), password: "a", key: new Uint8Array(32) }),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, "INVAL");
        return true;
      },
    );
  });
});
