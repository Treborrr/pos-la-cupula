/**
 * Leer y escribir XLSX sin dependencias.
 *
 * Un .xlsx es un ZIP con XML adentro. Node ya trae todo lo necesario —`zlib`
 * para desinflar, nada para el ZIP— así que se escribe a mano por la misma
 * razón que el tar de los respaldos: no sumar una dependencia de 1 MB para
 * leer una planilla de seis columnas.
 *
 * POR QUÉ XLSX Y NO CSV. Un CSV abierto en Excel en español es una fuente
 * inagotable de problemas: el separador pasa a ser punto y coma, los decimales
 * llevan coma, y las tildes y la eñe se rompen si el archivo no viene en UTF-8
 * con BOM. El XLSX no tiene ninguna de esas ambigüedades: el texto es texto y
 * los números son números.
 *
 * ALCANCE. Lo mínimo para una plantilla de catálogo: una hoja, celdas de texto
 * y de número, sin fórmulas, sin formatos, sin fechas. Si alguna vez hace falta
 * más, conviene mirar una librería de verdad antes que estirar esto.
 */

import { inflateRawSync } from "node:zlib";

// ─────────────────────────────────────────────────────────────────────────────
// ZIP
// ─────────────────────────────────────────────────────────────────────────────

/** CRC-32, que el formato ZIP exige por entrada. */
function crc32(datos: Buffer): number {
  let c = ~0;
  for (let i = 0; i < datos.length; i++) {
    c ^= datos[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

interface EntradaZip {
  nombre: string;
  contenido: Buffer;
}

/**
 * Arma un ZIP con las entradas SIN comprimir (método 0).
 *
 * Comprimir ahorraría unos kilobytes en un archivo que ya pesa tres, y
 * obligaría a escribir un deflate. Excel abre los dos por igual.
 */
function armarZip(entradas: EntradaZip[]): Buffer {
  const locales: Buffer[] = [];
  const central: Buffer[] = [];
  let desplazamiento = 0;

  for (const { nombre, contenido } of entradas) {
    const nombreBytes = Buffer.from(nombre, "utf8");
    const crc = crc32(contenido);

    const cabecera = Buffer.alloc(30);
    cabecera.writeUInt32LE(0x04034b50, 0); // firma
    cabecera.writeUInt16LE(20, 4); // versión necesaria
    cabecera.writeUInt16LE(0, 6); // sin banderas
    cabecera.writeUInt16LE(0, 8); // método 0 = almacenado
    cabecera.writeUInt16LE(0, 10); // hora
    cabecera.writeUInt16LE(0x21, 12); // fecha (1980-01-01, fija y reproducible)
    cabecera.writeUInt32LE(crc, 14);
    cabecera.writeUInt32LE(contenido.length, 18);
    cabecera.writeUInt32LE(contenido.length, 22);
    cabecera.writeUInt16LE(nombreBytes.length, 26);
    cabecera.writeUInt16LE(0, 28); // sin extra

    locales.push(cabecera, nombreBytes, contenido);

    const entradaCentral = Buffer.alloc(46);
    entradaCentral.writeUInt32LE(0x02014b50, 0);
    entradaCentral.writeUInt16LE(20, 4); // versión que lo creó
    entradaCentral.writeUInt16LE(20, 6);
    entradaCentral.writeUInt16LE(0, 8);
    entradaCentral.writeUInt16LE(0, 10);
    entradaCentral.writeUInt16LE(0, 12);
    entradaCentral.writeUInt16LE(0x21, 14);
    entradaCentral.writeUInt32LE(crc, 16);
    entradaCentral.writeUInt32LE(contenido.length, 20);
    entradaCentral.writeUInt32LE(contenido.length, 24);
    entradaCentral.writeUInt16LE(nombreBytes.length, 28);
    entradaCentral.writeUInt16LE(0, 30);
    entradaCentral.writeUInt16LE(0, 32);
    entradaCentral.writeUInt16LE(0, 34);
    entradaCentral.writeUInt16LE(0, 36);
    entradaCentral.writeUInt32LE(0, 38);
    entradaCentral.writeUInt32LE(desplazamiento, 42);

    central.push(entradaCentral, nombreBytes);
    desplazamiento += cabecera.length + nombreBytes.length + contenido.length;
  }

  const cuerpoCentral = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(0, 4);
  fin.writeUInt16LE(0, 6);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(cuerpoCentral.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  fin.writeUInt16LE(0, 20);

  return Buffer.concat([...locales, cuerpoCentral, fin]);
}

/** Abre un ZIP y devuelve sus entradas descomprimidas, por nombre. */
function leerZip(datos: Buffer): Map<string, Buffer> {
  // El directorio central está al final, precedido por un comentario de largo
  // variable: hay que buscar su firma hacia atrás.
  let fin = -1;
  for (let i = datos.length - 22; i >= 0 && i > datos.length - 65558; i--) {
    if (datos.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error("El archivo no es un .xlsx válido (no se encontró el índice del ZIP).");

  const cantidad = datos.readUInt16LE(fin + 10);
  let p = datos.readUInt32LE(fin + 16);
  const salida = new Map<string, Buffer>();

  for (let i = 0; i < cantidad; i++) {
    if (datos.readUInt32LE(p) !== 0x02014b50) break;

    const metodo = datos.readUInt16LE(p + 10);
    const comprimido = datos.readUInt32LE(p + 20);
    const largoNombre = datos.readUInt16LE(p + 28);
    const largoExtra = datos.readUInt16LE(p + 30);
    const largoComentario = datos.readUInt16LE(p + 32);
    const desplazamiento = datos.readUInt32LE(p + 42);
    const nombre = datos.subarray(p + 46, p + 46 + largoNombre).toString("utf8");

    // La cabecera local repite el nombre y el extra, y sus largos pueden NO
    // coincidir con los del directorio central: hay que leerlos de ahí.
    const largoNombreLocal = datos.readUInt16LE(desplazamiento + 26);
    const largoExtraLocal = datos.readUInt16LE(desplazamiento + 28);
    const inicio = desplazamiento + 30 + largoNombreLocal + largoExtraLocal;
    const crudo = datos.subarray(inicio, inicio + comprimido);

    if (metodo === 0) salida.set(nombre, Buffer.from(crudo));
    else if (metodo === 8) salida.set(nombre, inflateRawSync(crudo));
    // Cualquier otro método lo escribe un compresor exótico; se ignora la
    // entrada en vez de romper la lectura del resto.

    p += 46 + largoNombre + largoExtra + largoComentario;
  }

  return salida;
}

// ─────────────────────────────────────────────────────────────────────────────
// XML
// ─────────────────────────────────────────────────────────────────────────────

function escaparXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function desescaparXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    // El &amp; va ÚLTIMO: si no, "&amp;lt;" se convertiría en "<".
    .replace(/&amp;/g, "&");
}

/** Junta el texto de los `<t>` de un fragmento, que es como XLSX parte las cadenas con formato. */
function textoDeNodos(xml: string): string {
  const partes = [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => desescaparXml(m[1]));
  return partes.join("");
}

/** "BC12" → 54 (índice de columna, base 0). */
function columnaDeReferencia(ref: string): number {
  const letras = /^([A-Z]+)/.exec(ref)?.[1] ?? "A";
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

export type CeldaEscribible = string | number | null | undefined;

export interface HojaAEscribir {
  nombre: string;
  /** Primera fila: los encabezados. */
  filas: CeldaEscribible[][];
  /** Ancho de cada columna, en caracteres. Sin esto Excel las deja angostas. */
  anchos?: number[];
}

/**
 * Genera un .xlsx de una sola hoja.
 *
 * Las cadenas van EN LÍNEA (`t="inlineStr"`) en vez de en la tabla de cadenas
 * compartidas: evita mantener un índice y el archivo sigue siendo válido.
 */
export function escribirXlsx(hoja: HojaAEscribir): Buffer {
  const filasXml = hoja.filas
    .map((fila, f) => {
      const celdas = fila
        .map((valor, c) => {
          if (valor === null || valor === undefined || valor === "") return "";
          const ref = `${letrasDeColumna(c)}${f + 1}`;
          if (typeof valor === "number") return `<c r="${ref}"><v>${valor}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escaparXml(String(valor))}</t></is></c>`;
        })
        .join("");
      return `<row r="${f + 1}">${celdas}</row>`;
    })
    .join("");

  const columnas = hoja.anchos?.length
    ? `<cols>${hoja.anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${columnas}<sheetData>${filasXml}</sheetData></worksheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escaparXml(hoja.nombre)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const relsWorkbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

  const utf8 = (s: string) => Buffer.from(s, "utf8");
  return armarZip([
    { nombre: "[Content_Types].xml", contenido: utf8(contentTypes) },
    { nombre: "_rels/.rels", contenido: utf8(rels) },
    { nombre: "xl/workbook.xml", contenido: utf8(workbook) },
    { nombre: "xl/_rels/workbook.xml.rels", contenido: utf8(relsWorkbook) },
    { nombre: "xl/worksheets/sheet1.xml", contenido: utf8(sheet) },
  ]);
}

function letrasDeColumna(indice: number): string {
  let n = indice + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Lee la PRIMERA hoja de un .xlsx y la devuelve como una matriz de texto.
 *
 * Todo sale como cadena, incluidos los números: quien llama sabe qué esperaba
 * en cada columna y convierte con sus propias reglas. Devolver `number` acá
 * obligaría a adivinar si "10.50" es precio o código.
 */
export function leerXlsx(datos: Buffer): string[][] {
  const zip = leerZip(datos);

  const hoja = zip.get("xl/worksheets/sheet1.xml");
  if (!hoja) throw new Error("El archivo no tiene ninguna hoja de cálculo legible.");

  // Excel guarda las cadenas una sola vez en una tabla compartida y en las
  // celdas deja el índice.
  const compartidas: string[] = [];
  const tabla = zip.get("xl/sharedStrings.xml");
  if (tabla) {
    for (const m of tabla.toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      compartidas.push(textoDeNodos(m[1]));
    }
  }

  const xml = hoja.toString("utf8");
  const filas: string[][] = [];

  for (const mFila of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas: string[] = [];
    for (const mCelda of mFila[1].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atributos = mCelda[1];
      const cuerpo = mCelda[2] ?? "";
      const ref = /r="([A-Z]+\d+)"/.exec(atributos)?.[1];
      const tipo = /t="([^"]+)"/.exec(atributos)?.[1];

      let valor = "";
      if (tipo === "s") {
        const i = Number(/<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1] ?? "-1");
        valor = compartidas[i] ?? "";
      } else if (tipo === "inlineStr") {
        valor = textoDeNodos(cuerpo);
      } else {
        // `str` es el resultado de una fórmula; el resto son números.
        valor = desescaparXml(/<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1] ?? "");
      }

      // Las celdas vacías no se escriben: hay que colocar cada una en SU
      // columna o se corren todas las de la derecha.
      const columna = ref ? columnaDeReferencia(ref) : celdas.length;
      while (celdas.length < columna) celdas.push("");
      celdas[columna] = valor.trim();
    }
    filas.push(celdas);
  }

  return filas;
}
