import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

import { BfcError } from "./errors.ts";
import { extractAll as extractAllImpl } from "./extract.ts";
import { loadNative } from "./loader.ts";
import type { Entry, NativeArchive, NativeEntry, OpenArchiveOptions } from "./types.ts";

export function toEntry(native: NativeEntry): Entry {
  return {
    ...native,
    mtime: new Date(Number(native.mtimeNs / 1_000_000n)),
  };
}

/** Apply exactly one of password/key to a native writer or archive. */
export function applyEncryption(
  target: { setEncryptionPassword(p: string): void; setEncryptionKey(k: Uint8Array): void },
  password?: string,
  key?: Uint8Array,
): void {
  if (password !== undefined && key !== undefined) {
    throw new BfcError("Specify either `password` or `key`, not both", "INVAL");
  }
  if (password !== undefined) target.setEncryptionPassword(password);
  if (key !== undefined) target.setEncryptionKey(key);
}

export class Archive {
  readonly path: string;
  readonly #native: NativeArchive;

  /** @internal — use openArchive(). */
  constructor(path: string, native: NativeArchive) {
    this.path = path;
    this.#native = native;
  }

  get encrypted(): boolean {
    return this.#native.hasEncryption();
  }

  async list(prefix = ""): Promise<Entry[]> {
    return (await this.#native.list(prefix)).map(toEntry);
  }

  async stat(containerPath: string): Promise<Entry> {
    return toEntry(await this.#native.stat(containerPath));
  }

  /**
   * Read entry content. Does not validate CRC — arbitrary offsets make that
   * impossible. Use verify({deep:true}) or extract() when integrity matters.
   */
  async read(
    containerPath: string,
    opts: { offset?: number; length?: number } = {},
  ): Promise<Buffer> {
    return this.#native.read(containerPath, opts.offset ?? 0, opts.length ?? -1);
  }

  /** Write one entry to `destPath`, creating parent directories. Validates CRC. */
  async extract(containerPath: string, destPath: string): Promise<void> {
    await mkdir(dirname(destPath), { recursive: true });
    const handle = await open(destPath, "w");
    try {
      await this.#native.extractToFd(containerPath, handle.fd);
    } finally {
      await handle.close();
    }
  }

  /**
   * Restore every entry (optionally under `prefix`) into `destDir`, refusing
   * any path that would escape it.
   */
  async extractAll(destDir: string, opts: { prefix?: string } = {}): Promise<void> {
    await extractAllImpl(this, destDir, opts);
  }

  async verify(opts: { deep?: boolean } = {}): Promise<void> {
    await this.#native.verify(opts.deep ?? false);
  }

  async close(): Promise<void> {
    this.#native.close();
  }
}

export async function openArchive(
  path: string,
  opts: OpenArchiveOptions = {},
): Promise<Archive> {
  const native = await loadNative().Archive.open(path);
  try {
    applyEncryption(native, opts.password, opts.key);
  } catch (err) {
    native.close();
    throw err;
  }
  return new Archive(path, native);
}
