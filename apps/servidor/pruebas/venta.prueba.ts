/**
 * Pruebas del dominio de venta.
 *
 * Cada una corresponde a un defecto REAL del Excel que estamos reemplazando, o
 * a una regla que sostiene que las cuentas cuadren. No hay pruebas de camino feliz
 * por cumplir.
 */

import { describe, expect, it, afterEach } from "vitest";
import { ulid } from "ulid";

import { ServicioPos } from "../src/servicios/Pos";
import { actualizarItem, crearItem, desactivarItem } from "../src/dominio/catalogo/catalogo";
import { crearBarbero, desactivarBarbero, reactivarBarbero } from "../src/dominio/barberos/barberos";
import { registrarEntrada } from "../src/dominio/inventario/inventario";
import { abrirTurno, arquear, cerrarTurno, registrarEgreso } from "../src/dominio/caja/caja";
import { registrarPropina } from "../src/dominio/venta/propina";
import { abrirAlmacen, borrar, carpetaTemporal } from "./ayuda";

const aBorrar: string[] = [];
afterEach(async () => {
  await Promise.all(aBorrar.splice(0).map(borrar));
});

/** Un POS recién instalado, con el catálogo mínimo de la barbería cargado. */
async function posDePrueba() {
  const dir = await carpetaTemporal();
  aBorrar.push(dir);
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir));

  // Estas pruebas son de pagos, stock, idempotencia y caja: exigir cliente o
  // caja abierta en todas agregaría ruido sin probar nada. Las dos reglas
  // tienen sus propias pruebas más abajo, en «cliente obligatorio» y «exigir
  // caja abierta».
  await pos.guardarConfig("ventas.exigirCliente", false);
  await pos.guardarConfig("ventas.exigirTurnoAbierto", false);

  const ids: Record<string, string> = {};

  for (const [codigo, nombre, precio] of [
    ["COR", "CORTE CLASICO", 2000],
    ["COR-D", "CORTE DEGRADADO", 2500],
    ["BAR", "BARBA", 1000],
  ] as const) {
    await pos.transaccion(() => {
      const r = crearItem(pos.p, { codigo, nombre, tipo: "SERVICIO", categoria: "Barbería", precio });
      ids[codigo] = r.itemId;
      return { eventos: r.eventos, resultado: null };
    });
  }

  await pos.transaccion(() => {
    const r = crearItem(pos.p, {
      codigo: "CERA",
      marca: "NIVEL TRES",
      nombre: "PASTA MODELADORA",
      tipo: "PRODUCTO",
      categoria: "Productos",
      precio: 3500,
      costo: 2000,
      stockMinimo: 3,
      stockInicial: 10,
    });
    ids["CERA"] = r.itemId;
    return { eventos: r.eventos, resultado: null };
  });

  // Un producto SIN precio, como los 119 que trajo la planilla del cliente.
  await pos.transaccion(() => {
    const r = crearItem(pos.p, {
      codigo: "ROJA",
      marca: "FORAJIDO",
      nombre: "PASTA ROJA",
      tipo: "PRODUCTO",
      categoria: "Productos",
      precio: null,
      stockInicial: 5,
    });
    ids["ROJA"] = r.itemId;
    return { eventos: r.eventos, resultado: null };
  });

  return { pos, ids, dir };
}

function pedido(itemId: string, cantidad = 1, extra: Record<string, unknown> = {}) {
  return {
    lineas: [{ itemId, cantidad }],
    pagos: [{ medio: "EFECTIVO" as const, monto: 0 }],
    claveIdempotencia: ulid(),
    ...extra,
  };
}

