import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Windows keeps a file locked for a short while after the last handle closes,
 * so a removal that races with it fails with EBUSY. Node retries these with a
 * linear backoff when asked to.
 */
async function removeTempDir(dir) {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (cause) {
    // Name what is still there — "EBUSY on some path" is not enough to act on.
    let remaining = "<unreadable>";
    try {
      remaining = (await readdir(dir)).join(", ") || "<empty>";
    } catch {
      /* the directory itself may be gone already */
    }
    throw new Error(`Failed to remove ${dir} (still present: ${remaining})`, { cause });
  }
}

/**
 * Run `fn` with a fresh temp directory, removed afterwards.
 *
 * A cleanup failure must never mask a test failure: when the body throws, the
 * body's error wins and cleanup is best-effort. When the body succeeds, a
 * cleanup failure is surfaced, since it means something is still holding a
 * handle open.
 */
export async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "bfc-node-test-"));
  let result;
  try {
    result = await fn(dir);
  } catch (err) {
    await removeTempDir(dir).catch(() => {});
    throw err;
  }
  await removeTempDir(dir);
  return result;
}
