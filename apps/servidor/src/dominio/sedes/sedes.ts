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

/** Primera posición letra, el resto letras o números. Ver `esquemaCorrelativo`. */
const FORMATO_PREFIJO = /^[A-Z][A-Z0-9]{1,3}$/;

/** ¿Alguna sucursal ya emite tickets con este prefijo? */
function prefijoTomado(p: Proyeccion, prefijo: string, exceptoSedeId?: string): boolean {
  for (const s of p.sedes.values()) {
    if (s.id !== exceptoSedeId && s.prefijoTicket === prefijo) return true;
  }
  return false;
}

/**
 * Un prefijo de ticket LIBRE, propuesto a partir del nombre del local.
 *
 * Con veinte sucursales, pedirle al dueño que invente veinte códigos de dos a
 * cuatro letras que además no se repitan es trabajo manual puro: lo intenta,
 * el sistema le rechaza el repetido, prueba otro. La máquina puede responder
 * eso sola, y la propuesta sigue siendo editable por si prefiere la suya.
 *
 * El orden de los intentos va de lo más legible a lo que simplemente funciona:
 * primero las iniciales de las palabras ("Bagua Grande" → BG), después las
 * primeras letras ("Jaen" → JA, JAE, JAEN), y recién si todo eso está tomado,
 * la letra inicial con un número ("B2", "B3"). Un prefijo que se entiende
 * leyendo el ticket vale más que uno correlativo.
 */
export function prefijoSugerido(p: Proyeccion, nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .trim();

  const palabras = limpio.split(/\s+/).filter(Boolean);
  const candidatos: string[] = [];

  // Iniciales: "Bagua Grande" → BG; "San Juan de Lurigancho" → SJDL.
  if (palabras.length >= 2) {
    candidatos.push(palabras.map((w) => w[0]).join("").slice(0, 4));
  }
  // Primeras letras de la primera palabra: JA, JAE, JAEN.
  const primera = palabras[0] ?? "";
  for (const largo of [2, 3, 4]) {
    if (primera.length >= largo) candidatos.push(primera.slice(0, largo));
  }
  // Inicial + número, que siempre alcanza.
  const inicial = primera[0] ?? "S";
  for (let i = 2; i <= 99; i++) candidatos.push(`${inicial}${i}`);

  for (const c of candidatos) {
    if (FORMATO_PREFIJO.test(c) && !prefijoTomado(p, c)) return c;
  }
  return "";
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
  if (!prefijo || !FORMATO_PREFIJO.test(prefijo)) {
    throw new ErrorDeNegocio(
      "DATO_INVALIDO",
      "El prefijo empieza con una letra y sigue con letras o números, de 2 a 4 caracteres.",
      'Por ejemplo "BG" para Bagua Grande, o "S02" para la segunda sucursal.',
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
    if (!FORMATO_PREFIJO.test(prefijo)) {
      throw new ErrorDeNegocio(
        "DATO_INVALIDO",
        "El prefijo empieza con una letra y sigue con letras o números, de 2 a 4 caracteres.",
      );
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
