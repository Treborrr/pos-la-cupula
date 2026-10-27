import { SEDE_PRINCIPAL } from "@cupula/contratos";
/**
 * Adelantos, liquidación y el reporte de producción por barbero.
 *
 * Dato de GESTIÓN, no una liquidación de sueldo (D6: sueldo fijo, sin
 * comisiones). Lo que importa probar es que el saldo pendiente se calcule
 * bien —dos orígenes distintos, una sola cuenta— y que liquidar de verdad
 * la deje en cero sin tocar lo que pasó antes.
 */

import { describe, expect, it, afterEach } from "vitest";
import { ulid } from "ulid";

import { ServicioPos } from "../src/servicios/Pos";
import { crearItem } from "../src/dominio/catalogo/catalogo";
import { crearBarbero } from "../src/dominio/barberos/barberos";
import {
  adelantosPendientesDeBarbero,
  liquidarBarbero,
  saldoPendienteDeBarbero,
} from "../src/dominio/barberos/barberos";
import { registrarEgreso } from "../src/dominio/caja/caja";
import { reporteDeBarbero } from "../src/consultas/barberos";
import { abrirAlmacen, borrar, carpetaTemporal, relojFijo } from "./ayuda";

const aBorrar: string[] = [];
afterEach(async () => {
  await Promise.all(aBorrar.splice(0).map(borrar));
});

async function posConBarberoYServicio(fechaInicial = "2026-09-15T10:00:00.000-05:00") {
  const dir = await carpetaTemporal();
  aBorrar.push(dir);
  const reloj = relojFijo(fechaInicial);
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir, { reloj }));
  await pos.guardarConfig("ventas.exigirCliente", false);
  await pos.guardarConfig("ventas.exigirTurnoAbierto", false);

  const { itemId } = await pos.transaccion(() => {
    const r = crearItem(pos.p, { codigo: "COR", nombre: "CORTE", tipo: "SERVICIO", categoria: "B", precio: 2000 });
    return { eventos: r.eventos, resultado: r };
  });
  const ceraId = await pos.transaccion(() => {
    const r = crearItem(pos.p, {
      codigo: "CERA",
      nombre: "CERA",
      tipo: "PRODUCTO",
      categoria: "P",
      precio: 1500,
      stockInicial: 20,
    });
    return { eventos: r.eventos, resultado: r.itemId };
  });
  const barberoId = await pos.transaccion(() => {
    const r = crearBarbero(pos.p, "Kevin");
    return { eventos: r.eventos, resultado: r.barberoId };
  });

  return { pos, dir, itemId, ceraId, barberoId, reloj };
}

