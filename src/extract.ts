import { chmod, mkdir, symlink, utimes } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { BfcError } from "./errors.ts";
import type { Archive } from "./archive.ts";
import type { Entry } from "./types.ts";

/**
 * Join an archive entry path onto a destination directory, refusing anything
 * that would land outside it. Archives are untrusted input.
 */
export function safeJoin(destDir: string, entryPath: string): string {
  if (isAbsolute(entryPath)) {
    throw new BfcError(`Refusing to extract absolute path "${entryPath}"`, "INVAL", entryPath);
  }
  const base = resolve(destDir);
  const target = resolve(base, entryPath);
  const rel = relative(base, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new BfcError(
      `Refusing to extract "${entryPath}" outside the destination directory`,
      "INVAL",
      entryPath,
    );
  }
  return target;
}

function withinPrefix(entry: Entry, prefix: string): boolean {
  if (prefix === "") return true;
  return entry.path === prefix || entry.path.startsWith(`${prefix}/`);
}

export async function extractAll(
  archive: Archive,
  destDir: string,
  opts: { prefix?: string } = {},
): Promise<void> {
  const prefix = opts.prefix ?? "";
  const entries = (await archive.list(prefix)).filter((e) => withinPrefix(e, prefix));

  // Validate every path before writing anything: a partial extraction of a
  // malicious archive is worse than none.
  const targets = new Map<string, string>();
  for (const entry of entries) {
    targets.set(entry.path, safeJoin(destDir, entry.path));
  }

  // Shortest path first, so parents exist before their children.
  const ordered = [...entries].sort((a, b) => a.path.length - b.path.length);

  for (const entry of ordered) {
    const target = targets.get(entry.path)!;
    if (entry.type === "dir") {
      await mkdir(target, { recursive: true });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    if (entry.type === "symlink") {
      const link = (await archive.read(entry.path)).toString("utf8");
      await symlink(link, target);
      continue;
    }
    await archive.extract(entry.path, target);
  }

  // Modes and timestamps last, deepest first: writing into a directory resets
  // its mtime, and a read-only directory cannot receive children.
  for (const entry of [...entries].sort((a, b) => b.path.length - a.path.length)) {
    const target = targets.get(entry.path)!;
    if (entry.type === "symlink") continue; // symlink metadata is not portable
    await chmod(target, entry.mode & 0o7777);
    const seconds = Number(entry.mtimeNs / 1_000_000_000n);
    if (seconds > 0) {
      await utimes(target, seconds, seconds);
    }
  }
}
