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
  | "DATO_INVALIDO"
  | "USUARIO_NO_EXISTE"
  | "USUARIO_REPETIDO"
  | "LIMITE_CAJEROS_ALCANZADO"
  | "LIMITE_ADMINS_ALCANZADO"
  | "CONTRASENA_ACTUAL_INCORRECTA"
  | "CREDENCIALES_INVALIDAS"
  | "NO_AUTENTICADO"
  | "ROL_INSUFICIENTE";

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

/**
 * No hay sesión válida (sin cookie, cookie vencida, o la invalidó otra
 * sesión de cajero). Se distingue de `ErrorDeNegocio` porque el código HTTP
 * es 401, no 400: no es que el pedido esté mal armado, es que no sabemos
 * quién lo hace.
 */
export class ErrorDeAutenticacion extends Error {
  constructor(
    readonly codigo: Extract<CodigoError, "NO_AUTENTICADO" | "CREDENCIALES_INVALIDAS">,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorDeAutenticacion";
  }
}

export function esErrorDeAutenticacion(e: unknown): e is ErrorDeAutenticacion {
  return e instanceof ErrorDeAutenticacion;
}

/** Hay sesión válida, pero el rol de esa cuenta no alcanza para esta ruta. 403, no 401. */
export class ErrorDeAutorizacion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeAutorizacion";
  }
}

export function esErrorDeAutorizacion(e: unknown): e is ErrorDeAutorizacion {
  return e instanceof ErrorDeAutorizacion;
}
