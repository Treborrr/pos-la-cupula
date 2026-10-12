/**
 * El servicio de notificaciones: el contador diario, el lote de alertas
 * técnicas, el debounce del reporte de cierre y el recibo por correo.
 *
 * Cada prueba corresponde a una regla que se decidió a propósito con el
 * dueño — no son pruebas de camino feliz por cumplir.
 */

import { afterEach, describe, expect, it } from "vitest";
import { ulid } from "ulid";

import type { EventoNuevo } from "@cupula/contratos";
import { ServicioPos } from "../src/servicios/Pos";
import { abrirTurno, cerrarTurno } from "../src/dominio/caja/caja";
import type { Alerta } from "../src/consultas/alertas";
import type { DatosDelNegocio } from "../src/puertos/Impresora";
import { construirApp } from "../src/http/app";
import { ImpresoraVistaPrevia } from "../src/adaptadores/impresora/ImpresoraVistaPrevia";
import { ServicioDeRespaldos } from "../src/servicios/Respaldos";
import { relojDelSistema } from "../src/puertos/Reloj";
import {
  abrirAlmacen,
  borrar,
  carpetaTemporal,
  enviadorDeCorreoFalso,
  itemNuevo,
  notificacionesDePrueba,
  relojFijo,
} from "./ayuda";

const aBorrar: string[] = [];
afterEach(async () => {
  await Promise.all(aBorrar.splice(0).map(borrar));
});

const NEGOCIO: DatosDelNegocio = {
  nombre: "LA CÚPULA",
  direccion: "AV. SIEMPRE VIVA 742",
  ciudad: "Lima",
  ruc: "20100000001",
  pie: "Gracias por tu visita",
};

function itemIdDe(evento: EventoNuevo): string {
  if (evento.tipo !== "item.creado") throw new Error("se esperaba un evento item.creado");
  return evento.datos.itemId;
}

/** Un POS recién instalado, con un servicio cargado y el correo del dueño configurado. */
async function posDePrueba(reloj: ReturnType<typeof relojFijo>) {
  const dir = await carpetaTemporal();
  aBorrar.push(dir);
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir, { reloj }));
  await pos.guardarConfig("ventas.exigirCliente", false);
  await pos.guardarConfig("ventas.exigirTurnoAbierto", false);
  await pos.guardarConfig("negocio.correoDueno", "dueno@cupula.test");

  const evento = itemNuevo("COR", "CORTE CLASICO", 2000);
  await pos.escribir(() => [evento]);
  const itemId = itemIdDe(evento);

  return { pos, dir, itemId };
}

async function cobrarVenta(pos: ServicioPos, itemId: string, monto: number) {
  const { venta } = await pos.cobrar({
    lineas: [{ itemId, cantidad: 1, precioUnitario: monto }],
    pagos: [{ medio: "EFECTIVO", monto }],
    claveIdempotencia: ulid(),
  });
  return venta;
}

async function cerrarTurnoDePrueba(pos: ServicioPos, montoInicial: number, contadoEfectivo: number) {
  await pos.escribir(() => abrirTurno(pos.p, { montoInicial }).eventos);
  return pos.transaccion(() => {
    const r = cerrarTurno(pos.p, { contadoEfectivo });
    return { eventos: r.eventos, resultado: r };
  });
}

describe("contador diario", () => {
  it("solo cuenta los envíos exitosos, y resetea cada día", async () => {
    const reloj = relojFijo("2026-09-16T10:00:00.000-05:00");
    const { pos, itemId } = await posDePrueba(reloj);
    const venta = await cobrarVenta(pos, itemId, 2000);
    const enviador = enviadorDeCorreoFalso();
    const n = notificacionesDePrueba(pos, reloj, { enviador });

    expect(n.contadorDeHoy().usadosHoy).toBe(0);

    await n.notificarRecibo("cliente@x.com", venta, NEGOCIO);
    expect(n.contadorDeHoy().usadosHoy).toBe(1);

    enviador.fallarSiempre = true;
    await n.notificarRecibo("cliente@x.com", venta, NEGOCIO);
    expect(n.contadorDeHoy().usadosHoy).toBe(1); // el fallido no consumió cupo

    reloj.avanzar(24 * 60 * 60 * 1000);
    expect(n.contadorDeHoy().usadosHoy).toBe(0); // es un día nuevo

    await pos.cerrar();
  });

  it("no manda el recibo si ya se alcanzó el tope total del día, y no rompe la venta", async () => {
    const reloj = relojFijo();
    const { pos, itemId } = await posDePrueba(reloj);
    await pos.guardarConfig("notificaciones.topeTotalDiario", 0);
    const venta = await cobrarVenta(pos, itemId, 2000);
    const enviador = enviadorDeCorreoFalso();
    const n = notificacionesDePrueba(pos, reloj, { enviador });

    const resultado = await n.notificarRecibo("cliente@x.com", venta, NEGOCIO);
    expect(resultado.ok).toBe(false);
    expect(enviador.enviados).toHaveLength(0); // ni se intentó: el tope se chequea antes

    await pos.cerrar();
  });
});

