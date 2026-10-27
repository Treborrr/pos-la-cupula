import { SEDE_PRINCIPAL } from "@cupula/contratos";
/**
 * Pruebas de la importación de catálogo desde Excel.
 *
 * Tres cosas concentran el riesgo. Una es el XLSX: se lee y se escribe a mano,
 * así que si Excel cambia un detalle del formato hay que enterarse acá y no
 * con el cliente al teléfono. La otra es "reemplazar": es la única función del
 * sistema que da de baja cosas en bloque, y equivocarse deja a la barbería sin
 * catálogo en hora pico.
 *
 * La tercera es nueva y es la que motivó todo este cambio: UN CATÁLOGO DE
 * VERDAD. `fijos/catalogo-de-ejemplo.xlsx` reproduce el archivo que mandó el
 * primer cliente —137 filas, marcas escritas con espacios de más, "ILIMITADO"
 * en el stock de los servicios, 119 productos sin precio— con los nombres
 * cambiados por inventados. Hay una prueba que lo carga entero: si alguien
 * endurece la lectura y ese archivo deja de entrar, se cae acá, que es
 * exactamente lo que no pasó la primera vez.
 *
 * El archivo CONSERVA la estructura que produjo Excel: `sharedStrings.xml`,
 * `styles.xml`, `theme1.xml`. Eso no es un detalle — es la mitad del valor de
 * la prueba. Nuestro escritor de XLSX produce otra cosa (cadenas en línea, sin
 * estilos ni tema), así que regenerarlo con él convertiría "sabemos leer lo que
 * Excel escribe" en "sabemos leer lo que nosotros escribimos", que no prueba
 * nada. Se reemplazaron solo las cadenas, en sus mismos índices.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";

import { ServicioPos } from "../src/servicios/Pos";
import { actualizarItem, crearItem } from "../src/dominio/catalogo/catalogo";
import { importarCatalogo, planificarImportacion } from "../src/dominio/catalogo/importar";
import { escribirXlsx, leerXlsx } from "../src/adaptadores/planilla/xlsx";
import { COLUMNAS, generarPlantilla, leerPlantilla } from "../src/adaptadores/planilla/plantillaCatalogo";
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

/**
 * Arma un .xlsx con los encabezados de la plantilla y las filas que se le pasen.
 *
 * Orden de columnas: MARCA | NOMBRE | TIPO | CATEGORÍA | PRECIO VENTA |
 * PRECIO COMPRA | STOCK | STOCK MÍNIMO
 */
function planilla(filas: (string | number)[][]): Buffer {
  return escribirXlsx({ nombre: "Catálogo", filas: [[...COLUMNAS], ...filas] });
}

/** Atajo: lee y exige que no haya ni un problema. */
function filasDe(datos: Buffer) {
  const { filas, problemas } = leerPlantilla(datos);
  expect(problemas).toEqual([]);
  return filas;
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
    expect(filas[0]).toEqual([...COLUMNAS]);
  });

  it("lee los datos y no las instrucciones, que van en otra hoja", async () => {
    // Cuando el instructivo vivía debajo de los datos, el lector tenía que
    // adivinar con heurísticas qué fila era un producto. Ahora la primera hoja
    // solo tiene catálogo, y las filas de ejemplo son productos de verdad.
    const { filas, problemas } = leerPlantilla(generarPlantilla());
    expect(problemas).toEqual([]);
    expect(filas.map((f) => f.nombre)).toEqual([
      "CORTE CLASICO",
      "BARBA",
      "PASTA MATE FIRME",
      "CARTUCHO VP FRAMBUESA",
    ]);
  });
});

