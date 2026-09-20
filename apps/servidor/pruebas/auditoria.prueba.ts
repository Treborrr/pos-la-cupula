/**
 * Pruebas del export de auditoría.
 *
 * Lo que importa de este archivo no es que se genere, sino que las señales
 * aparezcan: es lo único que hace que revisar el log sea viable. Una señal que
 * deja de dispararse no rompe nada visible —el archivo sale igual— y eso lo
 * vuelve el candidato perfecto a podrirse en silencio.
 */

import { describe, expect, it, afterEach } from "vitest";
import { ulid } from "ulid";

import { ServicioPos } from "../src/servicios/Pos";
import { crearItem } from "../src/dominio/catalogo/catalogo";
import { crearBarbero } from "../src/dominio/barberos/barberos";
import { registrarCliente } from "../src/dominio/clientes/clientes";
import { abrirTurno, cerrarTurno } from "../src/dominio/caja/caja";
import { registrarMerma, ajustarStock } from "../src/dominio/inventario/inventario";
import { construirAuditoria, formatearAuditoria } from "../src/consultas/auditoria";
import { abrirAlmacen, borrar, carpetaTemporal, relojFijo } from "./ayuda";

const aBorrar: string[] = [];
afterEach(async () => {
  await Promise.all(aBorrar.splice(0).map(borrar));
});

async function posConMovimientos() {
  const dir = await carpetaTemporal();
  aBorrar.push(dir);
  // Reloj fijo a las 10:00. Con el reloj real, la señal de "fuera del horario
  // habitual" se dispara sola si las pruebas corren de madrugada, y el archivo
  // de auditoría sale distinto según la hora del día.
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir, { reloj: relojFijo() }));

  const corte = await pos.transaccion(() => {
    const r = crearItem(pos.p, { codigo: "COR", nombre: "CORTE", tipo: "SERVICIO", categoria: "B", precio: 2000 });
    return { eventos: r.eventos, resultado: r.itemId };
  });
  const cera = await pos.transaccion(() => {
    const r = crearItem(pos.p, {
      codigo: "CERA",
      nombre: "CERA",
      tipo: "PRODUCTO",
      categoria: "P",
      precio: 2500,
      stockInicial: 10,
    });
    return { eventos: r.eventos, resultado: r.itemId };
  });
  const barberoId = await pos.transaccion(() => {
    const r = crearBarbero(pos.p, "Kevin");
    return { eventos: r.eventos, resultado: r.barberoId };
  });
  const clienteId = await pos.transaccion(() => {
    const r = registrarCliente(pos.p, { nombre: "Juan Pérez" });
    return { eventos: r.eventos, resultado: r.clienteId };
  });

  return { pos, dir, corte, cera, barberoId, clienteId };
}

const señal = (a: Awaited<ReturnType<typeof construirAuditoria>>, tipo: string) =>
  a.señales.find((s) => s.tipo.toLowerCase().includes(tipo.toLowerCase()));

