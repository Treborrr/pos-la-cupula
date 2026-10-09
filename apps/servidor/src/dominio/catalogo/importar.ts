/**
 * Importar el catálogo desde la planilla.
 *
 * SOBRE "LIMPIAR LA BASE DE DATOS ANTES DE CARGAR". No se puede, y no es una
 * limitación técnica que convenga sortear: los datos son un log de eventos
 * append-only encadenado por hash, y borrar del medio lo rompería entero.
 * Además, las ventas viejas apuntan a los ítems por id — si el ítem
 * desapareciera, un ticket del mes pasado dejaría de poder mostrarse.
 *
 * Por eso REEMPLAZAR significa: lo que viene en el Excel se crea o se
 * actualiza, y lo que NO viene se DESACTIVA. Un ítem desactivado no aparece en
 * la pantalla de cobro ni se puede vender, que es lo que la persona quiere
 * cuando pide "limpiar"; pero sigue existiendo para el historial. Si mañana
 * vuelve a cargarlo, se reactiva con su mismo id y no se perdió nada.
 *
 * El otro modo, AGREGAR, no toca lo que no esté en el archivo.
 *
 * LA COMPARACIÓN ES POR MARCA + NOMBRE + TIPO. Antes era por código, pero la
 * planilla que el cliente usa no tiene columna de código —el sistema los genera
 * solos— así que la identidad tiene que salir de lo que la planilla sí trae. La
 * marca va en la clave y no es un detalle: en este catálogo hay un TALCO de
 * una marca y otro de otra, y comparando solo por nombre la segunda carga
 * pisaría un producto con el otro.
 */

import { normalizar, type EventoNuevo } from "@cupula/contratos";

import type { Proyeccion } from "../../proyecciones/Proyeccion";
import type { Item } from "../../proyecciones/tipos";
import { categoriaCanonica, marcaCanonica, siguienteCodigo } from "./catalogo";
import { ulid } from "ulid";

/**
 * Una fila de catálogo ya interpretada.
 *
 * Vive en el dominio y no en el lector de planillas porque es lo que el
 * dominio necesita para importar, venga de un Excel, de un CSV o de lo que
 * aparezca mañana. El adaptador se adapta a esto, no al revés.
 */
export interface FilaDeCatalogo {
  /** Número de fila en el archivo, para poder señalar el error donde está. */
  fila: number;
  /** Marca comercial. Vacío en los servicios propios del local. */
  marca: string;
  nombre: string;
  tipo: "SERVICIO" | "PRODUCTO";
  /**
   * Vacía si la planilla no la trae. El valor por defecto lo pone esta capa
   * —ver `categoriaDe`— y no el lector, para que el plan de importación pueda
   * avisar cuántas filas van a caer en una categoría que nadie eligió.
   */
  categoria: string;
  /** En céntimos enteros. `null` = todavía sin precio de lista. */
  precio: number | null;
  /** Precio de compra en céntimos. `null` = no declarado. */
  costo: number | null;
  stock: number | null;
  stockMinimo: number | null;
}

export type ModoDeImportacion = "agregar" | "reemplazar";

/**
 * La categoría de una fila, con su valor por defecto si no trae ninguna.
 *
 * La categoría agrupa los botones de la pantalla de cobro, así que una fila sin
 * categoría tiene que caer en ALGUNA: dejarla vacía produciría una pestaña sin
 * nombre. Pero el default es una decisión del sistema, no del dueño —en el
 * catálogo real fueron 22 productos de una misma línea que terminaron juntos en
 * una pestaña llamada "Productos" que nadie pidió—, así que el plan lo cuenta
 * aparte y la pantalla lo avisa antes de aplicar.
 */
export function categoriaDe(fila: FilaDeCatalogo): string {
  if (fila.categoria) return fila.categoria;
  return fila.tipo === "PRODUCTO" ? "Productos" : "Servicios";
}

export interface CambioDeImportacion {
  fila: number;
  codigo: string;
  nombre: string;
  /** Qué se le va a hacer, en palabras que entienda quien lo autoriza. */
  accion: "crear" | "actualizar" | "reactivar" | "sin cambios";
  detalle: string[];
}

