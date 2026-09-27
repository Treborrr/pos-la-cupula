/**
 * Pruebas del renderizador ESC/POS.
 *
 * Toda la impresión se puede verificar SIN la impresora enchufada, que es
 * justamente la situación mientras esperamos el modelo. Los bytes que salen
 * aquí son exactamente los que va a recibir el equipo el día que se conecte.
 */

import { describe, expect, it } from "vitest";

import { aCp850, anchoImpreso, deCp850 } from "../src/adaptadores/impresora/cp850";
import { ConstructorEscPos } from "../src/adaptadores/impresora/escpos";
import { PERFIL_EPSON_80, PERFIL_GENERICO_58, PERFIL_GENERICO_80 } from "../src/adaptadores/impresora/perfil";
import {
  partir,
  renderTicketEscPos,
  renderTicketTexto,
} from "../src/adaptadores/impresora/renderTicket";
import { qrComoBitmap, centrar } from "../src/adaptadores/impresora/qrBitmap";
import { PLANTILLA_POR_DEFECTO, reemplazar } from "../src/adaptadores/impresora/plantilla";
import type { Venta } from "../src/proyecciones/tipos";
import type { DatosDelNegocio } from "../src/puertos/Impresora";

const NEGOCIO: DatosDelNegocio = {
  nombre: "LA CÚPULA TATTOO BARBER SHOP",
  direccion: "AV. SIEMPRE VIVA 742",
  ciudad: "Lima - Lima - Miraflores",
  ruc: "20100000001",
  pie: "¡GRACIAS POR TU VISITA!",
};

function ventaDePrueba(cambios: Partial<Venta> = {}): Venta {
  return {
    id: "01K5B7M3QW8ZX2VDNPQR4T6Y9A",
    correlativo: "NV000030",
    ts: "2026-09-16T19:42:11.204-05:00",
    lineas: [
      {
        itemId: "01K5A0000000000000000000A1",
        codigo: "COR-D",
        nombre: "CORTE DEGRADADO",
        tipo: "SERVICIO",
        cantidad: 2,
        precioUnitario: 2500,
        precioLista: 2500,
        barberoId: "01K59000000000000000000B2",
        total: 5000,
      },
    ],
    subtotal: 5000,
    descuento: 0,
    total: 5000,
    pagos: [{ medio: "EFECTIVO", monto: 5000, recibido: 10000, vuelto: 5000 }],
    clienteId: null,
    turnoId: null,
    anulada: false,
    reimpresiones: 0,
    ...cambios,
  };
}

/** Extrae solo el texto imprimible, descartando comandos e imágenes. */
function textoDe(bytes: Buffer): string {
  const salida: string[] = [];
  const crudo: number[] = [];
  let i = 0;

  const volcar = () => {
    if (crudo.length) salida.push(deCp850(Buffer.from(crudo.splice(0))));
  };

  while (i < bytes.length) {
    const b = bytes[i];

    if (b === 0x1b) {
      // ESC: los comandos que usamos son de 2 o 3 bytes.
      const siguiente = bytes[i + 1];
      i += siguiente === 0x40 ? 2 : 3;
      continue;
    }
    if (b === 0x1d) {
      const siguiente = bytes[i + 1];
      if (siguiente === 0x76) {
        // GS v 0: imagen. Hay que saltear la carga completa.
        const bytesPorFila = bytes[i + 4] | (bytes[i + 5] << 8);
        const alto = bytes[i + 6] | (bytes[i + 7] << 8);
        i += 8 + bytesPorFila * alto;
        volcar();
        salida.push("[IMAGEN]");
        continue;
      }
      if (siguiente === 0x28) {
        const largo = bytes[i + 3] | (bytes[i + 4] << 8);
        i += 5 + largo;
        volcar();
        salida.push("[QR]");
        continue;
      }
      i += 3;
      continue;
    }

    crudo.push(b);
    i++;
  }

  volcar();
  return salida.join("");
}

