/**
 * Hash y verificación de contraseñas. Vive FUERA de `dominio/` a propósito,
 * por dos razones y no una:
 *
 *  · Generar un hash necesita una sal ALEATORIA — nada que dependa de azar
 *    puede vivir en el dominio (ver `herramientas/verificar-capas.mjs`).
 *  · Verificar un login es un asunto del FLUJO HTTP, no de qué significa un
 *    evento ya escrito: el dominio se reproduce entero al reconstruir la
 *    proyección desde el log, y esa reproducción nunca puede re-ejecutar una
 *    verificación de contraseña. `dominio/usuarios/usuarios.ts` solo recibe
 *    el hash ya calculado como un string cualquiera.
 *
 * Formato auto-descriptivo (`scrypt:N:r:p:saltHex:hashHex`) para poder subir
 * los costos de `scrypt` el día de mañana sin invalidar los hashes que ya
 * están guardados en el log.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  clave: string,
  sal: Buffer,
  largo: number,
  opciones: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * N=16384 (2¹⁴), r=8, p=1: el mínimo que recomienda OWASP para `scrypt`, con
 * memoria (~16 MB) bien por debajo del `maxmem` por defecto de Node. Más
 * costoso sería más seguro, pero esto corre en el mismo proceso que atiende
 * ventas — `scrypt` async no bloquea el event loop, pero sí compite por CPU
 * con un cobro que esté en curso al mismo tiempo que alguien inicia sesión.
 */
const N = 16384;
const R = 8;
const P = 1;
const LARGO_HASH = 64;

export async function hashearContrasena(clave: string): Promise<string> {
  const sal = randomBytes(16);
  const derivada = await scrypt(clave, sal, LARGO_HASH, { N, r: R, p: P });
  return `scrypt:${N}:${R}:${P}:${sal.toString("hex")}:${derivada.toString("hex")}`;
}

/**
 * Un hash SEÑUELO, con los mismos parámetros que los de verdad.
 *
 * Sirve para que verificar la contraseña de un usuario que NO existe cueste lo
 * mismo que la de uno que sí. Sin esto, el login respondía en 2 ms cuando el
 * usuario no existía y en 43 ms cuando existía —`scrypt` tarda a propósito—,
 * así que el mensaje "usuario o contraseña incorrectos" era idéntico pero el
 * CRONÓMETRO delataba cuáles son las cuentas reales. Con eso, un atacante
 * primero averigua los usuarios válidos y recién después gasta intentos en
 * adivinar contraseñas, que es exactamente el trabajo que el mensaje genérico
 * buscaba ahorrarle.
 *
 * La clave que se hashea es aleatoria y se tira: nadie puede autenticarse
 * contra este hash, solo gastar el mismo tiempo que gastaría una cuenta real.
 *
 * Se calcula una sola vez, la primera vez que hace falta, y se reutiliza.
 */
let senuelo: Promise<string> | null = null;
export function hashSenuelo(): Promise<string> {
  senuelo ??= hashearContrasena(randomBytes(32).toString("hex"));
  return senuelo;
}

/**
 * `false` ante cualquier hash con forma rara (corrupto, de otro esquema que
 * algún día se deje de soportar) en vez de tirar — un login que falla mal
 * tiene que verse igual que una contraseña incorrecta, nunca como un error
 * de sistema que invite a reintentar.
 */
export async function verificarContrasena(clave: string, hash: string): Promise<boolean> {
  const partes = hash.split(":");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;

  const [, nTexto, rTexto, pTexto, salHex, hashHex] = partes;
  const n = Number(nTexto);
  const r = Number(rTexto);
  const p = Number(pTexto);
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0)) return false;

  let sal: Buffer;
  let esperado: Buffer;
  try {
    sal = Buffer.from(salHex, "hex");
    esperado = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (sal.length === 0 || esperado.length === 0) return false;

  const derivada = await scrypt(clave, sal, esperado.length, { N: n, r, p });
  // Buffers de igual largo siempre (se pide `esperado.length` arriba): lo que
  // `timingSafeEqual` exige para no tirar.
  return timingSafeEqual(derivada, esperado);
}
