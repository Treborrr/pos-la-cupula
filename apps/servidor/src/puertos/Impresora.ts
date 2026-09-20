/**
 * Puerto de impresión: SOLO la interfaz y sus tipos.
 *
 * Nada de implementaciones aquí. Un puerto describe qué necesita el sistema
 * del mundo exterior; el cómo vive en `adaptadores/impresora/`. Mantener esa
 * separación es lo que permite cambiar de ticketera —o de transporte, o de
 * formato— sin tocar el dominio ni las rutas.
 */

import type { Venta } from "../proyecciones/tipos";

export interface DatosDelNegocio {
  nombre: string;
  direccion: string;
  ciudad: string;
  ruc: string;
  pie: string;
}

export interface OpcionesDeImpresion {
  /** Marca el papel como COPIA. */
  reimpresion?: boolean;
  /** Nombre del barbero por línea, resuelto por quien llama. */
  nombresDeBarbero?: Record<string, string>;
  nombreDelCliente?: string;
  /** Manda el pulso de apertura del cajón junto con el ticket. */
  abrirCajon?: boolean;
}

export interface ResultadoImpresion {
  impreso: boolean;
  /**
   * El ticket en texto. Se devuelve SIEMPRE, salga o no el papel: si la
   * impresora falla, el cajero igual tiene que poder ver qué decía.
   */
  vistaPrevia: string;
  /** Por qué no se imprimió, si no se imprimió. */
  motivo?: string;
  /**
   * Distingue "todavía no hay ticketera configurada" de "la ticketera falló".
   * La pantalla avisa en rojo solo lo segundo: durante la puesta a punto, ver
   * una alarma en cada venta entrena a ignorarla.
   */
  sinImpresora?: boolean;
}

export interface EstadoImpresora {
  disponible: boolean;
  descripcion: string;
  detalle?: string;
}

export interface Impresora {
  imprimirVenta(
    venta: Venta,
    negocio: DatosDelNegocio,
    opciones?: OpcionesDeImpresion,
  ): Promise<ResultadoImpresion>;
  estado(): Promise<EstadoImpresora>;
}

/**
 * El payload del QR que va impreso en el ticket.
 *
 * Formato `CUP1|<tipo>|<id>`. La versión va en el prefijo desde el día uno:
 * si mañana el formato cambia, los tickets viejos se siguen reconociendo por
 * su prefijo en vez de quedar ilegibles.
 *
 * `V` es venta. Escanearlo con la pistola abre esa venta en el POS.
 */
export function qrDeVenta(correlativo: string): string {
  return `CUP1|V|${correlativo}`;
}
