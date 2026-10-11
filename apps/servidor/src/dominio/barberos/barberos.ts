/**
 * Barberos.
 *
 * SOLO ATRIBUCIÓN: se registra quién atendió cada línea y nada más. No hay
 * cálculo de comisiones porque en La Cúpula los barberos tienen sueldo fijo
 * (decisión D6 en ARQUITECTURA.md).
 *
 * Se guarda igual el dato porque no cuesta nada y sirve para saber cuánto
 * produce cada uno y qué servicios hace. Si algún día aparecen las comisiones,
 * el histórico ya está: arrancar a juntarlo recién ese día sería empezar de
 * cero.
 */

import type { Centimos, EventoNuevo } from "@cupula/contratos";
import { ulid } from "ulid";

import { ErrorDeNegocio } from "../errores";
import type { Proyeccion } from "../../proyecciones/Proyeccion";

export function crearBarbero(p: Proyeccion, nombre: string): { eventos: EventoNuevo[]; barberoId: string } {
  const limpio = nombre.trim();
  if (!limpio) throw new ErrorDeNegocio("DATO_INVALIDO", "El barbero necesita un nombre.");

  const barberoId = ulid();
  return { barberoId, eventos: [{ tipo: "barbero.creado", datos: { barberoId, nombre: limpio } }] };
}

export function actualizarBarbero(p: Proyeccion, barberoId: string, nombre: string): EventoNuevo[] {
  if (!p.barberos.has(barberoId)) {
    throw new ErrorDeNegocio("BARBERO_NO_EXISTE", "Ese barbero no existe.");
  }
  return [{ tipo: "barbero.actualizado", datos: { barberoId, nombre: nombre.trim() } }];
}

/**
 * Vuelve a poner activo a un barbero desactivado.
 *
 * Reusa `barbero.creado` en vez de inventar un `barbero.reactivado`: el evento
 * ya existe, la proyección lo trata como alta, y agregar un tipo nuevo al
 * contrato haría que una versión anterior del POS no pudiera leer los datos.
 * El id se conserva, así que las ventas viejas siguen apuntando a la persona
 * correcta.
 */
export function reactivarBarbero(p: Proyeccion, barberoId: string): EventoNuevo[] {
  const b = p.barberos.get(barberoId);
  if (!b) throw new ErrorDeNegocio("BARBERO_NO_EXISTE", "Ese barbero no existe.");
  if (b.activo) return [];
  return [{ tipo: "barbero.creado", datos: { barberoId, nombre: b.nombre } }];
}

export function desactivarBarbero(p: Proyeccion, barberoId: string): EventoNuevo[] {
  const b = p.barberos.get(barberoId);
  if (!b) throw new ErrorDeNegocio("BARBERO_NO_EXISTE", "Ese barbero no existe.");
  if (!b.activo) return [];
  // Desactivar y no borrar: las ventas viejas siguen apuntando a su id y
  // tienen que poder mostrar el nombre de quien atendió.
  return [{ tipo: "barbero.desactivado", datos: { barberoId } }];
}

// ─────────────────────────────────────────────────────────────────────────────
// Adelantos y liquidación
//
// Dos orígenes alimentan la misma cuenta: un egreso de caja categoría
// ADELANTO (plata entregada en mano) y una venta pagada con medio ADELANTO
// (el barbero se lleva algo y se le descuenta). Las dos son "lo que se le
// adelantó"; liquidar las salda juntas, sin distinguir de dónde vino cada una.
// ─────────────────────────────────────────────────────────────────────────────

export interface AdelantoDeBarbero {
  id: string;
  ts: string;
  monto: Centimos;
  origen: "EFECTIVO" | "VENTA";
  detalle: string;
}

/**
 * Los adelantos sin liquidar de un barbero, del más viejo al más nuevo.
 *
 * "Sin liquidar" es TODO lo que pasó después de la última liquidación —no
 * hay saldo que arrastrar a mano: el cursor es la fecha, y listo.
 */
export function adelantosPendientesDeBarbero(p: Proyeccion, barberoId: string): AdelantoDeBarbero[] {
  const desde = p.ultimaLiquidacionPorBarbero.get(barberoId)?.ts ?? "";
  const salida: AdelantoDeBarbero[] = [];

  for (const egreso of p.egresos.values()) {
    if (egreso.categoria !== "ADELANTO" || egreso.barberoId !== barberoId) continue;
    if (egreso.ts <= desde) continue;
    salida.push({ id: egreso.id, ts: egreso.ts, monto: egreso.monto, origen: "EFECTIVO", detalle: egreso.motivo });
  }

  for (const venta of p.ventas.values()) {
    if (venta.anulada || venta.ts <= desde) continue;
    for (const pago of venta.pagos) {
      if (pago.medio !== "ADELANTO" || pago.barberoId !== barberoId) continue;
      salida.push({
        id: `${venta.id}:adelanto`,
        ts: venta.ts,
        monto: pago.monto,
        origen: "VENTA",
        detalle: `${venta.correlativo} · ${venta.lineas.map((l) => l.nombre).join(", ")}`,
      });
    }
  }

  return salida.sort((a, b) => a.ts.localeCompare(b.ts));
}

export function saldoPendienteDeBarbero(p: Proyeccion, barberoId: string): Centimos {
  return adelantosPendientesDeBarbero(p, barberoId).reduce((a, x) => a + x.monto, 0);
}

/**
 * El dueño le pagó al barbero: los adelantos de hasta ahora quedan saldados.
 *
 * NO calcula sueldo ni comisión (D6 intacta) — solo limpia la cuenta de lo
 * adelantado, para que la semana que entra arranque de cero.
 */
export function liquidarBarbero(
  p: Proyeccion,
  barberoId: string,
  notas?: string,
): { eventos: EventoNuevo[]; liquidacionId: string; monto: Centimos } {
  const barbero = p.barberos.get(barberoId);
  if (!barbero) throw new ErrorDeNegocio("BARBERO_NO_EXISTE", "Ese barbero no existe.");

  const monto = saldoPendienteDeBarbero(p, barberoId);
  if (monto <= 0) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "Este barbero no tiene ningún adelanto pendiente.");
  }

  const liquidacionId = ulid();
  return {
    liquidacionId,
    monto,
    eventos: [
      {
        tipo: "barbero.liquidado",
        datos: { liquidacionId, barberoId, monto, notas: notas?.trim() || undefined },
      },
    ],
  };
}
