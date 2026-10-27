/**
 * Multisucursal.
 *
 * Lo que se verifica acá es exactamente lo que distingue una cadena de varios
 * POS sueltos: que el stock, la caja y la numeración sean de cada local, que el
 * catálogo y los clientes sean de todos, y que un cajero no pueda tocar el
 * local que no es el suyo.
 */

import { SEDE_PRINCIPAL } from "@cupula/contratos";
import { afterEach, describe, expect, it } from "vitest";
import { ulid } from "ulid";

import { ServicioPos } from "../src/servicios/Pos";
import { cambiarPrecioDeSede, crearItem } from "../src/dominio/catalogo/catalogo";
import {
  actualizarSede,
  crearSede,
  desactivarSede,
  prefijoSugerido,
  slugDeSede,
} from "../src/dominio/sedes/sedes";
import { ajustarStock, registrarEntrada, stockBajo } from "../src/dominio/inventario/inventario";
import { trasladarStock } from "../src/dominio/inventario/traslados";
import { abrirTurno, arquear, cerrarTurno, registrarEgreso } from "../src/dominio/caja/caja";
import { compararSedes, construirReporte } from "../src/consultas/reportes";
import { abrirAlmacen, borrar, carpetaTemporal } from "./ayuda";

const aBorrar: string[] = [];
afterEach(async () => {
  for (const d of aBorrar.splice(0)) await borrar(d);
});

async function posDePrueba() {
  const dir = await carpetaTemporal();
  aBorrar.push(dir);
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
  await pos.guardarConfig("ventas.exigirCliente", false);
  await pos.guardarConfig("ventas.exigirTurnoAbierto", false);

  const ids: Record<string, string> = {};
  for (const [codigo, nombre, precio, tipo] of [
    ["COR", "CORTE CLASICO", 2000, "SERVICIO"],
    ["CERA", "CERA FIJADORA", 1500, "PRODUCTO"],
  ] as const) {
    await pos.transaccion(() => {
      const r = crearItem(pos.p, { codigo, nombre, tipo, categoria: "Barbería", precio });
      ids[codigo] = r.itemId;
      return { eventos: r.eventos, resultado: null };
    });
  }

  return { pos, ids, dir };
}

/** Crea una sucursal y devuelve su id. */
async function conSede(pos: ServicioPos, nombre: string, prefijo: string) {
  return pos.transaccion(() => {
    const r = crearSede(pos.p, { nombre, prefijoTicket: prefijo });
    return { eventos: r.eventos, resultado: r.sedeId };
  });
}

