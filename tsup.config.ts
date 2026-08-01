import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // Declarations come from tsc (see tsconfig.build.json). tsup's dts step uses
  // rollup-plugin-dts, which reaches into TypeScript 5.x internals and breaks
  // on TypeScript 7.
  dts: false,
  clean: true,
  sourcemap: true,
  // Makes createRequire(import.meta.url) work in the CJS build too.
  shims: true,
  target: "node18",
  define: { __PACKAGE_VERSION__: JSON.stringify(pkg.version) },
});
