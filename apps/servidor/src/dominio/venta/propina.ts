/**
 * Agregar una propina DESPUÉS de cobrar: el cliente volvió más tarde, o se
 * olvidó anotarla en el momento.
 *
 * A diferencia de la propina que viaja en el mismo lote que `registrarVenta`
 * —que confía en los datos que la pantalla de cobro ya validó en esa misma
 * petición—, esta busca la venta YA REGISTRADA en la proyección y valida de
 * verdad que la línea exista y que el barbero sea el que atendió, porque
 * puede pasar horas o días después de la venta, con el catálogo y el
 * personal ya distintos.
 */

import type { Centimos, EventoNuevo } from "@cupula/contratos";
import { ulid } from "ulid";

import { ErrorDeNegocio } from "../errores";
import type { Proyeccion } from "../../proyecciones/Proyeccion";

export interface PropinaPedida {
  ventaId: string;
  lineaIndex: number;
  barberoId: string;
  monto: Centimos;
}

export function registrarPropina(
  p: Proyeccion,
  pedido: PropinaPedida,
): { eventos: EventoNuevo[]; propinaId: string } {
  const venta = p.ventas.get(pedido.ventaId);
  if (!venta) {
    throw new ErrorDeNegocio("VENTA_NO_EXISTE", "Esa venta ya no existe.");
  }
  const linea = venta.lineas[pedido.lineaIndex];
  if (!linea) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "Esa línea de la venta no existe.");
  }
  if (!(pedido.monto > 0)) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "La propina tiene que ser mayor a cero.");
  }
  if (linea.barberoId !== pedido.barberoId) {
    throw new ErrorDeNegocio(
      "DATO_INVALIDO",
      "Esa línea no la atendió ese barbero.",
      "Elige el barbero que de verdad atendió el servicio en esa línea.",
    );
  }
  const barbero = p.barberos.get(pedido.barberoId);
  if (!barbero || !barbero.activo) {
    throw new ErrorDeNegocio("BARBERO_INACTIVO", "Ese barbero ya no está activo.");
  }

  const propinaId = ulid();
  return {
    propinaId,
    eventos: [
      {
        tipo: "venta.propina_registrada",
        datos: {
          propinaId,
          ventaId: pedido.ventaId,
          lineaIndex: pedido.lineaIndex,
          barberoId: pedido.barberoId,
          monto: pedido.monto,
          // Null si se agrega con la caja cerrada — como con los egresos, es
          // mejor registrarla sin turno que perderla.
          turnoId: p.turnoAbierto?.id ?? null,
        },
      },
    ],
  };
}
