/**
 * Catálogo: servicios y productos.
 *
 * La regla que más valor aporta aquí es la de códigos únicos. En el Excel había
 * tres códigos repetidos (`LANG`, `CEVC`, `MENU`) y eso volvía INVENDIBLES a
 * tres productos, porque la búsqueda siempre devolvía el primero. Nadie se
 * había dado cuenta. Aquí el alta lo rechaza de entrada.
 */

import { normalizar, type Centimos, type EventoNuevo, type TipoItem } from "@cupula/contratos";
import { ulid } from "ulid";

import { ErrorDeNegocio } from "../errores";
import type { Proyeccion } from "../../proyecciones/Proyeccion";

/**
 * Código automático: P0001, P0002… para productos y S0001… para servicios.
 *
 * Existe porque inventar códigos a mano es justo lo que produjo los tres
 * repetidos del Excel. Sigue desde el número más alto que ya exista con ese
 * prefijo, así que nunca reutiliza el de un ítem desactivado —reutilizarlo
 * haría que un ticket viejo pareciera de otro producto.
 */
export function siguienteCodigo(p: Proyeccion, tipo: TipoItem): string {
  const prefijo = tipo === "PRODUCTO" ? "P" : "S";
  const patron = new RegExp(`^${prefijo}(\\d+)$`);

  // Sobre TODOS los ítems, activos o no. `porCodigo` solo indexa los activos
  // —al desactivar uno, su código sale del mapa—, así que mirar ahí hacía que
  // el código de un producto dado de baja se le reasignara al siguiente, y un
  // ticket viejo pasaba a parecer de otro producto.
  const usados = new Set<string>();
  let mayor = 0;
  for (const item of p.items.values()) {
    usados.add(item.codigo);
    const m = patron.exec(item.codigo);
    if (m) mayor = Math.max(mayor, Number(m[1]));
  }

  let n = mayor + 1;
  while (usados.has(`${prefijo}${String(n).padStart(4, "0")}`)) n++;
  return `${prefijo}${String(n).padStart(4, "0")}`;
}

/**
 * Unifica cómo se escribe una categoría.
 *
 * Sin esto, "Productos", "productos" y "PRODUCTOS" salen como tres pestañas
 * distintas en la pantalla de cobro. Si ya hay ítems en una categoría
 * equivalente, se adopta la forma que ya estaba; si es nueva, se guarda con la
 * primera en mayúscula.
 */
export function categoriaCanonica(p: Proyeccion, texto: string, sinContar?: string): string {
  const limpio = String(texto ?? "").trim().replace(/\s+/g, " ");
  const clave = normalizar(limpio);
  if (!clave) return limpio;

  for (const item of p.items.values()) {
    if (item.id === sinContar) continue;
    if (normalizar(item.categoria) === clave) return item.categoria;
  }
  return limpio.charAt(0).toLocaleUpperCase("es") + limpio.slice(1);
}

export interface ItemNuevo {
  /** Vacío u omitido: lo genera el servidor (ver `siguienteCodigo`). */
  codigo?: string;
  nombre: string;
  tipo: TipoItem;
  categoria: string;
  precio: Centimos;
  stockMinimo?: number;
  orden?: number;
  /** Stock con el que arranca un PRODUCTO. Se escribe como entrada aparte. */
  stockInicial?: number;
}

export function crearItem(p: Proyeccion, nuevo: ItemNuevo): { eventos: EventoNuevo[]; itemId: string } {
  const codigo = nuevo.codigo?.trim() ? nuevo.codigo.trim().toUpperCase() : siguienteCodigo(p, nuevo.tipo);

  const existente = p.porCodigo.get(codigo);
  if (existente) {
    const item = p.items.get(existente)!;
    throw new ErrorDeNegocio(
      "CODIGO_REPETIDO",
      `El código "${codigo}" ya lo usa "${item.nombre}".`,
      "Elige otro código: si se repiten, uno de los dos ítems no se puede vender nunca.",
    );
  }

  const itemId = ulid();
  const eventos: EventoNuevo[] = [
    {
      tipo: "item.creado",
      datos: {
        itemId,
        codigo,
        nombre: nuevo.nombre.trim(),
        tipo: nuevo.tipo,
        categoria: categoriaCanonica(p, nuevo.categoria),
        precio: nuevo.precio,
        stockMinimo: nuevo.tipo === "PRODUCTO" ? (nuevo.stockMinimo ?? 0) : undefined,
        orden: nuevo.orden,
      },
    },
  ];

  if (nuevo.tipo === "PRODUCTO" && nuevo.stockInicial && nuevo.stockInicial > 0) {
    eventos.push({
      tipo: "stock.entrada",
      datos: {
        itemId,
        cantidad: nuevo.stockInicial,
        motivo: "Stock inicial al crear el producto",
      },
    });
  }

  return { eventos, itemId };
}

