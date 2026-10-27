/**
 * Login, roles y las fronteras entre ADMIN y CAJERO. La red de seguridad real
 * contra cualquier ruta que quede mal etiquetada con `{config:{rol:...}}` —
 * plantilla heredada de la vieja `candadoDeAcceso.prueba.ts`.
 */

import { describe, expect, it, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";

import { construirApp } from "../src/http/app";
import { ImpresoraVistaPrevia } from "../src/adaptadores/impresora/ImpresoraVistaPrevia";
import { ServicioPos } from "../src/servicios/Pos";
import { ServicioDeRespaldos } from "../src/servicios/Respaldos";
import { relojDelSistema } from "../src/puertos/Reloj";
import { crearUsuario, desactivarUsuario } from "../src/dominio/usuarios/usuarios";
import { hashearContrasena } from "../src/seguridad/contrasenas";
import { NOMBRE_COOKIE_SESION } from "../src/http/autorizacion";
import { abrirAlmacen, borrar, carpetaTemporal, dependenciasDeSeguridadDePrueba, notificacionesDePrueba } from "./ayuda";

const CONTRASENA = "una-clave-de-prueba-bien-larga";

const aCerrar: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of aCerrar.splice(0)) await fn().catch(() => undefined);
});

/**
 * `enNube` decide si se lee `X-Forwarded-For`. Las pruebas que simulan la IP
 * del cliente con esa cabecera TIENEN que pedirlo: fuera de la nube no hay
 * ningún proxy delante y la cabecera se ignora a propósito, porque ahí solo
 * puede venir de alguien mintiendo (ver `seguridadRed.prueba.ts`).
 */
async function appDePrueba(
  opciones: { enNube?: boolean } = {},
): Promise<{ app: FastifyInstance; pos: ServicioPos }> {
  const dir = await carpetaTemporal();
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
  await pos.guardarConfig("ventas.exigirCliente", false);
  await pos.guardarConfig("ventas.exigirTurnoAbierto", false);
  const app = await construirApp({
    pos,
    impresora: new ImpresoraVistaPrevia(),
    respaldos: new ServicioDeRespaldos(dir, relojDelSistema, null),
    notificaciones: notificacionesDePrueba(pos),
    carpetaDatos: dir,
    version: "pruebas",
    ...dependenciasDeSeguridadDePrueba(),
    enNube: opciones.enNube ?? false,
  });
  aCerrar.push(async () => {
    await app.close();
    await pos.cerrar();
    await borrar(dir);
  });
  return { app, pos };
}

async function crearUsuarioDePrueba(
  pos: ServicioPos,
  usuario: string,
  rol: "ADMIN" | "CAJERO",
  contrasena = CONTRASENA,
): Promise<string> {
  const hash = await hashearContrasena(contrasena);
  return pos.transaccion(() => {
    const r = crearUsuario(pos.p, { usuario, nombre: usuario, rol, hash });
    return { eventos: r.eventos, resultado: r.usuarioId };
  });
}

/** Loguea y devuelve el valor crudo para el header `cookie`. */
async function loguear(
  app: FastifyInstance,
  usuario: string,
  contrasena = CONTRASENA,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; cookie: string | null; cuerpo: any }> {
  const resp = await app.inject({ method: "POST", url: "/api/auth/login", payload: { usuario, contrasena }, headers });
  const crudo = resp.headers["set-cookie"];
  const texto = Array.isArray(crudo) ? crudo[0] : crudo;
  const coincidencia = texto ? new RegExp(`${NOMBRE_COOKIE_SESION}=([^;]+)`).exec(texto) : null;
  return {
    statusCode: resp.statusCode,
    cookie: coincidencia ? `${NOMBRE_COOKIE_SESION}=${coincidencia[1]}` : null,
    cuerpo: resp.json(),
  };
}