describe("alertas técnicas agrupadas", () => {
  it("junta varias alertas nuevas en un solo correo, y no repite una ya avisada hoy", async () => {
    const reloj = relojFijo();
    const { pos } = await posDePrueba(reloj);
    const enviador = enviadorDeCorreoFalso();
    let activas: Alerta[] = [{ codigo: "RELOJ_ATRASADO", mensaje: "La hora de la PC está atrasada." }];
    const n = notificacionesDePrueba(pos, reloj, { enviador, obtenerAlertas: async () => activas });

    await n.tick(); // primera alerta nueva: abre la ventana, todavía no manda
    expect(enviador.enviados).toHaveLength(0);

    activas = [...activas, { codigo: "IMPRESORA_CON_ERROR", mensaje: "La impresora no responde." }];
    reloj.avanzar(10 * 60 * 1000);
    await n.tick(); // dentro de la ventana de 20 min: todavía no manda
    expect(enviador.enviados).toHaveLength(0);

    reloj.avanzar(11 * 60 * 1000); // ya pasaron los 20 min desde la primera
    await n.tick();
    expect(enviador.enviados).toHaveLength(1);
    expect(enviador.enviados[0].html).toContain("La hora de la PC está atrasada");
    expect(enviador.enviados[0].html).toContain("La impresora no responde");

    // Sigue activa, pero ya se avisó hoy: el siguiente tick no repite el correo.
    reloj.avanzar(21 * 60 * 1000);
    await n.tick();
    expect(enviador.enviados).toHaveLength(1);

    await pos.cerrar();
  });

  it("el tope de alertas bloquea el lote, pero nunca el reporte del día", async () => {
    const reloj = relojFijo("2026-09-16T18:00:00.000-05:00");
    const { pos, itemId } = await posDePrueba(reloj);
    await pos.guardarConfig("notificaciones.topeAlertasDiario", 0);
    await cobrarVenta(pos, itemId, 2000);
    const enviador = enviadorDeCorreoFalso();
    const n = notificacionesDePrueba(pos, reloj, {
      enviador,
      obtenerAlertas: async () => [{ codigo: "RESPALDO_SIN_DESTINO", mensaje: "No hay respaldo externo." }],
    });

    await n.tick();
    reloj.avanzar(21 * 60 * 1000);
    await n.tick(); // intenta mandar el lote, pero el tope (0) lo bloquea
    expect(enviador.enviados).toHaveLength(0);
    expect(n.contadorDeHoy().usadosAlertas).toBe(0);

    await cerrarTurnoDePrueba(pos, 0, 2000);
    n.alCerrarTurno();
    reloj.avanzar(61 * 60 * 1000);
    await n.tick();
    expect(enviador.enviados).toHaveLength(1); // el reporte sí sale
    expect(n.contadorDeHoy().usadosHoy).toBe(1);

    await pos.cerrar();
  });
});

