/**
 * Pruebas de los reportes de utilidad, margen y rotación.
 *
 * Lo que se prueba acá no es "que sume bien" sino algo más incómodo: QUE NO
 * MIENTA. Un reporte de margen es peligroso justamente porque parece confiable;
 * si un producto sin costo cargado se cuenta como costo cero, la pantalla
 * informa un margen del 100% y el dueño decide sobre una ganancia que no existe.
 *
 * Por eso casi todas las pruebas de este archivo verifican la frontera entre
 * "cero" y "no se sabe".
 */

import { describe, expect, it, afterEach } from "vitest";
import { ulid } from "ulid";

import { ServicioPos } from "../src/servicios/Pos";
import { crearItem } from "../src/dominio/catalogo/catalogo";
import { construirReporte, variacion } from "../src/consultas/reportes";
import { abrirAlmacen, borrar, carpetaTemporal } from "./ayuda";

const aBorrar: string[] = [];
afterEach(async () => {
  await Promise.all(aBorrar.splice(0).map(borrar));
});

/** El POS con un catálogo chico y conocido, para poder hacer las cuentas a mano. */
async function posConCatalogo() {
  const dir = await carpetaTemporal();
  aBorrar.push(dir);
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
  await pos.guardarConfig("ventas.exigirCliente", false);

  const ids: Record<string, string> = {};
  const alta = async (clave: string, datos: Parameters<typeof crearItem>[1]) => {
    await pos.transaccion(() => {
      const r = crearItem(pos.p, datos);
      ids[clave] = r.itemId;
      return { eventos: r.eventos, resultado: null };
    });
  };

  // Un servicio: no tiene costo porque no hay mercadería que comprar.
  await alta("CORTE", {
    nombre: "CORTE CLASICO",
    tipo: "SERVICIO",
    categoria: "Barbería",
    precio: 2000,
  });

  // Un producto con costo: vende a 45, cuesta 28 → utilidad 17, margen 37.8%.
  await alta("CERA", {
    marca: "NIVEL TRES",
    nombre: "CERA MATE FINISH",
    tipo: "PRODUCTO",
    categoria: "Barbería",
    precio: 4500,
    costo: 2800,
    stockInicial: 10,
  });

  // Un producto SIN costo cargado: se vende, pero su margen no se puede calcular.
  await alta("VAPE", {
    marca: "VIDA POD",
    nombre: "CARTUCHO LP BLUE RAZZ",
    tipo: "PRODUCTO",
    categoria: "Vapes",
    precio: 2500,
    costo: null,
    stockInicial: 10,
  });

  // Un producto con stock que nunca se vende: es el que debe salir en rotación.
  await alta("DORMIDO", {
    marca: "FORAJIDO",
    nombre: "LACA DORADA",
    tipo: "PRODUCTO",
    categoria: "Barbería",
    precio: 3000,
    costo: 1500,
    stockInicial: 4,
  });

  return { pos, ids };
}

/**
 * Hoy EN LIMA, que es la fecha con la que se sellan los eventos.
 *
 * No sirve `toISOString().slice(0,10)`: esa es la fecha UTC, y a partir de las
 * 19:00 de Lima ya es el día siguiente en UTC. Con eso, estas pruebas pasaban
 * durante el día y empezaban a fallar de noche buscando ventas en un día que
 * todavía no existe — una bomba de tiempo, no un error de cálculo.
 *
 * El offset es fijo porque Perú no cambia la hora en todo el año (ver `Reloj`).
 */
const hoy = () => new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

async function cobrar(pos: ServicioPos, lineas: { itemId: string; cantidad: number; precioUnitario?: number }[]) {
  const total = lineas.reduce((a, l) => a + (l.precioUnitario ?? 0) * l.cantidad, 0);
  return pos.cobrar({
    lineas,
    pagos: [{ medio: "EFECTIVO", monto: total }],
    claveIdempotencia: ulid(),
  });
}

