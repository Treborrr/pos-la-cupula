import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ulid } from "ulid";
import type { FastifyInstance } from "fastify";
import type { InjectOptions } from "light-my-request";

import type { EventoNuevo } from "@cupula/contratos";
import { AlmacenArchivoJsonl } from "../src/adaptadores/almacen/ArchivoJsonl";
import { relojFijo, type Reloj } from "../src/puertos/Reloj";
import type { EnviadorDeCorreo } from "../src/puertos/EnviadorDeCorreo";
import type { Alerta } from "../src/consultas/alertas";
import type { ServicioPos } from "../src/servicios/Pos";
import { ServicioDeNotificaciones } from "../src/servicios/Notificaciones";
import { ServicioDeSesiones } from "../src/servicios/Sesiones";
import { ServicioDeIntentosDeLogin } from "../src/servicios/IntentosDeLogin";
import { ServicioDeVerificacionDeCuenta } from "../src/servicios/VerificacionDeCuenta";
import { crearUsuario } from "../src/dominio/usuarios/usuarios";
import { hashearContrasena } from "../src/seguridad/contrasenas";
import { NOMBRE_COOKIE_SESION } from "../src/http/autorizacion";

/** Dependencias de seguridad listas para `construirApp`, para no repetirlas en cada prueba. */
export function dependenciasDeSeguridadDePrueba(reloj: Reloj = relojFijo()) {
  return {
    sesiones: new ServicioDeSesiones(reloj),
    intentosDeLogin: new ServicioDeIntentosDeLogin(reloj),
    verificacionDeCuenta: new ServicioDeVerificacionDeCuenta(reloj),
    enNube: false,
  };
}

const USUARIO_ADMIN_DE_PRUEBA = "admin-prueba";
const CONTRASENA_ADMIN_DE_PRUEBA = "una-clave-de-prueba-bien-larga";

/**
 * Crea un ADMIN y loguea — pero en vez de devolver la cookie para que cada
 * prueba se acuerde de mandarla, parcha `app.inject` para que la mande SOLA
 * de ahí en más. Es lo que permite que las pruebas de negocio que ya
 * existían (cientos de `app.inject(...)`) seguir funcionando sin tocarlas:
 * lo que prueban es la regla de negocio, no el login.
 *
 * Las pruebas que SÍ son sobre autenticación/autorización
 * (`autenticacion.prueba.ts`) usan `app.inject` crudo, sin este parche.
 */
export async function conSesionAdmin(app: FastifyInstance, pos: ServicioPos): Promise<void> {
  const hash = await hashearContrasena(CONTRASENA_ADMIN_DE_PRUEBA);
  await pos.transaccion(() => {
    const r = crearUsuario(pos.p, {
      usuario: USUARIO_ADMIN_DE_PRUEBA,
      nombre: "Admin de prueba",
      rol: "ADMIN",
      hash,
    });
    return { eventos: r.eventos, resultado: r.usuarioId };
  });

  const resp = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { usuario: USUARIO_ADMIN_DE_PRUEBA, contrasena: CONTRASENA_ADMIN_DE_PRUEBA },
  });
  const crudo = resp.headers["set-cookie"];
  const texto = Array.isArray(crudo) ? crudo[0] : crudo;
  const coincidencia = texto ? new RegExp(`${NOMBRE_COOKIE_SESION}=([^;]+)`).exec(texto) : null;
  if (!coincidencia) {
    throw new Error(`No se pudo loguear el admin de prueba (login respondió ${resp.statusCode}): ${resp.body}`);
  }
  const cookie = `${NOMBRE_COOKIE_SESION}=${coincidencia[1]}`;

  const inyectarOriginal = app.inject.bind(app);
  app.inject = ((opciones: InjectOptions | string) => {
    const base: InjectOptions = typeof opciones === "string" ? { url: opciones } : opciones;
    return inyectarOriginal({ ...base, headers: { cookie, ...base.headers } });
  }) as typeof app.inject;
}

/** Carpeta temporal propia para cada prueba, borrada al terminar. */
export async function carpetaTemporal(prefijo = "pos-cupula-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefijo));
}

export async function borrar(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

export { relojFijo };

export async function abrirAlmacen(
  dir: string,
  opciones: { reloj?: ReturnType<typeof relojFijo>; sinBloqueo?: boolean } = {},
): Promise<AlmacenArchivoJsonl> {
  return AlmacenArchivoJsonl.abrir({
    directorio: dir,
    reloj: opciones.reloj,
    sinBloqueo: opciones.sinBloqueo ?? true,
  });
}

/** Un `item.creado` válido, para no repetir el payload en cada prueba. */
export function itemNuevo(codigo = "COR", nombre = "CORTE CLASICO", precio = 2000): EventoNuevo {
  return {
    tipo: "item.creado",
    datos: {
      itemId: ulid(),
      codigo,
      nombre,
      tipo: "SERVICIO",
      categoria: "Barbería",
      precio,
    },
  };
}

export function rutaMes(dir: string, mes: string): string {
  return path.join(dir, "eventos", `${mes}.jsonl`);
}

/**
 * Doble de prueba de `EnviadorDeCorreo`: no toca la red, guarda cada intento
 * en `enviados` para que la prueba pueda revisar qué se habría mandado, y
 * puede simular una falla con `fallarSiempre`.
 */
export function enviadorDeCorreoFalso(): EnviadorDeCorreo & {
  enviados: { to: string[]; subject: string; html: string }[];
  fallarSiempre: boolean;
} {
  return {
    enviados: [],
    fallarSiempre: false,
    async enviar(datos) {
      this.enviados.push(datos);
      if (this.fallarSiempre) return { ok: false, detalle: "falla simulada" };
      return { ok: true };
    },
  };
}

/**
 * `ServicioDeNotificaciones` de prueba: usa el enviador falso de arriba por
 * defecto y, salvo que se pase `obtenerAlertas`, no reporta ninguna alerta
 * activa — así las pruebas que no son sobre alertas técnicas no las
 * disparan por accidente.
 */
export function notificacionesDePrueba(
  pos: ServicioPos,
  reloj: Reloj = relojFijo(),
  opciones: {
    enviador?: ReturnType<typeof enviadorDeCorreoFalso>;
    obtenerAlertas?: () => Promise<Alerta[]>;
  } = {},
): ServicioDeNotificaciones {
  return new ServicioDeNotificaciones(
    pos,
    reloj,
    opciones.enviador ?? enviadorDeCorreoFalso(),
    opciones.obtenerAlertas ?? (async () => []),
  );
}