describe("cobrar", () => {
  it("cobra, asigna correlativo y calcula el total", async () => {
    const { pos, ids } = await posDePrueba();

    const r = await pos.cobrar({
      lineas: [{ itemId: ids["COR-D"], cantidad: 2 }],
      pagos: [{ medio: "YAPE", monto: 5000 }],
      claveIdempotencia: ulid(),
    });

    expect(r.venta.correlativo).toBe("NV000030"); // continúa donde quedó el Excel
    expect(r.venta.total).toBe(5000);
    expect(r.venta.lineas[0].cantidad).toBe(2);
    expect(r.duplicada).toBe(false);
    await pos.cerrar();
  });

  it("un ítem sin precio NO se puede vender", async () => {
    // El precio de lista es una decisión del dueño, no del mostrador. Un
    // producto sin precio se carga, se le lleva el stock, y no se vende hasta
    // que alguien le ponga precio desde Catálogo.
    const { pos, ids } = await posDePrueba();

    await expect(
      pos.cobrar({
        lineas: [{ itemId: ids["ROJA"], cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 3500 }],
        claveIdempotencia: ulid(),
      }),
    ).rejects.toThrow(/no tiene precio y no se puede vender/);
    await pos.cerrar();
  });

  it("tampoco se vende indicando el precio en el pedido", async () => {
    // La prueba que hace que la regla sea una REGLA y no una costumbre de la
    // pantalla. Si el servidor aceptara un precio suelto, alcanzaría con una
    // pantalla vieja, un script o la pistola de escaneo para saltearla, y el
    // mismo producto se cobraría distinto según quién atienda.
    const { pos, ids } = await posDePrueba();

    await expect(
      pos.cobrar({
        lineas: [{ itemId: ids["ROJA"], cantidad: 1, precioUnitario: 3500 }],
        pagos: [{ medio: "EFECTIVO", monto: 3500 }],
        claveIdempotencia: ulid(),
      }),
    ).rejects.toThrow(/no tiene precio y no se puede vender/);
    await pos.cerrar();
  });

  it("se vende apenas se le pone precio, sin tocar nada más", async () => {
    const { pos, ids } = await posDePrueba();
    await pos.escribir(() => actualizarItem(pos.p, ids["ROJA"], { precio: 3500 }));

    const r = await pos.cobrar({
      lineas: [{ itemId: ids["ROJA"], cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 3500 }],
      claveIdempotencia: ulid(),
    });

    expect(r.venta.total).toBe(3500);
    expect(r.venta.lineas[0].precioLista).toBe(3500);
    await pos.cerrar();
  });

  it("ajustar el precio de una línea SÍ se puede, si el ítem tiene precio", async () => {
    // La cortesía puntual sigue existiendo: lo que no se puede es inventar el
    // precio de algo que no lo tiene.
    const { pos, ids } = await posDePrueba();

    const r = await pos.cobrar({
      lineas: [{ itemId: ids["CERA"], cantidad: 1, precioUnitario: 3000 }],
      pagos: [{ medio: "EFECTIVO", monto: 3000 }],
      claveIdempotencia: ulid(),
    });

    expect(r.venta.lineas[0].precioUnitario).toBe(3000);
    expect(r.venta.lineas[0].precioLista).toBe(3500); // queda registrado lo que se regaló
    await pos.cerrar();
  });

  it("congela el costo del producto en la línea de venta", async () => {
    // Es lo que hace que la utilidad de un mes cerrado no se mueva nunca.
    const { pos, ids } = await posDePrueba();

    const r = await pos.cobrar({
      lineas: [{ itemId: ids["CERA"], cantidad: 2 }],
      pagos: [{ medio: "EFECTIVO", monto: 7000 }],
      claveIdempotencia: ulid(),
    });

    expect(r.venta.lineas[0].costoUnitario).toBe(2000);
    // La marca también viaja desnormalizada: el ticket de ayer conserva la de ayer.
    expect(r.venta.lineas[0].marca).toBe("NIVEL TRES");
    await pos.cerrar();
  });

  it("la venta de ayer conserva su costo aunque hoy suba el del producto", async () => {
    const { pos, ids } = await posDePrueba();

    const antes = await pos.cobrar({
      lineas: [{ itemId: ids["CERA"], cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 3500 }],
      claveIdempotencia: ulid(),
    });

    // Entra mercadería más cara: el promedio ponderado del producto sube.
    await pos.escribir(() => [
      { tipo: "stock.entrada", datos: { itemId: ids["CERA"], cantidad: 9, costoUnitario: 4000, motivo: "Compra" } },
    ]);
    expect(pos.p.items.get(ids["CERA"])!.costo).toBeGreaterThan(2000);

    // Y la venta vieja sigue diciendo lo que decía.
    expect(pos.p.ventas.get(antes.venta.id)!.lineas[0].costoUnitario).toBe(2000);
    await pos.cerrar();
  });

  it("un SERVICIO no lleva costo en la línea", async () => {
    const { pos, ids } = await posDePrueba();
    const r = await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });
    expect(r.venta.lineas[0].costoUnitario).toBeNull();
    await pos.cerrar();
  });

  it("acepta cantidad distinta de 1 en la misma línea", async () => {
    // El Excel SIEMPRE metía cantidad 1 y corregirla exigía activar un modo
    // especial y volver a hacer clic en la fila. Era su peor defecto de uso.
    const { pos, ids } = await posDePrueba();
    const r = await pos.cobrar({
      lineas: [{ itemId: ids["BAR"], cantidad: 3 }],
      pagos: [{ medio: "EFECTIVO", monto: 3000, recibido: 5000, vuelto: 2000 }],
      claveIdempotencia: ulid(),
    });
    expect(r.venta.total).toBe(3000);
    await pos.cerrar();
  });

  it("acepta pago mixto: parte efectivo, parte YAPE", async () => {
    // El Excel solo admitía un medio de pago por venta.
    const { pos, ids } = await posDePrueba();
    const r = await pos.cobrar({
      lineas: [{ itemId: ids["COR-D"], cantidad: 1 }, { itemId: ids["BAR"], cantidad: 1 }],
      pagos: [
        { medio: "EFECTIVO", monto: 2000 },
        { medio: "YAPE", monto: 1500 },
      ],
      claveIdempotencia: ulid(),
    });
    expect(r.venta.total).toBe(3500);
    expect(r.venta.pagos).toHaveLength(2);
    await pos.cerrar();
  });

  it("rechaza si los pagos no suman exactamente el total", async () => {
    const { pos, ids } = await posDePrueba();
    await expect(
      pos.cobrar({
        lineas: [{ itemId: ids["COR"], cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 1900 }],
        claveIdempotencia: ulid(),
      }),
    ).rejects.toThrow(/Faltan S\/ 1\.00/);
    await pos.cerrar();
  });

  it("guarda el precio de lista aparte cuando se cobra otro precio", async () => {
    const { pos, ids } = await posDePrueba();
    const r = await pos.cobrar({
      lineas: [{ itemId: ids["COR-D"], cantidad: 1, precioUnitario: 2000 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });
    expect(r.venta.lineas[0].precioUnitario).toBe(2000);
    expect(r.venta.lineas[0].precioLista).toBe(2500); // queda registrado lo que se regaló
    await pos.cerrar();
  });

  it("registra quién atendió, sin calcular comisión alguna", async () => {
    const { pos, ids } = await posDePrueba();
    const barberoId = await pos.transaccion(() => {
      const r = crearBarbero(pos.p, "José");
      return { eventos: r.eventos, resultado: r.barberoId };
    });

    const r = await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1, barberoId }],
      pagos: [{ medio: "YAPE", monto: 2000 }],
      claveIdempotencia: ulid(),
    });

    expect(r.venta.lineas[0].barberoId).toBe(barberoId);
    expect(r.venta).not.toHaveProperty("comision");
    await pos.cerrar();
  });
});