export interface PlanDeImportacion {
  cambios: CambioDeImportacion[];
  /** Ítems que hoy están activos y NO vienen en el archivo. */
  aDesactivar: { codigo: string; nombre: string }[];
  resumen: {
    crear: number;
    actualizar: number;
    reactivar: number;
    sinCambios: number;
    desactivar: number;
    /**
     * Cuántas filas entran sin precio. Se cuenta aparte porque es lo primero
     * que hay que decirle a quien autoriza la carga: esos ítems van a existir
     * pero no se van a poder vender de la grilla sin escribirles un precio.
     */
    sinPrecio: number;
    /**
     * Cuántas filas no traen categoría y van a caer en una puesta por el
     * sistema. Se avisa antes de aplicar porque la categoría define las
     * pestañas de la pantalla de cobro: 22 productos en una pestaña genérica
     * son 22 productos que el cajero va a tardar en encontrar.
     */
    sinCategoria: number;
  };
}

/**
 * Calcula qué pasaría, SIN escribir nada.
 *
 * Existe separado de la ejecución porque nadie debería autorizar una carga
 * masiva sin ver antes qué va a cambiar: es la diferencia entre "cargué el
 * catálogo" y "me quedé sin catálogo".
 */
export function planificarImportacion(
  p: Proyeccion,
  filas: FilaDeCatalogo[],
  modo: ModoDeImportacion,
): PlanDeImportacion {
  const cambios: CambioDeImportacion[] = [];
  const tocados = new Set<string>();

  for (const fila of filas) {
    const existente = buscarExistente(p, fila);
    if (existente) tocados.add(existente.id);

    if (!existente) {
      cambios.push({
        fila: fila.fila,
        codigo: "(automático)",
        nombre: nombreDeFila(fila),
        accion: "crear",
        detalle: [
          `${fila.tipo.toLowerCase()} · ${categoriaDe(fila)} · ${fila.precio === null ? "SIN PRECIO" : soles(fila.precio)}`,
        ],
      });
      continue;
    }

    const detalle: string[] = [];
    if (existente.nombre !== fila.nombre) detalle.push(`nombre: "${existente.nombre}" → "${fila.nombre}"`);
    if (normalizar(existente.marca) !== normalizar(fila.marca)) {
      detalle.push(`marca: ${existente.marca || "(sin marca)"} → ${fila.marca || "(sin marca)"}`);
    }
    // Igual que al aplicar: una celda de precio vacía no cambia nada, así que
    // tampoco se anuncia como cambio. Un plan que promete lo que no va a hacer
    // es peor que no tener plan.
    if (fila.precio !== null && existente.precio !== fila.precio) {
      detalle.push(`precio: ${precioEnPalabras(existente.precio)} → ${soles(fila.precio)}`);
    }
    if (fila.costo !== null && existente.costo !== fila.costo) {
      detalle.push(`costo: ${precioEnPalabras(existente.costo)} → ${soles(fila.costo)}`);
    }
    if (normalizar(existente.categoria) !== normalizar(categoriaDe(fila))) {
      detalle.push(`categoría: ${existente.categoria} → ${categoriaDe(fila)}`);
    }
    if (fila.stockMinimo !== null && existente.stockMinimo !== fila.stockMinimo) {
      detalle.push(`stock mínimo: ${existente.stockMinimo} → ${fila.stockMinimo}`);
    }
    if (fila.stock !== null) {
      const actual = p.stockDe(existente.id);
      if (actual !== fila.stock) detalle.push(`stock: ${actual} → ${fila.stock}`);
    }

    const accion = !existente.activo ? "reactivar" : detalle.length > 0 ? "actualizar" : "sin cambios";
    cambios.push({ fila: fila.fila, codigo: existente.codigo, nombre: nombreDeFila(fila), accion, detalle });
  }

  const aDesactivar =
    modo === "reemplazar"
      ? [...p.items.values()]
          .filter((i) => i.activo && !tocados.has(i.id))
          .map((i) => ({ codigo: i.codigo, nombre: p.nombreCompleto(i) }))
      : [];

  return {
    cambios,
    aDesactivar,
    resumen: {
      crear: cambios.filter((c) => c.accion === "crear").length,
      actualizar: cambios.filter((c) => c.accion === "actualizar").length,
      reactivar: cambios.filter((c) => c.accion === "reactivar").length,
      sinCambios: cambios.filter((c) => c.accion === "sin cambios").length,
      desactivar: aDesactivar.length,
      // Cuántas filas van a QUEDAR sin precio, no cuántas celdas vienen vacías.
      // Un ítem que ya tiene precio en el sistema y llega con la celda vacía no
      // se queda sin precio: la planilla no borra precios.
      sinPrecio: filas.filter((f) => {
        if (f.precio !== null) return false;
        const existente = buscarExistente(p, f);
        return !existente || existente.precio === null;
      }).length,
      sinCategoria: filas.filter((f) => !f.categoria).length,
    },
  };
}

