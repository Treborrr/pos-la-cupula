/**
 * Las vistas consultables del sistema: lo que queda después de reproducir el
 * log de eventos.
 *
 * Estos objetos NO son la fuente de verdad —el log lo es— y se pueden tirar y
 * reconstruir enteros en cualquier momento. Esa propiedad es la que permite
 * cambiarles la forma sin migrar datos de un cliente: se borra la instantánea,
 * se reproduce el log y listo.
 */

import type { CategoriaEgreso, Centimos, MedioPago, Pago, TipoItem, LineaVenta } from "@cupula/contratos";

export interface Item {
  id: string;
  codigo: string;
  /** Marca comercial. Cadena vacía = sin marca (los servicios, casi siempre). */
  marca: string;
  nombre: string;
  tipo: TipoItem;
  categoria: string;
  /**
   * `null` = todavía no tiene precio de lista. No se puede vender desde la
   * grilla sin escribirle un precio a mano en esa venta.
   */
  precio: Centimos | null;
  /**
   * Costo promedio ponderado móvil, en céntimos. `null` = nunca se declaró un
   * costo, y entonces la utilidad de sus ventas se informa como "no
   * registrada" en lugar de suponer cero.
   */
  costo: Centimos | null;
  /**
   * Solo PRODUCTO. Cuando el stock llega a este número o menos, la pantalla
   * avisa. En 0 —el valor por defecto— avisa recién al quedarse sin unidades,
   * que es lo que corresponde cuando la planilla no declaró un mínimo propio.
   */
  stockMinimo: number;
  orden: number;
  activo: boolean;
  creadoEn: string;
  actualizadoEn: string;
  /** Nombre del archivo en datos/fotos/, servido por /fotos/:archivo. Null = sin foto. */
  foto: string | null;
}

export interface Venta {
  id: string;
  correlativo: string;
  ts: string;
  lineas: LineaVenta[];
  subtotal: Centimos;
  descuento: Centimos;
  total: Centimos;
  pagos: Pago[];
  clienteId: string | null;
  turnoId: string | null;
  notas?: string;
  /** Anular no borra: marca. El correlativo queda consumido para siempre. */
  anulada: boolean;
  motivoAnulacion?: string;
  anuladaEn?: string;
  reimpresiones: number;
}

export interface Turno {
  id: string;
  abiertoEn: string;
  montoInicial: Centimos;
  cerradoEn?: string;
  contadoEfectivo?: Centimos;
  diferencia?: Centimos;
  notas?: string;
}

/** Una salida de efectivo del cajón que no es una venta. */
export interface Egreso {
  id: string;
  ts: string;
  /** Null si se registró con la caja cerrada. */
  turnoId: string | null;
  monto: Centimos;
  motivo: string;
  comprobante?: string;
  /** "OTRO" en los egresos escritos antes de que existiera esta categoría. */
  categoria: CategoriaEgreso;
  /** Solo presente cuando categoria es ADELANTO. */
  barberoId?: string;
}

/**
 * Cuántos correos salieron HOY y cuáles alertas técnicas ya se avisaron hoy.
 *
 * Se guarda por día (clave "2026-09-16") y se reconstruye de los eventos
 * `correo.enviado`: es lo que permite que el tope diario y el "no repetir una
 * alerta ya avisada" sobrevivan un reinicio del servidor, en vez de vivir
 * solo en memoria y perderse justo el día que más importa que no se pierdan.
 */
export interface ResumenCorreosDelDia {
  /** Correos que de verdad salieron hoy (solo `ok: true`), de cualquier categoría. */
  usadosTotal: number;
  /** De esos, cuántos fueron alertas técnicas agrupadas (no cuenta el reporte del día). */
  usadosAlertas: number;
  /** Códigos de `calcularAlertas` ya avisados hoy: no se repiten aunque sigan activos. */
  codigosAlertaNotificados: Set<string>;
  /** Si ya salió el reporte de cierre de hoy — evita mandarlo dos veces el mismo día. */
  reporteDiaEnviado: boolean;
}

/**
 * Propina de un cliente a un barbero por una línea de una venta. No afecta el
 * total de la venta ni el arqueo: es puro registro, para reportar — nunca
 * para liquidar (D6: sueldo fijo, sin comisiones).
 */
export interface Propina {
  id: string;
  ts: string;
  ventaId: string;
  lineaIndex: number;
  barberoId: string;
  monto: Centimos;
  turnoId: string | null;
}

export interface Cliente {
  id: string;
  nombre: string;
  telefono?: string;
  notas?: string;
  /** Seriales de tarjeta de fidelidad vinculados (puede tener más de uno). */
  seriales: string[];
  visitas: number;
  totalGastado: Centimos;
  primeraVisita?: string;
  ultimaVisita?: string;
}

export interface Barbero {
  id: string;
  nombre: string;
  activo: boolean;
}

/** El dueño le pagó al barbero: los adelantos de antes de esta fecha quedan saldados. */
export interface Liquidacion {
  id: string;
  ts: string;
  barberoId: string;
  monto: Centimos;
  notas?: string;
}

/** Un movimiento del kardex, venga de una venta o de un ajuste manual. */
export interface MovimientoStock {
  ts: string;
  itemId: string;
  /** Positivo entra, negativo sale. */
  cantidad: number;
  saldo: number;
  motivo: string;
  origen: "venta" | "anulacion" | "entrada" | "ajuste" | "merma";
  referencia?: string;
}

export interface TotalesPorMedio {
  EFECTIVO: Centimos;
  YAPE: Centimos;
  TARJETA: Centimos;
  /** Lo vendido a cuenta del sueldo de un barbero. No es efectivo cobrado. */
  ADELANTO: Centimos;
}

export function mediosEnCero(): TotalesPorMedio {
  return { EFECTIVO: 0, YAPE: 0, TARJETA: 0, ADELANTO: 0 };
}

export type { MedioPago };
