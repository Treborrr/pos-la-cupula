/**
 * Upcasters: traducen eventos viejos al formato que el código de hoy espera,
 * AL LEER. El archivo en disco no se toca nunca.
 *
 * Este es el mecanismo que hace que "escalable" no sea una palabra suelta:
 * el sistema puede cambiar de forma sin que el histórico se vuelva ilegible ni
 * haya que correr una migración destructiva sobre los datos de un cliente.
 *
 * Cómo se agrega uno, cuando llegue el día:
 *
 *   "venta.registrada": {
 *     // de v1 a v2: v2 agregó `propina`, que en v1 no existía
 *     1: (d) => ({ ...d, propina: 0 }),
 *   }
 *
 * La función recibe los datos en la versión N y devuelve los datos en N+1.
 * Se encadenan solas hasta llegar a VERSION_ACTUAL.
 */

import { VERSION_ACTUAL, type TipoEvento } from "./eventos";

type Upcaster = (datos: any) => any;

/**
 * Vacío hoy, y está bien: la v1 es la primera versión de todo. Que exista el
 * archivo y esté cableado desde el día 1 es lo que importa — si el gancho se
 * agrega recién cuando hace falta, para entonces ya hay datos de producción y
 * el cambio da miedo.
 */
export const upcasters: Partial<Record<TipoEvento, Record<number, Upcaster>>> = {};

/**
 * Lleva los datos de un evento desde la versión en que fueron escritos hasta
 * la versión actual, aplicando los upcasters en cadena.
 */
export function actualizarDatos(tipo: TipoEvento, v: number, datos: unknown): unknown {
  const destino = VERSION_ACTUAL[tipo];
  if (v === destino) return datos;

  if (v > destino) {
    // El archivo fue escrito por una versión MÁS NUEVA del programa que la que
    // está corriendo. Seguir sería inventar. Mejor negarse con un mensaje que
    // diga qué pasó: casi siempre es que alguien restauró un respaldo sobre
    // una instalación desactualizada.
    throw new Error(
      `El evento "${tipo}" está en la versión ${v} y este programa entiende hasta la ${destino}. ` +
        `Los datos fueron escritos por una versión más nueva del POS: actualiza el programa antes de abrirlos.`,
    );
  }

  const deEsteTipo = upcasters[tipo];
  let actuales = datos;
  for (let desde = v; desde < destino; desde++) {
    const fn = deEsteTipo?.[desde];
    if (!fn) {
      throw new Error(
        `Falta el upcaster de "${tipo}" de v${desde} a v${desde + 1}. ` +
          `Subir VERSION_ACTUAL obliga a escribirlo.`,
      );
    }
    actuales = fn(actuales);
  }
  return actuales;
}