describe("idempotencia", () => {
  it("el mismo pedido enviado dos veces cobra una sola vez", async () => {
    const { pos, ids } = await posDePrueba();
    const clave = ulid();
    const cuerpo = {
      lineas: [{ itemId: ids["COR"], cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO" as const, monto: 2000 }],
      claveIdempotencia: clave,
    };

    const primera = await pos.cobrar(cuerpo);
    const segunda = await pos.cobrar(cuerpo);

    expect(segunda.duplicada).toBe(true);
    expect(segunda.venta.correlativo).toBe(primera.venta.correlativo);
    expect(pos.p.ventas.size).toBe(1);
    await pos.cerrar();
  });

  it("resiste el doble clic: dos envíos simultáneos con la misma clave", async () => {
    const { pos, ids } = await posDePrueba();
    const cuerpo = {
      lineas: [{ itemId: ids["COR"], cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO" as const, monto: 2000 }],
      claveIdempotencia: ulid(),
    };

    const [a, b] = await Promise.all([pos.cobrar(cuerpo), pos.cobrar(cuerpo)]);

    expect(a.venta.id).toBe(b.venta.id);
    expect(pos.p.ventas.size).toBe(1);
    await pos.cerrar();
  });

  it("nunca repite correlativo con 50 cobros simultáneos", async () => {
    // Es el bug que tenía el Excel: F7 = MAX(NotaVenta[ID])+1, recalculado
    // fuera de toda transacción.
    const { pos, ids } = await posDePrueba();

    const resultados = await Promise.all(
      Array.from({ length: 50 }, () =>
        pos.cobrar({
          lineas: [{ itemId: ids["COR"], cantidad: 1 }],
          pagos: [{ medio: "EFECTIVO" as const, monto: 2000 }],
          claveIdempotencia: ulid(),
        }),
      ),
    );

    const correlativos = resultados.map((r) => r.venta.correlativo);
    expect(new Set(correlativos).size).toBe(50);
    expect(correlativos.sort()[0]).toBe("NV000030");
    expect(correlativos.sort().at(-1)).toBe("NV000079");
    await pos.cerrar();
  });
});

describe("anulación", () => {
  it("no borra: marca, conserva el correlativo y devuelve el stock", async () => {
    const { pos, ids } = await posDePrueba();

    const r = await pos.cobrar({
      lineas: [{ itemId: ids["CERA"], cantidad: 2 }],
      pagos: [{ medio: "EFECTIVO", monto: 7000 }],
      claveIdempotencia: ulid(),
    });
    expect(pos.p.stockDe(ids["CERA"])).toBe(8);

    const anulada = await pos.anular(r.venta.id, "El cliente se arrepintió");

    expect(anulada.anulada).toBe(true);
    expect(anulada.correlativo).toBe("NV000030");
    expect(pos.p.ventas.size).toBe(1); // sigue existiendo
    expect(pos.p.stockDe(ids["CERA"])).toBe(10); // el stock volvió

    // Y el correlativo NO se reusa: la siguiente venta es la 31.
    const siguiente = await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1 }],
      pagos: [{ medio: "YAPE", monto: 2000 }],
      claveIdempotencia: ulid(),
    });
    expect(siguiente.venta.correlativo).toBe("NV000031");
    await pos.cerrar();
  });

  it("exige motivo y no deja anular dos veces", async () => {
    const { pos, ids } = await posDePrueba();
    const r = await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });

    await expect(pos.anular(r.venta.id, "")).rejects.toThrow(/necesita motivo/);
    await pos.anular(r.venta.id, "Cobro duplicado");
    await expect(pos.anular(r.venta.id, "otra vez")).rejects.toThrow(/ya estaba anulada/);
    await pos.cerrar();
  });
});

describe("stock", () => {
  it("descuenta al vender sin necesitar un evento aparte", async () => {
    const { pos, ids } = await posDePrueba();
    await pos.cobrar({
      lineas: [{ itemId: ids["CERA"], cantidad: 3 }],
      pagos: [{ medio: "TARJETA", monto: 10500 }],
      claveIdempotencia: ulid(),
    });
    expect(pos.p.stockDe(ids["CERA"])).toBe(7);
    await pos.cerrar();
  });

  it("los servicios no consumen stock", async () => {
    const { pos, ids } = await posDePrueba();
    await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 5 }],
      pagos: [{ medio: "EFECTIVO", monto: 10000 }],
      claveIdempotencia: ulid(),
    });
    expect(pos.p.stock.has(ids["COR"])).toBe(false);
    await pos.cerrar();
  });

  it("avisa pero NO bloquea cuando no alcanza el stock", async () => {
    // Negarse a cobrar con el cliente y el billete delante es peor problema
    // que un inventario desfasado.
    const { pos, ids } = await posDePrueba();

    const r = await pos.cobrar({
      lineas: [{ itemId: ids["CERA"], cantidad: 15 }],
      pagos: [{ medio: "EFECTIVO", monto: 52500 }],
      claveIdempotencia: ulid(),
    });

    expect(r.venta.total).toBe(52500); // se cobró igual
    expect(r.advertencias).toHaveLength(1);
    expect(r.advertencias[0]).toMatch(/hay 10 y se están vendiendo 15/);
    expect(pos.p.stockDe(ids["CERA"])).toBe(-5); // negativo: hay que contar
    await pos.cerrar();
  });

  it("acumula la misma cantidad aunque el producto venga en dos líneas", async () => {
    const { pos, ids } = await posDePrueba();
    const r = await pos.cobrar({
      lineas: [
        { itemId: ids["CERA"], cantidad: 6 },
        { itemId: ids["CERA"], cantidad: 6 },
      ],
      pagos: [{ medio: "EFECTIVO", monto: 42000 }],
      claveIdempotencia: ulid(),
    });
    expect(r.advertencias[0]).toMatch(/se están vendiendo 12/);
    await pos.cerrar();
  });

  it("el ajuste fija el saldo contado y guarda lo que el sistema creía", async () => {
    const { pos, ids } = await posDePrueba();
    await pos.escribir(() =>
      registrarEntrada(pos.p, { itemId: ids["CERA"], cantidad: 5, motivo: "Compra a proveedor" }),
    );
    expect(pos.p.stockDe(ids["CERA"])).toBe(15);
    await pos.cerrar();
  });
});

