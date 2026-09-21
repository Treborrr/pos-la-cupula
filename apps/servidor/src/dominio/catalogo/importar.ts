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
 * La comparación es por CÓDIGO. Si la fila no trae código, se busca por nombre
 * normalizado antes de crear uno nuevo: cargar dos veces la misma planilla no
 * debe duplicar el catálogo.
 */

import { normalizar, type EventoNuevo } from "@cupula/contratos";

import type { Proyeccion } from "../../proyecciones/Proyeccion";
import { categoriaCanonica, siguienteCodigo } from "./catalogo";
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
  /** Vacío = el sistema lo genera. */
  codigo: string;
  nombre: string;
  tipo: "SERVICIO" | "PRODUCTO";
  categoria: string;
  /** En céntimos enteros, como todo monto del sistema. */
  precio: number;
  stock: number | null;
  stockMinimo: number | null;
}

export type ModoDeImportacion = "agregar" | "reemplazar";

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
  resumen: { crear: number; actualizar: number; reactivar: number; sinCambios: number; desactivar: number };
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
        codigo: fila.codigo || "(automático)",
        nombre: fila.nombre,
        accion: "crear",
        detalle: [`${fila.tipo.toLowerCase()} · ${fila.categoria} · ${soles(fila.precio)}`],
      });
      continue;
    }

    const detalle: string[] = [];
    if (existente.nombre !== fila.nombre) detalle.push(`nombre: "${existente.nombre}" → "${fila.nombre}"`);
    if (existente.precio !== fila.precio) detalle.push(`precio: ${soles(existente.precio)} → ${soles(fila.precio)}`);
    if (normalizar(existente.categoria) !== normalizar(fila.categoria)) {
      detalle.push(`categoría: ${existente.categoria} → ${fila.categoria}`);
    }
    if (fila.stockMinimo !== null && existente.stockMinimo !== fila.stockMinimo) {
      detalle.push(`stock mínimo: ${existente.stockMinimo} → ${fila.stockMinimo}`);
    }
    if (fila.stock !== null) {
      const actual = p.stockDe(existente.id);
      if (actual !== fila.stock) detalle.push(`stock: ${actual} → ${fila.stock}`);
    }

    const accion = !existente.activo ? "reactivar" : detalle.length > 0 ? "actualizar" : "sin cambios";
    cambios.push({ fila: fila.fila, codigo: existente.codigo, nombre: fila.nombre, accion, detalle });
  }

  const aDesactivar =
    modo === "reemplazar"
      ? [...p.items.values()]
          .filter((i) => i.activo && !tocados.has(i.id))
          .map((i) => ({ codigo: i.codigo, nombre: i.nombre }))
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

  for (const fila of filas) {
    const existente = buscarExistente(p, fila);

    if (!existente) {
      const itemId = ulid();
      eventos.push({
        tipo: "item.creado",
        datos: {
          itemId,
          codigo: fila.codigo || codigoLibre(fila.tipo),
          nombre: fila.nombre,
          tipo: fila.tipo,
          categoria: categoriaCanonica(p, fila.categoria),
          precio: fila.precio,
          stockMinimo: fila.tipo === "PRODUCTO" ? (fila.stockMinimo ?? 0) : undefined,
        },
      });
      if (fila.tipo === "PRODUCTO" && fila.stock !== null && fila.stock > 0) {
        eventos.push({
          tipo: "stock.entrada",
          datos: { itemId, cantidad: fila.stock, motivo: "Carga inicial desde planilla" },
        });
      }
      continue;
    }

    tocados.add(existente.id);

    if (!existente.activo) eventos.push({ tipo: "item.reactivado", datos: { itemId: existente.id } });

    const cambios: Record<string, unknown> = {};
    if (existente.nombre !== fila.nombre) cambios.nombre = fila.nombre;
    if (normalizar(existente.categoria) !== normalizar(fila.categoria)) cambios.categoria = fila.categoria;
    if (fila.stockMinimo !== null && existente.stockMinimo !== fila.stockMinimo) {
      cambios.stockMinimo = fila.stockMinimo;
    }
    if (Object.keys(cambios).length > 0) {
      eventos.push({ tipo: "item.actualizado", datos: { itemId: existente.id, ...cambios } });
    }

    // El precio va en su propio evento, con el anterior al lado: es lo que
    // permite auditar después quién cambió cuánto.
    if (existente.precio !== fila.precio) {
      eventos.push({
        tipo: "item.precio_cambiado",
        datos: {
          itemId: existente.id,
          precioAnterior: existente.precio,
          precioNuevo: fila.precio,
          motivo: "Importación de catálogo desde planilla",
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
            motivo: "Importación de catálogo desde planilla",
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

/** Por código si lo trae; si no, por nombre normalizado, para no duplicar. */
function buscarExistente(p: Proyeccion, fila: FilaDeCatalogo) {
  if (fila.codigo) {
    for (const item of p.items.values()) {
      if (item.codigo === fila.codigo) return item;
    }
    return undefined;
  }
  const clave = normalizar(fila.nombre);
  for (const item of p.items.values()) {
    if (normalizar(item.nombre) === clave && item.tipo === fila.tipo) return item;
  }
  return undefined;
}

function soles(centimos: number): string {
  return `S/ ${(centimos / 100).toFixed(2)}`;
}
