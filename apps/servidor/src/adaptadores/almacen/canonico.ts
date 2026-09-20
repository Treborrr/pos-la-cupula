/**
 * Serialización canónica y cadena de hash.
 *
 * Para que el hash de un evento sea reproducible hay que serializarlo SIEMPRE
 * igual. `JSON.stringify` respeta el orden en que se insertaron las claves, y
 * ese orden depende de cómo se construyó el objeto — o sea, de detalles que
 * cambian al refactorizar. Aquí las claves se ordenan alfabéticamente y de
 * forma recursiva, así el mismo contenido da el mismo texto hoy y dentro de
 * tres años.
 */

import { createHash } from "node:crypto";

export function canonico(valor: unknown): string {
  if (valor === undefined) return "null";
  if (valor === null || typeof valor !== "object") {
    // Number.isFinite descarta NaN e Infinity, que JSON no sabe representar y
    // convertiría silenciosamente en null — corrompiendo el hash sin avisar.
    if (typeof valor === "number" && !Number.isFinite(valor)) {
      throw new Error(`No se puede serializar el número ${valor}`);
    }
    return JSON.stringify(valor);
  }

  if (Array.isArray(valor)) {
    return "[" + valor.map(canonico).join(",") + "]";
  }

  const obj = valor as Record<string, unknown>;
  const claves = Object.keys(obj)
    .filter((k) => obj[k] !== undefined) // `undefined` no existe en JSON
    .sort();

  return "{" + claves.map((k) => `${JSON.stringify(k)}:${canonico(obj[k])}`).join(",") + "}";
}

/** Primer eslabón de la cadena, cuando el log está vacío. */
export const HASH_GENESIS = "0000000000000000";

/**
 * h(n) = sha256( h(n-1) + canónico(evento sin su propio h) ), primeros 16 hex.
 *
 * 16 hex son 64 bits: de sobra para detectar una edición accidental o
 * deliberada con el Bloc de notas, que es contra lo que esto protege. No
 * pretende ser una firma criptográfica — para eso haría falta una clave que en
 * una PC de barbería no habría dónde guardar.
 */
export function hashDelEvento(hashAnterior: string, sobreSinHash: unknown): string {
  return createHash("sha256")
    .update(hashAnterior + canonico(sobreSinHash), "utf8")
    .digest("hex")
    .slice(0, 16);
}