describe("login", () => {
  it("con credenciales correctas, entra y deja la cookie", async () => {
    const { app, pos } = await appDePrueba();
    await crearUsuarioDePrueba(pos, "ana", "CAJERO");

    const r = await loguear(app, "ana");
    expect(r.statusCode).toBe(200);
    expect(r.cookie).toBeTruthy();
    expect(r.cuerpo.usuario).toMatchObject({ usuario: "ana", rol: "CAJERO" });
    expect(r.cuerpo.usuario.hash).toBeUndefined();
  });

  it("usuario inexistente: mismo error genérico", async () => {
    const { app } = await appDePrueba();
    const r = await loguear(app, "no-existe");
    expect(r.statusCode).toBe(401);
    expect(r.cuerpo.error.codigo).toBe("CREDENCIALES_INVALIDAS");
  });

  it("contraseña incorrecta: el mismo error genérico", async () => {
    const { app, pos } = await appDePrueba();
    await crearUsuarioDePrueba(pos, "ana", "CAJERO");
    const r = await loguear(app, "ana", "otra-clave");
    expect(r.statusCode).toBe(401);
    expect(r.cuerpo.error.codigo).toBe("CREDENCIALES_INVALIDAS");
  });

  it("una cuenta desactivada no puede loguear", async () => {
    const { app, pos } = await appDePrueba();
    const id = await crearUsuarioDePrueba(pos, "ana", "CAJERO");
    await pos.escribir(() => desactivarUsuario(pos.p, id));

    const r = await loguear(app, "ana");
    expect(r.statusCode).toBe(401);
  });
});

describe("GET /auth/yo", () => {
  it("sin cookie: 200 con usuario null (nunca 401 — es la sonda de arranque)", async () => {
    const { app } = await appDePrueba();
    const r = await app.inject({ method: "GET", url: "/api/auth/yo" });
    expect(r.statusCode).toBe(200);
    expect(r.json().usuario).toBeNull();
  });

  it("con cookie válida: dice quién es", async () => {
    const { app, pos } = await appDePrueba();
    await crearUsuarioDePrueba(pos, "ana", "CAJERO");
    const { cookie } = await loguear(app, "ana");

    const r = await app.inject({ method: "GET", url: "/api/auth/yo", headers: { cookie: cookie! } });
    expect(r.json().usuario).toMatchObject({ usuario: "ana", rol: "CAJERO" });
  });

  it("con una cookie inventada: 200 con usuario null, no un error", async () => {
    const { app } = await appDePrueba();
    const r = await app.inject({
      method: "GET",
      url: "/api/auth/yo",
      headers: { cookie: `${NOMBRE_COOKIE_SESION}=token-que-nunca-se-emitio` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().usuario).toBeNull();
  });
});

describe("logout", () => {
  it("invalida la cookie: un pedido posterior con la misma cookie ya no entra", async () => {
    const { app, pos } = await appDePrueba();
    await crearUsuarioDePrueba(pos, "ana", "CAJERO");
    const { cookie } = await loguear(app, "ana");

    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: cookie! } });

    const r = await app.inject({ method: "GET", url: "/api/catalogo", headers: { cookie: cookie! } });
    expect(r.statusCode).toBe(401);
  });

  it("funciona sin cookie, sin explotar", async () => {
    const { app } = await appDePrueba();
    const r = await app.inject({ method: "POST", url: "/api/auth/logout" });
    expect(r.statusCode).toBe(200);
  });
});