describe("caja", () => {
  it("arquea el turno y calcula el efectivo esperado en el cajón", async () => {
    const { pos, ids } = await posDePrueba();

    await pos.escribir(() => abrirTurno(pos.p, { montoInicial: 5000 }).eventos);

    await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });
    await pos.cobrar({
      lineas: [{ itemId: ids["COR-D"], cantidad: 1 }],
      pagos: [{ medio: "YAPE", monto: 2500 }],
      claveIdempotencia: ulid(),
    });

    const arqueo = arquear(pos.p);
    expect(arqueo.medios.EFECTIVO).toBe(2000);
    expect(arqueo.medios.YAPE).toBe(2500);
    expect(arqueo.totalVendido).toBe(4500);
    expect(arqueo.efectivoEnCajon).toBe(7000); // 5000 inicial + 2000 cobrado
    await pos.cerrar();
  });

  it("registra la diferencia al cerrar y no cuenta las ventas anuladas", async () => {
    const { pos, ids } = await posDePrueba();
    await pos.escribir(() => abrirTurno(pos.p, { montoInicial: 0 }).eventos);

    const a = await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });
    await pos.cobrar({
      lineas: [{ itemId: ids["BAR"], cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 1000 }],
      claveIdempotencia: ulid(),
    });
    await pos.anular(a.venta.id, "Se cobró de más");

    const arqueo = arquear(pos.p);
    expect(arqueo.cantidadVentas).toBe(1);
    expect(arqueo.efectivoEnCajon).toBe(1000);
    expect(arqueo.ventasAnuladas).toBe(1);

    // Contaron 950: faltan 50 céntimos.
    const cierre = await pos.transaccion(() => {
      const r = cerrarTurno(pos.p, { contadoEfectivo: 950 });
      return { eventos: r.eventos, resultado: r };
    });
    expect(cierre.diferencia).toBe(-50);
    expect(pos.p.turnoAbierto).toBeNull();
    await pos.cerrar();
  });

  it("el efectivo esperado DESCUENTA lo que salió del cajón", async () => {
    // Era el defecto más grande del sistema: el arqueo calculaba
    // "inicial + cobrado" e ignoraba las salidas, así que decía que había más
    // plata de la que había y el cierre daba un faltante que no era un
    // faltante. Una caja que nunca cuadra es una caja que nadie mira.
    const { pos, ids } = await posDePrueba();
    await pos.escribir(() => abrirTurno(pos.p, { montoInicial: 10000 }).eventos);

    await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });
    // Salen 3000 para comprar insumos.
    await pos.escribir(() => registrarEgreso(pos.p, { monto: 3000, motivo: "Compra de ceras" }).eventos);

    const arqueo = arquear(pos.p);
    expect(arqueo.egresos).toBe(3000);
    expect(arqueo.cantidadEgresos).toBe(1);
    // 100 inicial + 20 cobrado − 30 que salieron = 90.
    expect(arqueo.efectivoEnCajon).toBe(9000);

    // Y si se cuentan 90, la caja CUADRA. Antes daba −30 sin explicación.
    const cierre = await pos.transaccion(() => {
      const r = cerrarTurno(pos.p, { contadoEfectivo: 9000 });
      return { eventos: r.eventos, resultado: r };
    });
    expect(cierre.diferencia).toBe(0);
    await pos.cerrar();
  });

  it("si los egresos superan lo que había, el cajón cierra en negativo sin romperse", async () => {
    // Una compra grande de mercadería pagada con la caja del día puede
    // superar todo lo cobrado en efectivo. El cajón queda "debiendo" —no es
    // un bug, es el negocio— y el cierre tiene que poder escribirse igual.
    const { pos, ids } = await posDePrueba();
    await pos.escribir(() => abrirTurno(pos.p, { montoInicial: 5000 }).eventos);

    await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });
    // Salen 10000 — mucho más de lo que había (5000 + 2000 = 7000).
    await pos.escribir(() => registrarEgreso(pos.p, { monto: 10000, motivo: "Compra grande de mercadería" }).eventos);

    const arqueo = arquear(pos.p);
    expect(arqueo.efectivoEnCajon).toBe(-3000);

    const cierre = await pos.transaccion(() => {
      const r = cerrarTurno(pos.p, { contadoEfectivo: 0 });
      return { eventos: r.eventos, resultado: r };
    });
    expect(cierre.diferencia).toBe(3000); // contaron 0, "esperaban" −3000: sobra 3000 de diferencia.
    expect(pos.p.turnoAbierto).toBeNull();
    await pos.cerrar();
  });

  it("un egreso sin motivo se rechaza", async () => {
    // Un egreso sin motivo es indistinguible de plata que falta, que es
    // exactamente el problema que los egresos vienen a resolver.
    const { pos } = await posDePrueba();
    await pos.escribir(() => abrirTurno(pos.p, { montoInicial: 5000 }).eventos);

    expect(() => registrarEgreso(pos.p, { monto: 1000, motivo: "   " })).toThrow(/para qué salió/);
    expect(() => registrarEgreso(pos.p, { monto: 0, motivo: "Taxi" })).toThrow(/mayor a cero/);
    await pos.cerrar();
  });

  it("un egreso sin categoría queda como OTRO", async () => {
    const { pos } = await posDePrueba();
    await pos.escribir(() => registrarEgreso(pos.p, { monto: 1000, motivo: "Taxi" }).eventos);
    expect([...pos.p.egresos.values()][0].categoria).toBe("OTRO");
    await pos.cerrar();
  });

  it("un adelanto exige decir a qué barbero", async () => {
    const { pos } = await posDePrueba();
    expect(() =>
      registrarEgreso(pos.p, { monto: 2000, motivo: "Adelanto", categoria: "ADELANTO" }),
    ).toThrow(/a qué barbero/);
    await pos.cerrar();
  });

  it("un adelanto rechaza un barbero que ya no está activo", async () => {
    const { pos } = await posDePrueba();
    const barberoId = await pos.transaccion(() => {
      const r = crearBarbero(pos.p, "Kevin");
      return { eventos: r.eventos, resultado: r.barberoId };
    });
    await pos.escribir(() => desactivarBarbero(pos.p, barberoId));

    expect(() =>
      registrarEgreso(pos.p, { monto: 2000, motivo: "Adelanto", categoria: "ADELANTO", barberoId }),
    ).toThrow(/ya no está activo/);
    await pos.cerrar();
  });

  it("solo un adelanto puede llevar barbero", async () => {
    const { pos } = await posDePrueba();
    const barberoId = await pos.transaccion(() => {
      const r = crearBarbero(pos.p, "Kevin");
      return { eventos: r.eventos, resultado: r.barberoId };
    });

    expect(() =>
      registrarEgreso(pos.p, { monto: 2000, motivo: "Taxi", categoria: "YAPE", barberoId }),
    ).toThrow(/Solo un adelanto/);
    await pos.cerrar();
  });

  it("un adelanto válido queda registrado con el barbero y la categoría", async () => {
    const { pos } = await posDePrueba();
    const barberoId = await pos.transaccion(() => {
      const r = crearBarbero(pos.p, "Kevin");
      return { eventos: r.eventos, resultado: r.barberoId };
    });

    await pos.escribir(
      () => registrarEgreso(pos.p, { monto: 5000, motivo: "Para el almuerzo", categoria: "ADELANTO", barberoId }).eventos,
    );

    const egreso = [...pos.p.egresos.values()][0];
    expect(egreso.categoria).toBe("ADELANTO");
    expect(egreso.barberoId).toBe(barberoId);
    await pos.cerrar();
  });

  it("se puede registrar un egreso con la caja cerrada, y se reporta aparte", async () => {
    // Negarse a registrar un gasto porque nadie abrió la caja haría que el
    // gasto no quede en ningún lado — que es justo lo que rompía el arqueo.
    const { pos } = await posDePrueba();
    await pos.escribir(() => registrarEgreso(pos.p, { monto: 1500, motivo: "Taxi al proveedor" }).eventos);

    const egreso = [...pos.p.egresos.values()][0];
    expect(egreso.turnoId).toBeNull();
    expect(egreso.monto).toBe(1500);

    // Al abrir la caja, el arqueo lo muestra aparte: salió del cajón, pero no
    // lo descuenta de este turno porque fue antes de abrirlo.
    await pos.escribir(() => abrirTurno(pos.p, { montoInicial: 10000 }).eventos);
    const arqueo = arquear(pos.p);
    expect(arqueo.egresos).toBe(0);
    expect(arqueo.egresosFueraDeTurno).toBe(1500);
    expect(arqueo.efectivoEnCajon).toBe(10000);
    await pos.cerrar();
  });

  it("los egresos sobreviven a reconstruir la proyección", async () => {
    const dir = await carpetaTemporal();
    aBorrar.push(dir);
    {
      const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
      await pos.escribir(() => abrirTurno(pos.p, { montoInicial: 5000 }).eventos);
      await pos.escribir(() => registrarEgreso(pos.p, { monto: 800, motivo: "Insumos", comprobante: "B001-123" }).eventos);
      await pos.cerrar();
    }
    const revivido = await ServicioPos.abrir(await abrirAlmacen(dir));
    const egreso = [...revivido.p.egresos.values()][0];
    expect(egreso).toMatchObject({ monto: 800, motivo: "Insumos", comprobante: "B001-123" });
    expect(arquear(revivido.p).efectivoEnCajon).toBe(4200);
    await revivido.cerrar();
  });

  it("deja cobrar con la caja cerrada y lo reporta aparte", async () => {
    // Perder una venta porque nadie abrió la caja es inaceptable.
    const { pos, ids } = await posDePrueba();

    const r = await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });
    expect(r.venta.turnoId).toBeNull();

    await pos.escribir(() => abrirTurno(pos.p, { montoInicial: 0 }).eventos);
    expect(arquear(pos.p).cantidadVentas).toBe(0);
    await pos.cerrar();
  });
});

