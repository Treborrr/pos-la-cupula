/**
 * `PUT /api/config` escribe al log APPEND-ONLY, que no se puede limpiar. Lo que
 * no se puede borrar hay que no dejarlo entrar: una clave inventada, un valor
 * con el tipo equivocado o un cuerpo gigante tienen que rebotar ANTES de tocar
 * el disco. La propiedad que de verdad importa: lo rechazado no deja rastro.
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
  conSesionAdmin,
  dependenciasDeSeguridadDePrueba,
  notificacionesDePrueba,
} from "./ayuda";

const aCerrar: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of aCerrar.splice(0)) await c();
});

async function api() {
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
  });
  await conSesionAdmin(app, pos);
  aCerrar.push(async () => {
    await app.close();
    await pos.cerrar();
    await borrar(dir);
  });
  return { app, pos };
}

const put = (app: Awaited<ReturnType<typeof api>>["app"], body: unknown) =>
  app.inject({ method: "PUT", url: "/api/config", payload: body });

describe("PUT /config valida contra una lista blanca", () => {
  it("una clave legítima se guarda", async () => {
    const { app } = await api();
    const r = await put(app, { "negocio.nombre": "LA CUPULA" });
    expect(r.statusCode).toBe(200);
    expect(r.json()["negocio.nombre"]).toBe("LA CUPULA");
  });

  it("una clave inventada se rechaza y NO deja rastro en el log", async () => {
    const { app, pos } = await api();
    const seqAntes = pos.p.seq;

    const r = await put(app, { "x.inventada": "basura" });
    expect(r.statusCode).toBe(400);
    expect(pos.p.seq).toBe(seqAntes); // no se escribió ningún evento
  });

  it("un valor con el tipo equivocado se rechaza (seguridad.redesCajero: 0)", async () => {
    const { app, pos } = await api();
    const seqAntes = pos.p.seq;

    // Este era el que rompía el sistema: 0 hace estallar `lista.split()` en
    // cada pedido de cajero. Ahora no entra.
    const r = await put(app, { "seguridad.redesCajero": 0 });
    expect(r.statusCode).toBe(400);
    expect(pos.p.seq).toBe(seqAntes);
  });

  it("un cuerpo con miles de claves rebota entero antes de escribir una sola", async () => {
    const { app, pos } = await api();
    const seqAntes = pos.p.seq;

    const bomba: Record<string, unknown> = {};
    for (let i = 0; i < 5_000; i++) bomba[`basura${i}`] = i;

    const r = await put(app, bomba);
    expect(r.statusCode).toBe(400);
    expect(pos.p.seq).toBe(seqAntes); // ni uno de los 5.000 se escribió
  });

  it("un valor gigante en una clave válida se rechaza", async () => {
    const { app, pos } = await api();
    const seqAntes = pos.p.seq;
    const r = await put(app, { "negocio.nombre": "x".repeat(90) }); // tope 80
    expect(r.statusCode).toBe(400);
    expect(pos.p.seq).toBe(seqAntes);
  });

  it("varias claves válidas entran en UN solo evento por el lote", async () => {
    const { app, pos } = await api();
    const seqAntes = pos.p.seq;
    const r = await put(app, {
      "negocio.nombre": "A",
      "negocio.ciudad": "B",
      "ventas.exigirCliente": false,
    });
    expect(r.statusCode).toBe(200);
    // Tres claves, un lote. La cola de cobros no se traba con N transacciones.
    expect(pos.p.seq).toBe(seqAntes + 3); // 3 eventos en un lote atómico
  });
});