describe("lectura de la planilla", () => {
  it("acepta los precios como los escribe una persona", async () => {
    const filas = filasDe(
      planilla([
        ["", "A", "SERVICIO", "B", "20", "", "", ""],
        ["", "B", "SERVICIO", "B", "25,50", "", "", ""],
        ["", "C", "SERVICIO", "B", "S/ 30.00", "", "", ""],
      ]),
    );
    expect(filas.map((f) => f.precio)).toEqual([2000, 2550, 3000]);
  });

  it("un PRECIO VENTA vacío entra como SIN PRECIO, no como cero", async () => {
    // Es el caso de 119 de las 137 filas del cliente. Un 0 se cobraría en
    // silencio; null obliga a escribir el precio al vender.
    const filas = filasDe(planilla([["FORAJIDO", "PASTA ROJA", "PRODUCTO", "Barbería", "", "", "2", ""]]));
    expect(filas).toHaveLength(1);
    expect(filas[0].precio).toBeNull();
  });

  it("entiende ILIMITADO en la columna STOCK", async () => {
    // El cliente lo escribió en sus siete servicios de barbería, y tiene razón:
    // un corte no se agota. Tratarlo como error haría que su archivo no cargue.
    const filas = filasDe(
      planilla([
        ["", "CORTE CLASICO", "SERVICIO", "Barbería", "20", "", "ILIMITADO", ""],
        ["", "BARBA", "SERVICIO", "Barbería", "10", "", "∞", ""],
      ]),
    );
    expect(filas.map((f) => f.stock)).toEqual([null, null]);
  });

  it("lee la marca y el precio de compra", async () => {
    const filas = filasDe(planilla([["NIVEL TRES", "PASTA MATE", "PRODUCTO", "Barbería", "45", "28", "2", "1"]]));
    expect(filas[0]).toMatchObject({ marca: "NIVEL TRES", precio: 4500, costo: 2800, stock: 2, stockMinimo: 1 });
  });

  it("limpia los espacios de más de la marca", async () => {
    // En el archivo del cliente, "NIVEL TRES " viene con espacio al final en seis
    // filas. Sin limpiarlo, el filtro por marca muestra dos marcas distintas.
    const filas = filasDe(planilla([["  NIVEL   TRES  ", "CERA", "PRODUCTO", "B", "45", "", "1", ""]]));
    expect(filas[0].marca).toBe("NIVEL TRES");
  });

  it("junta TODOS los problemas en vez de cortar en el primero", async () => {
    // Cortar en el primer error obliga a subir el archivo diez veces para
    // descubrir diez errores.
    const { problemas } = leerPlantilla(
      planilla([
        ["", "", "SERVICIO", "B", "20", "", "", ""],
        ["", "B", "COSITA", "B", "20", "", "", ""],
        ["", "C", "SERVICIO", "B", "carísimo", "", "", ""],
      ]),
    );
    expect(problemas.length).toBeGreaterThanOrEqual(3);
    expect(problemas.map((p) => p.fila)).toEqual([2, 3, 4]);
  });

  it("no acumula errores en cascada sobre una fila con el tipo mal", async () => {
    // Con el tipo inválido, quejarse ADEMÁS del stock manda a corregir una
    // celda que no tiene nada de malo.
    const { problemas } = leerPlantilla(planilla([["", "GEL", "COSITA", "P", "18", "", "5", ""]]));
    expect(problemas).toHaveLength(1);
    expect(problemas[0].columna).toBe("TIPO");
  });

  it("señala la fila repetida mirando marca Y nombre", async () => {
    const { problemas } = leerPlantilla(
      planilla([
        ["FORAJIDO", "CERA", "PRODUCTO", "P", "10", "", "1", ""],
        ["FORAJIDO", "CERA", "PRODUCTO", "P", "10", "", "1", ""],
      ]),
    );
    expect(problemas[0].problema).toMatch(/ya está en la fila 2/);
  });

  it("el mismo nombre con marcas distintas NO es un duplicado", async () => {
    // El caso literal del catálogo real: dos marcas, cada una con su TALCO.
    const filas = filasDe(
      planilla([
        ["DON NISH", "TALCO", "PRODUCTO", "Barbería", "15", "", "1", ""],
        ["SIRMAN", "TALCO", "PRODUCTO", "Barbería", "12", "", "2", ""],
      ]),
    );
    expect(filas).toHaveLength(2);
  });

  it("avisa si el precio de venta quedó por debajo del de compra", async () => {
    const { filas, problemas } = leerPlantilla(
      planilla([["ROLBA", "GEL", "PRODUCTO", "B", "11", "13", "1", ""]]),
    );
    expect(problemas[0].problema).toMatch(/menor que el de compra/);
    // Avisa, pero NO frena la carga: puede ser una liquidación de verdad.
    expect(filas).toHaveLength(1);
  });

  it("dice QUÉ columna está mal, no solo que los encabezados no coinciden", async () => {
    // Con ocho columnas, un "no coinciden" genérico obliga a compararlas a ojo.
    const torcida = escribirXlsx({
      nombre: "Catálogo",
      filas: [["MARCA", "NOMBRE", "PRECIO", "CATEGORÍA", "TIPO", "PRECIO COMPRA", "STOCK"]],
    });
    const { problemas } = leerPlantilla(torcida);
    expect(problemas[0].columna).toBe("C");
    expect(problemas[0].problema).toMatch(/debería decir "TIPO"/);
  });

  it("perdona la ortografía del encabezado pero no el orden", async () => {
    // El cliente escribió "CATEGORIA" sin tilde. Negarse por una tilde es el
    // tipo de rigidez que termina en una llamada telefónica.
    const sinTilde = escribirXlsx({
      nombre: "Catálogo",
      filas: [
        ["MARCA", "NOMBRE", "TIPO", "CATEGORIA", "PRECIO VENTA", "PRECIO COMPRA", "STOCK"],
        ["NIVEL TRES", "CERA", "PRODUCTO", "Barbería", "45", "", "2"],
      ],
    });
    expect(leerPlantilla(sinTilde).problemas).toEqual([]);
  });

  it("acepta la planilla sin la columna STOCK MÍNIMO, que se agregó después", async () => {
    // Es la que el cliente ya tiene llena. Rechazarla por una columna que
    // agregamos nosotros sería cobrarle a él nuestro cambio.
    const sieteColumnas = escribirXlsx({
      nombre: "Catálogo",
      filas: [[...COLUMNAS].slice(0, 7), ["NIVEL TRES", "CERA", "PRODUCTO", "Barbería", "45", "28", "2"]],
    });
    const { filas, problemas } = leerPlantilla(sieteColumnas);
    expect(problemas).toEqual([]);
    expect(filas[0]).toMatchObject({ marca: "NIVEL TRES", stock: 2, stockMinimo: null });
  });

  it("rechaza un archivo que no es la plantilla", async () => {
    const otro = escribirXlsx({ nombre: "H", filas: [["Fecha", "Importe"], ["hoy", "10"]] });
    expect(leerPlantilla(otro).problemas).toHaveLength(1);
  });
});