describe("matriz de permisos por ruta", () => {
  it("sin sesión, una ruta CAJERO rechaza con 401", async () => {
    const { app } = await appDePrueba();
    const r = await app.inject({ method: "GET", url: "/api/catalogo" });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.codigo).toBe("NO_AUTENTICADO");
  });

  it("/api/salud nunca pide sesión, lo use quien lo use", async () => {
    const { app } = await appDePrueba();
    expect((await app.inject({ method: "GET", url: "/api/salud" })).statusCode).toBe(200);
  });

  it("CAJERO entra a una ruta CAJERO", async () => {
    const { app, pos } = await appDePrueba();
    await crearUsuarioDePrueba(pos, "ana", "CAJERO");
    const { cookie } = await loguear(app, "ana");

    const r = await app.inject({ method: "GET", url: "/api/catalogo", headers: { cookie: cookie! } });
    expect(r.statusCode).toBe(200);
  });

  it("CAJERO rebota con 403 (no 401: SÍ está logueado) en una ruta ADMIN", async () => {
    const { app, pos } = await appDePrueba();
    await crearUsuarioDePrueba(pos, "ana", "CAJERO");
    const { cookie } = await loguear(app, "ana");

    for (const pedido of [
      { method: "GET" as const, url: "/api/reportes/resumen?desde=2026-01-01&hasta=2026-01-31" },
      { method: "POST" as const, url: "/api/inventario/ajuste", payload: { itemId: "x", cantidadContada: 1, motivo: "x" } },
      { method: "GET" as const, url: "/api/usuarios" },
      { method: "POST" as const, url: "/api/barberos/no-existe/liquidar" },
      { method: "GET" as const, url: "/api/config" },
    ]) {
      const r = await app.inject({ ...pedido, headers: { cookie: cookie! } });
      expect(r.statusCode, `${pedido.method} ${pedido.url}`).toBe(403);
      expect(r.json().error.codigo).toBe("ROL_INSUFICIENTE");
    }
  });

  it("ADMIN entra a rutas CAJERO y a rutas ADMIN por igual", async () => {
    const { app, pos } = await appDePrueba();
    await crearUsuarioDePrueba(pos, "dueno", "ADMIN");
    const { cookie } = await loguear(app, "dueno");

    const catalogo = await app.inject({ method: "GET", url: "/api/catalogo", headers: { cookie: cookie! } });
    expect(catalogo.statusCode).toBe(200);

    const config = await app.inject({ method: "GET", url: "/api/config", headers: { cookie: cookie! } });
    expect(config.statusCode).toBe(200);
  });
});

/**
 * Todo este bloque corre con `enNube: true` porque simula la IP del cliente
 * con `X-Forwarded-For`, que es como llega de verdad en Railway. La prueba de
 * que esa cabecera NO se puede falsificar vive en `seguridadRed.prueba.ts`.
 */
describe("red permitida del cajero", () => {
  it("vacía: el cajero entra desde cualquier IP", async () => {
    const { app, pos } = await appDePrueba({ enNube: true });
    await crearUsuarioDePrueba(pos, "ana", "CAJERO");
    const r = await loguear(app, "ana", CONTRASENA, { "x-forwarded-for": "8.8.8.8" });
    expect(r.statusCode).toBe(200);
  });

  it("configurada: rechaza el login desde una IP fuera de la lista", async () => {
    const { app, pos } = await appDePrueba({ enNube: true });
    await pos.guardarConfig("seguridad.redesCajero", "192.168.1.0/24");
    await crearUsuarioDePrueba(pos, "ana", "CAJERO");

    const r = await loguear(app, "ana", CONTRASENA, { "x-forwarded-for": "8.8.8.8" });
    expect(r.statusCode).toBe(401);
    // Mismo código que una contraseña mala: no delata que el motivo fue la red.
    expect(r.cuerpo.error.codigo).toBe("CREDENCIALES_INVALIDAS");
  });

  it("deja entrar desde una IP que sí matchea el CIDR configurado", async () => {
    const { app, pos } = await appDePrueba({ enNube: true });
    await pos.guardarConfig("seguridad.redesCajero", "192.168.1.0/24");
    await crearUsuarioDePrueba(pos, "ana", "CAJERO");

    const r = await loguear(app, "ana", CONTRASENA, { "x-forwarded-for": "192.168.1.50" });
    expect(r.statusCode).toBe(200);
  });

  it("ADMIN nunca tiene esta restricción", async () => {
    const { app, pos } = await appDePrueba({ enNube: true });
    await pos.guardarConfig("seguridad.redesCajero", "192.168.1.0/24");
    await crearUsuarioDePrueba(pos, "dueno", "ADMIN");

    const r = await loguear(app, "dueno", CONTRASENA, { "x-forwarded-for": "8.8.8.8" });
    expect(r.statusCode).toBe(200);
  });

  it("se revisa en CADA pedido, no solo al loguearse", async () => {
    const { app, pos } = await appDePrueba({ enNube: true });
    await crearUsuarioDePrueba(pos, "ana", "CAJERO");
    // Login sin restricción todavía.
    const { cookie } = await loguear(app, "ana", CONTRASENA, { "x-forwarded-for": "192.168.1.50" });

    // El admin configura la red DESPUÉS de que el cajero ya está logueado.
    await pos.guardarConfig("seguridad.redesCajero", "10.0.0.0/8");

    const r = await app.inject({
      method: "GET",
      url: "/api/catalogo",
      headers: { cookie: cookie!, "x-forwarded-for": "192.168.1.50" },
    });
    expect(r.statusCode).toBe(401);
  });
});

