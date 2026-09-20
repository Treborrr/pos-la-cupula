/**
 * Inventario. Solo aplica a ítems tipo PRODUCTO: las ceras, los vapes, las
 * pipas, las mallas, los trimmers. Un corte de pelo no consume stock.
 *
 * El descuento por venta NO se maneja aquí: se deriva de la propia venta en la
 * proyección. Así es imposible que exista una venta sin su movimiento de
 * stock, porque son el mismo hecho y no dos cosas que hay que mantener
 * sincronizadas.
 */

import type { EventoNuevo } from "@cupula/contratos";

import { ErrorDeNegocio } from "../errores";
import type { Proyeccion } from "../../proyecciones/Proyeccion";

function exigirProducto(p: Proyeccion, itemId: string) {
  const item = p.items.get(itemId);
  if (!item) throw new ErrorDeNegocio("ITEM_NO_EXISTE", "Ese ítem no existe.");
  if (item.tipo !== "PRODUCTO") {
    throw new ErrorDeNegocio(
      "NO_ES_PRODUCTO",
      `"${item.nombre}" es un servicio y los servicios no llevan stock.`,
      "Si de verdad es algo que se compra y se vende, cámbiale el tipo a PRODUCTO.",
    );
  }
  return item;
}

/** Llegó mercadería. */
export function registrarEntrada(
  p: Proyeccion,
  entrada: { itemId: string; cantidad: number; costoUnitario?: number; motivo: string; referencia?: string },
): EventoNuevo[] {
  exigirProducto(p, entrada.itemId);
  if (!(entrada.cantidad > 0)) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "La cantidad que entra tiene que ser mayor a cero.");
  }
  return [
    {
      tipo: "stock.entrada",
      datos: {
        itemId: entrada.itemId,
        cantidad: entrada.cantidad,
        costoUnitario: entrada.costoUnitario,
        motivo: entrada.motivo.trim(),
        referencia: entrada.referencia?.trim(),
      },
    },
  ];
}

/**
 * Conté y hay 10, el sistema decía 12.
 *
 * Se guardan las DOS cifras. Sin el valor que el sistema creía tener, un
 * ajuste no se puede auditar después: solo se vería "quedó en 10" sin saber
 * si faltaban dos o sobraban.
 */
export function ajustarStock(
  p: Proyeccion,
  ajuste: { itemId: string; cantidadContada: number; motivo: string },
): EventoNuevo[] {
  exigirProducto(p, ajuste.itemId);
  if (ajuste.cantidadContada < 0) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "Lo contado no puede ser negativo.");
  }
  if (!ajuste.motivo?.trim()) {
    throw new ErrorDeNegocio(
      "DATO_INVALIDO",
      "Un ajuste de stock necesita motivo.",
      "Escribe qué pasó: conteo del mes, se rompió, faltante detectado.",
    );
  }

  return [
    {
      tipo: "stock.ajustado",
      datos: {
        itemId: ajuste.itemId,
        cantidadContada: ajuste.cantidadContada,
        cantidadSistema: p.stockDe(ajuste.itemId),
        motivo: ajuste.motivo.trim(),
      },
    },
  ];
}

/** Se rompió, se venció, se perdió. */
export function registrarMerma(
  p: Proyeccion,
  merma: { itemId: string; cantidad: number; motivo: string },
): EventoNuevo[] {
  exigirProducto(p, merma.itemId);
  if (!(merma.cantidad > 0)) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "La cantidad de la merma tiene que ser mayor a cero.");
  }
  if (!merma.motivo?.trim()) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "Una merma necesita motivo.");
  }
  return [
    {
      tipo: "stock.merma",
      datos: { itemId: merma.itemId, cantidad: merma.cantidad, motivo: merma.motivo.trim() },
    },
  ];
}

/** Productos por debajo de su mínimo. Alimenta la alerta de la pantalla. */
export function stockBajo(p: Proyeccion): { itemId: string; nombre: string; stock: number; minimo: number }[] {
  const salida = [];
  for (const item of p.items.values()) {
    if (item.tipo !== "PRODUCTO" || !item.activo) continue;
    const stock = p.stockDe(item.id);
    // El mínimo en 0 significa "no me avises", salvo que el stock esté
    // negativo: eso siempre es algo que hay que mirar.
    if (stock < item.stockMinimo || stock < 0) {
      salida.push({ itemId: item.id, nombre: item.nombre, stock, minimo: item.stockMinimo });
    }
  }
  return salida.sort((a, b) => a.stock - b.stock);
}
