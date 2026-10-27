import { SEDE_PRINCIPAL } from "@cupula/contratos";
/**
 * Compras: varios productos en una sola acción, con su costo, y el egreso
 * que sale solo cuando de verdad salió plata del cajón.
 *
 * La matemática del costo promedio ponderado ya está probada donde vive de
 * verdad (`stock.entrada`); acá lo que importa es que una compra junte bien
 * varias líneas y que el egreso aparezca —o no— según corresponda.
 */

import { describe, expect, it, afterEach } from "vitest";

import { ServicioPos } from "../src/servicios/Pos";
import { crearItem } from "../src/dominio/catalogo/catalogo";
import { registrarCompra } from "../src/dominio/compras/compras";
import { arquear, abrirTurno } from "../src/dominio/caja/caja";
import { abrirAlmacen, borrar, carpetaTemporal } from "./ayuda";

const aBorrar: string[] = [];
afterEach(async () => {
  await Promise.all(aBorrar.splice(0).map(borrar));
});

async function posConDosProductos() {
  const dir = await carpetaTemporal();
  aBorrar.push(dir);
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir));

  const ceraId = await pos.transaccion(() => {
    const r = crearItem(pos.p, {
      codigo: "CERA",
      nombre: "CERA",
      tipo: "PRODUCTO",
      categoria: "P",
      precio: 4500,
      stockInicial: 0,
    });
    return { eventos: r.eventos, resultado: r.itemId };
  });
  const shampooId = await pos.transaccion(() => {
    const r = crearItem(pos.p, {
      codigo: "SHAMPOO",
      nombre: "SHAMPOO",
      tipo: "PRODUCTO",
      categoria: "P",
      precio: 3000,
      stockInicial: 0,
    });
    return { eventos: r.eventos, resultado: r.itemId };
  });
  const corteId = await pos.transaccion(() => {
    const r = crearItem(pos.p, { codigo: "COR", nombre: "CORTE", tipo: "SERVICIO", categoria: "B", precio: 2000 });
    return { eventos: r.eventos, resultado: r.itemId };
  });

  return { pos, ceraId, shampooId, corteId };
}

describe("registrar una compra", () => {
  it("todas las líneas entran al inventario", async () => {
    const { pos, ceraId, shampooId } = await posConDosProductos();

    await pos.transaccion(() => {
      const r = registrarCompra(pos.p, SEDE_PRINCIPAL, {
        lineas: [
          { itemId: ceraId, cantidad: 10, costoUnitario: 2000 },
          { itemId: shampooId, cantidad: 5, costoUnitario: 1500 },
        ],
        proveedor: "Distribuidora XYZ",
      });
      return { eventos: r.eventos, resultado: r };
    });

    expect(pos.p.stockDe(SEDE_PRINCIPAL, ceraId)).toBe(10);
    expect(pos.p.stockDe(SEDE_PRINCIPAL, shampooId)).toBe(5);
    expect(pos.p.items.get(ceraId)!.costo).toBe(2000);
    expect(pos.p.items.get(shampooId)!.costo).toBe(1500);
    await pos.cerrar();
  });

  it("por defecto genera el egreso por el total, descontando el efectivo esperado", async () => {
    const { pos, ceraId } = await posConDosProductos();
    await pos.escribir(() => abrirTurno(pos.p, SEDE_PRINCIPAL, { montoInicial: 50000 }).eventos);

    await pos.transaccion(() => {
      const r = registrarCompra(pos.p, SEDE_PRINCIPAL, {
        lineas: [{ itemId: ceraId, cantidad: 10, costoUnitario: 2000 }],
      });
      return { eventos: r.eventos, resultado: r };
    });

    const egreso = [...pos.p.egresos.values()][0];
    expect(egreso.categoria).toBe("COMPRA");
    expect(egreso.monto).toBe(20000); // 10 × 2000

    const arqueo = arquear(pos.p, SEDE_PRINCIPAL);
    expect(arqueo.efectivoEnCajon).toBe(30000); // 50000 - 20000
    await pos.cerrar();
  });

  it("con salioDeLaCaja: false no genera ningún egreso", async () => {
    const { pos, ceraId } = await posConDosProductos();
    await pos.escribir(() => abrirTurno(pos.p, SEDE_PRINCIPAL, { montoInicial: 50000 }).eventos);

    await pos.transaccion(() => {
      const r = registrarCompra(pos.p, SEDE_PRINCIPAL, {
        lineas: [{ itemId: ceraId, cantidad: 10, costoUnitario: 2000 }],
        salioDeLaCaja: false,
      });
      return { eventos: r.eventos, resultado: r };
    });

    expect(pos.p.egresos.size).toBe(0);
    expect(pos.p.stockDe(SEDE_PRINCIPAL, ceraId)).toBe(10); // el inventario igual se actualiza
    expect(arquear(pos.p, SEDE_PRINCIPAL).efectivoEnCajon).toBe(50000); // intacto
    await pos.cerrar();
  });

  it("rechaza una compra sin líneas", async () => {
    const { pos } = await posConDosProductos();
    expect(() => registrarCompra(pos.p, SEDE_PRINCIPAL, { lineas: [] })).toThrow(/no hay nada que registrar/i);
    await pos.cerrar();
  });

  it("rechaza un costo negativo", async () => {
    const { pos, ceraId } = await posConDosProductos();
    expect(() =>
      registrarCompra(pos.p, SEDE_PRINCIPAL, { lineas: [{ itemId: ceraId, cantidad: 10, costoUnitario: -100 }] }),
    ).toThrow(/costo/i);
    await pos.cerrar();
  });

  it("rechaza una línea de un servicio: no es producto", async () => {
    const { pos, corteId } = await posConDosProductos();
    expect(() =>
      registrarCompra(pos.p, SEDE_PRINCIPAL, { lineas: [{ itemId: corteId, cantidad: 1, costoUnitario: 500 }] }),
    ).toThrow();
    await pos.cerrar();
  });
});
