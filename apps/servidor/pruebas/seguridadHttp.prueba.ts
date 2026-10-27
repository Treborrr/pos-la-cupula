/**
 * La capa HTTP vista desde afuera: qué cabeceras salen, qué contesta ante
 * entradas hostiles y qué NO cuenta de sí mismo.
 *
 * Estar publicado en internet cambia el modelo de amenaza: no son solo los
 * cajeros de la barbería, es cualquiera que encuentre la URL. Esto fija las
 * defensas que ya no se pueden perder en un refactor.
 */

import { afterEach, describe, expect, it } from "vitest";

import { construirApp } from "../src/http/app";
import { ServicioPos } from "../src/servicios/Pos";
import { ServicioDeRespaldos } from "../src/servicios/Respaldos";
import { ImpresoraVistaPrevia } from "../src/adaptadores/impresora/ImpresoraVistaPrevia";
import { relojDelSistema } from "../src/puertos/Reloj";
import {
  abrirAlmacen,
  borrar,
  carpetaTemporal,
  dependenciasDeSeguridadDePrueba,
  notificacionesDePrueba,
} from "./ayuda";

const aCerrar: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cerrar of aCerrar.splice(0)) await cerrar();
});

async function api(enNube = true) {
  const dir = await carpetaTemporal();
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
  const app = await construirApp({
    pos,
    impresora: new ImpresoraVistaPrevia(),
    respaldos: new ServicioDeRespaldos(dir, relojDelSistema, null),
    notificaciones: notificacionesDePrueba(pos),
    carpetaDatos: dir,
    version: "pruebas",
    ...dependenciasDeSeguridadDePrueba(),
    enNube,
  });
  aCerrar.push(async () => {
    await app.close();
    await pos.cerrar();
    await borrar(dir);
  });
  return app;
}

describe("cabeceras de seguridad", () => {
  it("salen en todas las respuestas, incluidas las de error", async () => {
    const app = await api();
    for (const url of ["/", "/api/salud", "/api/estado", "/ruta/que/no/existe"]) {
      const r = await app.inject({ method: "GET", url });
      expect(r.headers["x-content-type-options"], url).toBe("nosniff");
      expect(r.headers["x-frame-options"], url).toBe("DENY");
      expect(r.headers["referrer-policy"], url).toBe("no-referrer");
      expect(String(r.headers["content-security-policy"]), url).toContain("frame-ancestors 'none'");
    }
  });

  it("la CSP no permite scripts de otro origen ni en línea", async () => {
    const app = await api();
    const csp = String((await app.inject({ method: "GET", url: "/" })).headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
  });

  /**
   * HSTS solo con HTTPS de por medio. Mandarla desde el POS instalado en la
   * barbería —que se sirve por HTTP en la red local— dejaría el navegador del
   * mostrador negándose a abrirlo durante meses, sin forma simple de deshacerlo.
   */
  it("HSTS solo en la nube, nunca en la instalación local", async () => {
    expect((await (await api(true)).inject({ method: "GET", url: "/" })).headers["strict-transport-security"])
      .toBeDefined();
    expect((await (await api(false)).inject({ method: "GET", url: "/" })).headers["strict-transport-security"])
      .toBeUndefined();
  });
});

describe("el API no se deja tocar sin sesión", () => {
  it("todo lo que no es público responde 401", async () => {
    const app = await api();
    for (const url of ["/api/estado", "/api/catalogo", "/api/ventas", "/api/usuarios", "/api/sedes", "/api/config"]) {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode, url).toBe(401);
    }
  });
});

describe("entradas hostiles", () => {
  it("un JSON malformado es 400, no una avería", async () => {
    const app = await api();
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{roto",
    });
    expect(r.statusCode).toBe(400);
  });

  it("un cuerpo más grande que el tope es 413", async () => {
    const app = await api();
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ relleno: "x".repeat(2_000_000) }),
    });
    expect(r.statusCode).toBe(413);
  });

  it("no se puede salir de la carpeta de fotos", async () => {
    const app = await api();
    for (const url of ["/fotos/../../../etc/passwd", "/fotos/..%2f..%2f..%2fetc%2fpasswd"]) {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode, url).not.toBe(200);
      expect(r.body, url).not.toContain("root:");
    }
  });

  /**
   * El freno de fuerza bruta TIENE que contestar 429 con su mensaje.
   *
   * Devolvía 500 "Algo falló en el sistema": el freno actuaba, pero la persona
   * veía una avería y quien opera no podía distinguir un ataque en curso de un
   * servidor roto. El `errorResponseBuilder` necesita `statusCode`.
   */
  it("pasado el tope de intentos contesta 429, no 500", async () => {
    const app = await api();
    const intentar = () =>
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { usuario: "fantasma", contrasena: "loquesea" },
      });

    let ultima = await intentar();
    for (let i = 0; i < 14 && ultima.statusCode !== 429; i++) ultima = await intentar();

    expect(ultima.statusCode).toBe(429);
    expect(ultima.json().error.mensaje).toMatch(/Demasiados intentos/);
  });
});

describe("el servidor no cuenta de más", () => {
  it("un error interno no filtra rutas del disco ni trazas", async () => {
    const app = await api();
    const r = await app.inject({ method: "GET", url: "/fotos/../../../etc/passwd" });
    expect(r.body).not.toMatch(/\/Users\/|node_modules|at Object\./);
  });

  it("el login no delata si el usuario existe", async () => {
    const app = await api();
    const inexistente = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { usuario: "fantasma", contrasena: "x12345678" },
    });
    expect(inexistente.json().error.codigo).toBe("CREDENCIALES_INVALIDAS");
    expect(inexistente.json().error.mensaje).not.toMatch(/no existe|no encontrado/i);
  });
});
