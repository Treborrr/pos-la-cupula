/**
 * Alta y baja de cuentas de CAJERO, solo para ADMIN. Las cuentas de ADMIN no
 * se gestionan acá —se crean con `herramientas/crear-usuario.mts`, fuera de
 * la UI a propósito— pero sí aparecen en el listado, de solo lectura, para
 * que el dueño pueda ver que las dos existen.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { esquemaUsuarioHandle, type RolUsuario } from "@cupula/contratos";
import { ErrorDeNegocio } from "../../dominio/errores";
import {
  cambiarContrasena,
  cambiarSedeDeUsuario,
  crearUsuario,
  desactivarUsuario,
  reactivarUsuario,
} from "../../dominio/usuarios/usuarios";
import { hashearContrasena } from "../../seguridad/contrasenas";
import type { Dependencias } from "../app";

function paraPantalla(u: {
  id: string;
  usuario: string;
  nombre: string;
  rol: RolUsuario;
  sedeId: string;
  activo: boolean;
}) {
  // Nunca `hash`: ni por accidente llega al cliente.
  return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, sedeId: u.sedeId, activo: u.activo };
}

export async function rutasUsuarios(app: FastifyInstance, { pos, sesiones }: Dependencias) {
  function soloCajero(id: string) {
    const u = pos.p.usuarios.get(id);
    if (!u) throw new ErrorDeNegocio("USUARIO_NO_EXISTE", "Esa cuenta no existe.");
    if (u.rol !== "CAJERO") {
      throw new ErrorDeNegocio(
        "DATO_INVALIDO",
        "Las cuentas de administrador no se gestionan desde acá.",
        "Se crean y se cambian directo en el servidor.",
      );
    }
    return u;
  }

  app.get("/usuarios", { config: { rol: "ADMIN" } }, async () => {
    const usuarios = [...pos.p.usuarios.values()]
      .sort((a, b) => {
        if (a.rol !== b.rol) return a.rol === "ADMIN" ? -1 : 1;
        return a.nombre.localeCompare(b.nombre, "es");
      })
      .map(paraPantalla);
    return { usuarios };
  });

  app.post("/usuarios", { config: { rol: "ADMIN" } }, async (peticion, respuesta) => {
    const { usuario, nombre, contrasena, sedeId } = z
      .object({
        usuario: esquemaUsuarioHandle,
        nombre: z.string().trim().min(1).max(80),
        contrasena: z.string().min(8).max(200),
        /** En qué local trabaja. Sin indicar, la sucursal del ADMIN que lo crea. */
        sedeId: z.string().min(1).optional(),
      })
      .parse(peticion.body);

    const hash = await hashearContrasena(contrasena);
    const usuarioId = await pos.transaccion(() => {
      // El rol SIEMPRE es CAJERO acá — nunca llega del cuerpo del pedido.
      // Crear un ADMIN es, a propósito, un camino que no pasa por HTTP.
      const r = crearUsuario(pos.p, {
        usuario,
        nombre,
        rol: "CAJERO",
        hash,
        sedeId: sedeId ?? peticion.sede,
      });
      return { eventos: r.eventos, resultado: r.usuarioId };
    }, peticion.actor);

    return respuesta.status(201).send({ usuario: paraPantalla(pos.p.usuarios.get(usuarioId)!) });
  });

  /** Mueve un cajero a otro local. Sus ventas ya cobradas no se mueven. */
  app.post("/usuarios/:id/sede", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    const { sedeId } = z.object({ sedeId: z.string().min(1) }).parse(peticion.body);
    soloCajero(id);

    await pos.transaccion(
      () => ({ eventos: cambiarSedeDeUsuario(pos.p, id, sedeId), resultado: null }),
      peticion.actor,
    );

    /**
     * Se le cierran las sesiones abiertas.
     *
     * Si no, el cajero seguiría operando contra su local anterior hasta que la
     * cookie venza: la sucursal se resuelve en cada pedido desde su cuenta,
     * pero una sesión viva ya autenticada seguiría cobrando donde ya no está.
     */
    sesiones.invalidarPorUsuario(id);
    return { usuario: paraPantalla(pos.p.usuarios.get(id)!) };
  });

  app.post("/usuarios/:id/desactivar", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    soloCajero(id);

    await pos.transaccion(() => ({ eventos: desactivarUsuario(pos.p, id), resultado: null }), peticion.actor);
    // Corta la sesión YA — no espera a que expire sola a las 8h.
    sesiones.invalidarPorUsuario(id);

    return { usuario: paraPantalla(pos.p.usuarios.get(id)!) };
  });

  app.post("/usuarios/:id/reactivar", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    soloCajero(id);

    await pos.transaccion(() => ({ eventos: reactivarUsuario(pos.p, id), resultado: null }), peticion.actor);
    return { usuario: paraPantalla(pos.p.usuarios.get(id)!) };
  });

  /** El admin le resetea la contraseña a un cajero (perdió la suya, por ejemplo). */
  app.post("/usuarios/:id/contrasena", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { id } = z.object({ id: z.string() }).parse(peticion.params);
    const { contrasenaNueva } = z.object({ contrasenaNueva: z.string().min(8).max(200) }).parse(peticion.body);
    soloCajero(id);

    const hash = await hashearContrasena(contrasenaNueva);
    await pos.transaccion(() => ({ eventos: cambiarContrasena(pos.p, id, hash), resultado: null }), peticion.actor);
    sesiones.invalidarPorUsuario(id);

    return { ok: true };
  });
}
