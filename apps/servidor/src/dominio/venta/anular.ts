/**
 * Anular una venta.
 *
 * Nunca se borra. Se escribe un evento `venta.anulada` que deja el rastro
 * completo: quién, cuándo y por qué. El stock vuelve solo (lo deriva la
 * proyección) y el CORRELATIVO QUEDA CONSUMIDO: la numeración jamás se reusa,
 * porque un salto sin explicación en el historial es exactamente lo que un
 * contador no quiere ver.
 */

import type { EventoNuevo } from "@cupula/contratos";

import { ErrorDeNegocio } from "../errores";
import type { Proyeccion } from "../../proyecciones/Proyeccion";

export function anularVenta(p: Proyeccion, ventaId: string, motivo: string): EventoNuevo[] {
  const venta = p.ventas.get(ventaId);
  if (!venta) throw new ErrorDeNegocio("VENTA_NO_EXISTE", "Esa venta no existe.");

  if (venta.anulada) {
    throw new ErrorDeNegocio(
      "VENTA_YA_ANULADA",
      `La ${venta.correlativo} ya estaba anulada.`,
      venta.motivoAnulacion ? `Motivo registrado: ${venta.motivoAnulacion}` : undefined,
    );
  }

  const limpio = motivo?.trim() ?? "";
  if (limpio.length < 3) {
    throw new ErrorDeNegocio(
      "DATO_INVALIDO",
      "Una anulación necesita motivo.",
      "Escribe qué pasó: cobro duplicado, el cliente se arrepintió, error de monto.",
    );
  }

  return [
    { tipo: "venta.anulada", datos: { ventaId, correlativo: venta.correlativo, motivo: limpio } },
  ];
}

export function marcarReimpresion(p: Proyeccion, ventaId: string): EventoNuevo[] {
  const venta = p.ventas.get(ventaId);
  if (!venta) throw new ErrorDeNegocio("VENTA_NO_EXISTE", "Esa venta no existe.");
  return [{ tipo: "venta.reimpresa", datos: { ventaId, correlativo: venta.correlativo } }];
}
