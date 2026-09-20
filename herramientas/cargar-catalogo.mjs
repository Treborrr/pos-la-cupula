#!/usr/bin/env node
/**
 * Carga un catálogo en el POS a través del API.
 *
 * Va por HTTP y no escribiendo el log directamente, a propósito: así pasa por
 * las MISMAS validaciones que cualquier alta hecha a mano (códigos únicos,
 * precios en céntimos, tipos válidos). Una herramienta de migración que se
 * salta las reglas del dominio es la forma clásica de meter datos que después
 * el sistema no sabe manejar.
 *
 * Es idempotente: un código que ya existe se informa y se saltea, así que se
 * puede correr dos veces sin duplicar nada.
 *
 * Uso:
 *   node herramientas/cargar-catalogo.mjs datos-ejemplo/catalogo-del-excel.json
 *   node herramientas/cargar-catalogo.mjs archivo.json --url http://localhost:7070
 */

import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

const argumentos = argv.slice(2);
const posicionUrl = argumentos.indexOf("--url");
// Cuidado con el -1 de `indexOf`: hay que resolverlo explícitamente, porque tanto
// `argumentos[-1 + 1]` como comparar contra `posicionUrl + 1` apuntan al
// primer argumento —el archivo— cuando `--url` no está.
const indiceValorUrl = posicionUrl >= 0 ? posicionUrl + 1 : -1;
const url = (indiceValorUrl >= 0 ? argumentos[indiceValorUrl] : "http://localhost:7070").replace(/\/$/, "");
const archivo = argumentos.find((a, i) => !a.startsWith("--") && i !== indiceValorUrl);

if (!archivo) {
  console.error("Falta el archivo. Ejemplo:\n  node herramientas/cargar-catalogo.mjs datos-ejemplo/catalogo-del-excel.json");
  exit(1);
}

const contenido = JSON.parse(await readFile(archivo, "utf8"));
const items = Array.isArray(contenido) ? contenido : (contenido.items ?? []);
const barberos = contenido.barberos ?? [];

if (items.length === 0 && barberos.length === 0) {
  console.error("El archivo no tiene ítems ni barberos.");
  exit(1);
}

// Antes de escribir nada: si el servidor no está, decirlo claro en vez de
// soltar un ECONNREFUSED pelado.
try {
  const salud = await fetch(`${url}/api/salud`);
  if (!salud.ok) throw new Error(String(salud.status));
} catch {
  console.error(`No responde el POS en ${url}.\nLevantalo con  npm run dev  y vuelve a intentar.`);
  exit(1);
}

let creados = 0;
let salteados = 0;
let fallados = 0;

for (const item of items) {
  const respuesta = await fetch(`${url}/api/catalogo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });

  if (respuesta.ok) {
    creados++;
    console.log(`  + ${item.codigo.padEnd(12)} ${item.nombre}`);
    continue;
  }

  const cuerpo = await respuesta.json().catch(() => null);
  if (cuerpo?.error?.codigo === "CODIGO_REPETIDO") {
    salteados++;
    console.log(`  = ${item.codigo.padEnd(12)} ya existía, se saltea`);
  } else {
    fallados++;
    console.error(`  ✗ ${item.codigo.padEnd(12)} ${cuerpo?.error?.mensaje ?? respuesta.status}`);
  }
}

for (const nombre of barberos) {
  const respuesta = await fetch(`${url}/api/barberos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre }),
  });
  console.log(respuesta.ok ? `  + barbero ${nombre}` : `  ✗ barbero ${nombre}`);
}

console.log(`\nCreados: ${creados}   Ya existían: ${salteados}   Con error: ${fallados}`);
exit(fallados > 0 ? 1 : 0);