describe("saldo pendiente de adelantos", () => {
  it("suma un adelanto en efectivo", async () => {
    const { pos, barberoId } = await posConBarberoYServicio();
    await pos.escribir(
      () => registrarEgreso(pos.p, SEDE_PRINCIPAL, { monto: 5000, motivo: "Almuerzo", categoria: "ADELANTO", barberoId }).eventos,
    );

    expect(saldoPendienteDeBarbero(pos.p, barberoId)).toBe(5000);
    await pos.cerrar();
  });

  it("suma una venta pagada por adelanto", async () => {
    const { pos, itemId, barberoId } = await posConBarberoYServicio();
    await pos.cobrar(SEDE_PRINCIPAL, {
      lineas: [{ itemId, cantidad: 1 }],
      pagos: [{ medio: "ADELANTO", monto: 2000, barberoId }],
      claveIdempotencia: ulid(),
    });

    expect(saldoPendienteDeBarbero(pos.p, barberoId)).toBe(2000);
    await pos.cerrar();
  });

  it("suma los dos orígenes juntos", async () => {
    const { pos, itemId, barberoId } = await posConBarberoYServicio();
    await pos.escribir(
      () => registrarEgreso(pos.p, SEDE_PRINCIPAL, { monto: 5000, motivo: "Almuerzo", categoria: "ADELANTO", barberoId }).eventos,
    );
    await pos.cobrar(SEDE_PRINCIPAL, {
      lineas: [{ itemId, cantidad: 1 }],
      pagos: [{ medio: "ADELANTO", monto: 2000, barberoId }],
      claveIdempotencia: ulid(),
    });

    expect(saldoPendienteDeBarbero(pos.p, barberoId)).toBe(7000);
    await pos.cerrar();
  });

  it("una venta anulada pagada por adelanto no cuenta", async () => {
    const { pos, itemId, barberoId } = await posConBarberoYServicio();
    const { venta } = await pos.cobrar(SEDE_PRINCIPAL, {
      lineas: [{ itemId, cantidad: 1 }],
      pagos: [{ medio: "ADELANTO", monto: 2000, barberoId }],
      claveIdempotencia: ulid(),
    });
    await pos.anular(venta.id, "se arrepintió");

    expect(saldoPendienteDeBarbero(pos.p, barberoId)).toBe(0);
    await pos.cerrar();
  });

  it("no mezcla el adelanto de un barbero con el de otro", async () => {
    const { pos, barberoId } = await posConBarberoYServicio();
    const otroId = await pos.transaccion(() => {
      const r = crearBarbero(pos.p, "Juan");
      return { eventos: r.eventos, resultado: r.barberoId };
    });
    await pos.escribir(
      () => registrarEgreso(pos.p, SEDE_PRINCIPAL, { monto: 1000, motivo: "Taxi", categoria: "ADELANTO", barberoId: otroId }).eventos,
    );

    expect(saldoPendienteDeBarbero(pos.p, barberoId)).toBe(0);
    expect(saldoPendienteDeBarbero(pos.p, otroId)).toBe(1000);
    await pos.cerrar();
  });
});

describe("liquidar", () => {
  it("deja el saldo en cero y lo que se liquidó queda en el historial", async () => {
    const { pos, barberoId } = await posConBarberoYServicio();
    await pos.escribir(
      () => registrarEgreso(pos.p, SEDE_PRINCIPAL, { monto: 5000, motivo: "Almuerzo", categoria: "ADELANTO", barberoId }).eventos,
    );

    const liquidacionId = await pos.transaccion(() => {
      const r = liquidarBarbero(pos.p, barberoId);
      return { eventos: r.eventos, resultado: r.liquidacionId };
    });

    expect(saldoPendienteDeBarbero(pos.p, barberoId)).toBe(0);
    expect(pos.p.liquidaciones.get(liquidacionId)?.monto).toBe(5000);
    await pos.cerrar();
  });

  it("un adelanto nuevo después de liquidar sí queda pendiente, el viejo no", async () => {
    const { pos, barberoId, reloj } = await posConBarberoYServicio();
    await pos.escribir(
      () => registrarEgreso(pos.p, SEDE_PRINCIPAL, { monto: 5000, motivo: "Almuerzo", categoria: "ADELANTO", barberoId }).eventos,
    );
    await pos.transaccion(() => {
      const r = liquidarBarbero(pos.p, barberoId);
      return { eventos: r.eventos, resultado: null };
    });

    reloj.avanzar(60 * 60 * 1000);
    await pos.escribir(
      () => registrarEgreso(pos.p, SEDE_PRINCIPAL, { monto: 1500, motivo: "Taxi", categoria: "ADELANTO", barberoId }).eventos,
    );

    expect(saldoPendienteDeBarbero(pos.p, barberoId)).toBe(1500);
    const pendientes = adelantosPendientesDeBarbero(pos.p, barberoId);
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0].monto).toBe(1500);
    await pos.cerrar();
  });

  it("rechaza liquidar sin saldo pendiente", async () => {
    const { pos, barberoId } = await posConBarberoYServicio();
    expect(() => liquidarBarbero(pos.p, barberoId)).toThrow(/no tiene ningún adelanto/);
    await pos.cerrar();
  });

  it("rechaza liquidar un barbero que no existe", async () => {
    const { pos } = await posConBarberoYServicio();
    expect(() => liquidarBarbero(pos.p, "no-existe")).toThrow(/no existe/);
    await pos.cerrar();
  });
});