describe("utilidad y margen", () => {
  it("calcula la utilidad contra el costo congelado en la venta", async () => {
    const { pos, ids } = await posConCatalogo();
    await cobrar(pos, [{ itemId: ids["CERA"], cantidad: 2, precioUnitario: 4500 }]);

    const r = construirReporte(pos.p, hoy(), hoy());

    expect(r.total).toBe(9000);
    expect(r.utilidad.costo).toBe(5600); // 2 × 28.00
    expect(r.utilidad.utilidad).toBe(3400); // 90.00 − 56.00
    expect(r.utilidad.margen).toBe(37.8);
    await pos.cerrar();
  });

  it("deja FUERA del margen lo que se vendió sin costo conocido", async () => {
    // Es la prueba más importante del archivo. Si el vape sin costo entrara al
    // cálculo como costo cero, el margen saldría 72% en vez de 37.8% y el dueño
    // creería que los vapes son su mejor negocio sin tener un solo dato.
    const { pos, ids } = await posConCatalogo();
    await cobrar(pos, [
      { itemId: ids["CERA"], cantidad: 2, precioUnitario: 4500 },
      { itemId: ids["VAPE"], cantidad: 2, precioUnitario: 2500 },
    ]);

    const r = construirReporte(pos.p, hoy(), hoy());

    expect(r.total).toBe(14000);
    // El margen sigue siendo el de la cera: es lo único costeable.
    expect(r.utilidad.margen).toBe(37.8);
    expect(r.utilidad.ingresoCosteado).toBe(9000);
    expect(r.utilidad.ingresoSinCostear).toBe(5000);
    // Y la pantalla puede decir sobre cuánto se calculó: 9000 de 14000 = 64%.
    expect(r.utilidad.cobertura).toBe(64);
    await pos.cerrar();
  });

  it("un servicio no arrastra el margen hacia arriba", async () => {
    // Un corte no tiene costo de mercadería. Contarlo como costo cero daría un
    // margen global inflado que no sirve para decidir nada sobre la reventa.
    const { pos, ids } = await posConCatalogo();
    await cobrar(pos, [
      { itemId: ids["CORTE"], cantidad: 5, precioUnitario: 2000 },
      { itemId: ids["CERA"], cantidad: 1, precioUnitario: 4500 },
    ]);

    const r = construirReporte(pos.p, hoy(), hoy());

    expect(r.total).toBe(14500);
    expect(r.utilidad.margen).toBe(37.8); // el de la cera, intacto
    expect(r.utilidad.ingresoSinCostear).toBe(10000); // los cortes
    await pos.cerrar();
  });

  it("sin ninguna venta costeable el margen es null, no cero", async () => {
    // "No lo sé" y "no gano nada" son afirmaciones distintas.
    const { pos, ids } = await posConCatalogo();
    await cobrar(pos, [{ itemId: ids["VAPE"], cantidad: 1, precioUnitario: 2500 }]);

    const r = construirReporte(pos.p, hoy(), hoy());

    expect(r.total).toBe(2500);
    expect(r.utilidad.margen).toBeNull();
    expect(r.utilidad.cobertura).toBe(0);
    await pos.cerrar();
  });
});

