/**
 * Los reportes: de "cuánto vendí" a "cuánto gané".
 *
 * Vive en su propio módulo y no dentro de la ruta HTTP porque calcula bastante y
 * porque lo que calcula tiene reglas que conviene poder probar sin levantar un
 * servidor. Todo sale de la proyección en memoria, así que es instantáneo.
 *
 * LA REGLA QUE ATRAVIESA TODO ESTE ARCHIVO: un dato que no se conoce se informa
 * como desconocido, nunca como cero. Un producto sin costo cargado no tiene
 * margen del 100%: no tiene margen calculable, y decir lo primero haría que el
 * dueño tomara decisiones sobre una ganancia inventada. Por eso casi todas las
 * cifras de utilidad vienen acompañadas de su COBERTURA —sobre cuánto de lo
 * vendido se pudo calcular— y el margen es `null` cuando no hay base.
 *
 * SOBRE EL COSTO. Cada línea de venta lleva congelado el costo promedio
 * ponderado que el producto tenía al momento de venderse (ver
 * `esquemaLineaVenta`). Los reportes usan ESE número y nunca el costo actual:
 * es lo que hace que el reporte de septiembre siga diciendo lo mismo en octubre.
 */

import { mediosEnCero, type Item, type TotalesPorMedio, type Venta } from "../proyecciones/tipos";
import type { Proyeccion } from "../proyecciones/Proyeccion";
import type { Centimos } from "@cupula/contratos";

// ─────────────────────────────────────────────────────────────────────────────
// Formas que salen por la API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Utilidad de un conjunto de líneas, con su cobertura al lado.
 *
 * `margen` es `null` cuando no hubo ni una línea con costo conocido. Devolver 0
 * ahí sería afirmar que no se gana nada, que es una afirmación distinta de "no
 * lo sé".
 */
export interface Utilidad {
  /** Vendido en las líneas que SÍ tienen costo conocido. */
  ingresoCosteado: Centimos;
  costo: Centimos;
  utilidad: Centimos;
  /** Porcentaje sobre `ingresoCosteado`, un decimal. `null` si no hay base. */
  margen: number | null;
  /** Vendido en líneas sin costo conocido: queda fuera del cálculo. */
  ingresoSinCostear: Centimos;
  /** Qué parte de lo vendido pudo costearse, en porcentaje. */
  cobertura: number;
}

export interface FilaAgrupada extends Utilidad {
  clave: string;
  etiqueta: string;
  cantidad: number;
  /** Vendido TOTAL, costeado o no. Es lo que se compara entre filas. */
  total: Centimos;
}

export interface TotalesDelPeriodo {
  desde: string;
  hasta: string;
  dias: number;
  total: Centimos;
  cantidadVentas: number;
  ticketPromedio: Centimos;
  medios: TotalesPorMedio;
  utilidad: Utilidad;
}

export interface VentaBajoCosto {
  correlativo: string;
  fecha: string;
  nombre: string;
  precioUnitario: Centimos;
  costoUnitario: Centimos;
  /** Lo que se perdió en esa línea: (costo − precio) × cantidad. */
  perdida: Centimos;
}

export interface ProductoSinRotar {
  itemId: string;
  nombre: string;
  stock: number;
  /** Días desde la última venta. `null` = no se vendió nunca. */
  diasSinVender: number | null;
  ultimaVenta: string | null;
  /** Plata inmovilizada, a costo. `null` si no se sabe el costo. */
  inmovilizado: Centimos | null;
}

export interface Inventario {
  productos: number;
  valorCosto: Centimos;
  valorVenta: Centimos;
  agotados: number;
  bajoMinimo: number;
  enNegativo: number;
  sinCosto: number;
  sinPrecio: number;
}

