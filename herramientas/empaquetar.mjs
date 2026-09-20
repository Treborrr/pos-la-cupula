#!/usr/bin/env node
/**
 * Empaqueta el servidor en un solo archivo JavaScript con esbuild.
 *
 * Bundlear resuelve de paso el lío de módulos: el paquete `@cupula/contratos`
 * se consume como fuente TypeScript y los imports son sin extensión, cosa que
 * Node en crudo no resuelve pero esbuild sí. El resultado es un `.mjs` que
 * arranca con `node` pelado, sin `node_modules` al lado.
 *
 * El paso siguiente —convertirlo en un `.exe` con @yao-pkg/pkg y registrarlo
 * como servicio de Windows con NSSM— es el hito H8 y todavía no está hecho.
 *
 * Uso:  npm run build --workspace=@cupula/servidor
 */

import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const SALIDA = join(RAIZ, "apps/servidor/dist");

await rm(SALIDA, { recursive: true, force: true });
await mkdir(SALIDA, { recursive: true });

const resultado = await build({
  entryPoints: [join(RAIZ, "apps/servidor/src/servidor.ts")],
  outfile: join(SALIDA, "pos-cupula.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  minify: false, // un stack trace legible vale más que 200 KB en una barbería
  // Sin esto, un `require` dentro de una dependencia CommonJS revienta al
  // ejecutar el bundle ESM.
  banner: {
    js: [
      "import { createRequire as __crearRequire } from 'node:module';",
      "const require = __crearRequire(import.meta.url);",
    ].join("\n"),
  },
  metafile: true,
  logLevel: "info",
});

// La PWA compilada viaja junto al servidor: `carpetaDeLaPwa()` la busca en
// `../pwa` relativo al bundle.
const origenPwa = join(RAIZ, "apps/pwa/dist");
await cp(origenPwa, join(SALIDA, "..", "pwa"), { recursive: true }).catch(() => {
  console.warn("\n⚠ No está la PWA compilada. Ejecuta primero:  npm run build --workspace=@cupula/pwa");
});

await writeFile(
  join(SALIDA, "arrancar.cmd"),
  [
    "@echo off",
    "REM Arranque manual del POS. En la instalación real esto lo hace NSSM",
    "REM como servicio de Windows, para que levante solo al encender la PC.",
    "set POS_DATOS=C:\\POSCupula\\datos",
    "node \"%~dp0pos-cupula.mjs\"",
  ].join("\r\n"),
  "utf8",
);

const bytes = Object.values(resultado.metafile.outputs).reduce((a, o) => a + o.bytes, 0);
console.log(`\nServidor empaquetado: ${(bytes / 1024 / 1024).toFixed(2)} MB en apps/servidor/dist/`);
console.log("Pruébalo con:  node apps/servidor/dist/pos-cupula.mjs");
