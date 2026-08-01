import { lstat, readdir, readlink, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Stats } from "node:fs";

import { openWriter } from "./writer.ts";
import type { CreateArchiveOptions, CreateArchiveResult } from "./types.ts";

export interface WalkEntry {
  relPath: string;
  absPath: string;
  kind: "dir" | "file" | "symlink";
  mode: number;
  mtimeNs: bigint;
  size: number;
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

function mtimeNs(st: Stats): bigint {
  return BigInt(Math.round(st.mtimeMs * 1e6));
}

/**
 * Longest common parent directory of the given absolute paths.
 * A single directory input becomes the base itself, so `inputs: ["./dist"]`
 * yields container paths without a "dist/" prefix. A single file input uses
 * its parent directory instead — otherwise its relative path would be empty.
 */
export async function commonBaseDir(paths: string[]): Promise<string> {
  if (paths.length === 0) return process.cwd();
  if (paths.length === 1) {
    const only = paths[0]!;
    return (await stat(only)).isDirectory() ? only : dirname(only);
  }
  const split = paths.map((p) => p.split(sep));
  const first = split[0]!;
  let i = 0;
  while (i < first.length && split.every((parts) => parts[i] === first[i])) i++;
  return first.slice(0, i).join(sep) || sep;
}

export async function collectEntries(
  baseDir: string,
  inputs: string[],
  opts: Pick<CreateArchiveOptions, "followSymlinks" | "filter">,
): Promise<WalkEntry[]> {
  const out: WalkEntry[] = [];

  async function visit(absPath: string): Promise<void> {
    const st = opts.followSymlinks ? await stat(absPath) : await lstat(absPath);
    const relPath = toPosix(relative(baseDir, absPath));

    // The base directory itself maps to an empty path — it is not content.
    if (relPath !== "" && opts.filter && !opts.filter(relPath, st)) return;

    if (st.isDirectory()) {
      if (relPath !== "") {
        out.push({
          relPath,
          absPath,
          kind: "dir",
          mode: st.mode & 0o7777,
          mtimeNs: mtimeNs(st),
          size: 0,
        });
      }
      const children = await readdir(absPath);
      children.sort(); // deterministic order
      for (const child of children) {
        await visit(join(absPath, child));
      }
      return;
    }

    out.push({
      relPath,
      absPath,
      kind: st.isSymbolicLink() ? "symlink" : "file",
      mode: st.mode & 0o7777,
      mtimeNs: mtimeNs(st),
      size: st.size,
    });
  }

  const sorted = [...inputs].map((p) => resolve(p)).sort();
  for (const input of sorted) {
    await visit(input);
  }

  out.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return out;
}

export async function createArchive(
  opts: CreateArchiveOptions,
): Promise<CreateArchiveResult> {
  const inputs = opts.inputs.map((p) => resolve(p));
  const baseDir = opts.baseDir ? resolve(opts.baseDir) : await commonBaseDir(inputs);

  const entries = await collectEntries(baseDir, inputs, {
    ...(opts.followSymlinks !== undefined ? { followSymlinks: opts.followSymlinks } : {}),
    ...(opts.filter !== undefined ? { filter: opts.filter } : {}),
  });

  const writer = await openWriter({
    output: opts.output,
    ...(opts.blockSize !== undefined ? { blockSize: opts.blockSize } : {}),
    ...(opts.compression !== undefined ? { compression: opts.compression } : {}),
    ...(opts.password !== undefined ? { password: opts.password } : {}),
    ...(opts.key !== undefined ? { key: opts.key } : {}),
  });

  let bytesWritten = 0;
  let entriesDone = 0;

  try {
    for (const entry of entries) {
      const meta = { mode: entry.mode, mtimeNs: entry.mtimeNs };
      if (entry.kind === "dir") {
        await writer.addDir(entry.relPath, meta);
      } else if (entry.kind === "symlink") {
        await writer.addSymlink(entry.relPath, await readlink(entry.absPath), meta);
      } else {
        await writer.addFile(entry.relPath, entry.absPath, meta);
        bytesWritten += entry.size;
      }
      entriesDone++;
      opts.onProgress?.({ path: entry.relPath, entriesDone, bytesWritten });
    }
    await writer.finish();
  } finally {
    await writer.close();
  }

  return { path: opts.output, entries: entriesDone, bytesWritten };
}
