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

import type { FastifyInstance, FastifyRequest } from "fastify";

import { ACTOR_SISTEMA, SEDE_PRINCIPAL, type Actor } from "@cupula/contratos";

import { ErrorDeAutenticacion, ErrorDeAutorizacion, ErrorDeNegocio } from "../dominio/errores";
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
    /**
     * En qué sucursal opera esta petición.
     *
     * Para un CAJERO sale de SU CUENTA y nada puede cambiarla: ni un parámetro,
     * ni una cabecera. Es lo que hace imposible cobrar en el local equivocado
     * —por error o a propósito— desde el mostrador.
     *
     * Para un ADMIN sale de `?sede=`, porque administra toda la cadena. Si no
     * la manda y hay una sola sucursal, es esa: así el cliente de un solo local
     * sigue funcionando sin enterarse de que esto existe.
     */
    sede: string;
    /**
     * Qué sucursales MIRA esta petición. `null` = toda la cadena.
     *
     * Va aparte de `sede` porque leer y escribir no son lo mismo: una venta se
     * cobra en UN local concreto, pero el dueño de una cadena necesita poder
     * mirar los 22 juntos. Si fueran el mismo campo, "ver el consolidado"
     * obligaría a inventar una sucursal falsa en la que se podría cobrar.
     *
     * Solo un ADMIN puede obtener `null`: un cajero mira siempre su local.
     */
    sedeFiltro: string | null;
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
      peticion.sede = sesion ? resolverSede(pos, peticion, sesion) : SEDE_PRINCIPAL;
      peticion.sedeFiltro = peticion.sede;
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
    peticion.sede = resolverSede(pos, peticion, sesion);
    peticion.sedeFiltro = resolverFiltro(pos, peticion, sesion);
  });
}

/**
 * En qué sucursal opera esta petición. Ver la nota de `sede` arriba.
 *
 * La asimetría entre CAJERO y ADMIN es el punto entero de esta función: para el
 * cajero la sucursal es un hecho de su cuenta, para el administrador es una
 * elección. Si el cajero pudiera elegirla, "cada cajero ve solo su local"
 * dejaría de ser una regla y pasaría a ser una costumbre que se salta con un
 * parámetro en la URL.
 */
/** La constante que pide el consolidado de toda la cadena: `?sede=todas`. */
export const TODAS_LAS_SEDES = "todas";

/**
 * La sucursal en la que ESCRIBIR, exigiendo que haya una elegida.
 *
 * Mirando "todas las sucursales" no se puede cobrar, abrir caja ni mover
 * stock: no existe una respuesta correcta a "en cuál". Sin esta guarda, un
 * ADMIN con el consolidado en pantalla cobraría en la sucursal que el servidor
 * eligió de reserva, sin enterarse, y esa venta aparecería en el arqueo de un
 * local donde nadie la hizo. Es exactamente el tipo de error que no da señal
 * hasta que una caja no cuadra.
 */
export function sedeParaEscribir(peticion: FastifyRequest): string {
  if (peticion.sedeFiltro === null) {
    throw new ErrorDeNegocio(
      "SEDE_NO_ELEGIDA",
      "Estás viendo todas las sucursales y esta acción necesita una sola.",
      "Elige la sucursal en el selector de arriba y vuelve a intentarlo.",
    );
  }
  return peticion.sede;
}

function resolverFiltro(pos: Dependencias["pos"], peticion: FastifyRequest, sesion: Sesion): string | null {
  if (sesion.rol !== "ADMIN") return peticion.sede;

  const pedida = (peticion.query as { sede?: string } | undefined)?.sede;
  if (pedida === TODAS_LAS_SEDES) return null;
  if (pedida && pos.p.sedes.has(pedida)) return pedida;

  /**
   * Un ADMIN que no eligió nada está mirando LA CADENA, no un local al azar.
   *
   * Antes caía en la sucursal de su cuenta, y entonces el encabezado decía
   * "Principal" mientras la pantalla de inicio mostraba los siete locales:
   * dos contextos distintos a la vez, que es la forma más rápida de que
   * alguien lea un número creyendo que es de otra cosa.
   *
   * Con una sola sucursal esto no cambia nada: ahí "la cadena" y "el local"
   * son lo mismo, y conviene que sea concreta para poder cobrar sin elegir.
   */
  const activas = pos.p.sedesActivas();
  return activas.length > 1 ? null : peticion.sede;
}

function resolverSede(pos: Dependencias["pos"], peticion: FastifyRequest, sesion: Sesion): string {
  const usuario = pos.p.usuarios.get(sesion.usuarioId);

  if (sesion.rol !== "ADMIN") {
    return usuario?.sedeId ?? SEDE_PRINCIPAL;
  }

  const pedida = (peticion.query as { sede?: string } | undefined)?.sede;
  if (pedida && pedida !== TODAS_LAS_SEDES && pos.p.sedes.has(pedida)) return pedida;

  // Sin elegir: si hay una sola sucursal es esa, y el POS de un solo local
  // nunca tiene que mandar nada. Si hay varias, la del propio ADMIN.
  const activas = pos.p.sedesActivas();
  if (activas.length === 1) return activas[0]!.id;
  return usuario?.sedeId ?? SEDE_PRINCIPAL;
}