describe("agrupaciones", () => {
  it("separa el margen por categoría", async () => {
    const { pos, ids } = await posConCatalogo();
    await cobrar(pos, [
      { itemId: ids["CERA"], cantidad: 1, precioUnitario: 4500 },
      { itemId: ids["VAPE"], cantidad: 1, precioUnitario: 2500 },
    ]);

    const r = construirReporte(pos.p, hoy(), hoy());
    const porNombre = Object.fromEntries(r.porCategoria.map((c) => [c.clave, c]));

    expect(porNombre["Barbería"].margen).toBe(37.8);
    // Vapes vendió, pero su margen no se conoce. No es 100%.
    expect(porNombre["Vapes"].total).toBe(2500);
    expect(porNombre["Vapes"].margen).toBeNull();
    await pos.cerrar();
  });

  it("agrupa por marca y deja los servicios afuera", async () => {
    // Una fila con todos los cortes aplastaría el ranking de marcas, que es una
    // pregunta sobre lo que se revende.
    const { pos, ids } = await posConCatalogo();
    await cobrar(pos, [
      { itemId: ids["CORTE"], cantidad: 3, precioUnitario: 2000 },
      { itemId: ids["CERA"], cantidad: 1, precioUnitario: 4500 },
    ]);

    const r = construirReporte(pos.p, hoy(), hoy());

    expect(r.porMarca.map((m) => m.clave)).toEqual(["NIVEL TRES"]);
    expect(r.porMarca[0].total).toBe(4500);
    await pos.cerrar();
  });

  it("un servicio marcado con el nombre del local NO entra al ranking de marcas", async () => {
    // El catálogo real marca los siete servicios de barbería con "LA CÚPULA".
    // Como los servicios son el grueso de la facturación, esa fila encabezaría
    // el ranking siempre y taparía a las marcas que de verdad se revenden.
    const { pos, ids } = await posConCatalogo();
    await pos.transaccion(() => {
      const r = crearItem(pos.p, {
        marca: "LA CÚPULA",
        nombre: "CEJAS",
        tipo: "SERVICIO",
        categoria: "Barbería",
        precio: 500,
      });
      return { eventos: r.eventos, resultado: r.itemId };
    });
    const cejas = [...pos.p.items.values()].find((i) => i.nombre === "CEJAS")!;

    await cobrar(pos, [
      { itemId: cejas.id, cantidad: 20, precioUnitario: 500 }, // 100.00 en servicios
      { itemId: ids["CERA"], cantidad: 1, precioUnitario: 4500 }, // 45.00 en producto
    ]);

    const r = construirReporte(pos.p, hoy(), hoy());

    expect(r.porMarca.map((m) => m.clave)).toEqual(["NIVEL TRES"]);
    // Pero la marca SÍ quedó guardada en el ítem y en la línea de venta: no se
    // pierde el dato, solo no se mezcla en este ranking.
    expect(cejas.marca).toBe("LA CÚPULA");
    await pos.cerrar();
  });

  it("el ranking nombra los ítems con su marca", async () => {
    const { pos, ids } = await posConCatalogo();
    await cobrar(pos, [{ itemId: ids["CERA"], cantidad: 1, precioUnitario: 4500 }]);

    const r = construirReporte(pos.p, hoy(), hoy());
    expect(r.ranking[0].etiqueta).toBe("NIVEL TRES CERA MATE FINISH");
    await pos.cerrar();
  });
});

describe("señales", () => {
  it("lista lo vendido por debajo del costo con la pérdida al lado", async () => {
    const { pos, ids } = await posConCatalogo();
    // La cera cuesta 28 y se cobra 20: se pierden 8 por unidad, 16 en total.
    await cobrar(pos, [{ itemId: ids["CERA"], cantidad: 2, precioUnitario: 2000 }]);

    const r = construirReporte(pos.p, hoy(), hoy());

    expect(r.bajoCosto).toHaveLength(1);
    expect(r.bajoCosto[0]).toMatchObject({ nombre: "NIVEL TRES CERA MATE FINISH", perdida: 1600 });
    // Y la utilidad del período es negativa, sin disimulo.
    expect(r.utilidad.utilidad).toBe(-1600);
    await pos.cerrar();
  });

  it("cuenta los cobros con el precio escrito a mano", async () => {
    const { pos } = await posConCatalogo();
    await pos.transaccion(() => {
      const r = crearItem(pos.p, {
        marca: "FORAJIDO",
        nombre: "CERA ROJA",
        tipo: "PRODUCTO",
        categoria: "Barbería",
        precio: null,
        stockInicial: 3,
      });
      return { eventos: r.eventos, resultado: r.itemId };
    });
    const sinPrecio = [...pos.p.items.values()].find((i) => i.nombre === "CERA ROJA")!;

    await cobrar(pos, [{ itemId: sinPrecio.id, cantidad: 1, precioUnitario: 3500 }]);

    expect(construirReporte(pos.p, hoy(), hoy()).preciosAbiertos).toBe(1);
    await pos.cerrar();
  });
});

