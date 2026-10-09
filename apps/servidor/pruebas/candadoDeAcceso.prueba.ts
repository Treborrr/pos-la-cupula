/**
 * El candado de acceso tiene que quedar invisible mientras nadie configure
 * CLAVE_DE_ACCESO (esa es la instalación de la barbería) y bloquear todo lo
 * demás en cuanto se configure (ese es el caso de publicarlo en internet).
 */

import { describe, expect, it, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";

import { construirApp } from "../src/http/app";
import { ImpresoraVistaPrevia } from "../src/adaptadores/impresora/ImpresoraVistaPrevia";
import { ServicioPos } from "../src/servicios/Pos";
import { ServicioDeRespaldos } from "../src/servicios/Respaldos";
import { relojDelSistema } from "../src/puertos/Reloj";
import { abrirAlmacen, borrar, carpetaTemporal } from "./ayuda";

const aCerrar: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of aCerrar.splice(0)) await fn().catch(() => undefined);
  delete process.env.CLAVE_DE_ACCESO;
});

async function appDePrueba(): Promise<FastifyInstance> {
  const dir = await carpetaTemporal();
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
  const app = await construirApp({
    pos,
    impresora: new ImpresoraVistaPrevia(),
    respaldos: new ServicioDeRespaldos(dir, relojDelSistema, null),
    version: "pruebas",
  });
  aCerrar.push(async () => {
    await app.close();
    await pos.cerrar();
    await borrar(dir);
  });
  return app;
}

function basic(usuario: string, clave: string): string {
  return `Basic ${Buffer.from(`${usuario}:${clave}`).toString("base64")}`;
}

describe("candado de acceso", () => {
  it("sin CLAVE_DE_ACCESO configurada, no pide nada (instalación local de siempre)", async () => {
    const app = await appDePrueba();
    const r = await app.inject({ method: "GET", url: "/api/catalogo" });
    expect(r.statusCode).toBe(200);
  });

  it("con CLAVE_DE_ACCESO configurada, rechaza sin credenciales", async () => {
    process.env.CLAVE_DE_ACCESO = "una-clave-larga-de-verdad";
    const app = await appDePrueba();
    const r = await app.inject({ method: "GET", url: "/api/catalogo" });
    expect(r.statusCode).toBe(401);
  });

  it("rechaza con la clave equivocada", async () => {
    process.env.CLAVE_DE_ACCESO = "una-clave-larga-de-verdad";
    const app = await appDePrueba();
    const r = await app.inject({
      method: "GET",
      url: "/api/catalogo",
      headers: { authorization: basic("cupula", "otra-clave") },
    });
    expect(r.statusCode).toBe(401);
  });

  it("deja pasar con la clave correcta", async () => {
    process.env.CLAVE_DE_ACCESO = "una-clave-larga-de-verdad";
    const app = await appDePrueba();
    const r = await app.inject({
      method: "GET",
      url: "/api/catalogo",
      headers: { authorization: basic("cupula", "una-clave-larga-de-verdad") },
    });
    expect(r.statusCode).toBe(200);
  });

  it("la clave puede llevar ':' sin romperse", async () => {
    process.env.CLAVE_DE_ACCESO = "clave:con:dos:puntos";
    const app = await appDePrueba();
    const r = await app.inject({
      method: "GET",
      url: "/api/catalogo",
      headers: { authorization: basic("cupula", "clave:con:dos:puntos") },
    });
    expect(r.statusCode).toBe(200);
  });

  it("/api/salud nunca pide clave: es lo que lee el healthcheck de Railway", async () => {
    process.env.CLAVE_DE_ACCESO = "una-clave-larga-de-verdad";
    const app = await appDePrueba();
    const r = await app.inject({ method: "GET", url: "/api/salud" });
    expect(r.statusCode).toBe(200);
  });
});
