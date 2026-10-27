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
import { bajoMinimo as estaBajoMinimo } from "../dominio/inventario/inventario";
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

/** Una fila de la comparativa entre sucursales. */
export interface ComparativaDeSede {
  sedeId: string;
  nombre: string;
  total: Centimos;
  cantidad: number;
  ticketPromedio: Centimos;
  utilidad: Centimos;
  /** `null` si no hubo base costeada para calcularlo. */
  margen: number | null;
  /** Contra el mismo período anterior. `null` si antes no vendió nada. */
  variacion: number | null;
  cajaAbierta: boolean;
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

/** Cuánto se vendió en cada hora del día, sumando todos los días del período. */
export interface VentasPorHora {
  /** 0 a 23. */
  hora: number;
  total: Centimos;
  cantidad: number;
}

/** Un producto que hay que reponer, con lo que haga falta para decidir cuánto. */
export interface ParaReponer {
  itemId: string;
  nombre: string;
  stock: number;
  stockMinimo: number;
  /** Unidades vendidas en el período: con qué velocidad se va. */
  vendidasEnPeriodo: number;
  /** Lo que costaría reponer hasta el mínimo. `null` si no se sabe el costo. */
  costoDeReponer: Centimos | null;
  /** Cuántas faltan para llegar al mínimo (o al menos una, si está agotado). */
  sugeridas: number;
}

export interface Reporte extends TotalesDelPeriodo {
  /** El mismo período inmediatamente anterior, para comparar. */
  anterior: TotalesDelPeriodo;
  porDia: { dia: string; total: Centimos; cantidad: number; utilidad: Centimos | null }[];
  ranking: FilaAgrupada[];
  porCategoria: FilaAgrupada[];
  porMarca: FilaAgrupada[];
  porBarbero: { barberoId: string; nombre: string; cantidad: number; total: Centimos }[];
  /**
   * Propinas registradas en el período, por barbero. Por cuándo se ANOTÓ la
   * propina, no por la fecha de la venta que la originó: una propina agregada
   * días después (un cliente que volvió, una que se había olvidado) es un
   * hecho de HOY, y contarla en el período de la venta vieja escondería que
   * pasó algo esta semana.
   */
  propinas: { barberoId: string; nombre: string; cantidad: number; total: Centimos }[];
  bajoCosto: VentaBajoCosto[];
  inventario: Inventario;
  sinRotar: ProductoSinRotar[];
  porHora: VentasPorHora[];
  paraReponer: ParaReponer[];
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

/**
 * Ventas NO anuladas cuya fecha cae dentro del rango, inclusive.
 *
 * `sedeId = null` significa TODA LA CADENA. No es lo mismo que "ninguna": el
 * dueño de varios locales necesita poder mirar el consolidado, y esa es una
 * pregunta distinta de "cómo le fue a Bagua Centro".
 */
function ventasEntre(p: Proyeccion, sedeId: string | null, desde: string, hasta: string): Venta[] {
  return [...p.ventas.values()].filter((v) => {
    if (v.anulada) return false;
    if (sedeId !== null && v.sedeId !== sedeId) return false;
    const f = v.ts.slice(0, 10);
    return f >= desde && f <= hasta;
  });
}

/**
 * Propinas por barbero en el período, agrupadas por CUÁNDO SE ANOTARON
 * —ver el comentario de `Reporte.propinas`—, no por la venta a la que
 * pertenecen. No descarta las de una venta anulada: la propina es plata que
 * de verdad cambió de manos, pase lo que pase después con el cobro.
 */
function propinasPorBarberoEntre(
  p: Proyeccion,
  sedeId: string | null,
  desde: string,
  hasta: string,
): { barberoId: string; nombre: string; cantidad: number; total: Centimos }[] {
  const porBarbero = new Map<string, { cantidad: number; total: Centimos }>();

  for (const propina of p.propinas.values()) {
    const f = propina.ts.slice(0, 10);
    if (f < desde || f > hasta) continue;
    // La propina pertenece al local donde se cobró el servicio, no a donde se
    // anotó: la venta es la que dice de qué sucursal es.
    if (sedeId !== null && p.ventas.get(propina.ventaId)?.sedeId !== sedeId) continue;
    const b = porBarbero.get(propina.barberoId) ?? { cantidad: 0, total: 0 };
    b.cantidad += 1;
    b.total += propina.monto;
    porBarbero.set(propina.barberoId, b);
  }

  return [...porBarbero.entries()]
    .map(([barberoId, d]) => ({ barberoId, nombre: p.barberos.get(barberoId)?.nombre ?? "(eliminado)", ...d }))
    .sort((a, b) => b.total - a.total);
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

function totalesDe(p: Proyeccion, sedeId: string | null, desde: string, hasta: string): TotalesDelPeriodo {
  const ventas = ventasEntre(p, sedeId, desde, hasta);
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

/**
 * El stock que mira el reporte: el de la sucursal elegida, o el de toda la
 * cadena en el consolidado.
 *
 * Existe en un solo lugar porque hay tres sitios que necesitan la misma
 * respuesta (valorizado, sin rotar y para reponer), y si cada uno la resolviera
 * por su lado, el valorizado podría quedar de un local y las sugerencias de
 * reposición de otro, en el mismo informe.
 */
function stockDelReporte(p: Proyeccion, sedeId: string | null, itemId: string): number {
  return sedeId === null ? p.stockTotalDe(itemId) : p.stockDe(sedeId, itemId);
}

function valorizarInventario(p: Proyeccion, sedeId: string | null): Inventario {
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

    const stock = stockDelReporte(p, sedeId, item.id);
    const positivo = Math.max(0, stock);
    if (stock <= 0) agotados += 1;
    if (stock < 0) enNegativo += 1;
    // La misma definición que la alerta del encabezado y la tabla de
    // inventario, importada del dominio en vez de reescrita acá.
    if (estaBajoMinimo(stock, item.stockMinimo)) bajoMinimo += 1;

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
function productosSinRotar(p: Proyeccion, sedeId: string | null, hasta: string, ventas: Venta[]): ProductoSinRotar[] {
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

    const stock = stockDelReporte(p, sedeId, item.id);
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
 * Qué productos hay que reponer, y cuánto costaría.
 *
 * No es la misma pregunta que "cuáles están bajo mínimo": esa se responde con
 * un número y no sirve para ir al proveedor. Acá va el nombre, cuántas quedan,
 * cuántas se vendieron en el período —que es lo que dice si vale la pena
 * reponerlo— y cuánto costaría. Un producto agotado que no se vendió nunca no
 * hay que comprarlo, y uno que se vende todas las semanas hay que comprarlo
 * aunque todavía queden dos.
 *
 * Se ordena por lo que MÁS SE VENDE, no por lo que menos queda: reponer
 * primero lo que rota es lo que evita perder ventas.
 */
function productosParaReponer(p: Proyeccion, sedeId: string | null, ventas: Venta[]): ParaReponer[] {
  const vendidas = new Map<string, number>();
  for (const venta of ventas) {
    for (const l of venta.lineas) {
      if (l.tipo === "PRODUCTO") vendidas.set(l.itemId, (vendidas.get(l.itemId) ?? 0) + l.cantidad);
    }
  }

  const salida: ParaReponer[] = [];
  for (const item of p.items.values()) {
    if (item.tipo !== "PRODUCTO" || !item.activo) continue;

    const stock = stockDelReporte(p, sedeId, item.id);
    const seVendio = vendidas.get(item.id) ?? 0;
    const bajo = estaBajoMinimo(stock, item.stockMinimo);

    // Entra si está bajo mínimo, o si se quedó sin stock HABIÉNDOSE VENDIDO.
    // Un agotado que nadie compró no es algo para reponer: es algo para dejar
    // de tener, y de eso ya habla el bloque de rotación.
    if (!bajo && !(stock <= 0 && seVendio > 0)) continue;

    // Hasta el mínimo, y si no hay mínimo fijado al menos una: el objetivo es
    // no quedarse en cero, no adivinar cuánto compra el dueño.
    const sugeridas = Math.max(1, Math.ceil((item.stockMinimo || 1) - stock));

    salida.push({
      itemId: item.id,
      nombre: p.nombreCompleto(item),
      stock,
      stockMinimo: item.stockMinimo,
      vendidasEnPeriodo: seVendio,
      costoDeReponer: item.costo === null ? null : Math.round(sugeridas * item.costo),
      sugeridas,
    });
  }

  return salida.sort((a, b) => b.vendidasEnPeriodo - a.vendidasEnPeriodo || a.stock - b.stock);
}

/**
 * El reporte completo de un período.
 *
 * `desde` y `hasta` son fechas locales inclusive ("2026-09-01" a "2026-09-30").
 * El período de comparación se deduce: el mismo largo, inmediatamente antes.
 * Deducirlo acá y no en la pantalla evita que dos pantallas comparen contra
 * períodos distintos y muestren variaciones que no coinciden.
 */
/**
 * El reporte de un período. `sedeId = null` consolida toda la cadena.
 *
 * El inventario y los productos sin rotar siguen la misma regla: con una
 * sucursal elegida se cuenta SU stock, y en el consolidado se suman todos los
 * locales. Mezclarlos sería el peor de los dos mundos: un valorizado que no se
 * puede ir a contar a ningún estante.
 */
export function construirReporte(
  p: Proyeccion,
  sedeId: string | null,
  desde: string,
  hasta: string,
): Reporte {
  const ventas = ventasEntre(p, sedeId, desde, hasta);
  const totales = totalesDe(p, sedeId, desde, hasta);

  const largo = totales.dias;
  const anterior = totalesDe(p, sedeId, sumarDias(desde, -largo), sumarDias(desde, -1));

  const porDia = new Map<string, { total: number; cantidad: number; acum: AcumUtilidad }>();
  const porBarbero = new Map<string, { cantidad: number; total: number }>();
  // Las 24 horas siempre presentes: un hueco en el gráfico tiene que verse
  // como "a esa hora no se vendió nada", que es justamente el dato útil.
  const porHora: VentasPorHora[] = Array.from({ length: 24 }, (_, hora) => ({ hora, total: 0, cantidad: 0 }));

  for (const venta of ventas) {
    const dia = venta.ts.slice(0, 10);
    // La hora sale del timestamp del evento, que ya viene en hora de Lima.
    const hora = Number(venta.ts.slice(11, 13));
    if (hora >= 0 && hora < 24) {
      porHora[hora].total += venta.total;
      porHora[hora].cantidad += 1;
    }
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

    propinas: propinasPorBarberoEntre(p, sedeId, desde, hasta),

    bajoCosto: ventasBajoCosto(ventas),
    inventario: valorizarInventario(p, sedeId),
    sinRotar: productosSinRotar(p, sedeId, hasta, ventas),
    porHora,
    paraReponer: productosParaReponer(p, sedeId, ventas),
  };
}

/** Variación porcentual entre dos cifras. `null` cuando no hay base contra la cual comparar. */
/**
 * Cómo le fue a CADA sucursal en el mismo período, una al lado de la otra.
 *
 * Es la pregunta que no existía con un solo local y que es la razón entera de
 * abrir el segundo: cuál vende más, cuál creció y cuál se quedó. Un dueño de
 * cadena que solo puede mirar los locales de a uno no está administrando una
 * cadena, está administrando varios negocios sueltos.
 *
 * Se ordena por total descendente: la pregunta se lee de arriba.
 */
export function compararSedes(
  p: Proyeccion,
  desde: string,
  hasta: string,
): ComparativaDeSede[] {
  const largo = Math.max(1, diasEntre(desde, hasta));
  const antesDesde = sumarDias(desde, -largo);
  const antesHasta = sumarDias(desde, -1);

  const filas: ComparativaDeSede[] = [];
  for (const sede of p.sedesActivas()) {
    const ahora = totalesDe(p, sede.id, desde, hasta);
    const antes = totalesDe(p, sede.id, antesDesde, antesHasta);

    filas.push({
      sedeId: sede.id,
      nombre: sede.nombre,
      total: ahora.total,
      cantidad: ahora.cantidadVentas,
      ticketPromedio: ahora.ticketPromedio,
      utilidad: ahora.utilidad.utilidad,
      margen: ahora.utilidad.margen,
      variacion: variacion(ahora.total, antes.total),
      cajaAbierta: p.turnoAbiertoDe(sede.id) !== null,
    });
  }

  return filas.sort((a, b) => b.total - a.total);
}

export function variacion(ahora: number, antes: number): number | null {
  if (antes === 0) return null;
  return Math.round(((ahora - antes) / Math.abs(antes)) * 1000) / 10;
}

export type { Item };