describe("propinas", () => {
  async function conBarbero(pos: ServicioPos, nombre: string): Promise<string> {
    return pos.transaccion(() => {
      const r = crearBarbero(pos.p, nombre);
      return { eventos: r.eventos, resultado: r.barberoId };
    });
  }

  it("se registra junto con la venta y no se suma al cobro", async () => {
    const { pos, ids } = await posDePrueba();
    const barberoId = await conBarbero(pos, "Juan");

    const { venta } = await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1, barberoId, propina: 500 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });

    expect(venta.total).toBe(2000);
    const propinas = pos.p.propinasPorVenta.get(venta.id) ?? [];
    expect(propinas).toHaveLength(1);
    expect(propinas[0]).toMatchObject({ barberoId, monto: 500, lineaIndex: 0, ventaId: venta.id });
    await pos.cerrar();
  });

  it("rechaza una propina en una línea sin barbero asignado", async () => {
    const { pos, ids } = await posDePrueba();
    await expect(
      pos.cobrar({
        lineas: [{ itemId: ids["COR"], cantidad: 1, propina: 500 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: ulid(),
      }),
    ).rejects.toThrow(/sin elegir a quién atendió/);
    await pos.cerrar();
  });

  it("rechaza una propina de cero", async () => {
    const { pos, ids } = await posDePrueba();
    const barberoId = await conBarbero(pos, "Juan");
    await expect(
      pos.cobrar({
        lineas: [{ itemId: ids["COR"], cantidad: 1, barberoId, propina: 0 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: ulid(),
      }),
    ).rejects.toThrow(/mayor a cero/);
    await pos.cerrar();
  });

  it("una venta con dos barberos puede llevar propina para cada uno por separado", async () => {
    const { pos, ids } = await posDePrueba();
    const juanId = await conBarbero(pos, "Juan");
    const luisId = await conBarbero(pos, "Luis");

    const { venta } = await pos.cobrar({
      lineas: [
        { itemId: ids["COR"], cantidad: 1, barberoId: juanId, propina: 500 },
        { itemId: ids["BAR"], cantidad: 1, barberoId: luisId, propina: 300 },
      ],
      pagos: [{ medio: "EFECTIVO", monto: 3000 }],
      claveIdempotencia: ulid(),
    });

    const propinas = pos.p.propinasPorVenta.get(venta.id) ?? [];
    expect(propinas).toHaveLength(2);
    expect(propinas.find((pr) => pr.barberoId === juanId)).toMatchObject({ lineaIndex: 0, monto: 500 });
    expect(propinas.find((pr) => pr.barberoId === luisId)).toMatchObject({ lineaIndex: 1, monto: 300 });
    await pos.cerrar();
  });

  it("se puede agregar una propina después, referenciando la venta ya cobrada", async () => {
    const { pos, ids } = await posDePrueba();
    const barberoId = await conBarbero(pos, "Luis");

    const { venta } = await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1, barberoId }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });
    expect(pos.p.propinasPorVenta.get(venta.id)).toBeUndefined();

    await pos.escribir(
      () => registrarPropina(pos.p, { ventaId: venta.id, lineaIndex: 0, barberoId, monto: 300 }).eventos,
    );

    const propinas = pos.p.propinasPorVenta.get(venta.id) ?? [];
    expect(propinas).toHaveLength(1);
    expect(propinas[0].monto).toBe(300);
    await pos.cerrar();
  });

  it("rechaza agregar después una propina a nombre de quien no atendió esa línea", async () => {
    const { pos, ids } = await posDePrueba();
    const juanId = await conBarbero(pos, "Juan");
    const luisId = await conBarbero(pos, "Luis");

    const { venta } = await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1, barberoId: juanId }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });

    expect(() => registrarPropina(pos.p, { ventaId: venta.id, lineaIndex: 0, barberoId: luisId, monto: 300 })).toThrow(
      /no la atendió ese barbero/,
    );
    await pos.cerrar();
  });

  it("rechaza agregar una propina a una venta o línea que no existen", async () => {
    const { pos, ids } = await posDePrueba();
    const barberoId = await conBarbero(pos, "Juan");
    const { venta } = await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1, barberoId }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });

    expect(() => registrarPropina(pos.p, { ventaId: "no-existe", lineaIndex: 0, barberoId, monto: 300 })).toThrow(
      /ya no existe/,
    );
    expect(() => registrarPropina(pos.p, { ventaId: venta.id, lineaIndex: 5, barberoId, monto: 300 })).toThrow(
      /línea .* no existe/,
    );
    await pos.cerrar();
  });

  it("sobrevive a reconstruir la proyección", async () => {
    const dir = await carpetaTemporal();
    aBorrar.push(dir);
    let ventaId = "";
    let barberoId = "";
    {
      const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
      await pos.guardarConfig("ventas.exigirCliente", false);
      await pos.guardarConfig("ventas.exigirTurnoAbierto", false);
      const { itemId } = await pos.transaccion(() => {
        const r = crearItem(pos.p, { codigo: "COR", nombre: "CORTE", tipo: "SERVICIO", categoria: "B", precio: 2000 });
        return { eventos: r.eventos, resultado: r };
      });
      barberoId = await conBarbero(pos, "Juan");
      const { venta } = await pos.cobrar({
        lineas: [{ itemId, cantidad: 1, barberoId, propina: 500 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: ulid(),
      });
      ventaId = venta.id;
      await pos.cerrar();
    }

    const revivido = await ServicioPos.abrir(await abrirAlmacen(dir));
    const propinas = revivido.p.propinasPorVenta.get(ventaId) ?? [];
    expect(propinas).toHaveLength(1);
    expect(propinas[0]).toMatchObject({ barberoId, monto: 500 });
    await revivido.cerrar();
  });
});

