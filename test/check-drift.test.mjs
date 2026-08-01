import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseUpstreamSources, checkDrift } from "../scripts/check-drift.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("parseUpstreamSources extracts the BFC_LIB_SOURCES list", () => {
  const cmake = `
set(BFC_LIB_SOURCES
    bfc_format.c
    bfc_writer.c
)

set(BFC_LIB_HEADERS
    bfc_format.h
)
`;
  assert.deepEqual(parseUpstreamSources(cmake), ["bfc_format.c", "bfc_writer.c"]);
});

test("parseUpstreamSources ignores comments inside the block", () => {
  const cmake = `
set(BFC_LIB_SOURCES
    # a comment
    bfc_os.c
)
`;
  assert.deepEqual(parseUpstreamSources(cmake), ["bfc_os.c"]);
});

test("parseUpstreamSources throws when the block is absent", () => {
  assert.throws(() => parseUpstreamSources("set(SOMETHING_ELSE a.c)"), /BFC_LIB_SOURCES/);
});

test("our source list matches the pinned upstream submodule", () => {
  const result = checkDrift(root);
  assert.deepEqual(
    result.missing,
    [],
    "sources present upstream but absent from cmake/bfc-sources.json",
  );
  assert.deepEqual(
    result.extra,
    [],
    "sources in cmake/bfc-sources.json that upstream no longer has",
  );
  assert.equal(result.ok, true);
});
