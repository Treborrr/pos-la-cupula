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
  sedeId: string,
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
        sedeId,
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
  sedeId: string,
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
        sedeId,
        cantidadContada: ajuste.cantidadContada,
        cantidadSistema: p.stockDe(sedeId, ajuste.itemId),
        motivo: ajuste.motivo.trim(),
      },
    },
  ];
}

/** Se rompió, se venció, se perdió. */
export function registrarMerma(
  p: Proyeccion,
  sedeId: string,
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
      datos: { itemId: merma.itemId, sedeId, cantidad: merma.cantidad, motivo: merma.motivo.trim() },
    },
  ];
}

/**
 * ¿Este producto está por debajo del mínimo que le fijaron?
 *
 * LA ÚNICA DEFINICIÓN DE "STOCK BAJO" DEL SISTEMA. Existía escrita tres veces
 * —la alerta del encabezado, la tabla de inventario y el reporte— y las tres no
 * decían lo mismo: sobre el catálogo real, el encabezado avisaba "0 con stock
 * bajo" mientras la tabla marcaba 28 productos. Dos números contradictorios en
 * la misma pantalla no son un detalle: el dueño deja de creerle a los dos.
 *
 * Dos reglas:
 *
 *  · `mínimo = 0` significa "no fijé ningún mínimo", no "avísame en cero". Es
 *    el valor por defecto de todo producto que entra sin la columna STOCK
 *    MÍNIMO, o sea el catálogo entero del cliente. Si avisara, los 28 agotados
 *    aparecerían dos veces —como agotados y como bajo mínimo— y la alerta
 *    dejaría de señalar lo que el dueño pidió que le señalen. Que esté agotado
 *    se informa aparte, que es una cosa distinta.
 *
 *  · Con un mínimo fijado, avisa AL LLEGAR a ese número, no al pasarlo. El
 *    campo se llama "avisar cuando queden" en la pantalla: si dice 2, en 2 hay
 *    que avisar. Antes era `<` y el aviso llegaba un producto tarde.
 */
export function bajoMinimo(stock: number, stockMinimo: number): boolean {
  // El negativo siempre se marca: significa que se vendió más de lo que el
  // sistema creía tener, y eso hay que mirarlo aunque no haya mínimo fijado.
  if (stock < 0) return true;
  return stockMinimo > 0 && stock <= stockMinimo;
}

/** Productos por debajo de su mínimo. Alimenta la alerta de la pantalla. */
export function stockBajo(
  p: Proyeccion,
  sedeId: string,
): { itemId: string; nombre: string; stock: number; minimo: number }[] {
  const salida = [];
  for (const item of p.items.values()) {
    if (item.tipo !== "PRODUCTO" || !item.activo) continue;
    // Solo lo que este local de verdad maneja. Ver `manejaProducto`.
    if (!p.manejaProducto(sedeId, item.id)) continue;
    const stock = p.stockDe(sedeId, item.id);
    if (bajoMinimo(stock, item.stockMinimo)) {
      salida.push({ itemId: item.id, nombre: p.nombreCompleto(item), stock, minimo: item.stockMinimo });
    }
  }
  return salida.sort((a, b) => a.stock - b.stock);
}