/**
 * Traduce la planilla a eventos.
 *
 * Todo sale como UNA sola tanda: o entra el catálogo entero o no entra nada.
 * Una importación a medias —la mitad de los precios nuevos y la otra mitad
 * viejos— sería peor que no haber importado.
 */
export function importarCatalogo(
  p: Proyeccion,
  filas: FilaDeCatalogo[],
  modo: ModoDeImportacion,
): EventoNuevo[] {
  const eventos: EventoNuevo[] = [];
  const tocados = new Set<string>();

  // Los códigos que se van generando todavía no están en la proyección, así
  // que hay que recordarlos para no repetirlos dentro de la misma tanda.
  const reservados = new Set<string>();
  const codigoLibre = (tipo: "SERVICIO" | "PRODUCTO") => {
    let c = siguienteCodigo(p, tipo);
    while (reservados.has(c)) {
      const n = Number(c.slice(1)) + 1;
      c = `${c[0]}${String(n).padStart(4, "0")}`;
    }
    reservados.add(c);
    return c;
  };

  const MOTIVO = "Importación de catálogo desde planilla";

  for (const fila of filas) {
    const existente = buscarExistente(p, fila);

    if (!existente) {
      const itemId = ulid();
      eventos.push({
        tipo: "item.creado",
        datos: {
          itemId,
          codigo: codigoLibre(fila.tipo),
          marca: marcaCanonica(p, fila.marca),
          nombre: fila.nombre,
          tipo: fila.tipo,
          categoria: categoriaCanonica(p, categoriaDe(fila)),
          precio: fila.precio,
          costo: fila.costo,
          stockMinimo: fila.tipo === "PRODUCTO" ? (fila.stockMinimo ?? 0) : undefined,
        },
      });
      if (fila.tipo === "PRODUCTO" && fila.stock !== null && fila.stock > 0) {
        eventos.push({
          tipo: "stock.entrada",
          datos: {
            itemId,
            cantidad: fila.stock,
            // El costo viaja también en la entrada para que el kardex diga a
            // cuánto entraron esas unidades, no solo cuántas.
            costoUnitario: fila.costo ?? undefined,
            motivo: "Carga inicial desde planilla",
          },
        });
      }
      continue;
    }

    tocados.add(existente.id);

    if (!existente.activo) eventos.push({ tipo: "item.reactivado", datos: { itemId: existente.id } });

    const cambios: Record<string, unknown> = {};
    if (existente.nombre !== fila.nombre) cambios.nombre = fila.nombre;
    if (normalizar(existente.marca) !== normalizar(fila.marca)) cambios.marca = marcaCanonica(p, fila.marca);
    if (normalizar(existente.categoria) !== normalizar(categoriaDe(fila))) cambios.categoria = categoriaDe(fila);
    if (fila.stockMinimo !== null && existente.stockMinimo !== fila.stockMinimo) {
      cambios.stockMinimo = fila.stockMinimo;
    }
    if (Object.keys(cambios).length > 0) {
      eventos.push({ tipo: "item.actualizado", datos: { itemId: existente.id, ...cambios } });
    }

    // El precio va en su propio evento, con el anterior al lado: es lo que
    // permite auditar después quién cambió cuánto. Ponerle precio por primera
    // vez a un ítem que no lo tenía es un cambio de precio como cualquier otro.
    //
    // UNA CELDA VACÍA NO BORRA EL PRECIO. Es la misma regla que el costo, y hace
    // falta de verdad: el cliente cargó su catálogo con 119 productos sin
    // precio, los va completando desde la pantalla de Catálogo, y en algún
    // momento va a volver a subir su planilla —la de siempre, con esas celdas
    // todavía vacías— para agregar productos nuevos. Si la celda vacía se
    // interpretara como "déjalo sin precio", esa carga destruiría en silencio
    // todo el trabajo de completarlos. La planilla puede PONER precios; para
    // quitarle el precio a un ítem está la pantalla de Catálogo, donde se ve lo
    // que se está haciendo.
    if (fila.precio !== null && existente.precio !== fila.precio) {
      eventos.push({
        tipo: "item.precio_cambiado",
        datos: {
          itemId: existente.id,
          precioAnterior: existente.precio,
          precioNuevo: fila.precio,
          motivo: MOTIVO,
        },
      });
    }

    // El costo solo se toca si la planilla LO TRAE. Una celda PRECIO COMPRA
    // vacía significa "no lo sé", no "vale cero": borrarle el costo a un
    // producto porque esta vez no lo escribieron destruiría el margen
    // histórico de un ítem que sí estaba bien cargado.
    if (fila.costo !== null && existente.costo !== fila.costo) {
      eventos.push({
        tipo: "item.costo_cambiado",
        datos: {
          itemId: existente.id,
          costoAnterior: existente.costo,
          costoNuevo: fila.costo,
          motivo: MOTIVO,
        },
      });
    }

    // El stock se AJUSTA, no se suma: la columna dice cuántas unidades hay,
    // no cuántas entraron. Sumarlas duplicaría el inventario al reimportar.
    if (fila.tipo === "PRODUCTO" && fila.stock !== null) {
      const actual = p.stockDe(existente.id);
      if (actual !== fila.stock) {
        eventos.push({
          tipo: "stock.ajustado",
          datos: {
            itemId: existente.id,
            cantidadContada: fila.stock,
            cantidadSistema: actual,
            motivo: MOTIVO,
          },
        });
      }
    }
  }

  if (modo === "reemplazar") {
    for (const item of p.items.values()) {
      if (item.activo && !tocados.has(item.id)) {
        eventos.push({
          tipo: "item.desactivado",
          datos: { itemId: item.id, motivo: "No vino en la planilla importada" },
        });
      }
    }
  }

  return eventos;
}

