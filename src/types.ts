import type { Stats } from "node:fs";

export type EntryType = "file" | "dir" | "symlink";
export type CompressionName = "none" | "zstd";
export type EncryptionName = "none" | "chacha20-poly1305";

export interface Entry {
  path: string;
  type: EntryType;
  mode: number;
  mtimeNs: bigint;
  mtime: Date;
  size: number;
  /** Only reliable from `stat()`; `list()` always reports "none" (see README). */
  compression: CompressionName;
  /** Only reliable from `stat()`; `list()` always reports "none" (see README). */
  encryption: EncryptionName;
  crc32c: number;
  objOffset: bigint;
  objSize: bigint;
}

export interface CompressionOptions {
  type?: "zstd";
  level?: number;
  threshold?: number;
}

export interface CreateArchiveOptions {
  output: string;
  inputs: string[];
  baseDir?: string;
  blockSize?: number;
  compression?: boolean | CompressionOptions;
  password?: string;
  key?: Uint8Array;
  followSymlinks?: boolean;
  filter?: (relPath: string, stats: Stats) => boolean;
  onProgress?: (progress: {
    path: string;
    entriesDone: number;
    bytesWritten: number;
  }) => void;
}

export interface CreateArchiveResult {
  path: string;
  entries: number;
  bytesWritten: number;
}

export interface OpenWriterOptions {
  output: string;
  blockSize?: number;
  compression?: boolean | CompressionOptions;
  password?: string;
  key?: Uint8Array;
}

export interface OpenArchiveOptions {
  password?: string;
  key?: Uint8Array;
}

export interface BuildInfo {
  packageVersion: string;
  napiVersion: number;
  bfcVersion: string;
  bfcCommit: string;
  platform: NodeJS.Platform;
  architecture: string;
  libc: "glibc" | "musl" | null;
  compression: boolean;
  encryption: boolean;
}

/* ---- Shape of the compiled addon. Mirrors native/src/addon.cc. ---- */

export interface NativeEntry {
  path: string;
  type: EntryType;
  mode: number;
  mtimeNs: bigint;
  size: number;
  compression: CompressionName;
  encryption: EncryptionName;
  crc32c: number;
  objOffset: bigint;
  objSize: bigint;
}

export interface NativeWriter {
  addFile(containerPath: string, sourcePath: string, mode: number, mtimeNs: bigint): Promise<void>;
  addFileFromBuffer(
    containerPath: string,
    data: Uint8Array,
    mode: number,
    mtimeNs: bigint,
  ): Promise<void>;
  addDir(containerPath: string, mode: number, mtimeNs: bigint): Promise<void>;
  addSymlink(containerPath: string, target: string, mode: number, mtimeNs: bigint): Promise<void>;
  setCompression(type: number, level: number): void;
  setCompressionThreshold(minBytes: number): void;
  setEncryptionPassword(password: string): void;
  setEncryptionKey(key: Uint8Array): void;
  clearEncryption(): void;
  finish(): Promise<void>;
  close(): void;
}

export interface NativeArchive {
  list(prefix: string): Promise<NativeEntry[]>;
  stat(containerPath: string): Promise<NativeEntry>;
  /** `length === -1` means "to the end of the entry". */
  read(containerPath: string, offset: number, length: number): Promise<Buffer>;
  extractToFd(containerPath: string, fd: number): Promise<void>;
  verify(deep: boolean): Promise<void>;
  setEncryptionPassword(password: string): void;
  setEncryptionKey(key: Uint8Array): void;
  hasEncryption(): boolean;
  close(): void;
}

export interface NativeBinding {
  COMP_NONE: number;
  COMP_ZSTD: number;
  zstdVersion(): string;
  sodiumVersion(): string;
  nativeBuildInfo(): Omit<BuildInfo, "packageVersion">;
  Writer: { create(path: string, blockSize: number): Promise<NativeWriter> };
  Archive: { open(path: string): Promise<NativeArchive> };
}