describe("una sola sesión de cajero a la vez", () => {
  it("un segundo login de OTRO cajero invalida la cookie del primero", async () => {
    const { app, pos } = await appDePrueba();
    await crearUsuarioDePrueba(pos, "ana", "CAJERO");
    await crearUsuarioDePrueba(pos, "bruno", "CAJERO");

    const primero = await loguear(app, "ana");
    await loguear(app, "bruno");

    const r = await app.inject({ method: "GET", url: "/api/catalogo", headers: { cookie: primero.cookie! } });
    expect(r.statusCode).toBe(401);
  });

  it("dos ADMIN pueden estar logueados a la vez sin pisarse", async () => {
    const { app, pos } = await appDePrueba();
    await crearUsuarioDePrueba(pos, "dueno1", "ADMIN");
    await crearUsuarioDePrueba(pos, "dueno2", "ADMIN");

    const a = await loguear(app, "dueno1");
    await loguear(app, "dueno2");

    const r = await app.inject({ method: "GET", url: "/api/catalogo", headers: { cookie: a.cookie! } });
    expect(r.statusCode).toBe(200);
  });
});

describe("autoservicio: cambiar mi contraseña", () => {
  it("con la contraseña actual correcta, cambia y la nueva sirve para loguear", async () => {
    const { app, pos } = await appDePrueba();
    await crearUsuarioDePrueba(pos, "ana", "CAJERO");
    const { cookie } = await loguear(app, "ana");

    const r = await app.inject({
      method: "POST",
      url: "/api/auth/contrasena",
      headers: { cookie: cookie! },
      payload: { contrasenaActual: CONTRASENA, contrasenaNueva: "una-clave-nueva-tambien-larga" },
    });
    expect(r.statusCode).toBe(200);

    const nuevo = await loguear(app, "ana", "una-clave-nueva-tambien-larga");
    expect(nuevo.statusCode).toBe(200);
  });

  it("rechaza si la contraseña actual está mal", async () => {
    const { app, pos } = await appDePrueba();
    await crearUsuarioDePrueba(pos, "ana", "CAJERO");
    const { cookie } = await loguear(app, "ana");

    const r = await app.inject({
      method: "POST",
      url: "/api/auth/contrasena",
      headers: { cookie: cookie! },
      payload: { contrasenaActual: "no-es-esta", contrasenaNueva: "una-clave-nueva-tambien-larga" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.codigo).toBe("CONTRASENA_ACTUAL_INCORRECTA");
  });

  it("no acepta otro usuarioId que no sea el de la sesión (no hay ni dónde ponerlo)", async () => {
    const { app, pos } = await appDePrueba();
    await crearUsuarioDePrueba(pos, "ana", "CAJERO");
    const { cookie } = await loguear(app, "ana");

    // Aunque alguien mande un campo de más, la ruta solo lee contrasenaActual/contrasenaNueva.
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/contrasena",
      headers: { cookie: cookie! },
      payload: { usuarioId: "otra-cuenta", contrasenaActual: CONTRASENA, contrasenaNueva: "una-clave-nueva-tambien-larga" },
    });
    expect(r.statusCode).toBe(200);
    // Y de verdad cambió la de "ana", no la de nadie más.
    const relog = await loguear(app, "ana", "una-clave-nueva-tambien-larga");
    expect(relog.statusCode).toBe(200);
  });
});