/**
 * Busca el ítem que esta fila representa: por MARCA + NOMBRE + TIPO.
 *
 * Mira también los desactivados a propósito: volver a cargar una planilla con
 * un producto que se había dado de baja tiene que REACTIVARLO con su mismo id
 * —conservando su historial de ventas— y no crear un duplicado al lado.
 */
function buscarExistente(p: Proyeccion, fila: FilaDeCatalogo): Item | undefined {
  const marca = normalizar(fila.marca);
  const nombre = normalizar(fila.nombre);

  const mismoNombre: Item[] = [];
  for (const item of p.items.values()) {
    if (item.tipo !== fila.tipo) continue;
    if (normalizar(item.nombre) !== nombre) continue;
    if (normalizar(item.marca) === marca) return item; // coincidencia exacta
    mismoNombre.push(item);
  }

  /**
   * Uno de los dos lados no tiene marca y el otro sí, y hay UN SOLO candidato
   * con ese nombre. Casi siempre es la misma cosa: alguien está completando las
   * marcas de un catálogo que cargó sin ellas, o se las está quitando. Tratarlo
   * como un producto nuevo duplicaría el catálogo entero en la carga siguiente.
   *
   * La condición de que haya UN SOLO candidato es lo que hace esto seguro. Con
   * dos o más —el TALCO de dos marcas distintas— no hay forma de saber a
   * cuál se refiere una fila que dice solo "TALCO", y adivinar fusionaría dos
   * productos distintos. En ese caso se crea uno nuevo: un ítem de más se ve y
   * se corrige, una fusión silenciosa mezcla el historial de ventas de dos
   * productos y no se deshace.
   */
  if (mismoNombre.length === 1) {
    const unico = mismoNombre[0];
    if (marca === "" || normalizar(unico.marca) === "") return unico;
  }

  return undefined;
}

function nombreDeFila(fila: FilaDeCatalogo): string {
  return fila.marca ? `${fila.marca} ${fila.nombre}` : fila.nombre;
}

function precioEnPalabras(centimos: number | null): string {
  return centimos === null ? "SIN PRECIO" : soles(centimos);
}

function soles(centimos: number): string {
  return `S/ ${(centimos / 100).toFixed(2)}`;
}
