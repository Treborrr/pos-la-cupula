/**
 * El candado de acceso tiene que quedar invisible mientras nadie configure
 * `seguridad.claveAcceso` (esa es la instalación de la barbería) y bloquear
 * todo lo demás en cuanto se configure (ese es el caso de publicarlo en
 * internet). Es config de la instalación, no una variable de entorno — se
 * asigna desde Ajustes, y un cambio se aplica sin reiniciar el servidor.
 */

import { describe, expect, it, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";

import { construirApp } from "../src/http/app";
import { ImpresoraVistaPrevia } from "../src/adaptadores/impresora/ImpresoraVistaPrevia";
import { ServicioPos } from "../src/servicios/Pos";
import { ServicioDeRespaldos } from "../src/servicios/Respaldos";
import { relojDelSistema } from "../src/puertos/Reloj";
import { abrirAlmacen, borrar, carpetaTemporal, notificacionesDePrueba } from "./ayuda";

const aCerrar: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of aCerrar.splice(0)) await fn().catch(() => undefined);
});

async function appDePrueba(clave?: string): Promise<{ app: FastifyInstance; pos: ServicioPos }> {
  const dir = await carpetaTemporal();
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
  if (clave !== undefined) await pos.guardarConfig("seguridad.claveAcceso", clave);
  const app = await construirApp({
    pos,
    impresora: new ImpresoraVistaPrevia(),
    respaldos: new ServicioDeRespaldos(dir, relojDelSistema, null),
    notificaciones: notificacionesDePrueba(pos),
    carpetaDatos: dir,
    version: "pruebas",
  });
  aCerrar.push(async () => {
    await app.close();
    await pos.cerrar();
    await borrar(dir);
  });
  return { app, pos };
}

function basic(usuario: string, clave: string): string {
  return `Basic ${Buffer.from(`${usuario}:${clave}`).toString("base64")}`;
}

describe("candado de acceso", () => {
  it("sin clave configurada, no pide nada (instalación local de siempre)", async () => {
    const { app } = await appDePrueba();
    const r = await app.inject({ method: "GET", url: "/api/catalogo" });
    expect(r.statusCode).toBe(200);
  });

  it("con la clave configurada, rechaza sin credenciales", async () => {
    const { app } = await appDePrueba("una-clave-larga-de-verdad");
    const r = await app.inject({ method: "GET", url: "/api/catalogo" });
    expect(r.statusCode).toBe(401);
  });

  it("rechaza con la clave equivocada", async () => {
    const { app } = await appDePrueba("una-clave-larga-de-verdad");
    const r = await app.inject({
      method: "GET",
      url: "/api/catalogo",
      headers: { authorization: basic("cupula", "otra-clave") },
    });
    expect(r.statusCode).toBe(401);
  });

  it("deja pasar con la clave correcta", async () => {
    const { app } = await appDePrueba("una-clave-larga-de-verdad");
    const r = await app.inject({
      method: "GET",
      url: "/api/catalogo",
      headers: { authorization: basic("cupula", "una-clave-larga-de-verdad") },
    });
    expect(r.statusCode).toBe(200);
  });

  it("la clave puede llevar ':' sin romperse", async () => {
    const { app } = await appDePrueba("clave:con:dos:puntos");
    const r = await app.inject({
      method: "GET",
      url: "/api/catalogo",
      headers: { authorization: basic("cupula", "clave:con:dos:puntos") },
    });
    expect(r.statusCode).toBe(200);
  });

  it("/api/salud nunca pide clave: es lo que lee el healthcheck de Railway", async () => {
    const { app } = await appDePrueba("una-clave-larga-de-verdad");
    const r = await app.inject({ method: "GET", url: "/api/salud" });
    expect(r.statusCode).toBe(200);
  });

  it("un cambio de clave hecho en caliente (vía Ajustes) se aplica sin reiniciar", async () => {
    const { app, pos } = await appDePrueba("clave-vieja");
    const bloqueada = await app.inject({
      method: "GET",
      url: "/api/catalogo",
      headers: { authorization: basic("cupula", "clave-nueva") },
    });
    expect(bloqueada.statusCode).toBe(401);

    await pos.guardarConfig("seguridad.claveAcceso", "clave-nueva");

    const permitida = await app.inject({
      method: "GET",
      url: "/api/catalogo",
      headers: { authorization: basic("cupula", "clave-nueva") },
    });
    expect(permitida.statusCode).toBe(200);
  });
});
