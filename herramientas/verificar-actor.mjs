#!/usr/bin/env node
/**
 * Toda escritura que sale de una ruta HTTP tiene que decir QUIÉN la hizo.
 *
 * `actor` es OPCIONAL en `ServicioPos` a propósito —exigirlo en el tipo
 * habría obligado a tocar cada prueba existente que llama
 * `transaccion`/`escribir`/etc. solo para armar su estado inicial, y ahí da
 * igual quién figure como autor—. Pero en `http/rutas/`, donde sí hay una
 * persona real detrás de cada pedido, olvidarlo deja el evento a nombre de
 * `ACTOR_SISTEMA` para siempre en un log que nunca se corrige. Esto cierra
 * esa rendija donde el tipo no alcanza.
 *
 * Corre en cada build:  node herramientas/verificar-actor.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { exit } from "node:process";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const RUTAS = join(RAIZ, "apps/servidor/src/http/rutas");

// Cuántas comas de nivel superior hacen falta ANTES de `actor`: varía porque
// no todos los métodos tienen la misma cantidad de parámetros obligatorios
// delante. `guardarConfig(clave, valor, actor?)` ya tiene una coma con solo
// `clave, valor` — ahí hace falta la SEGUNDA para que `actor` esté presente.
const COMAS_MINIMAS = {
  transaccion: 1,
  escribir: 1,
  cobrar: 1,
  anular: 2,
  registrarReimpresion: 1,
  guardarConfig: 2,
};

async function archivosTs(dir) {
  const salida = [];
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...(await archivosTs(ruta)));
    else if (entrada.name.endsWith(".ts")) salida.push(ruta);
  }
  return salida;
}

/**
 * Cuenta las comas de NIVEL SUPERIOR del paréntesis de la llamada (no las
 * que caen dentro de un `{}`, `[]`, otro `(...)` o un string). `desde` apunta
 * justo después del `(` de apertura (ya contado como una `profundidad` de 1).
 */
function contarComasDeNivelSuperior(texto, desde) {
  let profundidad = 1;
  let enString = null;
  let comas = 0;

  for (let i = desde; i < texto.length; i++) {
    const c = texto[i];
    if (enString) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === enString) enString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      enString = c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") {
      profundidad++;
      continue;
    }
    if (c === ")" || c === "}" || c === "]") {
      profundidad--;
      if (profundidad === 0) return comas;
      continue;
    }
    if (c === "," && profundidad === 1) comas++;
  }
  return comas;
}

const infracciones = [];

for (const archivo of await archivosTs(RUTAS)) {
  const texto = await readFile(archivo, "utf8");
  for (const [metodo, minimo] of Object.entries(COMAS_MINIMAS)) {
    const patron = new RegExp(`\\bpos\\.${metodo}\\s*\\(`, "g");
    let m;
    while ((m = patron.exec(texto))) {
      const desdeArgs = m.index + m[0].length;
      if (contarComasDeNivelSuperior(texto, desdeArgs) < minimo) {
        const linea = texto.slice(0, m.index).split("\n").length;
        infracciones.push({ archivo: relative(RAIZ, archivo), linea, metodo, minimo });
      }
    }
  }
}

if (infracciones.length === 0) {
  console.log("✓ Toda escritura desde las rutas HTTP pasa un actor explícito.");
  exit(0);
}

console.error("✗ Hay llamadas en http/rutas/ que no pasan `actor`:\n");
for (const i of infracciones) {
  console.error(`  ${i.archivo}:${i.linea}  pos.${i.metodo}(...)  — falta el argumento \`actor\` (necesita ${i.minimo} coma(s) de nivel superior)`);
}
console.error("\nCada ruta tiene que pasar `peticion.actor` (o el que corresponda) como último argumento.");
exit(1);