describe("inventario y rotación", () => {
  it("valoriza a costo y a precio de venta por separado", async () => {
    const { pos } = await posConCatalogo();
    const r = construirReporte(pos.p, hoy(), hoy());

    // CERA 10 × 28 = 280, DORMIDO 4 × 15 = 60 → 340. El vape no tiene costo.
    expect(r.inventario.valorCosto).toBe(34000);
    // CERA 10 × 45 = 450, VAPE 10 × 25 = 250, DORMIDO 4 × 30 = 120 → 820.
    expect(r.inventario.valorVenta).toBe(82000);
    // Y dice cuántos quedaron fuera del total a costo, para que el número no
    // se lea como "hay poca mercadería" cuando es "faltan costos".
    expect(r.inventario.sinCosto).toBe(1);
    await pos.cerrar();
  });

  it("lista los productos con stock que no se vendieron", async () => {
    const { pos, ids } = await posConCatalogo();
    await cobrar(pos, [{ itemId: ids["CERA"], cantidad: 1, precioUnitario: 4500 }]);

    const r = construirReporte(pos.p, hoy(), hoy());
    const nombres = r.sinRotar.map((s) => s.nombre);

    expect(nombres).toContain("FORAJIDO LACA DORADA");
    expect(nombres).not.toContain("NIVEL TRES CERA MATE FINISH"); // se vendió
    await pos.cerrar();
  });

  it("dice cuánta plata hay parada en lo que no rota", async () => {
    const { pos } = await posConCatalogo();
    const r = construirReporte(pos.p, hoy(), hoy());
    const dormido = r.sinRotar.find((s) => s.nombre === "FORAJIDO LACA DORADA")!;

    expect(dormido.inmovilizado).toBe(6000); // 4 × 15.00
    expect(dormido.diasSinVender).toBeNull(); // no se vendió nunca
    await pos.cerrar();
  });

  it("no cuenta como «sin rotar» un producto agotado", async () => {
    // Sin stock no hay plata inmovilizada, que es el problema que este bloque
    // busca. Meterlo ahí llenaría la lista de ruido.
    const { pos, ids } = await posConCatalogo();
    await pos.escribir(() => [
      { tipo: "stock.ajustado", datos: { itemId: ids["DORMIDO"], cantidadContada: 0, cantidadSistema: 4, motivo: "Conteo" } },
    ]);

    const r = construirReporte(pos.p, hoy(), hoy());
    expect(r.sinRotar.map((s) => s.nombre)).not.toContain("FORAJIDO LACA DORADA");
    await pos.cerrar();
  });
});

describe("comparación con el período anterior", () => {
  it("el período anterior es del mismo largo e inmediatamente antes", async () => {
    const { pos } = await posConCatalogo();
    const r = construirReporte(pos.p, "2026-09-01", "2026-09-30");

    expect(r.dias).toBe(30);
    expect(r.anterior).toMatchObject({ desde: "2026-08-02", hasta: "2026-08-31", dias: 30 });
    await pos.cerrar();
  });

  it("la variación es null cuando no hay contra qué comparar", async () => {
    // Un aumento desde cero no es "+100%", es una cifra que no existe. Mostrar
    // un porcentaje ahí es inventar una comparación.
    expect(variacion(5000, 0)).toBeNull();
    expect(variacion(5000, 4000)).toBe(25);
    expect(variacion(3000, 4000)).toBe(-25);
  });
});
