/**
 * Login, logout, "quién soy" y cambio de contraseña propio.
 *
 * El rol sale de la CUENTA, nunca de qué pantalla usó la persona para
 * loguearse: la PWA tiene dos pantallas (mostrador y admin) por comodidad,
 * pero las dos mandan acá mismo.
 *
 * Un fallo de login da SIEMPRE el mismo mensaje genérico, sea porque el
 * usuario no existe, la contraseña está mal, o —si es cajero— la red no es
 * la permitida. Distinguirlos le regalaría a quien prueba desde afuera del
 * local la información de "la contraseña era correcta, solo falló la red".
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { cambiarContrasena } from "../../dominio/usuarios/usuarios";
import { ErrorDeAutenticacion, ErrorDeNegocio } from "../../dominio/errores";
import { hashearContrasena, verificarContrasena } from "../../seguridad/contrasenas";
import { estaPermitida } from "../../seguridad/redIp";
import { NOMBRE_COOKIE_SESION } from "../autorizacion";
import type { Dependencias } from "../app";

const OCHO_HORAS_SEGUNDOS = 8 * 60 * 60;

export async function rutasAuth(app: FastifyInstance, { pos, sesiones, intentosDeLogin }: Dependencias) {
  app.post(
    "/auth/login",
    {
      config: {
        rol: "PUBLICO",
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          errorResponseBuilder: () => ({
            error: {
              codigo: "CREDENCIALES_INVALIDAS",
              mensaje: "Demasiados intentos. Espera un minuto y vuelve a probar.",
            },
          }),
        },
      },
    },
    async (peticion, respuesta) => {
      const { usuario, contrasena } = z
        .object({ usuario: z.string().trim().min(1).max(32), contrasena: z.string().min(1).max(200) })
        .parse(peticion.body);

      const handle = usuario.toLowerCase();
      const rechazar = (): never => {
        intentosDeLogin.registrarFallo(handle);
        throw new ErrorDeAutenticacion("CREDENCIALES_INVALIDAS", "Usuario o contraseña incorrectos.");
      };

      if (intentosDeLogin.estaBloqueado(handle)) {
        throw new ErrorDeAutenticacion(
          "CREDENCIALES_INVALIDAS",
          "Demasiados intentos fallidos. Espera unos minutos y vuelve a probar.",
        );
      }

      const usuarioId = pos.p.porNombreDeUsuario.get(handle);
      const u = usuarioId ? pos.p.usuarios.get(usuarioId) : undefined;
      if (!u) return rechazar();

      const ok = await verificarContrasena(contrasena, u.hash);
      if (!ok) return rechazar();

      if (u.rol === "CAJERO") {
        const redesPermitidas = pos.config<string>("seguridad.redesCajero");
        if (!estaPermitida(peticion.ip, redesPermitidas)) return rechazar();
      }

      intentosDeLogin.registrarExito(handle);
      const token = sesiones.crear({
        usuarioId: u.id,
        usuario: u.usuario,
        nombre: u.nombre,
        rol: u.rol,
        // La sucursal de su CUENTA. El límite de "un cajero a la vez" se
        // aplica por local, así que la sesión tiene que saber en cuál está.
        sedeId: u.sedeId,
        ip: peticion.ip,
      });

      respuesta.setCookie(NOMBRE_COOKIE_SESION, token, {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        // Detrás del proxy de Railway, `protocol` lee `X-Forwarded-Proto`
        // gracias a `trustProxy`. En local (http) la cookie no lleva
        // `Secure` — si lo llevara, el navegador la descartaría en desarrollo.
        secure: peticion.protocol === "https",
      });

      return { usuario: { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol } };
    },
  );

  app.post("/auth/logout", { config: { rol: "PUBLICO" } }, async (peticion, respuesta) => {
    const token = peticion.cookies[NOMBRE_COOKIE_SESION];
    if (token) sesiones.destruir(token);
    respuesta.clearCookie(NOMBRE_COOKIE_SESION, { path: "/" });
    return { ok: true };
  });

  /** La sonda que usa la PWA al arrancar para decidir qué pantalla mostrar. SIEMPRE 200. */
  app.get("/auth/yo", { config: { rol: "PUBLICO" } }, async (peticion) => {
    const s = peticion.sesion;
    if (!s) return { usuario: null };
    return { usuario: { id: s.usuarioId, usuario: s.usuario, nombre: s.nombre, rol: s.rol } };
  });

  /** Autoservicio: opera SIEMPRE sobre la cuenta de la sesión actual — nunca acepta un id del cuerpo. */
  app.post("/auth/contrasena", { config: { rol: "CAJERO" } }, async (peticion) => {
    const { contrasenaActual, contrasenaNueva } = z
      .object({ contrasenaActual: z.string().min(1).max(200), contrasenaNueva: z.string().min(8).max(200) })
      .parse(peticion.body);

    const s = peticion.sesion!; // el tag CAJERO ya garantiza que hay sesión
    const u = pos.p.usuarios.get(s.usuarioId)!;

    const ok = await verificarContrasena(contrasenaActual, u.hash);
    if (!ok) throw new ErrorDeNegocio("CONTRASENA_ACTUAL_INCORRECTA", "La contraseña actual no es correcta.");

    const hash = await hashearContrasena(contrasenaNueva);
    await pos.transaccion(() => ({ eventos: cambiarContrasena(pos.p, s.usuarioId, hash), resultado: null }), peticion.actor);

    return { ok: true };
  });
}
