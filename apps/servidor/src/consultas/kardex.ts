/**
 * Kardex: toda la historia de movimientos de un producto.
 *
 * Se calcula recorriendo el log en vez de mantenerlo en memoria. Es una
 * decisión deliberada: guardarlo en la proyección engordaría cada instantánea
 * con miles de movimientos que casi nunca se consultan, mientras que recorrer
 * el log filtrando por un ítem cuesta milisegundos con el volumen de esta
 * barbería (~20 000 eventos al año).
 *
 * Si algún día el volumen cambia ese cálculo, la respuesta es agregar un
 * índice, no mover esto a la proyección.
 */

import { esDeTipo } from "@cupula/contratos";

import type { AlmacenDeEventos } from "../puertos/AlmacenDeEventos";
import type { MovimientoStock } from "../proyecciones/tipos";

/**
 * Una sola pasada sobre el log.
 *
 * Las anulaciones obligan a llevar memoria: el evento `venta.anulada` no trae
 * las líneas, así que hay que recordar cuánto de este producto salió en cada
 * venta para saber cuánto devolver.
 */
export async function kardexDe(
  almacen: AlmacenDeEventos,
  itemId: string,
  limite = 200,
): Promise<MovimientoStock[]> {
  const movimientos: MovimientoStock[] = [];
  const salidaPorVenta = new Map<string, number>();
  let saldo = 0;

  const anotar = (
    ts: string,
    delta: number,
    motivo: string,
    origen: MovimientoStock["origen"],
    referencia?: string,
  ) => {
    saldo = Math.round((saldo + delta) * 1000) / 1000;
    movimientos.push({ ts, itemId, cantidad: delta, saldo, motivo, origen, referencia });
  };

  for await (const e of almacen.leer()) {
    if (esDeTipo(e, "stock.entrada") && e.datos.itemId === itemId) {
      anotar(e.ts, e.datos.cantidad, e.datos.motivo, "entrada", e.datos.referencia);
      continue;
    }

    if (esDeTipo(e, "stock.merma") && e.datos.itemId === itemId) {
      anotar(e.ts, -e.datos.cantidad, e.datos.motivo, "merma");
      continue;
    }

    if (esDeTipo(e, "stock.ajustado") && e.datos.itemId === itemId) {
      // El ajuste FIJA el saldo: es el resultado de haber contado, no una suma.
      // El movimiento que se muestra es la diferencia que produjo.
      const delta = Math.round((e.datos.cantidadContada - saldo) * 1000) / 1000;
      anotar(
        e.ts,
        delta,
        `${e.datos.motivo} — contado ${e.datos.cantidadContada}, el sistema decía ${e.datos.cantidadSistema}`,
        "ajuste",
      );
      continue;
    }

    if (esDeTipo(e, "venta.registrada")) {
      const salida = e.datos.lineas
        .filter((l) => l.itemId === itemId && l.tipo === "PRODUCTO")
        .reduce((a, l) => a + l.cantidad, 0);
      if (salida > 0) {
        salidaPorVenta.set(e.datos.ventaId, salida);
        anotar(e.ts, -salida, `Venta ${e.datos.correlativo}`, "venta", e.datos.correlativo);
      }
      continue;
    }

    if (esDeTipo(e, "venta.anulada")) {
      const devuelve = salidaPorVenta.get(e.datos.ventaId);
      if (devuelve) {
        anotar(e.ts, devuelve, `Anulación de ${e.datos.correlativo}`, "anulacion", e.datos.correlativo);
      }
      continue;
    }
  }

  // Los más recientes primero: es lo que alguien quiere ver al abrir la ficha.
  return movimientos.slice(-limite).reverse();
}
