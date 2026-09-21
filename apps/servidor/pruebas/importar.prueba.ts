/**
 * Pruebas de la importación de catálogo desde Excel.
 *
 * Dos cosas concentran el riesgo. Una es el XLSX: se lee y se escribe a mano,
 * así que si Excel cambia un detalle del formato hay que enterarse acá y no
 * con el cliente al teléfono. La otra es "reemplazar": es la única función del
 * sistema que da de baja cosas en bloque, y equivocarse deja a la barbería sin
 * catálogo en hora pico.
 */

import { describe, expect, it, afterEach } from "vitest";

import { ServicioPos } from "../src/servicios/Pos";
import { crearItem } from "../src/dominio/catalogo/catalogo";
import { importarCatalogo, planificarImportacion } from "../src/dominio/catalogo/importar";
import { escribirXlsx, leerXlsx } from "../src/adaptadores/planilla/xlsx";
import { generarPlantilla, leerPlantilla } from "../src/adaptadores/planilla/plantillaCatalogo";
import { abrirAlmacen, borrar, carpetaTemporal } from "./ayuda";

const aBorrar: string[] = [];
afterEach(async () => {
  await Promise.all(aBorrar.splice(0).map(borrar));
});

async function posVacio() {
  const dir = await carpetaTemporal();
  aBorrar.push(dir);
  return ServicioPos.abrir(await abrirAlmacen(dir));
}

/** Arma un .xlsx con los encabezados de la plantilla y las filas que se le pasen. */
function planilla(filas: (string | number)[][]): Buffer {
  return escribirXlsx({
    nombre: "Catálogo",
    filas: [["Código", "Nombre", "Tipo", "Categoría", "Precio", "Stock", "Stock mínimo"], ...filas],
  });
}

describe("xlsx", () => {
  it("sobrevive el ida y vuelta con acentos, comillas y símbolos de XML", async () => {
    // Si esto falla, los nombres con tilde llegan rotos al ticket.
    const original = ['CERA "FUERTE" & BRILLO <x>', "CORTE CLÁSICO — ÁÉÍÓÚ ñÑ", "5 > 3"];
    const leido = leerXlsx(escribirXlsx({ nombre: "H", filas: [original] }));
    expect(leido[0]).toEqual(original);
  });

  it("respeta la columna de cada celda aunque haya huecos", async () => {
    // Excel no escribe las celdas vacías. Sin colocar cada una en SU columna,
    // todo lo que está a la derecha de un hueco se corre un lugar.
    const leido = leerXlsx(escribirXlsx({ nombre: "H", filas: [["A", "", "", "D"]] }));
    expect(leido[0][0]).toBe("A");
    expect(leido[0][3]).toBe("D");
  });

  it("la plantilla que se entrega se puede volver a leer", async () => {
    const filas = leerXlsx(generarPlantilla());
    expect(filas[0]).toEqual(["Código", "Nombre", "Tipo", "Categoría", "Precio", "Stock", "Stock mínimo"]);
  });
});

describe("lectura de la planilla", () => {
  it("acepta los precios como los escribe una persona", async () => {
    const { filas, problemas } = leerPlantilla(
      planilla([
        ["", "A", "SERVICIO", "B", "20", "", ""],
        ["", "B", "SERVICIO", "B", "25,50", "", ""],
        ["", "C", "SERVICIO", "B", "S/ 30.00", "", ""],
      ]),
    );
    expect(problemas).toHaveLength(0);
    expect(filas.map((f) => f.precio)).toEqual([2000, 2550, 3000]);
  });

  it("junta TODOS los problemas en vez de cortar en el primero", async () => {
    // Cortar en el primer error obliga a subir el archivo diez veces para
    // descubrir diez errores.
    const { problemas } = leerPlantilla(
      planilla([
        ["", "", "SERVICIO", "B", "20", "", ""],
        ["", "B", "COSITA", "B", "20", "", ""],
        ["", "C", "SERVICIO", "B", "carísimo", "", ""],
      ]),
    );
    expect(problemas.length).toBeGreaterThanOrEqual(3);
    expect(problemas.map((p) => p.fila)).toEqual([2, 3, 4]);
  });

  it("no acumula errores en cascada sobre una fila con el tipo mal", async () => {
    // Con el tipo inválido, quejarse ADEMÁS del stock manda a corregir una
    // celda que no tiene nada de malo.
    const { problemas } = leerPlantilla(planilla([["", "GEL", "COSITA", "P", "18", "5", ""]]));
    expect(problemas).toHaveLength(1);
    expect(problemas[0].columna).toBe("Tipo");
  });

  it("señala el código repetido con la fila donde estaba antes", async () => {
    const { problemas } = leerPlantilla(
      planilla([
        ["DUP", "A", "PRODUCTO", "P", "10", "1", ""],
        ["DUP", "B", "PRODUCTO", "P", "10", "1", ""],
      ]),
    );
    expect(problemas[0].problema).toMatch(/ya está en la fila 2/);
  });

  it("rechaza un archivo que no es la plantilla", async () => {
    const otro = escribirXlsx({ nombre: "H", filas: [["Fecha", "Importe"], ["hoy", "10"]] });
    expect(leerPlantilla(otro).problemas[0].problema).toMatch(/encabezados no coinciden/);
  });
});

