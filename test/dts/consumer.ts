// Compiled by `npm run check:dts` against the built dist/, exactly as a
// consumer would see it. Catches declarations that reference paths or types
// which do not survive packaging.
import { BfcError, buildInfo, createArchive, openArchive, openWriter } from "../../dist/index.js";
import type { BuildInfo, Entry, CreateArchiveResult } from "../../dist/index.js";

export async function roundTrip(): Promise<number> {
  const result: CreateArchiveResult = await createArchive({
    output: "a.bfc",
    inputs: ["./dist"],
    compression: { level: 5, threshold: 128 },
    followSymlinks: false,
    filter: (relPath, stats) => relPath.length > 0 && stats.isFile(),
    onProgress: ({ entriesDone }) => void entriesDone,
  });

  const writer = await openWriter({ output: "b.bfc", password: "x" });
  await writer.addDir("d", { mode: 0o755 });
  await writer.addFile("d/f.txt", Buffer.from("hi"), { mtimeNs: 1n });
  await writer.addSymlink("d/l.txt", "f.txt");
  await writer.finish();
  await writer.close();

  const archive = await openArchive("a.bfc", { password: "x" });
  const entries: Entry[] = await archive.list("d");
  const first: Entry | undefined = entries[0];
  const buf: Buffer = await archive.read(first?.path ?? "d/f.txt", { offset: 0, length: 2 });
  await archive.extract("d/f.txt", "./out/f.txt");
  await archive.extractAll("./out", { prefix: "d" });
  await archive.verify({ deep: true });
  await archive.close();

  const info: BuildInfo = buildInfo;
  const err = new BfcError("boom", "IO", "/tmp/x");

  return result.entries + buf.length + info.napiVersion + err.code.length + (archive.encrypted ? 1 : 0);
}