describe("codificación CP850", () => {
  it("convierte las tildes y la eñe a un solo byte cada una", () => {
    // Sin esto, "Peña" sale como "PeÃ±a" en el papel.
    expect(aCp850("ñ")).toEqual(Buffer.from([0xa4]));
    expect(aCp850("Ñ")).toEqual(Buffer.from([0xa5]));
    expect(aCp850("é")).toEqual(Buffer.from([0x82]));
    expect(aCp850("¡")).toEqual(Buffer.from([0xad]));
    expect(aCp850("José Peña")).toHaveLength(9);
  });

  it("degrada a ASCII lo que no existe en CP850 en vez de escupir basura", () => {
    // Un emoji en el nombre de un cliente no puede romper el ticket.
    expect(aCp850("Ok 🎉").toString("latin1")).toBe("Ok ??");
    expect(aCp850("50 €").toString("latin1")).toBe("50 ?");
  });

  it("normaliza las comillas curvas que se cuelan al copiar y pegar", () => {
    expect(aCp850("“hola”").toString("latin1")).toBe('"hola"');
  });

  it("cuenta el ancho impreso, no los code points", () => {
    // "José" puede venir con la tilde combinante (2 code points para la é),
    // pero en el papel ocupa 4 columnas igual. Contar mal desalinea los importes.
    expect(anchoImpreso("José")).toBe(4);
    expect(anchoImpreso("José")).toBe(4);
  });
});

describe("comandos ESC/POS", () => {
  it("arranca reiniciando la impresora y fijando la página de códigos", () => {
    // Si el ticket anterior se cortó a mitad de un comando, la impresora pudo
    // quedar en negrita o en tamaño doble. ESC @ lo limpia.
    const bytes = new ConstructorEscPos(PERFIL_GENERICO_80).iniciar().construir();
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
    expect(bytes.subarray(2, 5)).toEqual(Buffer.from([0x1b, 0x74, 2]));
  });

  it("alinea a la derecha respetando el ancho del perfil", () => {
    const b = new ConstructorEscPos(PERFIL_GENERICO_80);
    const texto = textoDe(b.dosColumnas("TOTAL", "S/ 75.00").construir());
    expect(texto.trimEnd()).toBe("TOTAL" + " ".repeat(42 - "TOTAL".length - "S/ 75.00".length) + "S/ 75.00");
    expect(texto.replace("\n", "")).toHaveLength(42);
  });

  it("parte en dos líneas si la etiqueta y el valor no entran juntos", () => {
    // Antes que desalinear la columna de importes, que es la que se lee.
    const b = new ConstructorEscPos(PERFIL_GENERICO_58);
    const lineas = textoDe(b.dosColumnas("UNA ETIQUETA MUY MUY LARGA QUE NO ENTRA", "999.00").construir())
      .trimEnd()
      .split("\n");
    expect(lineas).toHaveLength(2);
    expect(lineas[1]).toHaveLength(32);
  });

  it("no manda comando de corte si el perfil dice que no hay cortador", () => {
    const sinCorte = { ...PERFIL_GENERICO_80, corte: "ninguno" as const };
    const bytes = new ConstructorEscPos(sinCorte).cortar().construir();
    expect(bytes.includes(Buffer.from([0x1d, 0x56]))).toBe(false);
  });

  it("no manda pulso al cajón si no hay cajón configurado", () => {
    expect(new ConstructorEscPos(PERFIL_GENERICO_80).abrirCajon().construir()).toHaveLength(0);
    const conCajon = { ...PERFIL_GENERICO_80, cajonDeDinero: true };
    expect(new ConstructorEscPos(conCajon).abrirCajon().construir()).toHaveLength(5);
  });
});

