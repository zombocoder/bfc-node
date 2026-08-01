import { stat as fsStat } from "node:fs/promises";

import { applyEncryption } from "./archive.ts";
import { loadNative } from "./loader.ts";
import type {
  CompressionOptions,
  NativeBinding,
  NativeWriter,
  OpenWriterOptions,
} from "./types.ts";

const DEFAULT_LEVEL = 3;
// Matches BFC's own default, so enabling compression changes only the codec.
const DEFAULT_THRESHOLD = 64;

export function applyCompression(
  native: NativeBinding,
  writer: NativeWriter,
  compression: boolean | CompressionOptions | undefined,
): void {
  if (!compression) return;
  const opts: CompressionOptions = compression === true ? {} : compression;
  writer.setCompression(native.COMP_ZSTD, opts.level ?? DEFAULT_LEVEL);
  writer.setCompressionThreshold(opts.threshold ?? DEFAULT_THRESHOLD);
}

export class Writer {
  readonly #native: NativeWriter;

  /** @internal — use openWriter(). */
  constructor(native: NativeWriter) {
    this.#native = native;
  }

  /**
   * Add a file from a filesystem path or from memory. A path also carries its
   * mode and mtime across unless they are given explicitly.
   */
  async addFile(
    containerPath: string,
    source: string | Uint8Array,
    opts: { mode?: number; mtimeNs?: bigint } = {},
  ): Promise<void> {
    if (typeof source === "string") {
      const st = await fsStat(source);
      await this.#native.addFile(
        containerPath,
        source,
        opts.mode ?? st.mode & 0o7777,
        opts.mtimeNs ?? BigInt(Math.round(st.mtimeMs * 1e6)),
      );
      return;
    }
    await this.#native.addFileFromBuffer(
      containerPath,
      source,
      opts.mode ?? 0o644,
      opts.mtimeNs ?? 0n,
    );
  }

  async addDir(
    containerPath: string,
    opts: { mode?: number; mtimeNs?: bigint } = {},
  ): Promise<void> {
    await this.#native.addDir(containerPath, opts.mode ?? 0o755, opts.mtimeNs ?? 0n);
  }

  async addSymlink(
    containerPath: string,
    target: string,
    opts: { mode?: number; mtimeNs?: bigint } = {},
  ): Promise<void> {
    await this.#native.addSymlink(containerPath, target, opts.mode ?? 0o777, opts.mtimeNs ?? 0n);
  }

  /** Write the index and footer. Required — without it the archive is unreadable. */
  async finish(): Promise<void> {
    await this.#native.finish();
  }

  async close(): Promise<void> {
    this.#native.close();
  }
}

export async function openWriter(opts: OpenWriterOptions): Promise<Writer> {
  const native = loadNative();
  const writer = await native.Writer.create(opts.output, opts.blockSize ?? 0);
  try {
    applyCompression(native, writer, opts.compression);
    applyEncryption(writer, opts.password, opts.key);
  } catch (err) {
    writer.close();
    throw err;
  }
  return new Writer(writer);
}