describe("un catálogo de verdad, como el que mandó el cliente", () => {
  const archivo = () => readFileSync(new URL("./fijos/catalogo-de-ejemplo.xlsx", import.meta.url));

  it("entra completo y sin un solo problema", async () => {
    const { filas, problemas } = leerPlantilla(archivo());
    expect(problemas).toEqual([]);
    expect(filas).toHaveLength(137);
  });

  it("reconoce sus tres categorías y sus servicios con ILIMITADO", async () => {
    const { filas } = leerPlantilla(archivo());

    expect([...new Set(filas.map((f) => f.categoria))].sort()).toEqual(["Barbería", "Tatuajes", "Vapes"]);

    const servicios = filas.filter((f) => f.tipo === "SERVICIO");
    expect(servicios).toHaveLength(8);
    // Ninguno queda con stock: siete decían ILIMITADO y el del tatuaje, vacío.
    expect(servicios.every((f) => f.stock === null)).toBe(true);
  });

  it("deja 119 filas sin precio y no las descarta", async () => {
    // El dato que decidió el diseño entero: la mayoría del catálogo llegó sin
    // precio, y aun así tiene que poder cargarse para empezar a usar el POS.
    const { filas } = leerPlantilla(archivo());
    expect(filas.filter((f) => f.precio === null)).toHaveLength(119);
    expect(filas.filter((f) => f.precio !== null)).toHaveLength(18);
  });

  it("unifica «NIVEL TRES » con espacio al final en una sola marca", async () => {
    const { filas } = leerPlantilla(archivo());
    const level3 = filas.filter((f) => f.marca === "NIVEL TRES");
    expect(level3).toHaveLength(6);
    expect(filas.some((f) => f.marca.endsWith(" "))).toBe(false);
  });

  it("se carga en el sistema y queda un catálogo usable", async () => {
    const pos = await posVacio();
    const { filas } = leerPlantilla(archivo());

    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, filas, "reemplazar"));

    expect(pos.p.items.size).toBe(137);
    expect(pos.p.sinPrecio()).toHaveLength(119);
    // 35 marcas y no 39: cuatro venían escritas con un espacio al final, y
    // sin unificarlas serían marcas aparte.
    expect(pos.p.marcas()).toHaveLength(35);
    expect(pos.p.marcas().some((m) => m.marca !== m.marca.trim())).toBe(false);

    // El TALCO de cada marca sobrevive como dos productos distintos.
    const talcos = [...pos.p.items.values()].filter((i) => i.nombre === "TALCO");
    expect(talcos.map((t) => t.marca).sort()).toEqual(["DON NISH", "SIRMAN"]);

    await pos.cerrar();
  });

  it("cargarlo dos veces no duplica ni un ítem", async () => {
    // La prueba que más importa de todas: el cliente va a subir su planilla
    // corregida muchas veces, y cada vez tiene que actualizar, no acumular.
    const pos = await posVacio();
    const { filas } = leerPlantilla(archivo());

    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, filas, "reemplazar"));
    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, filas, "reemplazar"));

    expect(pos.p.items.size).toBe(137);
    expect([...pos.p.items.values()].every((i) => i.activo)).toBe(true);
    await pos.cerrar();
  });
});