describe("QR en bitmap", () => {
  it("genera una imagen cuadrada con zona tranquila incluida", async () => {
    const qr = await qrComoBitmap("CUP1|V|NV000030", 4, 2);
    // 21 módulos de contenido + 2 de margen a cada lado, por 4 puntos cada uno.
    expect(qr.ancho).toBe((21 + 4) * 4);
    expect(qr.alto).toBe(qr.ancho);
    expect(qr.datos).toHaveLength(Math.ceil(qr.ancho / 8) * qr.alto);
  });

  it("tiene el patrón de posición: la esquina superior izquierda es negra", async () => {
    // Los tres cuadrados de las esquinas son lo que busca el lector. Si el
    // empaquetado de bits estuviera invertido, esto fallaría.
    const qr = await qrComoBitmap("HOLA", 4, 2);
    const bytesPorFila = Math.ceil(qr.ancho / 8);
    const primeraFilaDelPatron = 2 * 4; // salteando el margen
    expect(qr.datos[primeraFilaDelPatron * bytesPorFila + 1]).not.toBe(0);
  });

  it("centrar no pierde datos ni deja el ancho mal", async () => {
    const qr = await qrComoBitmap("CUP1|V|NV000030", 4, 2);
    const centrado = centrar(qr, 576);
    expect(centrado.ancho).toBe(576);
    expect(centrado.alto).toBe(qr.alto);
    // La cantidad de bits en negro no cambia: solo se movieron de lugar.
    expect(contarBits(centrado.datos)).toBe(contarBits(qr.datos));
  });
});

describe("plantilla", () => {
  it("reemplaza los marcadores conocidos", () => {
    expect(reemplazar("RUC {negocio.ruc}", { "negocio.ruc": "20100000001" })).toBe("RUC 20100000001");
  });

  it("deja a la vista un marcador que no existe", () => {
    // Que se note en el primer ticket de prueba, no un hueco silencioso.
    expect(reemplazar("Tel: {negocio.telefono}", {})).toBe("Tel: {negocio.telefono}");
  });
});

describe("partir texto", () => {
  it("no trunca: parte en varias líneas", () => {
    // El Excel cortaba a 18 caracteres con Left() y mutilaba los nombres largos.
    const largo = "FETUCCHINI A LA HUANCAÍNA CON LANGOSTINOS";
    const lineas = partir(largo, 42);
    expect(lineas.join(" ")).toBe(largo);
    expect(lineas.every((l) => l.length <= 42)).toBe(true);
  });

  it("corta una palabra sola más larga que el papel, pero la imprime entera", () => {
    const lineas = partir("A".repeat(60), 42);
    expect(lineas).toHaveLength(2);
    expect(lineas.join("")).toHaveLength(60);
  });
});

