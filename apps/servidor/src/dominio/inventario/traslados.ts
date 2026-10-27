/**
 * Traslado de mercadería entre sucursales.
 *
 * Es UN SOLO evento que mueve los dos lados. Hacerlo con una merma en el origen
 * más una entrada en el destino dejaría un estado intermedio en que la
 * mercadería ya salió de un local y todavía no entró en el otro: si el proceso
 * se cae en el medio, el stock de la cadena miente y nadie sabe dónde está el
 * producto. Ver la nota de `stock.traslado` en el contrato.
 */

import type { EventoNuevo } from "@cupula/contratos";
import { ulid } from "ulid";

import { ErrorDeNegocio } from "../errores";
import type { Proyeccion } from "../../proyecciones/Proyeccion";

export function trasladarStock(
  p: Proyeccion,
  traslado: { itemId: string; desdeSedeId: string; haciaSedeId: string; cantidad: number; motivo: string },
): { eventos: EventoNuevo[]; trasladoId: string } {
  const item = p.items.get(traslado.itemId);
  if (!item) {
    throw new ErrorDeNegocio("ITEM_NO_EXISTE", "Ese producto no existe.");
  }
  if (item.tipo !== "PRODUCTO") {
    throw new ErrorDeNegocio(
      "NO_ES_PRODUCTO",
      `"${item.nombre}" es un servicio y los servicios no se trasladan.`,
    );
  }
  if (traslado.desdeSedeId === traslado.haciaSedeId) {
    throw new ErrorDeNegocio(
      "DATO_INVALIDO",
      "El origen y el destino son la misma sucursal.",
      "Elige dos sucursales distintas.",
    );
  }

  const origen = p.sede(traslado.desdeSedeId);
  const destino = p.sede(traslado.haciaSedeId);
  if (!origen) throw new ErrorDeNegocio("SEDE_NO_EXISTE", "La sucursal de origen no existe.");
  if (!destino) throw new ErrorDeNegocio("SEDE_NO_EXISTE", "La sucursal de destino no existe.");
  if (!destino.activa) {
    throw new ErrorDeNegocio(
      "SEDE_INACTIVA",
      `"${destino.nombre}" está desactivada y no puede recibir mercadería.`,
    );
  }

  if (!(traslado.cantidad > 0)) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "La cantidad a trasladar tiene que ser mayor a cero.");
  }
  if (!traslado.motivo?.trim()) {
    throw new ErrorDeNegocio(
      "DATO_INVALIDO",
      "Un traslado necesita motivo.",
      "Escribe por qué se mueve: reposición, pedido del otro local, sobrestock.",
    );
  }

  /**
   * A diferencia de la venta, el traslado SÍ se bloquea por falta de stock.
   *
   * No es una incoherencia: en la venta hay un cliente con el billete en la
   * mano y negarse cuesta más que un inventario desfasado. Acá no hay nadie
   * esperando, y mover 10 unidades que no existen no desfasa un número: crea un
   * faltante en un local y un sobrante en el otro, o sea dos inventarios mal en
   * vez de uno, y encima sin que nadie se entere de dónde salió.
   */
  const disponible = p.stockDe(traslado.desdeSedeId, traslado.itemId);
  if (disponible < traslado.cantidad) {
    throw new ErrorDeNegocio(
      "STOCK_INSUFICIENTE",
      `En "${origen.nombre}" hay ${disponible} de "${p.nombreCompleto(item)}" y se quieren mover ${traslado.cantidad}.`,
      "Cuenta y ajusta el stock del origen, o traslada menos unidades.",
    );
  }

  const trasladoId = ulid();
  return {
    trasladoId,
    eventos: [
      {
        tipo: "stock.traslado",
        datos: {
          trasladoId,
          itemId: traslado.itemId,
          desdeSedeId: traslado.desdeSedeId,
          haciaSedeId: traslado.haciaSedeId,
          cantidad: traslado.cantidad,
          motivo: traslado.motivo.trim(),
        },
      },
    ],
  };
}