export interface Reporte extends TotalesDelPeriodo {
  /** El mismo período inmediatamente anterior, para comparar. */
  anterior: TotalesDelPeriodo;
  porDia: { dia: string; total: Centimos; cantidad: number; utilidad: Centimos | null }[];
  ranking: FilaAgrupada[];
  porCategoria: FilaAgrupada[];
  porMarca: FilaAgrupada[];
  porBarbero: { barberoId: string; nombre: string; cantidad: number; total: Centimos }[];
  bajoCosto: VentaBajoCosto[];
  inventario: Inventario;
  sinRotar: ProductoSinRotar[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Cálculo
// ─────────────────────────────────────────────────────────────────────────────

/** Acumulador mutable de utilidad. Se cierra con `cerrarUtilidad`. */
interface AcumUtilidad {
  ingresoCosteado: number;
  costo: number;
  ingresoSinCostear: number;
}

function acumVacio(): AcumUtilidad {
  return { ingresoCosteado: 0, costo: 0, ingresoSinCostear: 0 };
}

/**
 * Suma una línea al acumulador.
 *
 * Un SERVICIO nunca tiene costo —no hay mercadería que comprar— así que su
 * venta va entera a `ingresoSinCostear`. Eso hace que el margen de una barbería
 * sea, correctamente, "el margen de lo que revende": mezclar los servicios como
 * si tuvieran costo cero daría un margen global inflado que no se puede usar
 * para decidir nada.
 */
function sumarLinea(a: AcumUtilidad, linea: Venta["lineas"][number]): void {
  const costoUnitario = linea.costoUnitario;
  if (costoUnitario === null || costoUnitario === undefined) {
    a.ingresoSinCostear += linea.total;
    return;
  }
  a.ingresoCosteado += linea.total;
  a.costo += Math.round(costoUnitario * linea.cantidad);
}

function cerrarUtilidad(a: AcumUtilidad): Utilidad {
  const utilidad = a.ingresoCosteado - a.costo;
  const vendido = a.ingresoCosteado + a.ingresoSinCostear;
  return {
    ingresoCosteado: a.ingresoCosteado,
    costo: a.costo,
    utilidad,
    margen: a.ingresoCosteado > 0 ? Math.round((utilidad / a.ingresoCosteado) * 1000) / 10 : null,
    ingresoSinCostear: a.ingresoSinCostear,
    cobertura: vendido > 0 ? Math.round((a.ingresoCosteado / vendido) * 100) : 0,
  };
}

/** Ventas NO anuladas cuya fecha cae dentro del rango, inclusive. */
function ventasEntre(p: Proyeccion, desde: string, hasta: string): Venta[] {
  return [...p.ventas.values()].filter((v) => {
    if (v.anulada) return false;
    const f = v.ts.slice(0, 10);
    return f >= desde && f <= hasta;
  });
}

function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T12:00:00Z`);
  const b = Date.parse(`${hasta}T12:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function totalesDe(p: Proyeccion, desde: string, hasta: string): TotalesDelPeriodo {
  const ventas = ventasEntre(p, desde, hasta);
  const medios = mediosEnCero();
  const acum = acumVacio();
  let total = 0;

  for (const venta of ventas) {
    total += venta.total;
    for (const pago of venta.pagos) medios[pago.medio] += pago.monto;
    for (const linea of venta.lineas) sumarLinea(acum, linea);
  }

  return {
    desde,
    hasta,
    dias: diasEntre(desde, hasta),
    total,
    cantidadVentas: ventas.length,
    ticketPromedio: ventas.length ? Math.round(total / ventas.length) : 0,
    medios,
    utilidad: cerrarUtilidad(acum),
  };
}

/**
 * Agrupa las líneas por una clave y devuelve las filas ordenadas por lo vendido.
 *
 * Sirve para categoría, marca e ítem con el mismo código: las tres preguntas
 * son la misma operación sobre una clave distinta.
 */
function agrupar(
  ventas: Venta[],
  clavePara: (linea: Venta["lineas"][number]) => { clave: string; etiqueta: string } | null,
): FilaAgrupada[] {
  const mapa = new Map<string, { etiqueta: string; cantidad: number; total: number; acum: AcumUtilidad }>();

  for (const venta of ventas) {
    for (const linea of venta.lineas) {
      const k = clavePara(linea);
      if (!k) continue;
      const fila = mapa.get(k.clave) ?? { etiqueta: k.etiqueta, cantidad: 0, total: 0, acum: acumVacio() };
      fila.cantidad += linea.cantidad;
      fila.total += linea.total;
      sumarLinea(fila.acum, linea);
      mapa.set(k.clave, fila);
    }
  }

  return [...mapa.entries()]
    .map(([clave, f]) => ({
      clave,
      etiqueta: f.etiqueta,
      cantidad: f.cantidad,
      total: f.total,
      ...cerrarUtilidad(f.acum),
    }))
    .sort((a, b) => b.total - a.total);
}

/** Cómo se llama una línea en un reporte: con marca si la tiene. */
function nombreDeLinea(linea: Venta["lineas"][number]): string {
  return linea.marca ? `${linea.marca} ${linea.nombre}` : linea.nombre;
}

function valorizarInventario(p: Proyeccion): Inventario {
  let valorCosto = 0;
  let valorVenta = 0;
  let productos = 0;
  let agotados = 0;
  let bajoMinimo = 0;
  let enNegativo = 0;
  let sinCosto = 0;
  let sinPrecio = 0;

  for (const item of p.items.values()) {
    if (item.tipo !== "PRODUCTO" || !item.activo) continue;
    productos += 1;

    const stock = p.stockDe(item.id);
    const positivo = Math.max(0, stock);
    if (stock <= 0) agotados += 1;
    if (stock < 0) enNegativo += 1;
    if (stock <= item.stockMinimo) bajoMinimo += 1;

    if (item.costo === null) {
      if (stock > 0) sinCosto += 1;
    } else {
      valorCosto += Math.round(positivo * item.costo);
    }

    if (item.precio === null) {
      if (stock > 0) sinPrecio += 1;
    } else {
      valorVenta += Math.round(positivo * item.precio);
    }
  }

  return { productos, valorCosto, valorVenta, agotados, bajoMinimo, enNegativo, sinCosto, sinPrecio };
}

/**
 * Productos con stock que no se vendieron en el período.
 *
 * La última venta se busca en TODO el historial y no solo en el período: lo que
 * interesa saber es "hace cuánto que esto no se mueve", y si un producto se
 * vendió por última vez hace ocho meses, acotar la búsqueda al mes en curso
 * diría "nunca" y perdería el dato más útil.
 *
 * Solo entran los que tienen stock: un producto agotado que no se vende no tiene
 * plata inmovilizada, así que no es el problema que este reporte busca.
 */
function productosSinRotar(p: Proyeccion, hasta: string, ventas: Venta[]): ProductoSinRotar[] {
  const vendidoEnPeriodo = new Set<string>();
  for (const venta of ventas) {
    for (const linea of venta.lineas) vendidoEnPeriodo.add(linea.itemId);
  }

  const ultimaVenta = new Map<string, string>();
  for (const venta of p.ventas.values()) {
    if (venta.anulada) continue;
    const fecha = venta.ts.slice(0, 10);
    for (const linea of venta.lineas) {
      const previa = ultimaVenta.get(linea.itemId);
      if (!previa || fecha > previa) ultimaVenta.set(linea.itemId, fecha);
    }
  }

  const salida: ProductoSinRotar[] = [];
  for (const item of p.items.values()) {
    if (item.tipo !== "PRODUCTO" || !item.activo) continue;
    if (vendidoEnPeriodo.has(item.id)) continue;

    const stock = p.stockDe(item.id);
    if (stock <= 0) continue;

    const ultima = ultimaVenta.get(item.id) ?? null;
    salida.push({
      itemId: item.id,
      nombre: p.nombreCompleto(item),
      stock,
      ultimaVenta: ultima,
      diasSinVender: ultima ? diasEntre(ultima, hasta) - 1 : null,
      inmovilizado: item.costo === null ? null : Math.round(stock * item.costo),
    });
  }

  // Primero los que nunca se vendieron, y dentro de cada grupo los que tienen
  // más plata parada: es el orden en que conviene atacarlos.
  return salida.sort((a, b) => {
    if ((a.diasSinVender === null) !== (b.diasSinVender === null)) return a.diasSinVender === null ? -1 : 1;
    return (b.inmovilizado ?? 0) - (a.inmovilizado ?? 0);
  });
}

/**
 * Líneas vendidas por debajo de su costo.
 *
 * Puede ser una liquidación decidida a propósito, y por eso se informa en vez de
 * impedirse. Lo que no puede pasar es que ocurra sin que nadie lo vea: en un
 * catálogo de 129 productos con precios cargados a mano, un dedo en un precio es
 * cuestión de tiempo.
 */
function ventasBajoCosto(ventas: Venta[]): VentaBajoCosto[] {
  const salida: VentaBajoCosto[] = [];

  for (const venta of ventas) {
    for (const linea of venta.lineas) {
      const costo = linea.costoUnitario;
      if (costo === null || costo === undefined) continue;
      if (linea.precioUnitario >= costo) continue;
      salida.push({
        correlativo: venta.correlativo,
        fecha: venta.ts.slice(0, 10),
        nombre: nombreDeLinea(linea),
        precioUnitario: linea.precioUnitario,
        costoUnitario: costo,
        perdida: Math.round((costo - linea.precioUnitario) * linea.cantidad),
      });
    }
  }

  return salida.sort((a, b) => b.perdida - a.perdida);
}

/**
 * El reporte completo de un período.
 *
 * `desde` y `hasta` son fechas locales inclusive ("2026-09-01" a "2026-09-30").
 * El período de comparación se deduce: el mismo largo, inmediatamente antes.
 * Deducirlo acá y no en la pantalla evita que dos pantallas comparen contra
 * períodos distintos y muestren variaciones que no coinciden.
 */
export function construirReporte(p: Proyeccion, desde: string, hasta: string): Reporte {
  const ventas = ventasEntre(p, desde, hasta);
  const totales = totalesDe(p, desde, hasta);

  const largo = totales.dias;
  const anterior = totalesDe(p, sumarDias(desde, -largo), sumarDias(desde, -1));

  const porDia = new Map<string, { total: number; cantidad: number; acum: AcumUtilidad }>();
  const porBarbero = new Map<string, { cantidad: number; total: number }>();

  for (const venta of ventas) {
    const dia = venta.ts.slice(0, 10);
    const d = porDia.get(dia) ?? { total: 0, cantidad: 0, acum: acumVacio() };
    d.total += venta.total;
    d.cantidad += 1;

    for (const linea of venta.lineas) {
      sumarLinea(d.acum, linea);
      if (linea.barberoId) {
        const b = porBarbero.get(linea.barberoId) ?? { cantidad: 0, total: 0 };
        b.cantidad += linea.cantidad;
        b.total += linea.total;
        porBarbero.set(linea.barberoId, b);
      }
    }

    porDia.set(dia, d);
  }

  const categoriaDe = (itemId: string): string => p.items.get(itemId)?.categoria ?? "(sin categoría)";

  return {
    ...totales,
    anterior,
    porDia: [...porDia.entries()]
      .map(([dia, d]) => {
        const u = cerrarUtilidad(d.acum);
        return { dia, total: d.total, cantidad: d.cantidad, utilidad: u.margen === null ? null : u.utilidad };
      })
      .sort((a, b) => a.dia.localeCompare(b.dia)),

    ranking: agrupar(ventas, (l) => ({ clave: l.itemId, etiqueta: nombreDeLinea(l) })),
    porCategoria: agrupar(ventas, (l) => {
      const c = categoriaDe(l.itemId);
      return { clave: c, etiqueta: c };
    }),
    /**
     * Ranking de marcas: SOLO PRODUCTOS.
     *
     * No alcanza con excluir las líneas sin marca. El catálogo real marca los
     * servicios con "LA CÚPULA" —el nombre del propio local— y como los
     * servicios son el grueso de la facturación de una barbería, esa fila
     * encabezaría el ranking siempre y taparía a las marcas que sí se compran y
     * se revenden. La pregunta de este bloque es "de qué marca vendo más
     * mercadería", y un corte de pelo no es mercadería de ninguna marca.
     */
    porMarca: agrupar(ventas, (l) =>
      l.tipo === "PRODUCTO" && l.marca ? { clave: l.marca, etiqueta: l.marca } : null,
    ),

    // Producción por barbero. Es un dato de gestión, NO una liquidación:
    // en La Cúpula los barberos tienen sueldo fijo y no hay comisiones.
    porBarbero: [...porBarbero.entries()]
      .map(([barberoId, d]) => ({
        barberoId,
        nombre: p.barberos.get(barberoId)?.nombre ?? "(eliminado)",
        ...d,
      }))
      .sort((a, b) => b.total - a.total),

    bajoCosto: ventasBajoCosto(ventas),
    inventario: valorizarInventario(p),
    sinRotar: productosSinRotar(p, hasta, ventas),
  };
}

/** Variación porcentual entre dos cifras. `null` cuando no hay base contra la cual comparar. */
export function variacion(ahora: number, antes: number): number | null {
  if (antes === 0) return null;
  return Math.round(((ahora - antes) / Math.abs(antes)) * 1000) / 10;
}

export type { Item };