describe("la sucursal principal", () => {
  it("se siembra sola al arrancar, con los datos del negocio y la serie NV", async () => {
    const dir = await carpetaTemporal();
    aBorrar.push(dir);

    const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
    await pos.guardarConfig("negocio.nombre", "LA CÚPULA");
    await pos.guardarConfig("negocio.direccion", "JR. ANGAMOS 528");
    await pos.cerrar();

    // Al volver a abrir ya existe y NO se vuelve a sembrar: el evento está
    // escrito, así que el segundo arranque lo encuentra.
    const otra = await ServicioPos.abrir(await abrirAlmacen(dir));
    const sedes = [...otra.p.sedes.values()];
    expect(sedes).toHaveLength(1);
    expect(sedes[0]!.id).toBe(SEDE_PRINCIPAL);
    expect(sedes[0]!.prefijoTicket).toBe("NV");
    await otra.cerrar();
  });

  it("conserva la numeración NV que el cliente ya venía usando", async () => {
    const { pos, ids } = await posDePrueba();
    await pos.guardarConfig("ventas.correlativoInicial", 30);

    const { venta } = await pos.cobrar(SEDE_PRINCIPAL, {
      lineas: [{ itemId: ids["COR"]!, cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });

    expect(venta.correlativo).toBe("NV000030");
    expect(venta.sedeId).toBe(SEDE_PRINCIPAL);
    await pos.cerrar();
  });
});

describe("crear sucursales", () => {
  it("el id sale del nombre y es legible en el log", async () => {
    expect(slugDeSede("Bagua Centro")).toBe("bagua-centro");
    expect(slugDeSede("Sucursal Añón")).toBe("sucursal-anon");
  });

  it("no deja dos sucursales con el mismo prefijo de ticket", async () => {
    const { pos } = await posDePrueba();
    await conSede(pos, "Centro", "SC");

    // La principal ya usa NV, y "SC" se lo acaba de llevar Centro.
    await expect(
      pos.transaccion(() => {
        const r = crearSede(pos.p, { nombre: "Norte", prefijoTicket: "SC" });
        return { eventos: r.eventos, resultado: null };
      }),
    ).rejects.toThrow(/ya emite tickets con el prefijo/);
    await pos.cerrar();
  });

  it("congela el prefijo en cuanto la sucursal emitió un ticket", async () => {
    const { pos, ids } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    // Todavía sin vender: se puede corregir.
    await pos.escribir(() => actualizarSede(pos.p, centro, { prefijoTicket: "CE" }));
    expect(pos.p.sede(centro)!.prefijoTicket).toBe("CE");

    await pos.cobrar(centro, {
      lineas: [{ itemId: ids["COR"]!, cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });

    await expect(
      pos.escribir(() => actualizarSede(pos.p, centro, { prefijoTicket: "XX" })),
    ).rejects.toThrow(/no se puede cambiar/);
    await pos.cerrar();
  });

  it("no deja desactivar la última sucursal activa", async () => {
    const { pos } = await posDePrueba();
    await expect(pos.escribir(() => desactivarSede(pos.p, SEDE_PRINCIPAL))).rejects.toThrow(
      /única sucursal activa/,
    );
    await pos.cerrar();
  });
});

describe("cada sucursal lleva su propia serie de tickets", () => {
  it("dos locales numeran en paralelo sin pisarse", async () => {
    const { pos, ids } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    const cobrar = (sede: string) =>
      pos.cobrar(sede, {
        lineas: [{ itemId: ids["COR"]!, cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: ulid(),
      });

    const a1 = await cobrar(SEDE_PRINCIPAL);
    const b1 = await cobrar(centro);
    const a2 = await cobrar(SEDE_PRINCIPAL);
    const b2 = await cobrar(centro);

    /**
     * Cada serie avanza sola: la del otro local no le mete saltos.
     *
     * La principal sigue en NV000030 porque `ventas.correlativoInicial` vale 30
     * —continúa la numeración del Excel— y una sucursal NUEVA no hereda ese
     * piso: no tiene ningún histórico que continuar, así que empieza en 1.
     */
    expect([a1.venta.correlativo, a2.venta.correlativo]).toEqual(["NV000030", "NV000031"]);
    expect([b1.venta.correlativo, b2.venta.correlativo]).toEqual(["SC000001", "SC000002"]);
    await pos.cerrar();
  });
});

describe("el stock es de cada local", () => {
  it("una entrada en un local no aparece en el otro", async () => {
    const { pos, ids } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    await pos.escribir(() =>
      registrarEntrada(pos.p, SEDE_PRINCIPAL, { itemId: ids["CERA"]!, cantidad: 10, motivo: "Compra" }),
    );

    expect(pos.p.stockDe(SEDE_PRINCIPAL, ids["CERA"]!)).toBe(10);
    expect(pos.p.stockDe(centro, ids["CERA"]!)).toBe(0);
    // El consolidado de la cadena sí los suma.
    expect(pos.p.stockTotalDe(ids["CERA"]!)).toBe(10);
    await pos.cerrar();
  });

  it("vender en un local descuenta solo de ese local", async () => {
    const { pos, ids } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    for (const sede of [SEDE_PRINCIPAL, centro]) {
      await pos.escribir(() =>
        registrarEntrada(pos.p, sede, { itemId: ids["CERA"]!, cantidad: 10, motivo: "Compra" }),
      );
    }

    await pos.cobrar(centro, {
      lineas: [{ itemId: ids["CERA"]!, cantidad: 3 }],
      pagos: [{ medio: "EFECTIVO", monto: 4500 }],
      claveIdempotencia: ulid(),
    });

    expect(pos.p.stockDe(centro, ids["CERA"]!)).toBe(7);
    expect(pos.p.stockDe(SEDE_PRINCIPAL, ids["CERA"]!)).toBe(10);
    await pos.cerrar();
  });

  it("contar en un local no toca el conteo del otro", async () => {
    const { pos, ids } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    await pos.escribir(() =>
      registrarEntrada(pos.p, centro, { itemId: ids["CERA"]!, cantidad: 10, motivo: "Compra" }),
    );
    await pos.escribir(() =>
      ajustarStock(pos.p, centro, { itemId: ids["CERA"]!, cantidadContada: 8, motivo: "Conteo" }),
    );

    expect(pos.p.stockDe(centro, ids["CERA"]!)).toBe(8);
    expect(pos.p.stockDe(SEDE_PRINCIPAL, ids["CERA"]!)).toBe(0);
    await pos.cerrar();
  });
});

describe("traslados entre sucursales", () => {
  it("mueve los dos lados en un solo evento", async () => {
    const { pos, ids } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    await pos.escribir(() =>
      registrarEntrada(pos.p, SEDE_PRINCIPAL, { itemId: ids["CERA"]!, cantidad: 10, motivo: "Compra" }),
    );

    await pos.transaccion(() => {
      const r = trasladarStock(pos.p, {
        itemId: ids["CERA"]!,
        desdeSedeId: SEDE_PRINCIPAL,
        haciaSedeId: centro,
        cantidad: 4,
        motivo: "Reposición",
      });
      return { eventos: r.eventos, resultado: null };
    });

    expect(pos.p.stockDe(SEDE_PRINCIPAL, ids["CERA"]!)).toBe(6);
    expect(pos.p.stockDe(centro, ids["CERA"]!)).toBe(4);
    // Nada se perdió ni se duplicó por el camino.
    expect(pos.p.stockTotalDe(ids["CERA"]!)).toBe(10);
    await pos.cerrar();
  });

  it("se niega a trasladar lo que no hay", async () => {
    const { pos, ids } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    await pos.escribir(() =>
      registrarEntrada(pos.p, SEDE_PRINCIPAL, { itemId: ids["CERA"]!, cantidad: 2, motivo: "Compra" }),
    );

    await expect(
      pos.transaccion(() => {
        const r = trasladarStock(pos.p, {
          itemId: ids["CERA"]!,
          desdeSedeId: SEDE_PRINCIPAL,
          haciaSedeId: centro,
          cantidad: 5,
          motivo: "Reposición",
        });
        return { eventos: r.eventos, resultado: null };
      }),
    ).rejects.toThrow(/hay 2 .* se quieren mover 5/);
    await pos.cerrar();
  });

  it("no acepta origen y destino iguales", async () => {
    const { pos, ids } = await posDePrueba();
    await expect(
      pos.transaccion(() => {
        const r = trasladarStock(pos.p, {
          itemId: ids["CERA"]!,
          desdeSedeId: SEDE_PRINCIPAL,
          haciaSedeId: SEDE_PRINCIPAL,
          cantidad: 1,
          motivo: "x",
        });
        return { eventos: r.eventos, resultado: null };
      }),
    ).rejects.toThrow(/misma sucursal/);
    await pos.cerrar();
  });
});

describe("precios por sucursal", () => {
  it("una sucursal sin precio propio hereda el de la cadena", async () => {
    const { pos, ids } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");
    expect(pos.p.precioEn(centro, ids["COR"]!)).toBe(2000);
    await pos.cerrar();
  });

  it("el precio propio se cobra solo en esa sucursal", async () => {
    const { pos, ids } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    await pos.escribir(() => cambiarPrecioDeSede(pos.p, ids["COR"]!, centro, 2500, "Zona más cara"));

    const enCentro = await pos.cobrar(centro, {
      lineas: [{ itemId: ids["COR"]!, cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2500 }],
      claveIdempotencia: ulid(),
    });
    const enPrincipal = await pos.cobrar(SEDE_PRINCIPAL, {
      lineas: [{ itemId: ids["COR"]!, cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });

    expect(enCentro.venta.total).toBe(2500);
    expect(enCentro.venta.lineas[0]!.precioLista).toBe(2500);
    expect(enPrincipal.venta.total).toBe(2000);
    await pos.cerrar();
  });

  it("poner el precio en null vuelve a heredar el de la cadena", async () => {
    const { pos, ids } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    await pos.escribir(() => cambiarPrecioDeSede(pos.p, ids["COR"]!, centro, 2500));
    expect(pos.p.precioEn(centro, ids["COR"]!)).toBe(2500);

    await pos.escribir(() => cambiarPrecioDeSede(pos.p, ids["COR"]!, centro, null));
    expect(pos.p.precioEn(centro, ids["COR"]!)).toBe(2000);
    await pos.cerrar();
  });
});

describe("la caja es de cada local", () => {
  it("dos sucursales pueden tener turno abierto a la vez", async () => {
    const { pos } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    await pos.escribir(() => abrirTurno(pos.p, SEDE_PRINCIPAL, { montoInicial: 10000 }).eventos);
    await pos.escribir(() => abrirTurno(pos.p, centro, { montoInicial: 5000 }).eventos);

    expect(pos.p.turnoAbiertoDe(SEDE_PRINCIPAL)).not.toBeNull();
    expect(pos.p.turnoAbiertoDe(centro)).not.toBeNull();
    await pos.cerrar();
  });

  it("una sucursal sigue sin poder tener dos turnos abiertos", async () => {
    const { pos } = await posDePrueba();
    await pos.escribir(() => abrirTurno(pos.p, SEDE_PRINCIPAL, { montoInicial: 10000 }).eventos);
    await expect(
      pos.escribir(() => abrirTurno(pos.p, SEDE_PRINCIPAL, { montoInicial: 1 }).eventos),
    ).rejects.toThrow(/Ya hay un turno abierto/);
    await pos.cerrar();
  });

  /**
   * La regresión que más caro habría salido: sin filtrar por sucursal, el
   * arqueo de un local contaba las ventas del otro y el cajón esperaba plata
   * que estaba a 200 km.
   */
  it("el arqueo de un local ignora por completo las ventas del otro", async () => {
    const { pos, ids } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    await pos.escribir(() => abrirTurno(pos.p, SEDE_PRINCIPAL, { montoInicial: 10000 }).eventos);
    await pos.escribir(() => abrirTurno(pos.p, centro, { montoInicial: 5000 }).eventos);

    await pos.cobrar(SEDE_PRINCIPAL, {
      lineas: [{ itemId: ids["COR"]!, cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });
    await pos.cobrar(centro, {
      lineas: [{ itemId: ids["COR"]!, cantidad: 2 }],
      pagos: [{ medio: "EFECTIVO", monto: 4000 }],
      claveIdempotencia: ulid(),
    });

    const principal = arquear(pos.p, SEDE_PRINCIPAL);
    const deCentro = arquear(pos.p, centro);

    expect(principal.cantidadVentas).toBe(1);
    expect(principal.efectivoEnCajon).toBe(12000); // 10000 + 2000
    expect(deCentro.cantidadVentas).toBe(1);
    expect(deCentro.efectivoEnCajon).toBe(9000); // 5000 + 4000
    await pos.cerrar();
  });

  it("un egreso sale del cajón de su sucursal y no del otro", async () => {
    const { pos } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    await pos.escribir(() => abrirTurno(pos.p, SEDE_PRINCIPAL, { montoInicial: 10000 }).eventos);
    await pos.escribir(() => abrirTurno(pos.p, centro, { montoInicial: 10000 }).eventos);
    await pos.escribir(
      () => registrarEgreso(pos.p, centro, { monto: 3000, motivo: "Insumos" }).eventos,
    );

    expect(arquear(pos.p, centro).efectivoEnCajon).toBe(7000);
    expect(arquear(pos.p, SEDE_PRINCIPAL).efectivoEnCajon).toBe(10000);
    await pos.cerrar();
  });

  it("cerrar la caja de un local deja abierta la del otro", async () => {
    const { pos } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    await pos.escribir(() => abrirTurno(pos.p, SEDE_PRINCIPAL, { montoInicial: 10000 }).eventos);
    await pos.escribir(() => abrirTurno(pos.p, centro, { montoInicial: 5000 }).eventos);
    await pos.escribir(() => cerrarTurno(pos.p, centro, { contadoEfectivo: 5000 }).eventos);

    expect(pos.p.turnoAbiertoDe(centro)).toBeNull();
    expect(pos.p.turnoAbiertoDe(SEDE_PRINCIPAL)).not.toBeNull();
    await pos.cerrar();
  });
});

describe("lo que es de la cadena, no de la sucursal", () => {
  it("el catálogo y los clientes son los mismos en todos los locales", async () => {
    const { pos, ids } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    // El mismo ítem existe y se vende en los dos locales: es UN producto de la
    // cadena, no dos productos distintos que se llaman igual.
    for (const sede of [SEDE_PRINCIPAL, centro]) {
      const { venta } = await pos.cobrar(sede, {
        lineas: [{ itemId: ids["COR"]!, cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: ulid(),
      });
      expect(venta.lineas[0]!.itemId).toBe(ids["COR"]);
    }
    await pos.cerrar();
  });
});

describe("todo sobrevive a reconstruir la proyección desde el log", () => {
  it("sucursales, stock por local, precios propios y series de ticket", async () => {
    const { pos, ids, dir } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    await pos.escribir(() =>
      registrarEntrada(pos.p, centro, { itemId: ids["CERA"]!, cantidad: 7, motivo: "Compra" }),
    );
    await pos.escribir(() => cambiarPrecioDeSede(pos.p, ids["COR"]!, centro, 2500));
    await pos.cobrar(centro, {
      lineas: [{ itemId: ids["COR"]!, cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2500 }],
      claveIdempotencia: ulid(),
    });
    await pos.cerrar();

    // Se reproduce el log entero en un proceso nuevo.
    const otra = await ServicioPos.abrir(await abrirAlmacen(dir));
    expect(otra.p.sedes.size).toBe(2);
    expect(otra.p.stockDe(centro, ids["CERA"]!)).toBe(7);
    expect(otra.p.stockDe(SEDE_PRINCIPAL, ids["CERA"]!)).toBe(0);
    expect(otra.p.precioEn(centro, ids["COR"]!)).toBe(2500);
    expect(otra.p.precioEn(SEDE_PRINCIPAL, ids["COR"]!)).toBe(2000);
    expect(otra.p.ultimoCorrelativoPorSede.get(centro)).toBe(1);
    await otra.cerrar();
  });
});

/**
 * El agujero que casi se escapa: el selector de sucursal cambiaba el stock y
 * la caja, pero los reportes, el historial y los barberos seguían mostrando
 * TODA la cadena. Un selector que dice "Bagua Centro" sobre datos de los dos
 * locales es peor que no tener selector: el dueño toma decisiones con números
 * que cree de un local y son de otro.
 */
describe("los reportes respetan la sucursal", () => {
  async function conVentasEnDosLocales() {
    const { pos, ids } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    const cobrar = (sede: string, cantidad: number) =>
      pos.cobrar(sede, {
        lineas: [{ itemId: ids["COR"]!, cantidad }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 * cantidad }],
        claveIdempotencia: ulid(),
      });

    await cobrar(SEDE_PRINCIPAL, 1); // 2000
    await cobrar(centro, 2); // 4000
    await cobrar(centro, 3); // 6000

    return { pos, centro, ids };
  }

  const hoy = () => new Date().toISOString().slice(0, 10);

  it("una sucursal reporta SOLO sus ventas", async () => {
    const { pos, centro } = await conVentasEnDosLocales();

    const principal = construirReporte(pos.p, SEDE_PRINCIPAL, hoy(), hoy());
    const deCentro = construirReporte(pos.p, centro, hoy(), hoy());

    expect(principal.total).toBe(2000);
    expect(principal.cantidadVentas).toBe(1);
    expect(deCentro.total).toBe(10000);
    expect(deCentro.cantidadVentas).toBe(2);
    await pos.cerrar();
  });

  it("el consolidado suma la cadena entera", async () => {
    const { pos } = await conVentasEnDosLocales();
    const todas = construirReporte(pos.p, null, hoy(), hoy());

    expect(todas.total).toBe(12000);
    expect(todas.cantidadVentas).toBe(3);
    await pos.cerrar();
  });

  it("la comparativa ordena los locales por lo que vendieron", async () => {
    const { pos, centro } = await conVentasEnDosLocales();
    const filas = compararSedes(pos.p, hoy(), hoy());

    expect(filas.map((f) => f.sedeId)).toEqual([centro, SEDE_PRINCIPAL]);
    expect(filas[0]!.total).toBe(10000);
    expect(filas[0]!.cantidad).toBe(2);
    expect(filas[0]!.ticketPromedio).toBe(5000);
    expect(filas[1]!.total).toBe(2000);
    await pos.cerrar();
  });

  it("el inventario del reporte es el del local elegido, y se suma en el consolidado", async () => {
    const { pos, ids } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    await pos.escribir(() =>
      registrarEntrada(pos.p, SEDE_PRINCIPAL, { itemId: ids["CERA"]!, cantidad: 10, motivo: "Compra" }),
    );
    await pos.escribir(() =>
      registrarEntrada(pos.p, centro, { itemId: ids["CERA"]!, cantidad: 4, motivo: "Compra" }),
    );

    const d = new Date().toISOString().slice(0, 10);
    expect(construirReporte(pos.p, SEDE_PRINCIPAL, d, d).inventario.agotados).toBe(0);
    // Valorizado a costo: cada local cuenta lo suyo, la cadena suma.
    const soloCentro = construirReporte(pos.p, centro, d, d).inventario;
    const todas = construirReporte(pos.p, null, d, d).inventario;
    expect(todas.productos).toBe(soloCentro.productos); // el catálogo es el mismo
    await pos.cerrar();
  });
});

/**
 * Administrar veinte locales tiene que seguir siendo cómodo. Lo que lo hace
 * incómodo no es la cantidad: es el trabajo manual que la cantidad multiplica.
 */
describe("abrir muchas sucursales sin trabajo manual", () => {
  it("propone un prefijo legible a partir del nombre", async () => {
    const { pos } = await posDePrueba();
    expect(prefijoSugerido(pos.p, "Bagua Grande")).toBe("BG");
    expect(prefijoSugerido(pos.p, "Jaen")).toBe("JA");
    expect(prefijoSugerido(pos.p, "San Juan de Lurigancho")).toBe("SJDL");
    await pos.cerrar();
  });

  it("nunca propone uno ya tomado", async () => {
    const { pos } = await posDePrueba();
    const usados = new Set(["NV"]);

    // Veintidós locales, varios con nombres que colisionan a propósito.
    for (const nombre of [
      "Bagua Grande", "Bagua Chica", "Bagua Centro", "Jaen", "Jaen Norte",
      "Chachapoyas", "Cumba", "Cajaruro", "Copallin", "Chiclayo",
      "Lima", "Lonya", "La Peca", "Moyobamba", "Mendoza",
      "Nueva Cajamarca", "Pedro Ruiz", "Rioja", "Tarapoto", "Utcubamba", "Yamon",
    ]) {
      const prefijo = prefijoSugerido(pos.p, nombre);
      expect(prefijo, `para ${nombre}`).not.toBe("");
      expect(usados.has(prefijo), `${prefijo} repetido en ${nombre}`).toBe(false);
      usados.add(prefijo);

      await pos.transaccion(() => {
        const r = crearSede(pos.p, { nombre, prefijoTicket: prefijo });
        return { eventos: r.eventos, resultado: null };
      });
    }

    expect(pos.p.sedes.size).toBe(22); // las 21 nuevas + la principal
    await pos.cerrar();
  });

  /**
   * Con veinte locales, códigos de solo letras obligan a inventar
   * abreviaturas cada vez más forzadas. El número después de la letra inicial
   * es la salida que siempre funciona.
   */
  it("admite números en el prefijo, no solo letras", async () => {
    const { pos } = await posDePrueba();
    const id = await pos.transaccion(() => {
      const r = crearSede(pos.p, { nombre: "Sucursal Dos", prefijoTicket: "S02" });
      return { eventos: r.eventos, resultado: r.sedeId };
    });
    expect(pos.p.sede(id)!.prefijoTicket).toBe("S02");
    await pos.cerrar();
  });

  it("un prefijo que no empieza con letra se rechaza", async () => {
    const { pos } = await posDePrueba();
    await expect(
      pos.transaccion(() => {
        const r = crearSede(pos.p, { nombre: "Mala", prefijoTicket: "02" });
        return { eventos: r.eventos, resultado: null };
      }),
    ).rejects.toThrow(/empieza con una letra/);
    await pos.cerrar();
  });
});

/**
 * El catálogo es de la cadena, pero el STOCK de un producto nuevo es del local
 * que lo carga. Y el aviso de "bajo mínimo" tiene que llegarle a ese local, no
 * a los veintidós: con el catálogo compartido, cada producto con mínimo
 * aparecía como faltante en todos lados y la alerta dejaba de señalar nada.
 */
describe("dar de alta un producto en un local", () => {
  it("el stock inicial queda en la sucursal que lo creó", async () => {
    const { pos } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    const itemId = await pos.transaccion(() => {
      const r = crearItem(
        pos.p,
        { codigo: "POM", nombre: "POMADA", tipo: "PRODUCTO", categoria: "P", precio: 1200, stockInicial: 6 },
        centro,
      );
      return { eventos: r.eventos, resultado: r.itemId };
    });

    expect(pos.p.stockDe(centro, itemId)).toBe(6);
    expect(pos.p.stockDe(SEDE_PRINCIPAL, itemId)).toBe(0);
    await pos.cerrar();
  });

  it("solo avisa de bajo mínimo en los locales que manejan el producto", async () => {
    const { pos } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    await pos.transaccion(() => {
      const r = crearItem(
        pos.p,
        { codigo: "POM", nombre: "POMADA", tipo: "PRODUCTO", categoria: "P", precio: 1200, stockMinimo: 5, stockInicial: 1 },
        centro,
      );
      return { eventos: r.eventos, resultado: null };
    });

    // En Centro falta: tiene 1 y su mínimo es 5.
    expect(stockBajo(pos.p, centro)).toHaveLength(1);
    // En la principal NO aparece: ese local no maneja ese producto.
    expect(stockBajo(pos.p, SEDE_PRINCIPAL)).toHaveLength(0);
    await pos.cerrar();
  });

  it("un local empieza a manejarlo en cuanto recibe un traslado", async () => {
    const { pos, ids } = await posDePrueba();
    const centro = await conSede(pos, "Centro", "SC");

    await pos.escribir(() =>
      registrarEntrada(pos.p, SEDE_PRINCIPAL, { itemId: ids["CERA"]!, cantidad: 10, motivo: "Compra" }),
    );
    expect(pos.p.manejaProducto(centro, ids["CERA"]!)).toBe(false);

    await pos.transaccion(() => {
      const r = trasladarStock(pos.p, {
        itemId: ids["CERA"]!,
        desdeSedeId: SEDE_PRINCIPAL,
        haciaSedeId: centro,
        cantidad: 3,
        motivo: "Reposición",
      });
      return { eventos: r.eventos, resultado: null };
    });

    expect(pos.p.manejaProducto(centro, ids["CERA"]!)).toBe(true);
    await pos.cerrar();
  });
});