describe("reporte de producción por barbero", () => {
  it("agrupa por semana (lunes a domingo) y marca los cortes gratis", async () => {
    // 2026-09-15 es martes de la semana del 14 al 20.
    const { pos, itemId, ceraId, barberoId, reloj } = await posConBarberoYServicio("2026-09-15T10:00:00.000-05:00");

    // Un corte normal.
    await pos.cobrar(SEDE_PRINCIPAL, {
      lineas: [{ itemId, cantidad: 1, barberoId }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });

    // Un corte de cortesía, combinado con una cera pagada (si no, el total
    // daría S/0 y el sistema no deja registrar la venta).
    await pos.cobrar(SEDE_PRINCIPAL, {
      lineas: [
        { itemId, cantidad: 1, barberoId, precioUnitario: 0 },
        { itemId: ceraId, cantidad: 1 },
      ],
      pagos: [{ medio: "EFECTIVO", monto: 1500 }],
      claveIdempotencia: ulid(),
    });

    // Un corte la semana siguiente.
    reloj.avanzar(8 * 24 * 60 * 60 * 1000); // +8 días: 2026-09-23, miércoles
    await pos.cobrar(SEDE_PRINCIPAL, {
      lineas: [{ itemId, cantidad: 1, barberoId }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });

    const r = reporteDeBarbero(pos.p, barberoId, "2026-09-01", "2026-09-30");
    expect(r.semanas).toHaveLength(2);

    // Más reciente primero.
    expect(r.semanas[0].desde).toBe("2026-09-21");
    expect(r.semanas[0].cantidad).toBe(1);
    expect(r.semanas[0].cantidadGratis).toBe(0);

    const primera = r.semanas[1];
    expect(primera.desde).toBe("2026-09-14");
    expect(primera.hasta).toBe("2026-09-20");
    // La línea de la cera no es del barbero, no entra en su reporte.
    expect(primera.lineas).toHaveLength(2);
    expect(primera.cantidadGratis).toBe(1);
    expect(primera.total).toBe(2000); // el corte normal; el gratis suma 0

    await pos.cerrar();
  });

  it("no incluye líneas de otro barbero ni ventas anuladas", async () => {
    const { pos, itemId, barberoId } = await posConBarberoYServicio();
    const otroId = await pos.transaccion(() => {
      const r = crearBarbero(pos.p, "Juan");
      return { eventos: r.eventos, resultado: r.barberoId };
    });

    await pos.cobrar(SEDE_PRINCIPAL, {
      lineas: [{ itemId, cantidad: 1, barberoId: otroId }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });
    const { venta } = await pos.cobrar(SEDE_PRINCIPAL, {
      lineas: [{ itemId, cantidad: 1, barberoId }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });
    await pos.anular(venta.id, "se arrepintió");

    const r = reporteDeBarbero(pos.p, barberoId, "2026-09-01", "2026-09-30");
    expect(r.semanas).toHaveLength(0);
    await pos.cerrar();
  });

  it("trae los adelantos pendientes y la última liquidación", async () => {
    const { pos, barberoId } = await posConBarberoYServicio();
    await pos.escribir(
      () => registrarEgreso(pos.p, SEDE_PRINCIPAL, { monto: 3000, motivo: "Taxi", categoria: "ADELANTO", barberoId }).eventos,
    );

    let r = reporteDeBarbero(pos.p, barberoId, "2026-09-01", "2026-09-30");
    expect(r.saldoPendiente).toBe(3000);
    expect(r.ultimaLiquidacion).toBeNull();

    await pos.transaccion(() => {
      const res = liquidarBarbero(pos.p, barberoId);
      return { eventos: res.eventos, resultado: null };
    });

    r = reporteDeBarbero(pos.p, barberoId, "2026-09-01", "2026-09-30");
    expect(r.saldoPendiente).toBe(0);
    expect(r.ultimaLiquidacion?.monto).toBe(3000);
    await pos.cerrar();
  });
});