describe("reporte de cierre del día", () => {
  it("dos cierres el mismo día consolidan en un solo correo, no uno por cada uno", async () => {
    const reloj = relojFijo("2026-09-16T10:00:00.000-05:00");
    const { pos } = await posDePrueba(reloj);
    const enviador = enviadorDeCorreoFalso();
    const n = notificacionesDePrueba(pos, reloj, { enviador });

    await cerrarTurnoDePrueba(pos, 0, 2000);
    n.alCerrarTurno();

    reloj.avanzar(30 * 60 * 1000); // reabren dentro de la ventana de 60 min
    await cerrarTurnoDePrueba(pos, 0, 1500);
    n.alCerrarTurno(); // reprograma: debería anular el primer vencimiento

    await n.tick(); // todavía no pasaron 60 min desde el ÚLTIMO cierre
    expect(enviador.enviados).toHaveLength(0);

    reloj.avanzar(61 * 60 * 1000);
    await n.tick();
    expect(enviador.enviados).toHaveLength(1); // un solo correo, no dos

    await pos.cerrar();
  });

  it("recuperarAlArrancar manda el reporte pendiente si ya pasó la ventana", async () => {
    const reloj = relojFijo("2026-09-16T20:00:00.000-05:00");
    const dir = await carpetaTemporal();
    aBorrar.push(dir);

    let pos = await ServicioPos.abrir(await abrirAlmacen(dir, { reloj }));
    await pos.guardarConfig("ventas.exigirCliente", false);
    await pos.guardarConfig("ventas.exigirTurnoAbierto", false);
    await pos.guardarConfig("negocio.correoDueno", "dueno@cupula.test");
    const evento = itemNuevo("COR", "CORTE CLASICO", 2000);
    await pos.escribir(() => [evento]);
    await cobrarVenta(pos, itemIdDe(evento), 2000);
    await cerrarTurnoDePrueba(pos, 0, 2000);
    await pos.instantanea();
    await pos.cerrar();

    // Simula un reinicio del servidor 70 minutos después del cierre: nadie
    // llamó a `alCerrarTurno` en este proceso nuevo, así que sin recuperación
    // el reporte de hoy no saldría nunca.
    reloj.avanzar(70 * 60 * 1000);
    pos = await ServicioPos.abrir(await abrirAlmacen(dir, { reloj }));
    const enviador = enviadorDeCorreoFalso();
    const n = notificacionesDePrueba(pos, reloj, { enviador });

    await n.recuperarAlArrancar();
    expect(enviador.enviados).toHaveLength(1);

    await pos.cerrar();
  });

  it("recuperarAlArrancar reprograma en vez de mandar si todavía no pasó la ventana", async () => {
    const reloj = relojFijo("2026-09-16T20:00:00.000-05:00");
    const dir = await carpetaTemporal();
    aBorrar.push(dir);

    let pos = await ServicioPos.abrir(await abrirAlmacen(dir, { reloj }));
    await pos.guardarConfig("ventas.exigirCliente", false);
    await pos.guardarConfig("ventas.exigirTurnoAbierto", false);
    await pos.guardarConfig("negocio.correoDueno", "dueno@cupula.test");
    await cerrarTurnoDePrueba(pos, 0, 0);
    await pos.instantanea();
    await pos.cerrar();

    reloj.avanzar(10 * 60 * 1000); // solo 10 de los 60 min
    pos = await ServicioPos.abrir(await abrirAlmacen(dir, { reloj }));
    const enviador = enviadorDeCorreoFalso();
    const n = notificacionesDePrueba(pos, reloj, { enviador });

    await n.recuperarAlArrancar();
    expect(enviador.enviados).toHaveLength(0); // todavía no toca

    reloj.avanzar(51 * 60 * 1000);
    await n.tick();
    expect(enviador.enviados).toHaveLength(1); // y ahora sí

    await pos.cerrar();
  });
});

describe("recibo de venta por HTTP", () => {
  async function appDePrueba(enviador = enviadorDeCorreoFalso()) {
    const dir = await carpetaTemporal();
    aBorrar.push(dir);
    const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
    await pos.guardarConfig("ventas.exigirCliente", false);
    await pos.guardarConfig("ventas.exigirTurnoAbierto", false);

    const evento = itemNuevo("COR", "CORTE CLASICO", 2000);
    await pos.escribir(() => [evento]);

    const app = await construirApp({
      pos,
      impresora: new ImpresoraVistaPrevia(),
      respaldos: new ServicioDeRespaldos(dir, relojDelSistema, null),
      notificaciones: notificacionesDePrueba(pos, relojFijo(), { enviador }),
      carpetaDatos: dir,
      version: "pruebas",
    });
    return { app, pos, itemId: itemIdDe(evento) };
  }

  it("manda el recibo cuando viene correoRecibo, sin que afecte la venta", async () => {
    const enviador = enviadorDeCorreoFalso();
    const { app, itemId } = await appDePrueba(enviador);

    const r = await app.inject({
      method: "POST",
      url: "/api/ventas",
      payload: {
        lineas: [{ itemId, cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: ulid(),
        correoRecibo: "cliente@x.com",
      },
    });

    expect(r.statusCode).toBe(201);
    expect(r.json().correo).toEqual({ enviado: true });
    expect(enviador.enviados).toHaveLength(1);
    expect(enviador.enviados[0].to).toEqual(["cliente@x.com"]);
    await app.close();
  });

  it("si falla el envío, la venta queda registrada igual", async () => {
    const enviador = enviadorDeCorreoFalso();
    enviador.fallarSiempre = true;
    const { app, itemId } = await appDePrueba(enviador);

    const r = await app.inject({
      method: "POST",
      url: "/api/ventas",
      payload: {
        lineas: [{ itemId, cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: ulid(),
        correoRecibo: "cliente@x.com",
      },
    });

    expect(r.statusCode).toBe(201);
    expect(r.json().correo.enviado).toBe(false);
    expect(r.json().venta.total).toBe(2000);
    await app.close();
  });

  it("sin correoRecibo, no intenta mandar nada", async () => {
    const enviador = enviadorDeCorreoFalso();
    const { app, itemId } = await appDePrueba(enviador);

    const r = await app.inject({
      method: "POST",
      url: "/api/ventas",
      payload: {
        lineas: [{ itemId, cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: ulid(),
      },
    });

    expect(r.statusCode).toBe(201);
    expect(r.json().correo).toBeUndefined();
    expect(enviador.enviados).toHaveLength(0);
    await app.close();
  });
});
