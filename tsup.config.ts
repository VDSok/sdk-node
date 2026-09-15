import { defineConfig } from "tsup";

// ESM + CJS из одного исходника: клиенты на старом `require()` и на
// современных `import` получают один и тот же пакет без двух сборок руками.
// `node:crypto` — единственный импорт вне пакета, tsup оставляет его внешним.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
  platform: "node",
  treeshake: true,
  splitting: false,
  minify: false,
});
