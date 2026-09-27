/**
 * Errores de negocio: cosas que el usuario hizo mal y puede corregir.
 *
 * Se distinguen de los errores de programa porque tienen un mensaje escrito
 * PARA LA PERSONA QUE ESTÁ EN EL MOSTRADOR, no para el que lee el log. La capa
 * HTTP los traduce a 400 con ese mensaje; cualquier otra excepción es un 500 y
 * un bug nuestro.
 *
 * El Excel decía "El Item no existe." y te dejaba solo. Aquí, cuando se puede,
 * el error trae una pista de qué hacer.
 */

export type CodigoError =
  | "ITEM_NO_EXISTE"
  | "CODIGO_REPETIDO"
  | "ITEM_INACTIVO"
  /** Se intentó cobrar un ítem sin precio de lista y sin indicar cuánto cobrar. */
  | "ITEM_SIN_PRECIO"
  | "VENTA_SIN_LINEAS"
  | "PAGOS_NO_CUADRAN"
  | "EFECTIVO_INSUFICIENTE"
  | "VENTA_NO_EXISTE"
  | "VENTA_YA_ANULADA"
  | "TURNO_YA_ABIERTO"
  | "TURNO_NO_ABIERTO"
  | "CLIENTE_NO_EXISTE"
  | "CLIENTE_REQUERIDO"
  | "CLIENTE_REPETIDO"
  | "BARBERO_NO_EXISTE"
  | "BARBERO_INACTIVO"
  | "NO_ES_PRODUCTO"
  | "PLANILLA_ILEGIBLE"
  | "PLANILLA_CON_ERRORES"
  | "PLANILLA_VACIA"
  | "DATO_INVALIDO";

export class ErrorDeNegocio extends Error {
  constructor(
    readonly codigo: CodigoError,
    mensaje: string,
    /** Qué puede hacer la persona para resolverlo. Se muestra debajo. */
    readonly sugerencia?: string,
  ) {
    super(mensaje);
    this.name = "ErrorDeNegocio";
  }
}

export function esErrorDeNegocio(e: unknown): e is ErrorDeNegocio {
  return e instanceof ErrorDeNegocio;
}
