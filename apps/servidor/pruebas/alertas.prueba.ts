/**
 * `calcularAlertas` es pura: nada de esto toca disco. Lo que hay que
 * verificar es que cada condición dispare SU alerta y nada más — en
 * particular, que los dos casos "todavía no sé" (sin respaldo configurado
 * nunca verificado, impresora en modo vista previa) no disparen falsos
 * positivos.
 */

import { describe, expect, it } from "vitest";

import { calcularAlertas } from "../src/consultas/alertas";

const BASE = {
  relojAtrasado: null,
  lineasEnCuarentena: 0,
  respaldos: null,
  impresoraConfigurada: false,
  impresora: { disponible: false, detalle: "Vista previa" },
  enNube: false,
  redesCajero: "",
};

describe("calcularAlertas", () => {
  it("no avisa nada cuando todo está en el estado normal de un día cualquiera", () => {
    expect(calcularAlertas(BASE)).toEqual([]);
  });

  it("avisa si el reloj parece atrasado", () => {
    const alertas = calcularAlertas({
      ...BASE,
      relojAtrasado: { ultimoEvento: "2026-09-16T10:00:00.000-05:00", alAbrir: "2020-01-01T00:00:00.000-05:00" },
    });
    expect(alertas.map((a) => a.codigo)).toContain("RELOJ_ATRASADO");
  });

  it("avisa si hay líneas en cuarentena", () => {
    const alertas = calcularAlertas({ ...BASE, lineasEnCuarentena: 2 });
    expect(alertas.map((a) => a.codigo)).toContain("LINEAS_EN_CUARENTENA");
  });

  it("no avisa de respaldos si todavía no se verificó nunca (null, no false)", () => {
    const alertas = calcularAlertas({ ...BASE, respaldos: null });
    expect(alertas.map((a) => a.codigo)).not.toContain("RESPALDO_SIN_DESTINO");
  });

  it("avisa si el último chequeo real del respaldo externo falló", () => {
    const alertas = calcularAlertas({ ...BASE, respaldos: { ok: false, detalle: "el USB está desconectado" } });
    expect(alertas.map((a) => a.codigo)).toContain("RESPALDO_SIN_DESTINO");
  });

  it("no avisa de la impresora si todavía no se configuró ninguna (modo vista previa)", () => {
    const alertas = calcularAlertas({
      ...BASE,
      impresoraConfigurada: false,
      impresora: { disponible: false, detalle: "Vista previa (sin impresora configurada)" },
    });
    expect(alertas.map((a) => a.codigo)).not.toContain("IMPRESORA_CON_ERROR");
  });

  it("avisa si hay una impresora configurada que no responde", () => {
    const alertas = calcularAlertas({
      ...BASE,
      impresoraConfigurada: true,
      impresora: { disponible: false, detalle: "No responde." },
    });
    expect(alertas.map((a) => a.codigo)).toContain("IMPRESORA_CON_ERROR");
  });

  it("no avisa de la impresora si está configurada y respondiendo", () => {
    const alertas = calcularAlertas({
      ...BASE,
      impresoraConfigurada: true,
      impresora: { disponible: true, detalle: "Todo bien." },
    });
    expect(alertas.map((a) => a.codigo)).not.toContain("IMPRESORA_CON_ERROR");
  });

  it("puede avisar varias cosas a la vez", () => {
    const alertas = calcularAlertas({
      ...BASE,
      lineasEnCuarentena: 1,
      respaldos: { ok: false, detalle: "no hay destino" },
      impresoraConfigurada: true,
      impresora: { disponible: false },
    });
    expect(alertas).toHaveLength(3);
  });

  it("no avisa de la red del cajero fuera de Railway, aunque esté vacía", () => {
    const alertas = calcularAlertas({ ...BASE, enNube: false, redesCajero: "" });
    expect(alertas.map((a) => a.codigo)).not.toContain("CAJERO_SIN_RESTRICCION_DE_RED");
  });

  it("avisa si está en Railway y la red del cajero quedó vacía", () => {
    const alertas = calcularAlertas({ ...BASE, enNube: true, redesCajero: "" });
    expect(alertas.map((a) => a.codigo)).toContain("CAJERO_SIN_RESTRICCION_DE_RED");
  });

  it("no avisa si está en Railway pero ya hay una red configurada", () => {
    const alertas = calcularAlertas({ ...BASE, enNube: true, redesCajero: "181.64.123.45" });
    expect(alertas.map((a) => a.codigo)).not.toContain("CAJERO_SIN_RESTRICCION_DE_RED");
  });
});