export interface CambiosDeItem {
  codigo?: string;
  nombre?: string;
  categoria?: string;
  precio?: Centimos;
  stockMinimo?: number;
  orden?: number;
  motivoPrecio?: string;
}

export function actualizarItem(p: Proyeccion, itemId: string, cambios: CambiosDeItem): EventoNuevo[] {
  const item = p.items.get(itemId);
  if (!item) throw new ErrorDeNegocio("ITEM_NO_EXISTE", "Ese ítem no existe.");

  const eventos: EventoNuevo[] = [];

  const codigo = cambios.codigo?.trim().toUpperCase();
  if (codigo && codigo !== item.codigo) {
    const ocupadoPor = p.porCodigo.get(codigo);
    if (ocupadoPor && ocupadoPor !== itemId) {
      const otro = p.items.get(ocupadoPor)!;
      throw new ErrorDeNegocio(
        "CODIGO_REPETIDO",
        `El código "${codigo}" ya lo usa "${otro.nombre}".`,
        "Elige otro: con códigos repetidos, uno de los dos ítems queda invendible.",
      );
    }
  }

  const tocaDatos =
    (codigo !== undefined && codigo !== item.codigo) ||
    cambios.nombre !== undefined ||
    cambios.categoria !== undefined ||
    cambios.stockMinimo !== undefined ||
    cambios.orden !== undefined;

  if (tocaDatos) {
    eventos.push({
      tipo: "item.actualizado",
      datos: {
        itemId,
        codigo: codigo !== item.codigo ? codigo : undefined,
        nombre: cambios.nombre?.trim(),
        // `sinContar` es este mismo ítem: si no, al renombrar su categoría se
        // adoptaría su propia forma vieja y el cambio no tendría efecto.
        categoria: cambios.categoria === undefined ? undefined : categoriaCanonica(p, cambios.categoria, itemId),
        stockMinimo: cambios.stockMinimo,
        orden: cambios.orden,
      },
    });
  }

  // El precio va en su propio evento: así queda la historia de precios y se
  // puede responder "¿desde cuándo el corte cuesta 25?" sin escarbar diffs.
  if (cambios.precio !== undefined && cambios.precio !== item.precio) {
    eventos.push({
      tipo: "item.precio_cambiado",
      datos: {
        itemId,
        precioAnterior: item.precio,
        precioNuevo: cambios.precio,
        motivo: cambios.motivoPrecio,
      },
    });
  }

  return eventos;
}

export function desactivarItem(p: Proyeccion, itemId: string, motivo?: string): EventoNuevo[] {
  const item = p.items.get(itemId);
  if (!item) throw new ErrorDeNegocio("ITEM_NO_EXISTE", "Ese ítem no existe.");
  if (!item.activo) return []; // ya estaba: no hace falta escribir nada
  return [{ tipo: "item.desactivado", datos: { itemId, motivo } }];
}

export function reactivarItem(p: Proyeccion, itemId: string): EventoNuevo[] {
  const item = p.items.get(itemId);
  if (!item) throw new ErrorDeNegocio("ITEM_NO_EXISTE", "Ese ítem no existe.");
  if (item.activo) return [];

  // Mientras estuvo desactivado, su código pudo haber quedado libre y alguien
  // lo pudo tomar. Reactivar sin revisar dejaría dos ítems activos con el
  // mismo código — exactamente el problema del Excel, reintroducido.
  const ocupadoPor = p.porCodigo.get(item.codigo);
  if (ocupadoPor && ocupadoPor !== itemId) {
    const otro = p.items.get(ocupadoPor)!;
    throw new ErrorDeNegocio(
      "CODIGO_REPETIDO",
      `No se puede reactivar: mientras estaba desactivado, el código "${item.codigo}" lo tomó "${otro.nombre}".`,
      "Cámbiale el código a uno de los dos antes de reactivar.",
    );
  }

  return [{ tipo: "item.reactivado", datos: { itemId } }];
}