describe("reconstrucción", () => {
  it("el estado se rehace idéntico reproduciendo el log", async () => {
    const dir = await carpetaTemporal();
    aBorrar.push(dir);

    let ventaId = "";
    let ceraId = "";
    {
      const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
      await pos.guardarConfig("ventas.exigirCliente", false);
      await pos.guardarConfig("ventas.exigirTurnoAbierto", false);
      const { itemId } = await pos.transaccion(() => {
        const r = crearItem(pos.p, {
          codigo: "CERA",
          nombre: "CERA",
          tipo: "PRODUCTO",
          categoria: "P",
          precio: 3500,
          stockInicial: 10,
        });
        return { eventos: r.eventos, resultado: r };
      });
      ceraId = itemId;

      const r = await pos.cobrar({
        lineas: [{ itemId, cantidad: 4 }],
        pagos: [{ medio: "EFECTIVO", monto: 14000 }],
        claveIdempotencia: ulid(),
      });
      ventaId = r.venta.id;
      await pos.cerrar();
    }

    const revivido = await ServicioPos.abrir(await abrirAlmacen(dir));
    expect(revivido.p.ventas.get(ventaId)?.correlativo).toBe("NV000030");
    expect(revivido.p.stockDe(ceraId)).toBe(6);
    expect(revivido.p.ultimoCorrelativo).toBe(30);
    await revivido.cerrar();
  });

  it("el costo promedio y la marca sobreviven a la reconstrucción", async () => {
    // El promedio ponderado NO se guarda como un número suelto: se deriva del
    // log, ponderando cada entrada contra el stock que había en ese momento.
    // O sea que reproducir el log tiene que dar exactamente el mismo número, o
    // el margen de los reportes cambiaría solo con reiniciar el programa.
    const dir = await carpetaTemporal();
    aBorrar.push(dir);

    let ceraId = "";
    {
      const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
      const { itemId } = await pos.transaccion(() => {
        const r = crearItem(pos.p, {
          codigo: "CERA",
          marca: "NIVEL TRES",
          nombre: "PASTA MATE",
          tipo: "PRODUCTO",
          categoria: "P",
          precio: 4500,
          costo: 2800,
          stockInicial: 6,
        });
        return { eventos: r.eventos, resultado: r };
      });
      ceraId = itemId;

      // Entran 4 a 34 sobre 6 a 28 → (6×28 + 4×34) / 10 = 30.40
      await pos.escribir(() => [
        { tipo: "stock.entrada", datos: { itemId, cantidad: 4, costoUnitario: 3400, motivo: "Compra" } },
      ]);
      expect(pos.p.items.get(itemId)!.costo).toBe(3040);
      await pos.cerrar();
    }

    const revivido = await ServicioPos.abrir(await abrirAlmacen(dir));
    const item = revivido.p.items.get(ceraId)!;

    expect(item.costo).toBe(3040);
    expect(item.marca).toBe("NIVEL TRES");
    expect(revivido.p.stockDe(ceraId)).toBe(10);
    // Y el índice de marcas se rehace: si no, el filtro del catálogo quedaría
    // vacío después de cada reinicio.
    expect(revivido.p.marcas()).toEqual([{ marca: "NIVEL TRES", items: 1 }]);
    await revivido.cerrar();
  });

  it("un ítem sin precio sigue sin precio después de reiniciar", async () => {
    const dir = await carpetaTemporal();
    aBorrar.push(dir);

    let id = "";
    {
      const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
      const { itemId } = await pos.transaccion(() => {
        const r = crearItem(pos.p, {
          codigo: "LACA",
          marca: "FORAJIDO",
          nombre: "FIJADOR DORADO",
          tipo: "PRODUCTO",
          categoria: "P",
          precio: null,
          stockInicial: 3,
        });
        return { eventos: r.eventos, resultado: r };
      });
      id = itemId;
      await pos.cerrar();
    }

    const revivido = await ServicioPos.abrir(await abrirAlmacen(dir));
    // `null` y no 0: si se reconstruyera como 0, un producto al que le falta el
    // precio pasaría a ser un producto gratis al reiniciar el programa.
    expect(revivido.p.items.get(id)!.precio).toBeNull();
    expect(revivido.p.sinPrecio()).toHaveLength(1);
    await revivido.cerrar();
  });

  it("ignora una instantánea de otro formato y reconstruye desde el log", async () => {
    const dir = await carpetaTemporal();
    aBorrar.push(dir);

    const almacen = await abrirAlmacen(dir);
    const pos = await ServicioPos.abrir(almacen);
    await pos.transaccion(() => {
      const r = crearItem(pos.p, {
        codigo: "COR",
        nombre: "CORTE",
        tipo: "SERVICIO",
        categoria: "B",
        precio: 2000,
      });
      return { eventos: r.eventos, resultado: r };
    });

    // Instantánea escrita por una versión anterior, con otra forma.
    await almacen.guardarInstantanea(1, { formato: 999, seq: 1, items: [] });

    const revivido = await ServicioPos.abrir(await abrirAlmacen(dir));
    expect(revivido.p.itemPorCodigo("COR")?.nombre).toBe("CORTE");
    await revivido.cerrar();
    await pos.cerrar();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reglas que llegaron con la v0.2.0
// ─────────────────────────────────────────────────────────────────────────────

describe("exigir caja abierta", () => {
  it("no deja cobrar con la caja cerrada cuando la regla está encendida", async () => {
    const { pos, ids } = await posDePrueba();
    await pos.guardarConfig("ventas.exigirTurnoAbierto", true);

    await expect(
      pos.cobrar({
        lineas: [{ itemId: ids["COR"], cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: ulid(),
      }),
    ).rejects.toThrow(/La caja está cerrada/);

    await pos.cerrar();
  });

  it("deja cobrar en cuanto se abre el turno", async () => {
    const { pos, ids } = await posDePrueba();
    await pos.guardarConfig("ventas.exigirTurnoAbierto", true);
    await pos.transaccion(() => {
      const r = abrirTurno(pos.p, { montoInicial: 0 });
      return { eventos: r.eventos, resultado: null };
    });

    const { venta } = await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });
    expect(venta.total).toBe(2000);

    await pos.cerrar();
  });

  it("apagada (el default), cobra igual con la caja cerrada", async () => {
    const { pos, ids } = await posDePrueba();

    const { venta } = await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    });
    expect(venta.turnoId).toBeNull();

    await pos.cerrar();
  });
});

describe("pago por adelanto", () => {
  async function conBarberoActivo(pos: ServicioPos, nombre = "Kevin"): Promise<string> {
    return pos.transaccion(() => {
      const r = crearBarbero(pos.p, nombre);
      return { eventos: r.eventos, resultado: r.barberoId };
    });
  }

  it("exige decir a qué barbero se le descuenta", async () => {
    const { pos, ids } = await posDePrueba();
    await expect(
      pos.cobrar({
        lineas: [{ itemId: ids["COR"], cantidad: 1 }],
        pagos: [{ medio: "ADELANTO", monto: 2000 }],
        claveIdempotencia: ulid(),
      }),
    ).rejects.toThrow(/de qué barbero/);
    await pos.cerrar();
  });

  it("rechaza un barbero que ya no está activo", async () => {
    const { pos, ids } = await posDePrueba();
    const barberoId = await conBarberoActivo(pos);
    await pos.escribir(() => desactivarBarbero(pos.p, barberoId));

    await expect(
      pos.cobrar({
        lineas: [{ itemId: ids["COR"], cantidad: 1 }],
        pagos: [{ medio: "ADELANTO", monto: 2000, barberoId }],
        claveIdempotencia: ulid(),
      }),
    ).rejects.toThrow(/ya no está activo/);
    await pos.cerrar();
  });

  it("solo un pago de adelanto puede llevar barbero", async () => {
    const { pos, ids } = await posDePrueba();
    const barberoId = await conBarberoActivo(pos);
    await expect(
      pos.cobrar({
        lineas: [{ itemId: ids["COR"], cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000, barberoId }],
        claveIdempotencia: ulid(),
      }),
    ).rejects.toThrow(/Solo un pago de adelanto/);
    await pos.cerrar();
  });

  it("una venta pagada por adelanto no cuenta como efectivo en el arqueo", async () => {
    const { pos, ids } = await posDePrueba();
    const barberoId = await conBarberoActivo(pos);
    await pos.escribir(() => abrirTurno(pos.p, { montoInicial: 10000 }).eventos);

    const { venta } = await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1 }],
      pagos: [{ medio: "ADELANTO", monto: 2000, barberoId }],
      claveIdempotencia: ulid(),
    });

    expect(venta.total).toBe(2000); // la venta es real, por el precio real
    const arqueo = arquear(pos.p);
    expect(arqueo.medios.ADELANTO).toBe(2000);
    expect(arqueo.medios.EFECTIVO).toBe(0);
    // Nada entró al cajón: sigue siendo exactamente el monto inicial.
    expect(arqueo.efectivoEnCajon).toBe(10000);
    await pos.cerrar();
  });

  it("se puede combinar con efectivo en la misma venta", async () => {
    const { pos, ids } = await posDePrueba();
    const barberoId = await conBarberoActivo(pos);
    await pos.escribir(() => abrirTurno(pos.p, { montoInicial: 0 }).eventos);

    await pos.cobrar({
      lineas: [{ itemId: ids["COR"], cantidad: 1 }], // 20.00
      pagos: [
        { medio: "ADELANTO", monto: 1500, barberoId },
        { medio: "EFECTIVO", monto: 500 },
      ],
      claveIdempotencia: ulid(),
    });

    const arqueo = arquear(pos.p);
    expect(arqueo.medios.ADELANTO).toBe(1500);
    expect(arqueo.efectivoEnCajon).toBe(500);
    await pos.cerrar();
  });
});

