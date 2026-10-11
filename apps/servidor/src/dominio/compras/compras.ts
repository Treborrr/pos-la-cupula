/**
 * Compras: mercadería que entra al inventario de una sola vez, de un
 * proveedor, con lo que costó cada línea.
 *
 * No es un evento nuevo: por línea es exactamente un `stock.entrada` —la
 * misma lógica de costo promedio ponderado, ya probada— y si de verdad salió
 * plata del cajón, un `caja.egreso_registrado` más, igual que un egreso
 * cualquiera. "Compra" es la manera en que la pantalla junta varias líneas en
 * una sola acción; el log no se entera de que fueron una compra y no cuatro
 * entradas sueltas, salvo por compartir la misma referencia.
 */

import type { Centimos, EventoNuevo } from "@cupula/contratos";
import { ulid } from "ulid";

import { ErrorDeNegocio } from "../errores";
import { registrarEntrada } from "../inventario/inventario";
import { registrarEgreso } from "../caja/caja";
import type { Proyeccion } from "../../proyecciones/Proyeccion";

export interface LineaDeCompra {
  itemId: string;
  cantidad: number;
  costoUnitario: Centimos;
}

export interface CompraPedida {
  lineas: LineaDeCompra[];
  proveedor?: string;
  comprobante?: string;
  /**
   * `true` (default): salió plata del cajón y se descuenta sola del efectivo
   * esperado, como cualquier egreso. `false`: se pagó por otro lado —
   * transferencia desde otra cuenta, crédito del proveedor— y no toca la caja
   * para nada: solo se actualiza el inventario y el costo.
   */
  salioDeLaCaja?: boolean;
}

export function registrarCompra(
  p: Proyeccion,
  pedido: CompraPedida,
): { eventos: EventoNuevo[]; compraId: string; total: Centimos } {
  if (!pedido.lineas || pedido.lineas.length === 0) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "No hay nada que registrar en la compra.");
  }

  const compraId = ulid();
  const motivo = pedido.proveedor?.trim() ? `Compra a ${pedido.proveedor.trim()}` : "Compra de mercadería";

  const eventos: EventoNuevo[] = [];
  let total = 0;

  for (const linea of pedido.lineas) {
    if (!(linea.costoUnitario >= 0)) {
      throw new ErrorDeNegocio("DATO_INVALIDO", "El costo de cada línea tiene que ser cero o más.");
    }
    total += linea.costoUnitario * linea.cantidad;

    // `registrarEntrada` ya valida que el ítem exista, sea PRODUCTO y la
    // cantidad sea mayor a cero — reusarla es lo que evita que una compra y
    // una entrada suelta puedan quedar validadas distinto.
    eventos.push(
      ...registrarEntrada(p, {
        itemId: linea.itemId,
        cantidad: linea.cantidad,
        costoUnitario: linea.costoUnitario,
        motivo,
        referencia: compraId,
      }),
    );
  }

  if (pedido.salioDeLaCaja !== false && total > 0) {
    const egreso = registrarEgreso(p, {
      monto: total,
      motivo,
      comprobante: pedido.comprobante,
      categoria: "COMPRA",
    });
    eventos.push(...egreso.eventos);
  }

  return { eventos, compraId, total };
}
