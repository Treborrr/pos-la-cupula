/**
 * Las sucursales.
 *
 * Qué es de la sucursal y qué es de la cadena está documentado en `sede.creada`
 * (contratos/eventos.ts). Acá viven las reglas que no se pueden romper:
 * el slug es único y estable, el prefijo del ticket es único y se congela en
 * cuanto la sucursal vende, y la última sucursal activa no se puede desactivar.
 */

import { SEDE_PRINCIPAL, type EventoNuevo } from "@cupula/contratos";

import { ErrorDeNegocio } from "../errores";
import type { Proyeccion } from "../../proyecciones/Proyeccion";

/**
 * Convierte un nombre en slug: "Bagua Centro" → "bagua-centro".
 *
 * El id es estable y NO se regenera cuando cambia el nombre: todo el histórico
 * de ventas, stock y caja apunta a él. Renombrar la sucursal en la pantalla no
 * puede reescribir el log.
 */
export function slugDeSede(nombre: string): string {
  const base = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return base || "sede";
}

/** Un slug libre, agregándole un número si el natural ya está tomado. */
function slugLibre(p: Proyeccion, nombre: string): string {
  const base = slugDeSede(nombre);
  if (!p.sedes.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const intento = `${base.slice(0, 29)}-${i}`;
    if (!p.sedes.has(intento)) return intento;
  }
  throw new ErrorDeNegocio("DATO_INVALIDO", "Demasiadas sucursales con nombres parecidos.");
}

/** ¿Alguna sucursal ya emite tickets con este prefijo? */
function prefijoTomado(p: Proyeccion, prefijo: string, exceptoSedeId?: string): boolean {
  for (const s of p.sedes.values()) {
    if (s.id !== exceptoSedeId && s.prefijoTicket === prefijo) return true;
  }
  return false;
}

export function crearSede(
  p: Proyeccion,
  datos: { nombre: string; direccion?: string; ciudad?: string; pie?: string; prefijoTicket: string },
): { eventos: EventoNuevo[]; sedeId: string } {
  const nombre = datos.nombre?.trim();
  if (!nombre) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "La sucursal necesita un nombre.");
  }
  for (const s of p.sedes.values()) {
    if (s.nombre.toLowerCase() === nombre.toLowerCase()) {
      throw new ErrorDeNegocio(
        "SEDE_DUPLICADA",
        `Ya existe una sucursal llamada "${s.nombre}".`,
        "Usa un nombre que las distinga: la ciudad o el barrio.",
      );
    }
  }

  const prefijo = datos.prefijoTicket?.trim().toUpperCase();
  if (!prefijo || !/^[A-Z]{2,4}$/.test(prefijo)) {
    throw new ErrorDeNegocio(
      "DATO_INVALIDO",
      "El prefijo del ticket va en mayúsculas, de 2 a 4 letras.",
      'Por ejemplo "SC" para Sucursal Centro.',
    );
  }

  /**
   * El prefijo tiene que ser único en toda la cadena.
   *
   * Si dos sucursales emitieran `NV000031`, habría dos tickets distintos con el
   * mismo número: el correlativo dejaría de identificar una venta, que es lo
   * único para lo que sirve. El dueño lo descubriría recién cuando un cliente
   * reclame con un ticket y aparezcan dos ventas.
   */
  if (prefijoTomado(p, prefijo)) {
    throw new ErrorDeNegocio(
      "PREFIJO_DUPLICADO",
      `Otra sucursal ya emite tickets con el prefijo "${prefijo}".`,
      "Cada sucursal necesita el suyo para que dos tickets nunca tengan el mismo número.",
    );
  }

  const sedeId = slugLibre(p, nombre);
  return {
    sedeId,
    eventos: [
      {
        tipo: "sede.creada",
        datos: {
          sedeId,
          nombre,
          direccion: datos.direccion?.trim() || undefined,
          ciudad: datos.ciudad?.trim() || undefined,
          pie: datos.pie?.trim() || undefined,
          prefijoTicket: prefijo,
        },
      },
    ],
  };
}