describe("ticket completo", () => {
  it("contiene todo lo que tiene que contener", async () => {
    const bytes = await renderTicketEscPos(ventaDePrueba(), NEGOCIO, { perfil: PERFIL_GENERICO_80 });
    const texto = textoDe(bytes);

    expect(texto).toContain("LA C"); // el nombre, con la Ú ya en CP850
    expect(texto).toContain("AV. SIEMPRE VIVA 742");
    expect(texto).toContain("RUC 20100000001");
    expect(texto).toContain("NV000030");
    expect(texto).toContain("16/09/2026");
    expect(texto).toContain("19:42");
    expect(texto).toContain("CORTE DEGRADADO");
    expect(texto).toContain("2 x 25.00");
    expect(texto).toContain("TOTAL");
    expect(texto).toContain("Vuelto");
    expect(texto).toContain("[IMAGEN]"); // el logo y el QR en bitmap
  });

  it("imprime la marca en los productos y NO en los servicios", async () => {
    // Los servicios los hace La Cúpula y su nombre ya está tres centímetros
    // más arriba, en el encabezado: repetirlo en cada línea gasta papel para
    // decir algo que el cliente ya leyó. En un producto es al revés — la marca
    // es justo lo que distingue el TALCO de DON NISH del de SIRMAN.
    const venta = ventaDePrueba({
      lineas: [
        {
          itemId: "01K5A0000000000000000000A1",
          codigo: "COR-D",
          marca: "LA CÚPULA",
          nombre: "CORTE DEGRADADO",
          tipo: "SERVICIO",
          cantidad: 1,
          precioUnitario: 2500,
          precioLista: 2500,
          barberoId: null,
          total: 2500,
        },
        {
          itemId: "01K5A0000000000000000000A2",
          codigo: "P0031",
          marca: "DON NISH",
          nombre: "TALCO",
          tipo: "PRODUCTO",
          cantidad: 1,
          precioUnitario: 1500,
          precioLista: 1500,
          costoUnitario: 900,
          barberoId: null,
          total: 1500,
        },
      ],
      subtotal: 4000,
      total: 4000,
      pagos: [{ medio: "EFECTIVO", monto: 4000 }],
    });

    const texto = textoDe(await renderTicketEscPos(venta, NEGOCIO, { perfil: PERFIL_GENERICO_80 }));

    expect(texto).toContain("DON NISH TALCO");
    // El servicio sale limpio: su marca no viaja al papel.
    expect(texto).toContain("CORTE DEGRADADO");
    expect(texto).not.toMatch(/C.PULA CORTE DEGRADADO/);
  });

  it("parte por palabra el nombre de un vape que no cabe en el papel", async () => {
    // "VIDA POD CARTUCHO LP WATERMELON PEACH ICE" son 41 caracteres y el perfil
    // de 58 mm tiene 32 columnas. Truncarlo dejaría al cliente con un ticket
    // que no dice qué compró.
    const venta = ventaDePrueba({
      lineas: [
        {
          itemId: "01K5A0000000000000000000A3",
          codigo: "P0088",
          marca: "VIDA POD",
          nombre: "CARTUCHO LP WATERMELON PEACH ICE",
          tipo: "PRODUCTO",
          cantidad: 1,
          precioUnitario: 2500,
          precioLista: 2500,
          barberoId: null,
          total: 2500,
        },
      ],
      subtotal: 2500,
      total: 2500,
      pagos: [{ medio: "EFECTIVO", monto: 2500 }],
    });

    const texto = textoDe(await renderTicketEscPos(venta, NEGOCIO, { perfil: PERFIL_GENERICO_58 }));

    // Está entero, repartido en renglones, y ninguna palabra quedó cortada.
    for (const palabra of ["LIFE", "POD", "CARTUCHO", "WATERMELON", "PEACH", "ICE"]) {
      expect(texto).toContain(palabra);
    }
    expect(texto).not.toContain("WATERME\n");
  });

  it("termina en un comando de corte", async () => {
    // `GS V 66 0` — corte parcial, cuatro bytes.
    const bytes = await renderTicketEscPos(ventaDePrueba(), NEGOCIO, { perfil: PERFIL_GENERICO_80 });
    expect(bytes.subarray(-4)).toEqual(Buffer.from([0x1d, 0x56, 66, 0]));
  });

  it("marca la copia al reimprimir", async () => {
    const bytes = await renderTicketEscPos(
      ventaDePrueba(),
      NEGOCIO,
      { perfil: PERFIL_GENERICO_80 },
      { reimpresion: true },
    );
    expect(textoDe(bytes)).toContain("*** COPIA ***");
  });

  it("marca la anulación con su motivo", async () => {
    const bytes = await renderTicketEscPos(
      ventaDePrueba({ anulada: true, motivoAnulacion: "Cobro duplicado" }),
      NEGOCIO,
      { perfil: PERFIL_GENERICO_80 },
    );
    const texto = textoDe(bytes);
    expect(texto).toContain("ANULADA");
    expect(texto).toContain("Cobro duplicado");
  });

  it("no deja una línea en blanco cuando el marcador viene vacío", async () => {
    // Sin cliente, la línea "Cliente: {cliente.nombre}" no debe imprimirse.
    const conCliente = await renderTicketEscPos(
      ventaDePrueba(),
      NEGOCIO,
      { perfil: PERFIL_GENERICO_80 },
      { nombreDelCliente: "José Peña" },
    );
    expect(textoDe(conCliente)).toContain("Jos");

    const sinCliente = await renderTicketEscPos(ventaDePrueba(), NEGOCIO, { perfil: PERFIL_GENERICO_80 });
    expect(textoDe(sinCliente)).not.toContain("Cliente:");
  });

  it("nombra al barbero UNA vez arriba, no bajo cada servicio", async () => {
    // La venta lleva un solo barbero desde que se elige junto al cliente.
    // Repetirlo en cada línea alargaba el papel sin agregar nada.
    const bytes = await renderTicketEscPos(
      ventaDePrueba(),
      NEGOCIO,
      { perfil: PERFIL_GENERICO_80 },
      { nombresDeBarbero: { "01K59000000000000000000B2": "José" } },
    );
    const texto = textoDe(bytes);

    expect(texto).toContain("Atendi");
    expect(texto).toContain("Jos");
    expect(texto).not.toContain("(Jos");
  });

  it("vuelve a nombrarlo por línea si la venta tiene barberos distintos", async () => {
    // Las ventas anteriores al cambio pueden tener uno por servicio: ahí el
    // dato de la cabecera sería ambiguo y cada línea tiene que decir el suyo.
    const venta = ventaDePrueba();
    const bytes = await renderTicketEscPos(
      {
        ...venta,
        lineas: [
          venta.lineas[0],
          { ...venta.lineas[0], nombre: "BARBA", barberoId: "01K59000000000000000000B3" },
        ],
      },
      NEGOCIO,
      { perfil: PERFIL_GENERICO_80 },
      {
        nombresDeBarbero: {
          "01K59000000000000000000B2": "José",
          "01K59000000000000000000B3": "Kevin",
        },
      },
    );
    const texto = textoDe(bytes);

    expect(texto).toContain("(Jos");
    expect(texto).toContain("(Kevin)");
    expect(texto).not.toContain("Atendi");
  });

  it("no dice nada del barbero si la venta no tiene ninguno", async () => {
    const venta = ventaDePrueba();
    const bytes = await renderTicketEscPos(
      { ...venta, lineas: [{ ...venta.lineas[0], barberoId: null }] },
      NEGOCIO,
      { perfil: PERFIL_GENERICO_80 },
    );
    expect(textoDe(bytes)).not.toContain("Atendi");
  });

  it("desglosa subtotal y descuento solo si hubo descuento", async () => {
    const sin = await renderTicketEscPos(ventaDePrueba(), NEGOCIO, { perfil: PERFIL_GENERICO_80 });
    expect(textoDe(sin)).not.toContain("Subtotal");

    const con = await renderTicketEscPos(
      ventaDePrueba({ descuento: 500, total: 4500 }),
      NEGOCIO,
      { perfil: PERFIL_GENERICO_80 },
    );
    const texto = textoDe(con);
    expect(texto).toContain("Subtotal");
    expect(texto).toContain("-5.00");
  });

  it("usa el QR por firmware cuando el perfil lo permite, y el bitmap si no", async () => {
    const porFirmware = await renderTicketEscPos(ventaDePrueba(), NEGOCIO, { perfil: PERFIL_EPSON_80 });
    expect(textoDe(porFirmware)).toContain("[QR]");

    const enBitmap = await renderTicketEscPos(ventaDePrueba(), NEGOCIO, { perfil: PERFIL_GENERICO_80 });
    // En bitmap el QR es una imagen más: la del logo y la del QR.
    expect(textoDe(enBitmap).match(/\[IMAGEN\]/g)).toHaveLength(2);
  });

  it("respeta el ancho de 58 mm sin desbordar el papel", async () => {
    const bytes = await renderTicketEscPos(ventaDePrueba(), NEGOCIO, { perfil: PERFIL_GENERICO_58 });
    const lineas = textoDe(bytes)
      .split("\n")
      .filter((l) => !l.includes("[IMAGEN]") && !l.includes("[QR]"));
    // Cada línea de texto entra en 32 columnas. Las de tamaño doble llevan la
    // mitad, así que el límite las cubre de sobra.
    expect(lineas.every((l) => l.length <= 32)).toBe(true);
  });

  it("se puede apagar el logo", async () => {
    const bytes = await renderTicketEscPos(ventaDePrueba(), NEGOCIO, {
      perfil: PERFIL_GENERICO_80,
      conLogo: false,
    });
    // Queda solo la imagen del QR.
    expect(textoDe(bytes).match(/\[IMAGEN\]/g)).toHaveLength(1);
  });

  it("una plantilla vacía produce un ticket vacío, sin reventar", async () => {
    const bytes = await renderTicketEscPos(ventaDePrueba(), NEGOCIO, {
      perfil: PERFIL_GENERICO_80,
      plantilla: [],
    });
    expect(bytes).toHaveLength(5); // solo ESC @ + ESC t 2
  });

  it("la plantilla por defecto no se rompió", () => {
    // Red de seguridad: si alguien reordena los bloques sin querer, esto avisa.
    expect(PLANTILLA_POR_DEFECTO[0]).toEqual({ tipo: "logo" });
    expect(PLANTILLA_POR_DEFECTO.at(-1)).toEqual({ tipo: "corte" });
    expect(PLANTILLA_POR_DEFECTO.some((b) => b.tipo === "qr")).toBe(true);
  });
});