describe("importar", () => {
  it("crea los ítems y les pone el stock inicial", async () => {
    const pos = await posVacio();
    const filas = filasDe(
      planilla([
        ["", "CORTE", "SERVICIO", "Barbería", "20", "", "", ""],
        ["NIVEL TRES", "CERA", "PRODUCTO", "Barbería", "25", "", "12", "3"],
      ]),
    );

    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, filas, "agregar"));

    expect(pos.p.items.size).toBe(2);
    const cera = pos.p.itemPorCodigo("P0001")!;
    expect(cera.nombre).toBe("CERA");
    expect(cera.marca).toBe("NIVEL TRES");
    expect(pos.p.stockDe(SEDE_PRINCIPAL, cera.id)).toBe(12);
    await pos.cerrar();
  });

  it("subir dos veces la misma planilla no duplica nada", async () => {
    const pos = await posVacio();
    const filas = filasDe(planilla([["", "CORTE", "SERVICIO", "Barbería", "20", "", "", ""]]));

    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, filas, "agregar"));
    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, filas, "agregar"));

    expect(pos.p.items.size).toBe(1);
    await pos.cerrar();
  });

  it("distingue dos productos con el mismo nombre y marcas distintas", async () => {
    const pos = await posVacio();
    const filas = filasDe(
      planilla([
        ["DON NISH", "TALCO", "PRODUCTO", "Barbería", "15", "", "1", ""],
        ["SIRMAN", "TALCO", "PRODUCTO", "Barbería", "12", "", "2", ""],
      ]),
    );

    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, filas, "agregar"));
    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, filas, "agregar"));

    // Sin la marca en la clave de identidad, la segunda fila pisaría a la
    // primera y uno de los dos talcos desaparecería del catálogo.
    expect(pos.p.items.size).toBe(2);
    await pos.cerrar();
  });

  it("le completa la marca a un ítem que se había cargado sin ella", async () => {
    const pos = await posVacio();
    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["", "CERA", "PRODUCTO", "B", "25", "", "2", ""]])), "agregar"),
    );

    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["FORAJIDO", "CERA", "PRODUCTO", "B", "25", "", "2", ""]])), "agregar"),
    );

    expect(pos.p.items.size).toBe(1);
    expect(pos.p.itemPorCodigo("P0001")!.marca).toBe("FORAJIDO");
    await pos.cerrar();
  });

  it("ajusta el stock en vez de sumarlo", async () => {
    // La columna dice cuántas unidades HAY, no cuántas entraron. Sumarlas
    // duplicaría el inventario en cada reimportación.
    const pos = await posVacio();
    const fila = planilla([["", "CERA", "PRODUCTO", "P", "25", "", "10", ""]]);
    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(fila), "agregar"));
    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(fila), "agregar"));

    expect(pos.p.stockDe(SEDE_PRINCIPAL, pos.p.itemPorCodigo("P0001")!.id)).toBe(10);
    await pos.cerrar();
  });

  it("el cambio de precio queda registrado con el anterior al lado", async () => {
    const pos = await posVacio();
    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["", "CORTE", "SERVICIO", "B", "20", "", "", ""]])), "agregar"),
    );
    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["", "CORTE", "SERVICIO", "B", "25", "", "", ""]])), "agregar"),
    );

    const tipos: string[] = [];
    for await (const e of pos.almacen.leer()) tipos.push(e.tipo);
    // Es lo que hace auditable quién cambió cuánto.
    expect(tipos).toContain("item.precio_cambiado");
    expect(pos.p.itemPorCodigo("S0001")!.precio).toBe(2500);
    await pos.cerrar();
  });

  it("ponerle precio a un ítem que no tenía también queda en la historia", async () => {
    const pos = await posVacio();
    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["FORAJIDO", "CERA", "PRODUCTO", "B", "", "", "2", ""]])), "agregar"),
    );
    expect(pos.p.itemPorCodigo("P0001")!.precio).toBeNull();

    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["FORAJIDO", "CERA", "PRODUCTO", "B", "35", "", "2", ""]])), "agregar"),
    );

    const cambios: unknown[] = [];
    for await (const e of pos.almacen.leer()) {
      if (e.tipo === "item.precio_cambiado") cambios.push(e.datos);
    }
    expect(cambios).toEqual([
      expect.objectContaining({ precioAnterior: null, precioNuevo: 3500 }),
    ]);
    await pos.cerrar();
  });

  it("un PRECIO VENTA vacío NO le borra el precio a un ítem que ya lo tenía", async () => {
    // El escenario que va a pasar de verdad, y que rompía: el cliente carga su
    // planilla con 119 productos sin precio, los completa desde la pantalla de
    // Catálogo, y meses después vuelve a subir LA MISMA planilla —con esas
    // celdas todavía vacías— para agregar productos nuevos. Si la celda vacía
    // borrara el precio, esa carga destruiría en silencio todo ese trabajo.
    const pos = await posVacio();
    const sinPrecio = planilla([["FORAJIDO", "PASTA ROJA", "PRODUCTO", "Barbería", "", "", "2", ""]]);

    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(sinPrecio), "agregar"));
    const id = pos.p.itemPorCodigo("P0001")!.id;
    expect(pos.p.items.get(id)!.precio).toBeNull();

    // Se le pone precio desde la UI.
    await pos.escribir(() => actualizarItem(pos.p, id, { precio: 3500 }));
    expect(pos.p.items.get(id)!.precio).toBe(3500);

    // Y se vuelve a subir la misma planilla, con la celda todavía vacía.
    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(sinPrecio), "reemplazar"));

    expect(pos.p.items.get(id)!.precio).toBe(3500);
    expect(pos.p.sinPrecio()).toHaveLength(0);
    await pos.cerrar();
  });

  it("el plan no anuncia un cambio de precio que no va a hacer", async () => {
    const pos = await posVacio();
    const sinPrecio = planilla([["FORAJIDO", "PASTA ROJA", "PRODUCTO", "Barbería", "", "", "2", ""]]);
    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(sinPrecio), "agregar"));
    const id = pos.p.itemPorCodigo("P0001")!.id;
    await pos.escribir(() => actualizarItem(pos.p, id, { precio: 3500 }));

    const plan = planificarImportacion(pos.p, SEDE_PRINCIPAL, filasDe(sinPrecio), "agregar");

    expect(plan.cambios[0].accion).toBe("sin cambios");
    expect(plan.cambios[0].detalle).toEqual([]);
    // Y el contador cuenta los que van a QUEDAR sin precio, no las celdas vacías.
    expect(plan.resumen.sinPrecio).toBe(0);
    await pos.cerrar();
  });

  it("un PRECIO COMPRA vacío no le borra el costo a un producto ya cargado", async () => {
    // "No lo sé" no es "vale cero". Borrarlo destruiría el margen histórico de
    // un producto que sí estaba bien cargado.
    const pos = await posVacio();
    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["NIVEL TRES", "CERA", "PRODUCTO", "B", "45", "28", "2", ""]])), "agregar"),
    );
    expect(pos.p.itemPorCodigo("P0001")!.costo).toBe(2800);

    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["NIVEL TRES", "CERA", "PRODUCTO", "B", "45", "", "2", ""]])), "agregar"),
    );
    expect(pos.p.itemPorCodigo("P0001")!.costo).toBe(2800);
    await pos.cerrar();
  });

  it("«agregar» NO toca lo que no viene en el archivo", async () => {
    const pos = await posVacio();
    await pos.transaccion(() => {
      const r = crearItem(pos.p, { codigo: "VIEJO", nombre: "VIEJO", tipo: "SERVICIO", categoria: "B", precio: 1000 });
      return { eventos: r.eventos, resultado: null };
    });

    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["", "NUEVO", "SERVICIO", "B", "20", "", "", ""]])), "agregar"),
    );

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

    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["", "NUEVO", "SERVICIO", "B", "20", "", "", ""]])), "reemplazar"),
    );

    // Desactivado, no eliminado: un ticket viejo tiene que poder seguir
    // mostrando qué se vendió.
    expect(pos.p.items.get(idViejo)?.activo).toBe(false);
    expect(pos.p.items.has(idViejo)).toBe(true);
    await pos.cerrar();
  });

  it("volver a cargar un ítem dado de baja lo reactiva con su mismo id", async () => {
    const pos = await posVacio();
    const p1 = filasDe(planilla([["", "CORTE", "SERVICIO", "B", "20", "", "", ""]]));
    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, p1, "agregar"));
    const id = pos.p.itemPorCodigo("S0001")!.id;

    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["", "OTRO", "SERVICIO", "B", "20", "", "", ""]])), "reemplazar"),
    );
    expect(pos.p.items.get(id)!.activo).toBe(false);

    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, p1, "agregar"));
    expect(pos.p.items.get(id)!.activo).toBe(true);
    await pos.cerrar();
  });
});

