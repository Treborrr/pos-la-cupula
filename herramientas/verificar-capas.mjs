#!/usr/bin/env node
/**
 * Verifica la regla que sostiene toda la promesa de migración:
 *
 *   NINGÚN archivo bajo `src/dominio/` puede tocar el sistema de archivos,
 *   la red, el reloj ni el azar.
 *
 * Es lo que convierte "cambiar de archivos a Postgres" en escribir un
 * adaptador contra una interfaz, en vez de reescribir el sistema. Una regla
 * que no se chequea se rompe sola en tres meses, cuando alguien con prisa
 * importe `fs` "solo para esta cosita".
 *
 * Corre en cada build:  npm run verificar-capas
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { exit } from "node:process";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const DOMINIO = join(RAIZ, "apps/servidor/src/dominio");

const PROHIBIDO = [
  { patron: /from\s+["']node:fs["']|from\s+["']fs["']|require\(["']fs["']\)/, que: "acceso a archivos" },
  { patron: /from\s+["']node:http|from\s+["']node:https|\bfetch\s*\(/, que: "acceso a la red" },
  { patron: /from\s+["']node:path["']|from\s+["']path["']/, que: "rutas del sistema de archivos" },
  { patron: /\bDate\.now\s*\(|new\s+Date\s*\(\s*\)/, que: "lectura del reloj (usa el puerto Reloj)" },
  { patron: /\bMath\.random\s*\(/, que: "azar (rompe la reproducibilidad del log)" },
  { patron: /\bprocess\.env\b/, que: "lectura del entorno (pasalo como parámetro)" },
];

async function archivosTs(dir) {
  const salida = [];
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...(await archivosTs(ruta)));
    else if (entrada.name.endsWith(".ts")) salida.push(ruta);
  }
  return salida;
}

const infracciones = [];

for (const archivo of await archivosTs(DOMINIO)) {
  const lineas = (await readFile(archivo, "utf8")).split("\n");
  lineas.forEach((linea, i) => {
    // Los comentarios no cuentan: el dominio habla DE estas cosas todo el
    // tiempo para explicar por qué no las usa.
    const sinComentario = linea.replace(/^\s*(\/\/|\*|\/\*).*/, "");
    for (const { patron, que } of PROHIBIDO) {
      if (patron.test(sinComentario)) {
        infracciones.push({
          archivo: relative(RAIZ, archivo),
          linea: i + 1,
          que,
          texto: linea.trim(),
        });
      }
    }
  });
}

if (infracciones.length === 0) {
  console.log("✓ El dominio está limpio: no toca archivos, red, reloj ni azar.");
  exit(0);
}

console.error("✗ El dominio se contaminó con detalles de infraestructura:\n");
for (const i of infracciones) {
  console.error(`  ${i.archivo}:${i.linea}`);
  console.error(`    ${i.que}`);
  console.error(`    ${i.texto}\n`);
}
console.error(
  "El dominio tiene que hablar con un PUERTO (src/puertos/), no con el mundo.\n" +
    "Si de verdad hace falta algo nuevo del exterior, agrega un puerto y un adaptador.",
);
exit(1);