describe("auditoría", () => {
  it("resuelve nombres en vez de dejar identificadores", async () => {
    const { pos, dir, corte, barberoId, clienteId } = await posConMovimientos();
    await pos.cobrar({
      lineas: [{ itemId: corte, cantidad: 1, barberoId }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      clienteId,
      claveIdempotencia: ulid(),
    });

    const a = await construirAuditoria(pos.almacen, dir, "2026-09-18T20:00:00.000-05:00");
    const venta = a.movimientos.find((m) => m.tipo === "venta")!;

    expect(venta.detalle).toContain("CORTE");
    expect(venta.detalle).toContain("JUAN PÉREZ");
    expect(venta.detalle).toContain("Kevin");
    // Ni un ULID suelto: si aparece uno, el archivo dejó de ser legible.
    expect(venta.detalle).not.toMatch(/[0-9A-HJKMNP-TV-Z]{26}/);
    await pos.cerrar();
  });

  it("marca la anulación de una venta en efectivo con cuánto tardó", async () => {
    const { pos, dir, corte, clienteId } = await posConMovimientos();
    const r = await pos.cobrar({
      lineas: [{ itemId: corte, cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      clienteId,
      claveIdempotencia: ulid(),
    });
    await pos.anular(r.venta.id, "se arrepintió");

    const a = await construirAuditoria(pos.almacen, dir, "2026-09-18T20:00:00.000-05:00");
    const s = señal(a, "anulaciones");

    expect(s?.cuantas).toBe(1);
    expect(s?.detalle[0]).toContain("EN EFECTIVO");
    expect(s?.detalle[0]).toContain("se arrepintió");
    await pos.cerrar();
  });

  it("delata el cobro por debajo del precio de lista", async () => {
    const { pos, dir, corte, clienteId } = await posConMovimientos();
    await pos.cobrar({
      lineas: [{ itemId: corte, cantidad: 1, precioUnitario: 1000 }], // lista: 20.00
      pagos: [{ medio: "EFECTIVO", monto: 1000 }],
      clienteId,
      claveIdempotencia: ulid(),
    });

    const a = await construirAuditoria(pos.almacen, dir, "2026-09-18T20:00:00.000-05:00");
    const s = señal(a, "por debajo del precio de lista");

    expect(s?.cuantas).toBe(1);
    expect(s?.detalle[0]).toContain("cobrado 10.00");
    expect(s?.detalle[0]).toContain("lista 20.00");
    await pos.cerrar();
  });

  it("reporta el faltante de caja con el monto exacto", async () => {
    const { pos, dir, corte, clienteId } = await posConMovimientos();
    await pos.escribir(() => abrirTurno(pos.p, { montoInicial: 5000 }).eventos);
    await pos.cobrar({
      lineas: [{ itemId: corte, cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      clienteId,
      claveIdempotencia: ulid(),
    });
    // Esperado 70.00, se cuentan 65.00.
    await pos.escribir(() => cerrarTurno(pos.p, { contadoEfectivo: 6500 }).eventos);

    const a = await construirAuditoria(pos.almacen, dir, "2026-09-18T20:00:00.000-05:00");
    const s = señal(a, "no cuadraron");

    expect(s?.cuantas).toBe(1);
    expect(s?.detalle[0]).toContain("falta 5.00");
    expect(a.turnos[0].diferencia).toBe(-5);
    await pos.cerrar();
  });

  it("junta las salidas de mercadería que no son venta", async () => {
    const { pos, dir, cera } = await posConMovimientos();
    await pos.escribir(() => registrarMerma(pos.p, { itemId: cera, cantidad: 2, motivo: "se rompió" }));
    await pos.escribir(() =>
      ajustarStock(pos.p, { itemId: cera, cantidadContada: 3, motivo: "conteo" }),
    );

    const a = await construirAuditoria(pos.almacen, dir, "2026-09-18T20:00:00.000-05:00");

    expect(señal(a, "mermas")?.cuantas).toBe(1);
    const ajuste = señal(a, "ajustes de stock con faltante");
    expect(ajuste?.cuantas).toBe(1);
    expect(ajuste?.detalle[0]).toContain("faltan 5"); // 8 en sistema, 3 contadas
    await pos.cerrar();
  });

  it("no inventa señales cuando el día fue normal", async () => {
    const { pos, dir, corte, clienteId } = await posConMovimientos();
    await pos.escribir(() => abrirTurno(pos.p, { montoInicial: 5000 }).eventos);
    await pos.cobrar({
      lineas: [{ itemId: corte, cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      clienteId,
      claveIdempotencia: ulid(),
    });
    await pos.escribir(() => cerrarTurno(pos.p, { contadoEfectivo: 7000 }).eventos);

    const a = await construirAuditoria(pos.almacen, dir, "2026-09-18T20:00:00.000-05:00");

    // Un día sin nada raro no debe producir ruido: si esto empieza a fallar,
    // las señales dejaron de significar algo.
    expect(a.señales).toHaveLength(0);
    expect(a.integridad.ok).toBe(true);
    await pos.cerrar();
  });

  it("el archivo avisa que nadie firma los movimientos", async () => {
    const { pos, dir } = await posConMovimientos();
    const a = await construirAuditoria(pos.almacen, dir, "2026-09-18T20:00:00.000-05:00");
    const texto = formatearAuditoria(a);

    // Sin login no hay identidad de operador, y quien lea el archivo tiene que
    // saberlo antes de acusar a nadie.
    expect(texto).toContain("NINGÚN movimiento");
    expect(texto).toContain("turno de caja");
    await pos.cerrar();
  });
});