describe("costo promedio ponderado", () => {
  it("el PRECIO COMPRA de la planilla siembra el costo del producto", async () => {
    const pos = await posVacio();
    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["NIVEL TRES", "CERA", "PRODUCTO", "B", "45", "28", "6", ""]])), "agregar"),
    );

    expect(pos.p.itemPorCodigo("P0001")!.costo).toBe(2800);
    await pos.cerrar();
  });

  it("una compra a otro precio pondera contra lo que había", async () => {
    // Había 6 a 28 y entran 4 a 34 → (6×28 + 4×34) / 10 = 30.40.
    const pos = await posVacio();
    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["NIVEL TRES", "CERA", "PRODUCTO", "B", "45", "28", "6", ""]])), "agregar"),
    );
    const id = pos.p.itemPorCodigo("P0001")!.id;

    await pos.escribir(() => [
      { tipo: "stock.entrada", datos: { itemId: id, cantidad: 4, costoUnitario: 3400, motivo: "Compra" } },
    ]);

    expect(pos.p.itemPorCodigo("P0001")!.costo).toBe(3040);
    expect(pos.p.stockDe(SEDE_PRINCIPAL, id)).toBe(10);
    await pos.cerrar();
  });

  it("una entrada sin costo declarado no mueve el promedio", async () => {
    // Suponerle costo cero a la mercadería que entró sin factura a mano
    // abarataría el promedio y el reporte mostraría una ganancia que no existe.
    const pos = await posVacio();
    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["NIVEL TRES", "CERA", "PRODUCTO", "B", "45", "28", "6", ""]])), "agregar"),
    );
    const id = pos.p.itemPorCodigo("P0001")!.id;

    await pos.escribir(() => [
      { tipo: "stock.entrada", datos: { itemId: id, cantidad: 4, motivo: "Compra sin factura" } },
    ]);

    expect(pos.p.itemPorCodigo("P0001")!.costo).toBe(2800);
    await pos.cerrar();
  });

  it("contar el inventario no cambia el costo", async () => {
    // Un ajuste dice cuántas hay, no a cuánto se compraron.
    const pos = await posVacio();
    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["NIVEL TRES", "CERA", "PRODUCTO", "B", "45", "28", "6", ""]])), "agregar"),
    );
    const id = pos.p.itemPorCodigo("P0001")!.id;

    await pos.escribir(() => [
      { tipo: "stock.ajustado", datos: { itemId: id, cantidadContada: 3, cantidadSistema: 6, motivo: "Conteo" } },
    ]);

    expect(pos.p.itemPorCodigo("P0001")!.costo).toBe(2800);
    await pos.cerrar();
  });

  it("con el stock en cero, el costo que entra reemplaza al viejo", async () => {
    // No hay unidades con las que ponderar: lo que acaba de entrar es el único
    // dato real. Ponderar contra cero o contra un negativo daría un absurdo.
    const pos = await posVacio();
    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["NIVEL TRES", "CERA", "PRODUCTO", "B", "45", "28", "0", ""]])), "agregar"),
    );
    const id = pos.p.itemPorCodigo("P0001")!.id;

    await pos.escribir(() => [
      { tipo: "stock.entrada", datos: { itemId: id, cantidad: 5, costoUnitario: 3400, motivo: "Compra" } },
    ]);

    expect(pos.p.itemPorCodigo("P0001")!.costo).toBe(3400);
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

    const filas = filasDe(planilla([["", "NUEVO", "SERVICIO", "B", "20", "", "", ""]]));
    const plan = planificarImportacion(pos.p, SEDE_PRINCIPAL, filas, "reemplazar");

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

    const filas = filasDe(planilla([["", "NUEVO", "SERVICIO", "B", "20", "", "", ""]]));
    expect(planificarImportacion(pos.p, SEDE_PRINCIPAL, filas, "agregar").aDesactivar).toHaveLength(0);
    await pos.cerrar();
  });

  it("explica qué cambia en cada ítem, no solo que cambia", async () => {
    const pos = await posVacio();
    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["", "CORTE", "SERVICIO", "B", "20", "", "", ""]])), "agregar"),
    );

    const filas = filasDe(planilla([["", "CORTE", "SERVICIO", "B", "25", "", "", ""]]));
    const plan = planificarImportacion(pos.p, SEDE_PRINCIPAL, filas, "agregar");

    expect(plan.cambios[0].accion).toBe("actualizar");
    expect(plan.cambios[0].detalle.join(" ")).toMatch(/precio: S\/ 20\.00 → S\/ 25\.00/);
    await pos.cerrar();
  });

  it("cuenta cuántas filas entran sin precio antes de autorizar la carga", async () => {
    // Es lo primero que hay que decirle a quien autoriza: esos ítems van a
    // existir pero no se van a poder vender de la grilla.
    const pos = await posVacio();
    const filas = filasDe(
      planilla([
        ["", "CORTE", "SERVICIO", "B", "20", "", "", ""],
        ["FORAJIDO", "PASTA ROJA", "PRODUCTO", "B", "", "", "2", ""],
        ["FORAJIDO", "CERA AZUL", "PRODUCTO", "B", "", "", "2", ""],
      ]),
    );

    expect(planificarImportacion(pos.p, SEDE_PRINCIPAL, filas, "agregar").resumen).toMatchObject({ crear: 3, sinPrecio: 2 });
    await pos.cerrar();
  });

  it("avisa cuántas filas no traen categoría, antes de inventarles una", async () => {
    // La categoría define las pestañas de la pantalla de cobro. En el catálogo
    // real fueron 22 productos de una misma línea —pipas, papeles, mallas— que
    // habrían terminado juntos en una pestaña "Productos" que nadie pidió, sin
    // que nadie se enterara hasta ir a cobrar.
    const pos = await posVacio();
    const filas = filasDe(
      planilla([
        ["FORAJIDO", "PASTA ROJA", "PRODUCTO", "Barbería", "35", "", "2", ""],
        ["", "PIPA DE VIDRIO", "PRODUCTO", "", "", "", "3", ""],
        ["", "PAPELES", "PRODUCTO", "", "", "", "9", ""],
      ]),
    );

    expect(planificarImportacion(pos.p, SEDE_PRINCIPAL, filas, "agregar").resumen).toMatchObject({ crear: 3, sinCategoria: 2 });

    // Y al aplicar, caen en una categoría de verdad: una pestaña sin nombre
    // sería peor que una genérica.
    await pos.escribir(() => importarCatalogo(pos.p, SEDE_PRINCIPAL, filas, "agregar"));
    const categorias = [...pos.p.items.values()].map((i) => i.categoria).sort();
    expect(categorias).toEqual(["Barbería", "Productos", "Productos"]);
    await pos.cerrar();
  });

  it("muestra el cambio de marca y de costo en el detalle", async () => {
    const pos = await posVacio();
    await pos.escribir(() =>
      importarCatalogo(pos.p, SEDE_PRINCIPAL, filasDe(planilla([["NIVEL TRES", "CERA", "PRODUCTO", "B", "45", "28", "2", ""]])), "agregar"),
    );

    const filas = filasDe(planilla([["FORAJIDO", "CERA", "PRODUCTO", "B", "45", "30", "2", ""]]));
    const plan = planificarImportacion(pos.p, SEDE_PRINCIPAL, filas, "agregar");
    const detalle = plan.cambios[0].detalle.join(" ");

    // Cambió la marca, así que para el sistema es un producto NUEVO: la marca
    // es parte de la identidad. Eso también hay que poder verlo antes.
    expect(plan.cambios[0].accion).toBe("crear");
    expect(detalle).toMatch(/SIN PRECIO|S\/ 45\.00/);
    await pos.cerrar();
  });
});
