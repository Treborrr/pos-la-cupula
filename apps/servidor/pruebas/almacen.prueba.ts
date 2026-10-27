/**
 * Pruebas del almacén de eventos.
 *
 * Esta es la capa que no puede fallar: si pierde una venta, todo lo que está
 * construido encima miente. Las pruebas están escritas contra los modos de
 * falla REALES de la PC de una barbería —corte de luz a mitad de
 * escritura, dos instancias abiertas, alguien editando el archivo con el Bloc
 * de notas— y no contra el camino feliz.
 */

import { describe, expect, it, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import { hostname } from "node:os";
import { ulid } from "ulid";

import { AlmacenArchivoJsonl } from "../src/adaptadores/almacen/ArchivoJsonl";
import { HASH_GENESIS, hashDelEvento, canonico } from "../src/adaptadores/almacen/canonico";
import { abrirAlmacen, borrar, carpetaTemporal, itemNuevo, relojFijo, rutaMes } from "./ayuda";

const aBorrar: string[] = [];
afterEach(async () => {
  await Promise.all(aBorrar.splice(0).map(borrar));
});

async function nuevaCarpeta(): Promise<string> {
  const d = await carpetaTemporal();
  aBorrar.push(d);
  return d;
}

async function todos(almacen: AlmacenArchivoJsonl) {
  const salida = [];
  for await (const e of almacen.leer()) salida.push(e);
  return salida;
}

describe("escritura y lectura", () => {
  it("devuelve los eventos sellados y los relee en el mismo orden", async () => {
    const dir = await nuevaCarpeta();
    const almacen = await abrirAlmacen(dir);

    const escritos = await almacen.agregar([
      itemNuevo("COR", "CORTE CLASICO", 2000),
      itemNuevo("COR-D", "CORTE DEGRADADO", 2500),
    ]);

    expect(escritos).toHaveLength(2);
    expect(escritos[0].seq).toBe(1);
    expect(escritos[1].seq).toBe(2);
    expect(escritos[0].id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(escritos[0].ts).toMatch(/[+-]\d{2}:\d{2}$/); // offset explícito, nunca UTC implícito

    const leidos = await todos(almacen);
    expect(leidos.map((e) => e.seq)).toEqual([1, 2]);
    await almacen.cerrar();
  });

  it("sobrevive a reiniciar el proceso y continúa la secuencia", async () => {
    const dir = await nuevaCarpeta();

    const primero = await abrirAlmacen(dir);
    await primero.agregar([itemNuevo("COR"), itemNuevo("BAR", "BARBA", 1000)]);
    await primero.cerrar();

    const segundo = await abrirAlmacen(dir);
    expect(segundo.ultimaSeq()).toBe(2);

    const [tercero] = await segundo.agregar([itemNuevo("CEJ", "CEJAS", 500)]);
    expect(tercero.seq).toBe(3);
    expect(await todos(segundo)).toHaveLength(3);
    await segundo.cerrar();
  });

  it("normaliza el código a mayúsculas: 'cor d' y 'COR D' no son dos cosas distintas", async () => {
    // En el Excel convivían las dos formas en el registro de ventas.
    const dir = await nuevaCarpeta();
    const almacen = await abrirAlmacen(dir);
    const [e] = await almacen.agregar([itemNuevo("cor-d", "CORTE DEGRADADO", 2500)]);
    expect((e.datos as any).codigo).toBe("COR-D");
    await almacen.cerrar();
  });
});

describe("validación antes de escribir", () => {
  it("rechaza un evento inválido sin escribir nada ni consumir seq", async () => {
    const dir = await nuevaCarpeta();
    const almacen = await abrirAlmacen(dir);
    await almacen.agregar([itemNuevo("COR")]);

    await expect(
      almacen.agregar([
        { tipo: "item.creado", datos: { itemId: ulid(), codigo: "X", nombre: "", tipo: "SERVICIO", categoria: "c", precio: 100 } as any },
      ]),
    ).rejects.toThrow(/inválido/);

    // Ni hueco en la secuencia ni línea a medias en el archivo.
    expect(almacen.ultimaSeq()).toBe(1);
    expect(await todos(almacen)).toHaveLength(1);
    expect((await almacen.verificar()).ok).toBe(true);
    await almacen.cerrar();
  });

  it("rechaza montos con decimales: el dinero va en céntimos enteros", async () => {
    const dir = await nuevaCarpeta();
    const almacen = await abrirAlmacen(dir);
    await expect(almacen.agregar([itemNuevo("COR", "CORTE", 25.5)])).rejects.toThrow(/céntimos/);
    await almacen.cerrar();
  });

  it("todo el lote se descarta si un solo evento del lote es inválido", async () => {
    // Importa para las ventas: registrar la venta y descontar el stock son
    // varios eventos que tienen que quedar todos o ninguno.
    const dir = await nuevaCarpeta();
    const almacen = await abrirAlmacen(dir);

    await expect(
      almacen.agregar([itemNuevo("BUENO"), itemNuevo("MALO", "X", -1)]),
    ).rejects.toThrow();

    expect(await todos(almacen)).toHaveLength(0);
    await almacen.cerrar();
  });
});

describe("cadena de hash", () => {
  it("encadena cada evento con el anterior desde el génesis", async () => {
    const dir = await nuevaCarpeta();
    const almacen = await abrirAlmacen(dir);
    const escritos = await almacen.agregar([itemNuevo("A"), itemNuevo("B"), itemNuevo("C")]);

    let previo = HASH_GENESIS;
    for (const e of escritos) {
      const { h, ...sinHash } = e;
      expect(h).toBe(hashDelEvento(previo, sinHash));
      previo = h;
    }
    await almacen.cerrar();
  });

  it("detecta que alguien editó una línea con el Bloc de notas", async () => {
    const dir = await nuevaCarpeta();
    const reloj = relojFijo("2026-09-16T10:00:00.000-05:00");
    const almacen = await abrirAlmacen(dir, { reloj });
    await almacen.agregar([itemNuevo("COR", "CORTE", 2000), itemNuevo("BAR", "BARBA", 1000)]);
    await almacen.cerrar();

    expect((await (await abrirAlmacen(dir)).verificar()).ok).toBe(true);

    // El dueño "arregla" a mano el precio de la primera venta.
    const ruta = rutaMes(dir, "2026-09");
    const lineas = (await fs.readFile(ruta, "utf8")).trim().split("\n");
    const manoseada = JSON.parse(lineas[0]);
    manoseada.datos.precio = 100;
    lineas[0] = canonico(manoseada);
    await fs.writeFile(ruta, lineas.join("\n") + "\n", "utf8");

    const revisado = await abrirAlmacen(dir);
    const integridad = await revisado.verificar();
    expect(integridad.ok).toBe(false);
    expect(integridad.hashRotos).toContain(1);
    await revisado.cerrar();
  });
});

describe("corte de luz", () => {
  it("aparta la línea cortada a la mitad y conserva todo lo anterior", async () => {
    const dir = await nuevaCarpeta();
    const reloj = relojFijo("2026-09-16T10:00:00.000-05:00");

    const almacen = await abrirAlmacen(dir, { reloj });
    await almacen.agregar([itemNuevo("COR"), itemNuevo("BAR", "BARBA", 1000)]);
    await almacen.cerrar();

    // Se corta la luz justo mientras se escribía el tercer evento: en el
    // archivo queda medio JSON, sin salto de línea final.
    const ruta = rutaMes(dir, "2026-09");
    await fs.appendFile(ruta, '{"seq":3,"id":"01K5B7M3QW8ZX2VDNPQR4T","ts":"2026-09-16T10:0', "utf8");

    const recuperado = await abrirAlmacen(dir, { reloj });

    expect(recuperado.apertura.lineasEnCuarentena).toBe(1);
    expect(recuperado.ultimaSeq()).toBe(2);
    expect(await todos(recuperado)).toHaveLength(2);

    // La basura quedó guardada, no se perdió: si algún día hay que auditar qué
    // se estaba escribiendo, está ahí.
    const cuarentena = await fs.readdir(`${dir}/cuarentena`);
    expect(cuarentena).toHaveLength(1);

    // Y se puede seguir vendiendo inmediatamente después.
    const [siguiente] = await recuperado.agregar([itemNuevo("CEJ", "CEJAS", 500)]);
    expect(siguiente.seq).toBe(3);
    expect((await recuperado.verificar()).huecos).toEqual([]);
    await recuperado.cerrar();
  });

  it("conserva la última línea si solo faltó el salto de línea", async () => {
    // El corte cayó entre el write del contenido y el del "\n". La línea es
    // buena: tirarla sería perder una venta que sí ocurrió.
    const dir = await nuevaCarpeta();
    const reloj = relojFijo("2026-09-16T10:00:00.000-05:00");

    const almacen = await abrirAlmacen(dir, { reloj });
    const [uno, dos] = await almacen.agregar([itemNuevo("COR"), itemNuevo("BAR", "BARBA", 1000)]);
    await almacen.cerrar();

    const ruta = rutaMes(dir, "2026-09");
    const contenido = await fs.readFile(ruta, "utf8");
    await fs.writeFile(ruta, contenido.trimEnd(), "utf8"); // le quitamos el "\n" final

    const recuperado = await abrirAlmacen(dir, { reloj });
    expect(recuperado.apertura.lineasEnCuarentena).toBe(0);
    expect(recuperado.ultimaSeq()).toBe(dos.seq);
    expect(await todos(recuperado)).toHaveLength(2);
    expect((await recuperado.verificar()).ok).toBe(true);
    await recuperado.cerrar();
  });

  /**
   * El tiempo límite va subido a mano porque esta prueba escribe 2000 eventos
   * de verdad a disco, en 400 lotes con su fsync cada uno. Tarda ~2 s sola,
   * pero corriendo en paralelo con el resto de la suite pasaba de los 5 s por
   * defecto y fallaba por tiempo, no por haber perdido un evento. Lo que se
   * verifica acá es la integridad, no la velocidad.
   */
  it("no pierde ninguno de 2000 eventos escritos de a lotes", { timeout: 20_000 }, async () => {
    const dir = await nuevaCarpeta();
    const almacen = await abrirAlmacen(dir);

    for (let i = 0; i < 400; i++) {
      await almacen.agregar([
        itemNuevo(`A${i}`, `ITEM A${i}`, 1000 + i),
        itemNuevo(`B${i}`, `ITEM B${i}`, 2000 + i),
        itemNuevo(`C${i}`, `ITEM C${i}`, 3000 + i),
        itemNuevo(`D${i}`, `ITEM D${i}`, 4000 + i),
        itemNuevo(`E${i}`, `ITEM E${i}`, 5000 + i),
      ]);
    }
    await almacen.cerrar();

    const releido = await abrirAlmacen(dir);
    const integridad = await releido.verificar();
    expect(integridad.eventos).toBe(2000);
    expect(integridad.ultimaSeq).toBe(2000);
    expect(integridad.ok).toBe(true);
    await releido.cerrar();
  });
});

describe("un solo escritor", () => {
  it("impide abrir dos almacenes sobre la misma carpeta", async () => {
    const dir = await nuevaCarpeta();
    const primero = await AlmacenArchivoJsonl.abrir({ directorio: dir });

    await expect(AlmacenArchivoJsonl.abrir({ directorio: dir })).rejects.toThrow(
      /Ya hay un POS corriendo/,
    );

    await primero.cerrar();
    // Liberado el bloqueo, se puede volver a abrir con normalidad.
    const segundo = await AlmacenArchivoJsonl.abrir({ directorio: dir });
    await segundo.cerrar();
  });

  it("arranca solo si el bloqueo quedó huérfano por un apagón", async () => {
    const dir = await nuevaCarpeta();
    await fs.mkdir(`${dir}/eventos`, { recursive: true });
    // PID de un proceso que no existe: así queda el bloqueo tras un corte.
    await fs.writeFile(
      `${dir}/.bloqueo`,
      JSON.stringify({ pid: 999_999, host: hostname(), inicio: "ayer" }),
      "utf8",
    );

    const almacen = await AlmacenArchivoJsonl.abrir({ directorio: dir });
    expect(almacen.ultimaSeq()).toBe(0);
    await almacen.cerrar();
  });

  it("serializa las escrituras concurrentes sin repetir ni saltear seq", async () => {
    // Es el escenario del doble clic y del reintento: varias escrituras
    // disparadas sin esperar a la anterior.
    const dir = await nuevaCarpeta();
    const almacen = await abrirAlmacen(dir);

    const resultados = await Promise.all(
      Array.from({ length: 100 }, (_, i) => almacen.agregar([itemNuevo(`I${i}`, `ITEM ${i}`, 100)])),
    );

    const seqs = resultados.flat().map((e) => e.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(new Set(seqs).size).toBe(100);
    expect((await almacen.verificar()).ok).toBe(true);
    await almacen.cerrar();
  });
});

describe("archivos por mes", () => {
  it("abre un archivo nuevo al cambiar de mes y los lee en orden", async () => {
    const dir = await nuevaCarpeta();
    const reloj = relojFijo("2026-09-30T23:50:00.000-05:00");
    const almacen = await abrirAlmacen(dir, { reloj });

    await almacen.agregar([itemNuevo("SEP", "DE SEPTIEMBRE", 100)]);
    reloj.fijar("2026-10-01T00:10:00.000-05:00");
    await almacen.agregar([itemNuevo("OCT", "DE OCTUBRE", 200)]);

    const archivos = (await fs.readdir(`${dir}/eventos`)).sort();
    expect(archivos).toEqual(["2026-09.jsonl", "2026-10.jsonl"]);

    const leidos = await todos(almacen);
    expect(leidos.map((e) => (e.datos as any).codigo)).toEqual(["SEP", "OCT"]);
    await almacen.cerrar();
  });

  it("no retrocede de archivo si el reloj de la PC está mal puesto", async () => {
    // Si el reloj salta hacia atrás, escribir en el archivo del mes anterior
    // dejaría seq fuera de orden respecto al orden de los archivos.
    const dir = await nuevaCarpeta();
    const reloj = relojFijo("2026-10-01T10:00:00.000-05:00");
    const almacen = await abrirAlmacen(dir, { reloj });

    await almacen.agregar([itemNuevo("OCT", "DE OCTUBRE", 100)]);
    reloj.fijar("2026-09-15T10:00:00.000-05:00"); // alguien tocó la hora
    await almacen.agregar([itemNuevo("RARO", "CON RELOJ MAL", 200)]);

    expect((await fs.readdir(`${dir}/eventos`)).sort()).toEqual(["2026-10.jsonl"]);
    expect((await almacen.verificar()).ok).toBe(true);
    await almacen.cerrar();
  });
});

describe("instantáneas", () => {
  it("guarda, recupera y conserva solo las tres últimas", async () => {
    const dir = await nuevaCarpeta();
    const almacen = await abrirAlmacen(dir);

    for (const seq of [10, 20, 30, 40]) {
      await almacen.guardarInstantanea(seq, { marcador: seq });
    }

    const guardadas = (await fs.readdir(`${dir}/instantaneas`)).filter((n) => n.endsWith(".json"));
    expect(guardadas).toHaveLength(3);

    const ultima = await almacen.cargarInstantanea();
    expect(ultima?.seq).toBe(40);
    expect((ultima?.estado as any).marcador).toBe(40);
    await almacen.cerrar();
  });

  it("cae a una instantánea anterior si la última quedó corrupta", async () => {
    const dir = await nuevaCarpeta();
    const almacen = await abrirAlmacen(dir);
    await almacen.guardarInstantanea(10, { marcador: 10 });
    await almacen.guardarInstantanea(20, { marcador: 20 });

    await fs.writeFile(`${dir}/instantaneas/000000020.json`, "{ esto no es json", "utf8");

    const recuperada = await almacen.cargarInstantanea();
    expect(recuperada?.seq).toBe(10);
    await almacen.cerrar();
  });
});

describe("reloj atrasado al arrancar", () => {
  it("no avisa nada en un log vacío", async () => {
    const dir = await nuevaCarpeta();
    const almacen = await abrirAlmacen(dir);
    expect(almacen.diagnosticoDeArranque().relojAtrasado).toBeNull();
    await almacen.cerrar();
  });

  it("no avisa nada si el reloj avanza normalmente entre arranques", async () => {
    const dir = await nuevaCarpeta();
    const reloj1 = relojFijo("2026-09-16T10:00:00.000-05:00");
    const almacen1 = await abrirAlmacen(dir, { reloj: reloj1 });
    await almacen1.agregar([itemNuevo()]);
    await almacen1.cerrar();

    const reloj2 = relojFijo("2026-09-16T10:05:00.000-05:00");
    const almacen2 = await abrirAlmacen(dir, { reloj: reloj2 });
    expect(almacen2.diagnosticoDeArranque().relojAtrasado).toBeNull();
    await almacen2.cerrar();
  });

  it("avisa si al reabrir el reloj dice una hora anterior al último evento", async () => {
    const dir = await nuevaCarpeta();
    const reloj1 = relojFijo("2026-09-16T10:00:00.000-05:00");
    const almacen1 = await abrirAlmacen(dir, { reloj: reloj1 });
    await almacen1.agregar([itemNuevo()]);
    await almacen1.cerrar();

    // La PC se reinició con la pila del reloj muerta y volvió a una fecha
    // de fábrica, bien ANTES del último evento que ya está en el log.
    const reloj2 = relojFijo("2020-01-01T00:00:00.000-05:00");
    const almacen2 = await abrirAlmacen(dir, { reloj: reloj2 });

    const aviso = almacen2.diagnosticoDeArranque().relojAtrasado;
    expect(aviso).not.toBeNull();
    expect(aviso!.ultimoEvento).toBe("2026-09-16T10:00:00.000-05:00");
    expect(aviso!.alAbrir).toBe("2020-01-01T00:00:00.000-05:00");
    await almacen2.cerrar();
  });
});
