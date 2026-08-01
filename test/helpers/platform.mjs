/**
 * Windows has no POSIX permission bits: `fs.stat().mode` only reflects the
 * read-only attribute, so modes read back from disk never match what a
 * chmod asked for. Assertions about modes that originate from the filesystem
 * are gated on this; modes we pass explicitly to the writer round-trip
 * everywhere and need no gate.
 */
export const hasPosixModes = process.platform !== "win32";
