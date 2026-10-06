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

/**
 * Unifica cómo se escribe una marca, igual que `categoriaCanonica`.
 *
 * Hace falta por lo que trae la planilla real: una marca con espacio al final
 * en seis filas, otra en tres, otra en dos. Sin unificar, el filtro por marca
 * mostraría "NIVEL TRES" y "NIVEL TRES " como dos marcas distintas con
 * tres productos cada una, y el reporte de ventas por marca partiría los
 * números de la misma marca en dos filas.
 *
 * Se adopta la forma que YA estaba en el catálogo: si alguien cargó "Nivel Tres"
 * y mañana escribe "NIVEL TRES", los productos siguen agrupados bajo la primera.
 */
export function marcaCanonica(p: Proyeccion, texto: string, sinContar?: string): string {
  const limpio = String(texto ?? "").trim().replace(/\s+/g, " ");
  const clave = normalizar(limpio);
  if (!clave) return "";

  for (const item of p.items.values()) {
    if (item.id === sinContar) continue;
    if (normalizar(item.marca) === clave) return item.marca;
  }
  return limpio;
}

export interface ItemNuevo {
  /** Vacío u omitido: lo genera el servidor (ver `siguienteCodigo`). */
  codigo?: string;
  /** Marca comercial. Vacío en los servicios del local. */
  marca?: string;
  nombre: string;
  tipo: TipoItem;
  categoria: string;
  /** `null` = se crea sin precio y habrá que ponérselo antes de venderlo. */
  precio: Centimos | null;
  /** Precio de compra. Siembra el costo promedio del producto. */
  costo?: Centimos | null;
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
        marca: marcaCanonica(p, nuevo.marca ?? ""),
        nombre: nuevo.nombre.trim(),
        tipo: nuevo.tipo,
        categoria: categoriaCanonica(p, nuevo.categoria),
        precio: nuevo.precio,
        costo: nuevo.tipo === "PRODUCTO" ? (nuevo.costo ?? null) : null,
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
        costoUnitario: nuevo.costo ?? undefined,
        motivo: "Stock inicial al crear el producto",
      },
    });
  }

  return { eventos, itemId };
}

export interface CambiosDeItem {
  codigo?: string;
  /** Cadena vacía = quitarle la marca. Ausente = no tocarla. */
  marca?: string;
  nombre?: string;
  categoria?: string;
  /** `null` = dejarlo SIN precio. Ausente = no tocar el precio. */
  precio?: Centimos | null;
  /** `null` = dejarlo sin costo conocido. Ausente = no tocar el costo. */
  costo?: Centimos | null;
  stockMinimo?: number;
  orden?: number;
  motivoPrecio?: string;
  motivoCosto?: string;
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
    cambios.marca !== undefined ||
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
        // `sinContar` es este mismo ítem: si no, al renombrar su marca o su
        // categoría se adoptaría su propia forma vieja y el cambio no tendría
        // efecto — corregir "NIVEL TRES " a "NIVEL TRES" no haría nada.
        marca: cambios.marca === undefined ? undefined : marcaCanonica(p, cambios.marca, itemId),
        nombre: cambios.nombre?.trim(),
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

  // El costo, por la misma razón: sin su historia no se puede explicar por qué
  // el margen de un producto cambió de un mes al otro.
  if (cambios.costo !== undefined && cambios.costo !== item.costo) {
    eventos.push({
      tipo: "item.costo_cambiado",
      datos: {
        itemId,
        costoAnterior: item.costo,
        costoNuevo: cambios.costo,
        motivo: cambios.motivoCosto,
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