function contarBits(b: Buffer): number {
  let n = 0;
  for (const byte of b) n += byte.toString(2).split("1").length - 1;
  return n;
}

describe("vista previa y papel no pueden divergir", () => {
  /**
   * El valor del refactor: las dos salidas recorren la MISMA plantilla. Antes
   * eran dos funciones separadas que armaban el ticket por su cuenta, y nada
   * impedía que un cambio en una no llegara a la otra — el cajero habría visto
   * en pantalla algo distinto de lo que imprimió.
   */
  it("el texto de la vista previa dice lo mismo que los bytes impresos", async () => {
    const venta = ventaDePrueba({ descuento: 500, total: 4500 });
    const extra = { nombreDelCliente: "José Peña", nombresDeBarbero: { "01K59000000000000000000B2": "Kevin" } };

    const texto = await renderTicketTexto(venta, NEGOCIO, { perfil: PERFIL_GENERICO_80 }, extra);
    const impreso = textoDe(await renderTicketEscPos(venta, NEGOCIO, { perfil: PERFIL_GENERICO_80 }, extra));

    // Se comparan las palabras con contenido: el ESC/POS lleva además bytes de
    // comando y el texto lleva marcadores de imagen, pero lo que DICE el ticket
    // tiene que ser idéntico.
    const palabras = (s: string) =>
      s.replace(/\[IMAGEN\]|\[ LOGO \]|\[ QR \]|\[QR\]/g, " ")
        .replace(/CUP1\|V\|NV\d{6}/g, " ")
        .split(/\s+/)
        .filter((p) => p.length > 1)
        .join(" ");

    expect(palabras(texto)).toBe(palabras(impreso));
  });

  it("un cambio en la plantilla se refleja en las dos salidas", async () => {
    const plantilla = [
      { tipo: "texto", contenido: "PROMOCION DEL MES", alinear: "centro" },
      { tipo: "totales" },
    ] as const;

    const opciones = { perfil: PERFIL_GENERICO_80, plantilla: [...plantilla] };
    const texto = await renderTicketTexto(ventaDePrueba(), NEGOCIO, opciones);
    const impreso = textoDe(await renderTicketEscPos(ventaDePrueba(), NEGOCIO, opciones));

    expect(texto).toContain("PROMOCION DEL MES");
    expect(impreso).toContain("PROMOCION DEL MES");
    // Y lo que la plantilla no incluye no aparece en ninguna de las dos.
    expect(texto).not.toContain("RUC");
    expect(impreso).not.toContain("RUC");
  });
});