describe("importar", () => {
  it("crea los ítems y les pone el stock inicial", async () => {
    const pos = await posVacio();
    const { filas } = leerPlantilla(
      planilla([
        ["", "CORTE", "SERVICIO", "Barbería", "20", "", ""],
        ["", "CERA", "PRODUCTO", "Productos", "25", "12", "3"],
      ]),
    );

    await pos.escribir(() => importarCatalogo(pos.p, filas, "agregar"));

    expect(pos.p.items.size).toBe(2);
    const cera = pos.p.itemPorCodigo("P0001")!;
    expect(cera.nombre).toBe("CERA");
    expect(pos.p.stockDe(cera.id)).toBe(12);
    await pos.cerrar();
  });

  it("subir dos veces la misma planilla no duplica nada", async () => {
    const pos = await posVacio();
    const { filas } = leerPlantilla(planilla([["", "CORTE", "SERVICIO", "Barbería", "20", "", ""]]));

    await pos.escribir(() => importarCatalogo(pos.p, filas, "agregar"));
    await pos.escribir(() => importarCatalogo(pos.p, filas, "agregar"));

    expect(pos.p.items.size).toBe(1);
    await pos.cerrar();
  });

  it("ajusta el stock en vez de sumarlo", async () => {
    // La columna dice cuántas unidades HAY, no cuántas entraron. Sumarlas
    // duplicaría el inventario en cada reimportación.
    const pos = await posVacio();
    const uno = leerPlantilla(planilla([["", "CERA", "PRODUCTO", "P", "25", "10", ""]])).filas;
    await pos.escribir(() => importarCatalogo(pos.p, uno, "agregar"));

    const dos = leerPlantilla(planilla([["", "CERA", "PRODUCTO", "P", "25", "10", ""]])).filas;
    await pos.escribir(() => importarCatalogo(pos.p, dos, "agregar"));

    expect(pos.p.stockDe(pos.p.itemPorCodigo("P0001")!.id)).toBe(10);
    await pos.cerrar();
  });

  it("el cambio de precio queda registrado con el anterior al lado", async () => {
    const pos = await posVacio();
    await pos.escribir(() => importarCatalogo(pos.p, leerPlantilla(planilla([["", "CORTE", "SERVICIO", "B", "20", "", ""]])).filas, "agregar"));
    await pos.escribir(() => importarCatalogo(pos.p, leerPlantilla(planilla([["", "CORTE", "SERVICIO", "B", "25", "", ""]])).filas, "agregar"));

    const tipos: string[] = [];
    for await (const e of pos.almacen.leer()) tipos.push(e.tipo);
    // Es lo que hace auditable quién cambió cuánto.
    expect(tipos).toContain("item.precio_cambiado");
    expect(pos.p.itemPorCodigo("S0001")!.precio).toBe(2500);
    await pos.cerrar();
  });

  it("«agregar» NO toca lo que no viene en el archivo", async () => {
    const pos = await posVacio();
    await pos.transaccion(() => {
      const r = crearItem(pos.p, { codigo: "VIEJO", nombre: "VIEJO", tipo: "SERVICIO", categoria: "B", precio: 1000 });
      return { eventos: r.eventos, resultado: null };
    });

    await pos.escribir(() => importarCatalogo(pos.p, leerPlantilla(planilla([["", "NUEVO", "SERVICIO", "B", "20", "", ""]])).filas, "agregar"));

    expect(pos.p.itemPorCodigo("VIEJO")!.activo).toBe(true);
    await pos.cerrar();
  });

  it("«reemplazar» da de baja lo que no viene, pero NO lo borra", async () => {
    const pos = await posVacio();
    await pos.transaccion(() => {
      const r = crearItem(pos.p, { codigo: "VIEJO", nombre: "VIEJO", tipo: "SERVICIO", categoria: "B", precio: 1000 });
      return { eventos: r.eventos, resultado: null };
    });
    const idViejo = pos.p.itemPorCodigo("VIEJO")!.id;

    await pos.escribir(() => importarCatalogo(pos.p, leerPlantilla(planilla([["", "NUEVO", "SERVICIO", "B", "20", "", ""]])).filas, "reemplazar"));

    // Desactivado, no eliminado: un ticket viejo tiene que poder seguir
    // mostrando qué se vendió.
    expect(pos.p.items.get(idViejo)?.activo).toBe(false);
    expect(pos.p.items.has(idViejo)).toBe(true);
    await pos.cerrar();
  });

  it("volver a cargar un ítem dado de baja lo reactiva con su mismo id", async () => {
    const pos = await posVacio();
    const p1 = leerPlantilla(planilla([["", "CORTE", "SERVICIO", "B", "20", "", ""]])).filas;
    await pos.escribir(() => importarCatalogo(pos.p, p1, "agregar"));
    const id = pos.p.itemPorCodigo("S0001")!.id;

    await pos.escribir(() => importarCatalogo(pos.p, leerPlantilla(planilla([["", "OTRO", "SERVICIO", "B", "20", "", ""]])).filas, "reemplazar"));
    expect(pos.p.items.get(id)!.activo).toBe(false);

    await pos.escribir(() => importarCatalogo(pos.p, p1, "agregar"));
    expect(pos.p.items.get(id)!.activo).toBe(true);
    await pos.cerrar();
  });
});

