/**
 * "Mi cuenta": el ADMIN actualiza su propio nombre, correo, teléfono y/o
 * contraseña — todo en un solo formulario, y nada se aplica hasta confirmar
 * el código que llega por correo. Nunca acepta un `usuarioId` del cuerpo:
 * opera siempre sobre la cuenta de la sesión actual, igual que
 * `/auth/contrasena`.
 *
 * A propósito NO es para CAJERO: el pedido fue específicamente "el dueño del
 * negocio", y las cuentas de cajero no tienen correo donde mandar nada.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { actualizarDatosDeUsuario, cambiarContrasena } from "../../dominio/usuarios/usuarios";
import { ErrorDeNegocio } from "../../dominio/errores";
import { hashearContrasena } from "../../seguridad/contrasenas";
import type { Dependencias } from "../app";

const esquemaSolicitud = z
  .object({
    nombre: z.string().trim().min(1).max(80).optional(),
    correo: z.string().trim().toLowerCase().email().max(160).optional(),
    telefono: z.string().trim().max(20).optional(),
    contrasenaNueva: z.string().min(8).max(200).optional(),
  })
  .refine((d) => d.nombre !== undefined || d.correo !== undefined || d.telefono !== undefined || d.contrasenaNueva !== undefined, {
    message: "No hay nada para cambiar.",
  });

const ETIQUETAS: Record<string, string> = {
  nombre: "Nombre",
  correo: "Correo",
  telefono: "Teléfono",
  contrasenaNueva: "Contraseña",
};

export async function rutasMiCuenta(
  app: FastifyInstance,
  { pos, notificaciones, verificacionDeCuenta, sesiones }: Dependencias,
) {
  app.get("/mi-cuenta", { config: { rol: "ADMIN" } }, async (peticion) => {
    const u = pos.p.usuarios.get(peticion.sesion!.usuarioId)!;
    return { usuario: { id: u.id, usuario: u.usuario, nombre: u.nombre, correo: u.correo, telefono: u.telefono } };
  });

  app.post(
    "/mi-cuenta/solicitar-cambio",
    {
      config: {
        rol: "ADMIN",
        rateLimit: {
          max: 5,
          timeWindow: "1 hour",
          errorResponseBuilder: () => ({
            error: { codigo: "DEMASIADOS_PEDIDOS", mensaje: "Ya pediste varios códigos. Espera un poco y vuelve a probar." },
          }),
        },
      },
    },
    async (peticion) => {
      const datos = esquemaSolicitud.parse(peticion.body);
      const u = pos.p.usuarios.get(peticion.sesion!.usuarioId)!;

      // El código SIEMPRE va al correo YA registrado, aunque este mismo
      // pedido quiera cambiarlo — así una sesión robada no puede adueñarse
      // de la cuenta mandando el código a un correo propio. Solo si todavía
      // no hay ninguno registrado (las cuentas de hoy no traen uno) el
      // código puede ir al correo nuevo que se está dando de alta.
      const destinatario = u.correo ?? datos.correo;
      if (!destinatario) {
        throw new ErrorDeNegocio(
          "SIN_CORREO",
          "Esta cuenta todavía no tiene un correo registrado.",
          "Incluye un correo en este mismo pedido para poder confirmarlo.",
        );
      }

      const hashNuevo = datos.contrasenaNueva ? await hashearContrasena(datos.contrasenaNueva) : undefined;
      const codigo = verificacionDeCuenta.solicitar(u.id, destinatario, {
        nombre: datos.nombre,
        correo: datos.correo,
        telefono: datos.telefono,
        hashNuevo,
      });

      const campos = Object.keys(datos)
        .filter((k) => k in ETIQUETAS)
        .map((k) => ETIQUETAS[k]);
      const resultado = await notificaciones.enviarCodigoDeVerificacion(destinatario, codigo, campos);

      return { enviado: resultado.ok, detalle: resultado.detalle };
    },
  );

  app.post("/mi-cuenta/confirmar-cambio", { config: { rol: "ADMIN" } }, async (peticion) => {
    const { codigo } = z.object({ codigo: z.string().trim().length(6) }).parse(peticion.body);
    const usuarioId = peticion.sesion!.usuarioId;

    const cambios = verificacionDeCuenta.confirmar(usuarioId, codigo);
    if (!cambios) {
      throw new ErrorDeNegocio("CODIGO_INVALIDO", "El código no es correcto o ya venció.", "Pide uno nuevo.");
    }

    const hayCambioDeDatos = cambios.nombre !== undefined || cambios.correo !== undefined || cambios.telefono !== undefined;
    const eventos = [
      ...(hayCambioDeDatos
        ? actualizarDatosDeUsuario(pos.p, usuarioId, {
            nombre: cambios.nombre,
            correo: cambios.correo,
            telefono: cambios.telefono,
          })
        : []),
      ...(cambios.hashNuevo ? cambiarContrasena(pos.p, usuarioId, cambios.hashNuevo) : []),
    ];

    await pos.transaccion(() => ({ eventos, resultado: null }), peticion.actor);

    // Un cambio de contraseña fuerza a loguearse de nuevo en todos lados,
    // incluida esta misma sesión — mismo criterio que cuando un admin le
    // resetea la contraseña a un cajero.
    if (cambios.hashNuevo) sesiones.invalidarPorUsuario(usuarioId);

    const u = pos.p.usuarios.get(usuarioId)!;
    return {
      usuario: { id: u.id, usuario: u.usuario, nombre: u.nombre, correo: u.correo, telefono: u.telefono },
      contrasenaCambiada: Boolean(cambios.hashNuevo),
    };
  });
}