describe("cliente obligatorio", () => {
  it("no deja cobrar sin cliente cuando la regla está encendida", async () => {
    const { pos, ids } = await posDePrueba();
    await pos.guardarConfig("ventas.exigirCliente", true);

    await expect(
      pos.cobrar({
        lineas: [{ itemId: ids["COR"], cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: ulid(),
      }),
    ).rejects.toThrow(/Falta el nombre del cliente/);

    await pos.cerrar();
  });

  it("rechaza un cliente que no existe antes de tocar el log", async () => {
    const { pos, ids } = await posDePrueba();
    const antes = pos.almacen.ultimaSeq();

    await expect(
      pos.cobrar({
        lineas: [{ itemId: ids["COR"], cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        clienteId: ulid(),
        claveIdempotencia: ulid(),
      }),
    ).rejects.toThrow(/cliente elegido no existe/);

    // Lo que importa: una venta rechazada no deja rastro en el log.
    expect(pos.almacen.ultimaSeq()).toBe(antes);
    await pos.cerrar();
  });
});

describe("barbero de la venta", () => {
  it("no admite un barbero desactivado en una venta nueva", async () => {
    const { pos, ids } = await posDePrueba();

    const barberoId = await pos.transaccion(() => {
      const r = crearBarbero(pos.p, "Kevin");
      return { eventos: r.eventos, resultado: r.barberoId };
    });
    await pos.escribir(() => desactivarBarbero(pos.p, barberoId));

    await expect(
      pos.cobrar({
        lineas: [{ itemId: ids["COR"], cantidad: 1, barberoId }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: ulid(),
      }),
    ).rejects.toThrow(/ya no está activo/);

    await pos.cerrar();
  });

  it("reactivar conserva el id, así que las ventas viejas siguen apuntando a la persona", async () => {
    const { pos } = await posDePrueba();

    const barberoId = await pos.transaccion(() => {
      const r = crearBarbero(pos.p, "Marco");
      return { eventos: r.eventos, resultado: r.barberoId };
    });
    await pos.escribir(() => desactivarBarbero(pos.p, barberoId));
    expect(pos.p.barberos.get(barberoId)?.activo).toBe(false);

    await pos.escribir(() => reactivarBarbero(pos.p, barberoId));
    expect(pos.p.barberos.get(barberoId)?.activo).toBe(true);
    expect(pos.p.barberos.get(barberoId)?.nombre).toBe("Marco");

    await pos.cerrar();
  });
});

describe("catálogo de la v0.2.0", () => {
  it("genera el código solo, sin reutilizar el de un ítem desactivado", async () => {
    const { pos } = await posDePrueba();

    const primero = await pos.transaccion(() => {
      const r = crearItem(pos.p, { nombre: "VAPE", tipo: "PRODUCTO", categoria: "Productos", precio: 4500 });
      return { eventos: r.eventos, resultado: r.itemId };
    });
    expect(pos.p.items.get(primero)?.codigo).toBe("P0001");

    await pos.escribir(() => desactivarItem(pos.p, primero, "se dejó de vender"));

    const segundo = await pos.transaccion(() => {
      const r = crearItem(pos.p, { nombre: "PIPA", tipo: "PRODUCTO", categoria: "Productos", precio: 3500 });
      return { eventos: r.eventos, resultado: r.itemId };
    });
    // P0002 y NO P0001: reutilizarlo haría que un ticket viejo pareciera de
    // otro producto.
    expect(pos.p.items.get(segundo)?.codigo).toBe("P0002");

    await pos.cerrar();
  });

  it("unifica cómo se escribe una categoría en vez de abrir una pestaña nueva", async () => {
    const { pos } = await posDePrueba();

    const id = await pos.transaccion(() => {
      // El catálogo de `posDePrueba` ya tiene "Productos".
      const r = crearItem(pos.p, { nombre: "GEL", tipo: "PRODUCTO", categoria: "  productos ", precio: 1800 });
      return { eventos: r.eventos, resultado: r.itemId };
    });

    expect(pos.p.items.get(id)?.categoria).toBe("Productos");
    await pos.cerrar();
  });
});
