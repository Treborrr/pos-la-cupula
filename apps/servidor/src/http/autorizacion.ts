/**
 * Un solo lugar decide quién puede llegar a cada ruta.
 *
 * Cada ruta trae un tag explícito (`{config:{rol:"PUBLICO"|"CAJERO"|"ADMIN"}}`
 * en su registro). SIN TAG el default es ADMIN — fail-closed a propósito:
 * una ruta que alguien se olvide de etiquetar queda MÁS restringida, nunca
 * más abierta. `herramientas/verificar-actor.mjs` cubre el otro lado de esta
 * misma idea (que nadie se olvide de pasar `actor` al escribir).
 *
 * Este hook se registra DENTRO del bloque `{prefix:"/api"}` de `app.ts`,
 * nunca en el `app` de nivel superior: si quedara afuera, el default
 * "sin tag = ADMIN" también taparía los archivos estáticos de la PWA —JS,
 * CSS, `index.html`— y nadie podría ver ni siquiera la pantalla de login.
 */

import type { FastifyInstance } from "fastify";

import { ACTOR_SISTEMA, type Actor } from "@cupula/contratos";

import { ErrorDeAutenticacion, ErrorDeAutorizacion } from "../dominio/errores";
import { estaPermitida } from "../seguridad/redIp";
import type { Sesion } from "../servicios/Sesiones";
import type { Dependencias } from "./app";

export type RolRuta = "PUBLICO" | "CAJERO" | "ADMIN";

export const NOMBRE_COOKIE_SESION = "pos_sesion";

declare module "fastify" {
  interface FastifyContextConfig {
    rol?: RolRuta;
  }
  interface FastifyRequest {
    /** `null` en rutas PUBLICO sin cookie de sesión (o con una vencida). */
    sesion: Sesion | null;
    /** Quién queda como autor de los eventos que esta petición escriba. */
    actor: Actor;
  }
}

export function registrarAutorizacion(api: FastifyInstance, { pos, sesiones }: Dependencias): void {
  api.addHook("onRequest", async (peticion) => {
    const rolRuta: RolRuta = peticion.routeOptions.config.rol ?? "ADMIN";

    const token = peticion.cookies[NOMBRE_COOKIE_SESION];
    const sesion = token ? sesiones.obtener(token) : null;

    if (rolRuta === "PUBLICO") {
      // Igual se decora si hay sesión: `/auth/yo` la necesita para decir
      // quién está logueado, y cualquier escritura incidental de una ruta
      // pública (no hay ninguna hoy, pero por si acaso) queda bien atribuida.
      peticion.sesion = sesion;
      peticion.actor = sesion ? { tipo: "operador", id: sesion.usuarioId } : ACTOR_SISTEMA;
      return;
    }

    if (!sesion) {
      throw new ErrorDeAutenticacion("NO_AUTENTICADO", "Hace falta iniciar sesión.");
    }

    // Para CAJERO se revisa la red en CADA pedido, no solo al loguearse —
    // corta el reuso de una cookie robada fuera de la red del local. No se
    // destruye la sesión: puede ser un corte momentáneo de la red correcta,
    // y expulsar de una echaría a alguien por un segundo de mala señal.
    if (sesion.rol === "CAJERO") {
      const redesPermitidas = pos.config<string>("seguridad.redesCajero");
      if (!estaPermitida(peticion.ip, redesPermitidas)) {
        throw new ErrorDeAutenticacion("NO_AUTENTICADO", "Hace falta iniciar sesión.");
      }
    }

    if (rolRuta === "ADMIN" && sesion.rol !== "ADMIN") {
      throw new ErrorDeAutorizacion("Esta cuenta no tiene permiso para esto.");
    }

    peticion.sesion = sesion;
    peticion.actor = { tipo: "operador", id: sesion.usuarioId };
  });
}