describe("plan de importación", () => {
  it("avisa qué se va a dar de baja ANTES de aplicar nada", async () => {
    // Es lo único que separa "cargué el catálogo" de "me quedé sin catálogo".
    const pos = await posVacio();
    await pos.transaccion(() => {
      const r = crearItem(pos.p, { codigo: "VIEJO", nombre: "VIEJO", tipo: "SERVICIO", categoria: "B", precio: 1000 });
      return { eventos: r.eventos, resultado: null };
    });

    const { filas } = leerPlantilla(planilla([["", "NUEVO", "SERVICIO", "B", "20", "", ""]]));
    const plan = planificarImportacion(pos.p, filas, "reemplazar");

    expect(plan.aDesactivar).toEqual([{ codigo: "VIEJO", nombre: "VIEJO" }]);
    expect(plan.resumen).toMatchObject({ crear: 1, desactivar: 1 });
    // Planificar no escribe: el ítem sigue activo.
    expect(pos.p.itemPorCodigo("VIEJO")!.activo).toBe(true);
    await pos.cerrar();
  });

  it("en «agregar» no hay bajas ni aunque sobren ítems", async () => {
    const pos = await posVacio();
    await pos.transaccion(() => {
      const r = crearItem(pos.p, { codigo: "VIEJO", nombre: "VIEJO", tipo: "SERVICIO", categoria: "B", precio: 1000 });
      return { eventos: r.eventos, resultado: null };
    });

    const { filas } = leerPlantilla(planilla([["", "NUEVO", "SERVICIO", "B", "20", "", ""]]));
    expect(planificarImportacion(pos.p, filas, "agregar").aDesactivar).toHaveLength(0);
    await pos.cerrar();
  });

  it("explica qué cambia en cada ítem, no solo que cambia", async () => {
    const pos = await posVacio();
    await pos.escribir(() => importarCatalogo(pos.p, leerPlantilla(planilla([["", "CORTE", "SERVICIO", "B", "20", "", ""]])).filas, "agregar"));

    const { filas } = leerPlantilla(planilla([["", "CORTE", "SERVICIO", "B", "25", "", ""]]));
    const plan = planificarImportacion(pos.p, filas, "agregar");

    expect(plan.cambios[0].accion).toBe("actualizar");
    expect(plan.cambios[0].detalle.join(" ")).toMatch(/precio: S\/ 20\.00 → S\/ 25\.00/);
    await pos.cerrar();
  });
});
