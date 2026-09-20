/**
 * Barberos.
 *
 * SOLO ATRIBUCIÓN: se registra quién atendió cada línea y nada más. No hay
 * cálculo de comisiones porque en La Cúpula los barberos tienen sueldo fijo
 * (decisión D6 en ARQUITECTURA.md).
 *
 * Se guarda igual el dato porque no cuesta nada y sirve para saber cuánto
 * produce cada uno y qué servicios hace. Si algún día aparecen las comisiones,
 * el histórico ya está: arrancar a juntarlo recién ese día sería empezar de
 * cero.
 */

import type { EventoNuevo } from "@cupula/contratos";
import { ulid } from "ulid";

import { ErrorDeNegocio } from "../errores";
import type { Proyeccion } from "../../proyecciones/Proyeccion";

export function crearBarbero(p: Proyeccion, nombre: string): { eventos: EventoNuevo[]; barberoId: string } {
  const limpio = nombre.trim();
  if (!limpio) throw new ErrorDeNegocio("DATO_INVALIDO", "El barbero necesita un nombre.");

  const barberoId = ulid();
  return { barberoId, eventos: [{ tipo: "barbero.creado", datos: { barberoId, nombre: limpio } }] };
}

export function actualizarBarbero(p: Proyeccion, barberoId: string, nombre: string): EventoNuevo[] {
  if (!p.barberos.has(barberoId)) {
    throw new ErrorDeNegocio("BARBERO_NO_EXISTE", "Ese barbero no existe.");
  }
  return [{ tipo: "barbero.actualizado", datos: { barberoId, nombre: nombre.trim() } }];
}

/**
 * Vuelve a poner activo a un barbero desactivado.
 *
 * Reusa `barbero.creado` en vez de inventar un `barbero.reactivado`: el evento
 * ya existe, la proyección lo trata como alta, y agregar un tipo nuevo al
 * contrato haría que una versión anterior del POS no pudiera leer los datos.
 * El id se conserva, así que las ventas viejas siguen apuntando a la persona
 * correcta.
 */
export function reactivarBarbero(p: Proyeccion, barberoId: string): EventoNuevo[] {
  const b = p.barberos.get(barberoId);
  if (!b) throw new ErrorDeNegocio("BARBERO_NO_EXISTE", "Ese barbero no existe.");
  if (b.activo) return [];
  return [{ tipo: "barbero.creado", datos: { barberoId, nombre: b.nombre } }];
}

export function desactivarBarbero(p: Proyeccion, barberoId: string): EventoNuevo[] {
  const b = p.barberos.get(barberoId);
  if (!b) throw new ErrorDeNegocio("BARBERO_NO_EXISTE", "Ese barbero no existe.");
  if (!b.activo) return [];
  // Desactivar y no borrar: las ventas viejas siguen apuntando a su id y
  // tienen que poder mostrar el nombre de quien atendió.
  return [{ tipo: "barbero.desactivado", datos: { barberoId } }];
}
