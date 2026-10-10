/**
 * El papel del cierre de turno: lo que lleva impreso, decidido a propósito
 * con el dueño (ver `DatosDelCierre` en `puertos/Impresora.ts`) — ventas por
 * barbero, egresos con su motivo y la diferencia de caja, de forma compacta.
 */

import { describe, expect, it } from "vitest";

import { PERFIL_GENERICO_80 } from "../src/adaptadores/impresora/perfil";
import { renderCierreEscPos, renderCierreTexto } from "../src/adaptadores/impresora/renderCierre";
import type { DatosDelCierre, DatosDelNegocio } from "../src/puertos/Impresora";

const NEGOCIO: DatosDelNegocio = {
  nombre: "LA CÚPULA TATTOO BARBER SHOP",
  direccion: "AV. SIEMPRE VIVA 742",
  ciudad: "Lima",
  ruc: "20100000001",
  pie: "",
};

function cierreDePrueba(cambios: Partial<DatosDelCierre> = {}): DatosDelCierre {
  return {
    turnoId: "01TURNO",
    abiertoEn: "2026-09-16T09:00:00.000-05:00",
    cerradoEn: "2026-09-16T21:03:00.000-05:00",
    montoInicial: 10000,
    medios: { EFECTIVO: 32000, YAPE: 12000, TARJETA: 10000 },
    totalVendido: 54000,
    cantidadVentas: 18,
    egresos: [
      { monto: 3000, motivo: "Insumos de limpieza" },
      { monto: 1500, motivo: "Taxi" },
    ],
    totalEgresos: 4500,
    efectivoEnCajon: 37500,
    contadoEfectivo: 37000,
    diferencia: -500,
    porBarbero: [
      { nombre: "Juan", cantidad: 10, total: 30000 },
      { nombre: "Luis", cantidad: 8, total: 24000 },
    ],
    ...cambios,
  };
}

describe("ticket de cierre de turno", () => {
  it("lleva ventas, medios de pago, egresos con motivo, diferencia y producción por barbero", () => {
    const texto = renderCierreTexto(cierreDePrueba(), NEGOCIO, PERFIL_GENERICO_80);

    expect(texto).toContain("CIERRE DE TURNO");
    expect(texto).toContain("18"); // cantidad de ventas
    expect(texto).toContain("540.00"); // total vendido
    expect(texto).toContain("Insumos de limpieza");
    expect(texto).toContain("Taxi");
    expect(texto).toContain("-5.00"); // diferencia, faltaron S/ 5
    expect(texto).toContain("Juan");
    expect(texto).toContain("Luis");
  });

  it("si no hubo egresos, no imprime esa sección", () => {
    const texto = renderCierreTexto(cierreDePrueba({ egresos: [], totalEgresos: 0 }), NEGOCIO, PERFIL_GENERICO_80);
    expect(texto).not.toContain("Egresos");
  });

  it("si nadie tiene barbero asignado, no imprime 'Por barbero'", () => {
    const texto = renderCierreTexto(cierreDePrueba({ porBarbero: [] }), NEGOCIO, PERFIL_GENERICO_80);
    expect(texto).not.toContain("Por barbero");
  });

  it("si la caja cuadró exacto, lo dice en texto y no 'S/ 0.00'", () => {
    const texto = renderCierreTexto(cierreDePrueba({ diferencia: 0 }), NEGOCIO, PERFIL_GENERICO_80);
    expect(texto).toContain("cuadró");
  });

  it("solo muestra los medios de pago que de verdad se usaron", () => {
    const texto = renderCierreTexto(
      cierreDePrueba({ medios: { EFECTIVO: 20000, YAPE: 0, TARJETA: 0 } }),
      NEGOCIO,
      PERFIL_GENERICO_80,
    );
    expect(texto).toContain("Efectivo");
    expect(texto).not.toContain("Yape");
    expect(texto).not.toContain("Tarjeta");
  });

  it("los bytes ESC/POS se generan sin reventar", () => {
    const bytes = renderCierreEscPos(cierreDePrueba(), NEGOCIO, PERFIL_GENERICO_80);
    expect(bytes.length).toBeGreaterThan(0);
  });
});