describe("gestión de cajeros (solo ADMIN)", () => {
  async function conAdmin() {
    const { app, pos } = await appDePrueba();
    await crearUsuarioDePrueba(pos, "dueno", "ADMIN");
    const { cookie } = await loguear(app, "dueno");
    return { app, pos, cookieAdmin: cookie! };
  }

  it("crea un cajero con rol CAJERO SIEMPRE, aunque el cuerpo pida ADMIN", async () => {
    const { app, cookieAdmin } = await conAdmin();
    const r = await app.inject({
      method: "POST",
      url: "/api/usuarios",
      headers: { cookie: cookieAdmin },
      payload: { usuario: "nueva", nombre: "Nueva Cajera", contrasena: CONTRASENA, rol: "ADMIN" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().usuario.rol).toBe("CAJERO");
    expect(r.json().usuario.hash).toBeUndefined();
  });

  it("el listado nunca trae el hash de nadie", async () => {
    const { app, cookieAdmin } = await conAdmin();
    await app.inject({
      method: "POST",
      url: "/api/usuarios",
      headers: { cookie: cookieAdmin },
      payload: { usuario: "nueva", nombre: "Nueva", contrasena: CONTRASENA },
    });
    const r = await app.inject({ method: "GET", url: "/api/usuarios", headers: { cookie: cookieAdmin } });
    for (const u of r.json().usuarios) expect(u.hash).toBeUndefined();
  });

  it("tope de 3 cajeros vía HTTP", async () => {
    const { app, cookieAdmin } = await conAdmin();
    for (const usuario of ["cajero1", "cajero2", "cajero3"]) {
      await app.inject({
        method: "POST",
        url: "/api/usuarios",
        headers: { cookie: cookieAdmin },
        payload: { usuario, nombre: usuario, contrasena: CONTRASENA },
      });
    }
    const r = await app.inject({
      method: "POST",
      url: "/api/usuarios",
      headers: { cookie: cookieAdmin },
      payload: { usuario: "cajero4", nombre: "cajero4", contrasena: CONTRASENA },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.codigo).toBe("LIMITE_CAJEROS_ALCANZADO");
  });

  it("desactivar un cajero corta su sesión activa en el momento", async () => {
    const { app, pos, cookieAdmin } = await conAdmin();
    const idCajero = await crearUsuarioDePrueba(pos, "ana", "CAJERO");
    const { cookie: cookieCajero } = await loguear(app, "ana");

    await app.inject({
      method: "POST",
      url: `/api/usuarios/${idCajero}/desactivar`,
      headers: { cookie: cookieAdmin },
    });

    const r = await app.inject({ method: "GET", url: "/api/catalogo", headers: { cookie: cookieCajero! } });
    expect(r.statusCode).toBe(401);
  });

  it("resetear la contraseña de un cajero corta su sesión y habilita la nueva clave", async () => {
    const { app, pos, cookieAdmin } = await conAdmin();
    const idCajero = await crearUsuarioDePrueba(pos, "ana", "CAJERO");
    const { cookie: cookieVieja } = await loguear(app, "ana");

    await app.inject({
      method: "POST",
      url: `/api/usuarios/${idCajero}/contrasena`,
      headers: { cookie: cookieAdmin },
      payload: { contrasenaNueva: "otra-clave-bien-larga" },
    });

    const conVieja = await app.inject({ method: "GET", url: "/api/catalogo", headers: { cookie: cookieVieja! } });
    expect(conVieja.statusCode).toBe(401);

    const relog = await loguear(app, "ana", "otra-clave-bien-larga");
    expect(relog.statusCode).toBe(200);
  });

  it("no gestiona cuentas ADMIN desde acá", async () => {
    const { app, pos, cookieAdmin } = await conAdmin();
    const otroAdminId = await crearUsuarioDePrueba(pos, "dueno2", "ADMIN");

    const r = await app.inject({
      method: "POST",
      url: `/api/usuarios/${otroAdminId}/desactivar`,
      headers: { cookie: cookieAdmin },
    });
    expect(r.statusCode).toBe(400);
  });

  it("CAJERO no puede llegar a ninguna ruta de /usuarios", async () => {
    const { app, pos } = await appDePrueba();
    await crearUsuarioDePrueba(pos, "ana", "CAJERO");
    const { cookie } = await loguear(app, "ana");

    const r = await app.inject({ method: "GET", url: "/api/usuarios", headers: { cookie: cookie! } });
    expect(r.statusCode).toBe(403);
  });
});
