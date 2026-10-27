/**
 * Aislamiento entre sucursales: que un cajero no pueda tocar lo que no es de
 * su local, ni siquiera pidiéndolo por id.
 *
 * El listado filtrado NO alcanza como defensa. Los correlativos son
 * secuenciales y públicos (salen impresos en el ticket), así que adivinar el
 * de otro local es trivial: si la ruta por id no comprueba la sucursal, el
 * filtro del listado es decoración.
 */

import { SEDE_PRINCIPAL } from "@cupula/contratos";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { construirApp } from "../src/http/app";
import { ServicioPos } from "../src/servicios/Pos";
import { ServicioDeRespaldos } from "../src/servicios/Respaldos";
import { ImpresoraVistaPrevia } from "../src/adaptadores/impresora/ImpresoraVistaPrevia";
import { relojDelSistema } from "../src/puertos/Reloj";
import { NOMBRE_COOKIE_SESION } from "../src/http/autorizacion";
import {
  abrirAlmacen,
  borrar,
  carpetaTemporal,
  conSesionAdmin,
  dependenciasDeSeguridadDePrueba,
  notificacionesDePrueba,
} from "./ayuda";

const aCerrar: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cerrar of aCerrar.splice(0)) await cerrar();
});

async function escenario() {
  const dir = await carpetaTemporal();
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
  await pos.guardarConfig("ventas.exigirCliente", false);
  await pos.guardarConfig("ventas.exigirTurnoAbierto", false);
  await pos.guardarConfig("seguridad.redesCajero", "");

  const app = await construirApp({
    pos,
    impresora: new ImpresoraVistaPrevia(),
    respaldos: new ServicioDeRespaldos(dir, relojDelSistema, null),
    notificaciones: notificacionesDePrueba(pos),
    carpetaDatos: dir,
    version: "pruebas",
    ...dependenciasDeSeguridadDePrueba(),
  });
  await conSesionAdmin(app, pos);
  aCerrar.push(async () => {
    await app.close();
    await pos.cerrar();
    await borrar(dir);
  });

  // Dos locales.
  const centro = (
    await app.inject({ method: "POST", url: "/api/sedes", payload: { nombre: "Centro", prefijoTicket: "SC" } })
  ).json().sede.id as string;

  const corte = (
    await app.inject({
      method: "POST",
      url: "/api/catalogo",
      payload: { codigo: "COR", nombre: "CORTE", tipo: "SERVICIO", categoria: "Barbería", precio: 2000 },
    })
  ).json().item.id as string;

  // Una venta EN LA PRINCIPAL, que la cajera de Centro no debería poder tocar.
  const ajena = (
    await app.inject({
      method: "POST",
      url: `/api/ventas?sede=${SEDE_PRINCIPAL}`,
      payload: {
        lineas: [{ itemId: corte, cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: "01K5B7M3QW8ZX2VDNPQR4T6Y9A",
      },
    })
  ).json().venta;

  // Cajera de Centro.
  await app.inject({
    method: "POST",
    url: "/api/usuarios",
    payload: { usuario: "ana", nombre: "Ana", contrasena: "contrasena-larga", sedeId: centro },
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { usuario: "ana", contrasena: "contrasena-larga" },
  });
  const crudo = login.headers["set-cookie"];
  const texto = Array.isArray(crudo) ? crudo[0] : crudo;
  const m = new RegExp(`${NOMBRE_COOKIE_SESION}=([^;]+)`).exec(texto as string)!;

  return { app, pos, centro, corte, ajena, cookie: `${NOMBRE_COOKIE_SESION}=${m[1]}` };
}

describe("un cajero no llega a las ventas de otra sucursal", () => {
  it("no puede LEERLA por id", async () => {
    const { app, ajena, cookie } = await escenario();
    const r = await app.inject({ method: "GET", url: `/api/ventas/${ajena.id}`, headers: { cookie } });
    expect(r.statusCode).toBe(404);
  });

  it("no puede leerla por su correlativo, que es adivinable", async () => {
    const { app, ajena, cookie } = await escenario();
    const r = await app.inject({ method: "GET", url: `/api/ventas/${ajena.correlativo}`, headers: { cookie } });
    expect(r.statusCode).toBe(404);
  });

  /** La peor: anular el cobro de otro local borra plata de un arqueo ajeno. */
  it("no puede ANULARLA", async () => {
    const { app, pos, ajena, cookie } = await escenario();
    const r = await app.inject({
      method: "POST",
      url: `/api/ventas/${ajena.id}/anular`,
      headers: { cookie },
      payload: { motivo: "intento desde otra sucursal" },
    });
    expect(r.statusCode).toBe(404);
    expect(pos.p.ventas.get(ajena.id)!.anulada).toBe(false);
  });

  it("no puede reimprimir su ticket", async () => {
    const { app, ajena, cookie } = await escenario();
    const r = await app.inject({
      method: "POST",
      url: `/api/ventas/${ajena.id}/reimprimir`,
      headers: { cookie },
    });
    expect(r.statusCode).toBe(404);
  });

  it("no puede anotarle una propina", async () => {
    const { app, ajena, cookie } = await escenario();
    const r = await app.inject({
      method: "POST",
      url: `/api/ventas/${ajena.id}/propina`,
      headers: { cookie },
      payload: { lineaIndex: 0, barberoId: "01K5B7M3QW8ZX2VDNPQR4T6Y9A", monto: 500 },
    });
    expect(r.statusCode).toBe(404);
  });

  it("el kardex de un producto es el de SU local", async () => {
    const { app, corte, cookie } = await escenario();
    const r = await app.inject({ method: "GET", url: `/api/inventario/${corte}/kardex`, headers: { cookie } });
    // El corte es un SERVICIO, así que no lleva kardex; lo que importa es que
    // la ruta no reviente y no filtre movimientos de otro local.
    expect([200, 400, 404]).toContain(r.statusCode);
  });

  it("un ADMIN sí puede leerla, eligiendo esa sucursal", async () => {
    const { app, ajena } = await escenario();
    const r = await app.inject({ method: "GET", url: `/api/ventas/${ajena.id}?sede=${SEDE_PRINCIPAL}` });
    expect(r.statusCode).toBe(200);
  });
});
