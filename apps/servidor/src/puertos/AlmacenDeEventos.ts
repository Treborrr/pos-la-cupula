/**
 * El puerto que sostiene toda la promesa de migración.
 *
 * El dominio habla con ESTA interfaz. No sabe si detrás hay archivos JSONL en
 * `C:\POSCupula\datos`, una tabla de Postgres en Neon o un arreglo en memoria
 * durante los tests. Esa ignorancia es lo que convierte "migrar a la nube" en
 * escribir un adaptador nuevo contra una batería de tests que ya existe, en
 * vez de reescribir el sistema.
 *
 * La regla que lo protege: ningún archivo bajo `src/dominio/` puede importar
 * `fs`. Lo verifica `herramientas/verificar-capas.mjs` en cada build.
 */

import type { Evento, EventoNuevo } from "@cupula/contratos";

/** Resultado de verificar la integridad del log de punta a punta. */
export interface Integridad {
  ok: boolean;
  eventos: number;
  ultimaSeq: number;
  /** Huecos en la secuencia: `seq` que deberían existir y no están. */
  huecos: number[];
  /** Eventos cuya cadena de hash no valida: alguien editó el archivo. */
  hashRotos: number[];
  /** Líneas que no parsean, movidas a `cuarentena/` al arrancar. */
  enCuarentena: number;
}

export interface FiltroLectura {
  desdeSeq?: number;
  hastaSeq?: number;
  tipos?: Evento["tipo"][];
}

export interface AlmacenDeEventos {
  /**
   * Escribe uno o más eventos como UNA unidad y no responde hasta que están
   * físicamente en disco (`fsync`).
   *
   * El lote importa: registrar una venta que descuenta stock son varios
   * eventos que tienen que quedar todos o ninguno. Escribirlos de a uno
   * dejaría, ante un corte de luz, una venta sin su descuento de inventario.
   *
   * Devuelve los eventos ya sellados (con `seq`, `id`, `ts` y `h`).
   */
  agregar(eventos: EventoNuevo[]): Promise<Evento[]>;

  /** Recorre el log en orden. Es un generador: nunca carga todo en memoria. */
  leer(filtro?: FiltroLectura): AsyncIterable<Evento>;

  /** Último `seq` escrito. 0 si el log está vacío. */
  ultimaSeq(): number;

  /** Recorre el log completo revisando secuencia y cadena de hash. */
  verificar(): Promise<Integridad>;

  /** Guarda el estado reconstruido para que el arranque no crezca sin techo. */
  guardarInstantanea(seq: number, estado: unknown): Promise<void>;

  /** La instantánea más reciente, o null si no hay ninguna. */
  cargarInstantanea(): Promise<{ seq: number; estado: unknown } | null>;

  cerrar(): Promise<void>;
}
