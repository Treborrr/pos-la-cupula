/**
 * Cliente del API.
 *
 * Rutas relativas siempre (`/api/...`): en desarrollo el proxy de Vite las
 * manda al 7070 y en producción el mismo servidor sirve la PWA. Así no hay una
 * variable de entorno con la URL del backend que alguien tenga que configurar
 * —ni equivocar— al instalar.
 */

export interface ErrorApi {
  codigo: string;
  mensaje: string;
  sugerencia?: string;
  detalles?: { campo: string; problema: string }[];
}

/**
 * Error con el mensaje YA redactado para la persona del mostrador. Las
 * pantallas lo muestran tal cual: el servidor es el único lugar donde se
 * decide cómo se explica un problema de negocio.
 */
export class FalloDeApi extends Error {
  constructor(
    readonly info: ErrorApi,
    readonly estado: number,
  ) {
    super(info.mensaje);
    this.name = "FalloDeApi";
  }

  get sugerencia() {
    return this.info.sugerencia;
  }
}

/** El servidor local no responde: está apagado o se cayó. */
export class ServidorCaido extends Error {
  constructor() {
    super("No hay conexión con el servidor del POS.");
    this.name = "ServidorCaido";
  }
}

async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`/api${ruta}`, {
      ...opciones,
      headers: {
        ...(opciones.body ? { "Content-Type": "application/json" } : {}),
        ...opciones.headers,
      },
    });
  } catch {
    // fetch solo rechaza por problemas de red. Con el servidor en la misma
    // máquina, eso significa que el servicio no está corriendo.
    throw new ServidorCaido();
  }

  if (respuesta.status === 204) return undefined as T;

  const cuerpo = await respuesta.json().catch(() => null);

  if (!respuesta.ok) {
    throw new FalloDeApi(
      cuerpo?.error ?? { codigo: "DESCONOCIDO", mensaje: `Error ${respuesta.status}` },
      respuesta.status,
    );
  }

  return cuerpo as T;
}

export const api = {
  get: <T>(ruta: string) => pedir<T>(ruta),
  post: <T>(ruta: string, cuerpo?: unknown) =>
    pedir<T>(ruta, { method: "POST", body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }),
  patch: <T>(ruta: string, cuerpo: unknown) =>
    pedir<T>(ruta, { method: "PATCH", body: JSON.stringify(cuerpo) }),
  put: <T>(ruta: string, cuerpo: unknown) =>
    pedir<T>(ruta, { method: "PUT", body: JSON.stringify(cuerpo) }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Formas de respuesta que usan las pantallas
// ─────────────────────────────────────────────────────────────────────────────

export interface Item {
  id: string;
  codigo: string;
  /** Marca comercial. Cadena vacía = sin marca (los servicios, casi siempre). */
  marca: string;
  nombre: string;
  /** "MARCA NOMBRE" ya armado por el servidor, para que todas las pantallas coincidan. */
  nombreCompleto: string;
  tipo: "SERVICIO" | "PRODUCTO";
  categoria: string;
  /** `null` = todavía sin precio de lista. Hay que escribirlo al cobrar. */
  precio: number | null;
  /** Costo promedio ponderado. `null` = no se sabe a cuánto se compra. */
  costo: number | null;
  stockMinimo: number;
  orden: number;
  activo: boolean;
  stock: number | null;
}

export interface LineaVenta {
  itemId: string;
  codigo: string;
  marca?: string;
  nombre: string;
  tipo: "SERVICIO" | "PRODUCTO";
  cantidad: number;
  precioUnitario: number;
  /** `null` = el ítem no tenía precio y se escribió al cobrar. */
  precioLista: number | null;
  /** Costo congelado al momento de vender. `null` = no se conocía. */
  costoUnitario?: number | null;
  barberoId: string | null;
  total: number;
}

export interface Pago {
  medio: "EFECTIVO" | "YAPE" | "TARJETA";
  monto: number;
  recibido?: number;
  vuelto?: number;
}

export interface Venta {
  id: string;
  correlativo: string;
  ts: string;
  lineas: LineaVenta[];
  subtotal: number;
  descuento: number;
  total: number;
  pagos: Pago[];
  clienteId: string | null;
  turnoId: string | null;
  notas?: string;
  anulada: boolean;
  motivoAnulacion?: string;
  anuladaEn?: string;
  reimpresiones: number;
}

export interface Cliente {
  id: string;
  nombre: string;
  telefono?: string;
  notas?: string;
  seriales: string[];
  visitas: number;
  totalGastado: number;
  primeraVisita?: string;
  ultimaVisita?: string;
}

export interface Barbero {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface Turno {
  id: string;
  abiertoEn: string;
  montoInicial: number;
  cerradoEn?: string;
  contadoEfectivo?: number;
  diferencia?: number;
  notas?: string;
}

export interface Arqueo {
  turnoId: string;
  abiertoEn: string;
  montoInicial: number;
  medios: { EFECTIVO: number; YAPE: number; TARJETA: number };
  totalVendido: number;
  cantidadVentas: number;
  efectivoEnCajon: number;
  ventasAnuladas: number;
  ventasFueraDeTurno: number;
  totalFueraDeTurno?: number;
  efectivoFueraDeTurno?: number;
}

export interface EstadoGeneral {
  negocio: { nombre: string; direccion: string; ciudad: string; ruc: string; pie: string };
  siguienteCorrelativo: string;
  turnoAbierto: Turno | null;
  exigirTurnoAbierto: boolean;
  alertasDeStock: number;
  impresora: { disponible: boolean; descripcion: string; detalle?: string };
}

export type RespuestaEscaneo =
  | { tipo: "venta"; venta: Venta }
  | { tipo: "item"; item: Item }
  | { tipo: "cliente"; cliente: Cliente; exacto: boolean }
  | { tipo: "clienteAmbiguo"; candidatos: Cliente[]; leido: string; mensaje: string }
  | {
      tipo: "nada";
      leido: string;
      mensaje: string;
      sugerencia?: string;
      esSerialDeTarjeta?: boolean;
    };

/** Lo que devuelve el servidor cada vez que intenta imprimir un ticket. */
export interface ResultadoImpresion {
  impreso: boolean;
  motivo?: string;
  vistaPrevia: string;
  /** No hay ticketera configurada: no es un error, no hay que alarmar. */
  sinImpresora?: boolean;
}

/** Ficha de un cliente con su historial. */
export interface FichaCliente {
  cliente: Cliente;
  ventas: Venta[];
  habituales: { nombre: string; veces: number }[];
}