export function actualizarSede(
  p: Proyeccion,
  sedeId: string,
  datos: { nombre?: string; direccion?: string; ciudad?: string; pie?: string; prefijoTicket?: string },
): EventoNuevo[] {
  const sede = p.sedes.get(sedeId);
  if (!sede) throw new ErrorDeNegocio("SEDE_NO_EXISTE", "Esa sucursal no existe.");

  let prefijo: string | undefined;
  if (datos.prefijoTicket !== undefined) {
    prefijo = datos.prefijoTicket.trim().toUpperCase();
    if (!/^[A-Z]{2,4}$/.test(prefijo)) {
      throw new ErrorDeNegocio("DATO_INVALIDO", "El prefijo del ticket va en mayúsculas, de 2 a 4 letras.");
    }
    if (prefijo !== sede.prefijoTicket) {
      /**
       * El prefijo se congela en cuanto la sucursal emitió su primer ticket.
       *
       * Cambiarlo después partiría su numeración en dos series (`NV000001` a
       * `NV000030` y después `SC000031`), y eso un contador no lo puede
       * explicar: parece que faltan ventas o que hay dos talonarios.
       */
      if ((p.ultimoCorrelativoPorSede.get(sedeId) ?? 0) > 0) {
        throw new ErrorDeNegocio(
          "PREFIJO_CONGELADO",
          `"${sede.nombre}" ya emitió tickets con el prefijo "${sede.prefijoTicket}" y no se puede cambiar.`,
          "Cambiarlo partiría su numeración en dos series y el histórico dejaría de leerse.",
        );
      }
      if (prefijoTomado(p, prefijo, sedeId)) {
        throw new ErrorDeNegocio(
          "PREFIJO_DUPLICADO",
          `Otra sucursal ya emite tickets con el prefijo "${prefijo}".`,
        );
      }
    }
  }

  if (datos.nombre !== undefined && !datos.nombre.trim()) {
    throw new ErrorDeNegocio("DATO_INVALIDO", "La sucursal necesita un nombre.");
  }

  return [
    {
      tipo: "sede.actualizada",
      datos: {
        sedeId,
        nombre: datos.nombre?.trim(),
        direccion: datos.direccion?.trim(),
        ciudad: datos.ciudad?.trim(),
        pie: datos.pie?.trim(),
        prefijoTicket: prefijo,
      },
    },
  ];
}

export function desactivarSede(p: Proyeccion, sedeId: string, motivo?: string): EventoNuevo[] {
  const sede = p.sedes.get(sedeId);
  if (!sede) throw new ErrorDeNegocio("SEDE_NO_EXISTE", "Esa sucursal no existe.");
  if (!sede.activa) return [];

  /**
   * Nunca se queda el sistema sin ninguna sucursal activa: no habría dónde
   * cobrar, y la pantalla de venta quedaría sin destino posible.
   */
  if (p.sedesActivas().length <= 1) {
    throw new ErrorDeNegocio(
      "ULTIMA_SEDE",
      "Es la única sucursal activa y no se puede desactivar.",
      "Crea otra sucursal antes de desactivar esta.",
    );
  }

  /**
   * Con la caja abierta no: el turno quedaría abierto para siempre, sin nadie
   * que pueda entrar a cerrarlo, y su arqueo nunca cuadraría.
   */
  if (p.turnoAbiertoDe(sedeId)) {
    throw new ErrorDeNegocio(
      "TURNO_ABIERTO",
      `"${sede.nombre}" tiene la caja abierta.`,
      "Cierra el turno antes de desactivar la sucursal.",
    );
  }

  return [{ tipo: "sede.desactivada", datos: { sedeId, motivo: motivo?.trim() || undefined } }];
}

export function reactivarSede(p: Proyeccion, sedeId: string): EventoNuevo[] {
  const sede = p.sedes.get(sedeId);
  if (!sede) throw new ErrorDeNegocio("SEDE_NO_EXISTE", "Esa sucursal no existe.");
  if (sede.activa) return [];
  return [{ tipo: "sede.reactivada", datos: { sedeId } }];
}

/**
 * El evento que siembra la sucursal principal a partir de la configuración
 * `negocio.*` que ya existía cuando había un solo local.
 *
 * Lo escribe el arranque una sola vez, si el log no trae ninguna sucursal. Así
 * el cliente actual no tiene que crear nada a mano: abre el POS y su local ya
 * está, con su dirección y su serie `NV` intactas.
 */
export function sembrarSedePrincipal(config: {
  nombre: string;
  direccion: string;
  ciudad: string;
  pie: string;
}): EventoNuevo {
  return {
    tipo: "sede.creada",
    datos: {
      sedeId: SEDE_PRINCIPAL,
      nombre: config.nombre?.trim() || "Principal",
      direccion: config.direccion?.trim() || undefined,
      ciudad: config.ciudad?.trim() || undefined,
      pie: config.pie?.trim() || undefined,
      prefijoTicket: "NV",
    },
  };
}
