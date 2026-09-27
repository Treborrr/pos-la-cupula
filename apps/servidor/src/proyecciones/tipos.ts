/**
 * Las vistas consultables del sistema: lo que queda después de reproducir el
 * log de eventos.
 *
 * Estos objetos NO son la fuente de verdad —el log lo es— y se pueden tirar y
 * reconstruir enteros en cualquier momento. Esa propiedad es la que permite
 * cambiarles la forma sin migrar datos de un cliente: se borra la instantánea,
 * se reproduce el log y listo.
 */

import type { Centimos, MedioPago, Pago, TipoItem, LineaVenta } from "@cupula/contratos";

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
}

export function mediosEnCero(): TotalesPorMedio {
  return { EFECTIVO: 0, YAPE: 0, TARJETA: 0 };
}

export type { MedioPago };
