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

/**
 * Topes contra una bomba de descompresión.
 *
 * Un `.xlsx` es un ZIP, y un ZIP de pocos KB puede inflar a gigabytes: medido,
 * 18 KB de entrada llegaron a 480 MB de memoria. En Railway, con RAM acotada,
 * eso es un OOM que reinicia el servicio, o sea una denegación de servicio para
 * toda la barbería. La ruta exige ADMIN, pero un archivo malicioso que alguien
 * le pasa al dueño para que lo importe sigue siendo un vector real.
 *
 * Una planilla de catálogo de verdad pesa, descomprimida, unos pocos MB como
 * mucho (el caso real del cliente eran 187 productos). Estos topes están muy
 * por encima de eso y muy por debajo de lo que tumba el proceso.
 */
const MAX_ENTRADA_DESCOMPRIMIDA = 48 * 1024 * 1024; // 48 MB por archivo del ZIP
const MAX_TOTAL_DESCOMPRIMIDO = 96 * 1024 * 1024; // 96 MB sumando todo el ZIP
const MAX_ENTRADAS = 512; // un .xlsx normal tiene unas pocas, no miles

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
  if (cantidad > MAX_ENTRADAS) {
    throw new Error("El archivo no es una planilla de catálogo válida (demasiadas entradas internas).");
  }
  let p = datos.readUInt32LE(fin + 16);
  const salida = new Map<string, Buffer>();
  let totalDescomprimido = 0;

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

    if (metodo === 0 || metodo === 8) {
      // `maxOutputLength` hace que `inflateRawSync` CORTE una entrada que se
      // pasa de la raya, en vez de materializar gigabytes y reventar el
      // proceso. Para los no comprimidos (método 0) el tope lo pone el
      // `subarray`, acotado al tamaño que ya declaró el ZIP.
      let contenido: Buffer;
      try {
        contenido =
          metodo === 0
            ? Buffer.from(crudo.subarray(0, MAX_ENTRADA_DESCOMPRIMIDA))
            : inflateRawSync(crudo, { maxOutputLength: MAX_ENTRADA_DESCOMPRIMIDA });
      } catch {
        // Una entrada que no infla o que se pasa del tope tumba SOLO esa
        // entrada, no la lectura entera: si era una hoja que no hacía falta,
        // la planilla igual se puede leer; si era la que importaba, más
        // adelante se avisa "no hay hoja legible".
        p += 46 + largoNombre + largoExtra + largoComentario;
        continue;
      }

      totalDescomprimido += contenido.length;
      if (totalDescomprimido > MAX_TOTAL_DESCOMPRIMIDO) {
        throw new Error("El archivo no es una planilla de catálogo válida (contenido descomprimido excesivo).");
      }
      salida.set(nombre, contenido);
    }
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
  const partes: string[] = [];
  for (const cuerpo of fragmentos(xml, "t")) partes.push(desescaparXml(cuerpo));
  return partes.join("");
}

/**
 * Qué archivo tiene la PRIMERA hoja del libro.
 *
 * No alcanza con asumir `sheet1.xml`. El orden de las pestañas lo define
 * `workbook.xml`, y el archivo detrás de cada una lo define el mapa de
 * relaciones: si alguien borró una hoja, la que queda puede ser `sheet2.xml`, y
 * si reordenó las pestañas, la primera puede ser cualquiera. Leer el archivo
 * equivocado no da un error — da una tabla vacía o las instrucciones en lugar
 * de los productos, que es peor porque parece que la planilla estaba vacía.
 */
function rutaDeLaPrimeraHoja(zip: Map<string, Buffer>): string {
  const libro = zip.get("xl/workbook.xml")?.toString("utf8");
  const relaciones = zip.get("xl/_rels/workbook.xml.rels")?.toString("utf8");

  if (libro && relaciones) {
    const primera = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(libro)?.[1];
    if (primera) {
      for (const m of relaciones.matchAll(/<Relationship\b([^>]*)\/>/g)) {
        if (!new RegExp(`Id="${primera}"`).test(m[1])) continue;
        const destino = /Target="([^"]+)"/.exec(m[1])?.[1];
        if (!destino) break;
        // Los destinos son relativos a xl/ y a veces vienen como "/xl/…".
        const ruta = destino.startsWith("/")
          ? destino.slice(1)
          : `xl/${destino.replace(/^\.\//, "")}`;
        if (zip.has(ruta)) return ruta;
      }
    }
  }

  // Sin workbook legible, el nombre por convención. Y si tampoco está, la
  // primera hoja que haya: mejor leer algo que negarse por un detalle de
  // empaquetado.
  if (zip.has("xl/worksheets/sheet1.xml")) return "xl/worksheets/sheet1.xml";
  for (const nombre of zip.keys()) {
    if (nombre.startsWith("xl/worksheets/") && nombre.endsWith(".xml")) return nombre;
  }
  return "xl/worksheets/sheet1.xml";
}

/** "BC12" → 54 (índice de columna, base 0). */
/**
 * Recorre `<tag ...>…</tag>` en tiempo LINEAL con `indexOf`.
 *
 * Reemplaza a `matchAll(/<tag>([\s\S]*?)<\/tag>/g)`, que es O(n²) cuando el
 * tag de cierre NO existe: el motor intenta abrir en cada posición y escanea
 * hasta el final cada vez. Medido: 160 KB de `<si>` sin cerrar bloqueaban el
 * bucle de eventos 23 segundos, y un .xlsx de ~550 KB lo colgaría durante
 * meses, sin morir ni reiniciar. Acá, si no hay cierre, se corta y listo.
 */
function* fragmentos(xml: string, tag: string): Generator<string> {
  let i = 0;
  const cierre = `</${tag}>`;
  for (;;) {
    const abre = xml.indexOf(`<${tag}`, i);
    if (abre < 0) return;
    // Que `<t` no matchee `<table`: el carácter siguiente tiene que cerrar el
    // nombre del tag.
    const sig = xml[abre + tag.length + 1];
    if (sig !== " " && sig !== ">" && sig !== "/" && sig !== "\t" && sig !== "\n" && sig !== "\r") {
      i = abre + tag.length + 1;
      continue;
    }
    const finAbre = xml.indexOf(">", abre);
    if (finAbre < 0) return;
    if (xml[finAbre - 1] === "/") {
      i = finAbre + 1;
      yield "";
      continue;
    }
    const cierraEn = xml.indexOf(cierre, finAbre);
    if (cierraEn < 0) return;
    yield xml.slice(finAbre + 1, cierraEn);
    i = cierraEn + cierre.length;
  }
}

/** Las celdas `<c ...>…</c>` de una fila, con sus atributos. Lineal, ver `fragmentos`. */
function* celdasDe(fila: string): Generator<{ atributos: string; cuerpo: string }> {
  let i = 0;
  for (;;) {
    const abre = fila.indexOf("<c", i);
    if (abre < 0) return;
    const sig = fila[abre + 2];
    if (sig !== " " && sig !== ">" && sig !== "/") {
      i = abre + 2;
      continue;
    }
    const finAbre = fila.indexOf(">", abre);
    if (finAbre < 0) return;
    const autocierra = fila[finAbre - 1] === "/";
    const atributos = fila.slice(abre + 2, autocierra ? finAbre - 1 : finAbre);
    if (autocierra) {
      yield { atributos, cuerpo: "" };
      i = finAbre + 1;
      continue;
    }
    const cierraEn = fila.indexOf("</c>", finAbre);
    if (cierraEn < 0) return;
    yield { atributos, cuerpo: fila.slice(finAbre + 1, cierraEn) };
    i = cierraEn + 4;
  }
}

/**
 * Topes de la planilla. Una de catálogo real tiene unas pocas columnas y
 * cientos de filas (la del cliente, 138). Estos límites dejan margen de sobra y
 * cortan los dos vectores que mataban el proceso: una celda `r="ZZZZZZ1"` pedía
 * un arreglo de 321 millones de posiciones, y las filas no tenían tope.
 */
const MAX_FILAS = 50_000;
const MAX_COLUMNAS = 256;

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

/** Genera un .xlsx de una sola hoja. Atajo sobre `escribirLibro`. */
export function escribirXlsx(hoja: HojaAEscribir): Buffer {
  return escribirLibro([hoja]);
}

/**
 * Genera un .xlsx con VARIAS hojas.
 *
 * Existe por una razón concreta: las instrucciones de la plantilla de catálogo
 * vivían debajo de los datos, en la misma hoja, y el lector tenía que adivinar
 * con heurísticas cuál fila era un producto y cuál una explicación ("si no
 * tiene nombre pero sí primera columna, es instructivo…"). Cada instrucción
 * nueva era un riesgo de que una fila real se descartara en silencio. Con la
 * hoja aparte, el lector lee la primera hoja y ahí solo hay datos.
 *
 * Las cadenas van EN LÍNEA (`t="inlineStr"`) en vez de en la tabla de cadenas
 * compartidas: evita mantener un índice y el archivo sigue siendo válido.
 */
export function escribirLibro(hojas: HojaAEscribir[]): Buffer {
  if (hojas.length === 0) throw new Error("Un libro necesita al menos una hoja.");

  const cuerpoDeHoja = (hoja: HojaAEscribir): string => {
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

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${columnas}<sheetData>${filasXml}</sheetData></worksheet>`;
  };

  const entradasDeHoja = hojas.map((hoja, i) => ({
    ruta: `xl/worksheets/sheet${i + 1}.xml`,
    rel: `rId${i + 1}`,
    nombre: hoja.nombre,
    xml: cuerpoDeHoja(hoja),
  }));

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${entradasDeHoja
    .map((h, i) => `<sheet name="${escaparXml(h.nombre)}" sheetId="${i + 1}" r:id="${h.rel}"/>`)
    .join("")}</sheets></workbook>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${entradasDeHoja
    .map(
      (h) =>
        `<Override PartName="/${h.ruta}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("")}</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const relsWorkbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entradasDeHoja
    .map(
      (h) =>
        `<Relationship Id="${h.rel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${h.ruta.replace("xl/", "")}"/>`,
    )
    .join("")}</Relationships>`;

  const utf8 = (s: string) => Buffer.from(s, "utf8");
  return armarZip([
    { nombre: "[Content_Types].xml", contenido: utf8(contentTypes) },
    { nombre: "_rels/.rels", contenido: utf8(rels) },
    { nombre: "xl/workbook.xml", contenido: utf8(workbook) },
    { nombre: "xl/_rels/workbook.xml.rels", contenido: utf8(relsWorkbook) },
    ...entradasDeHoja.map((h) => ({ nombre: h.ruta, contenido: utf8(h.xml) })),
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

  const hoja = zip.get(rutaDeLaPrimeraHoja(zip));
  if (!hoja) throw new Error("El archivo no tiene ninguna hoja de cálculo legible.");

  // Excel guarda las cadenas una sola vez en una tabla compartida y en las
  // celdas deja el índice.
  const compartidas: string[] = [];
  const tabla = zip.get("xl/sharedStrings.xml");
  if (tabla) {
    for (const cuerpo of fragmentos(tabla.toString("utf8"), "si")) {
      compartidas.push(textoDeNodos(cuerpo));
    }
  }

  const xml = hoja.toString("utf8");
  const filas: string[][] = [];

  for (const cuerpoFila of fragmentos(xml, "row")) {
    if (filas.length >= MAX_FILAS) {
      throw new Error(`La planilla tiene más de ${MAX_FILAS} filas. Revisa que no haya filas vacías de más.`);
    }
    const celdas: string[] = [];
    for (const { atributos, cuerpo } of celdasDe(cuerpoFila)) {
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
      // Una celda más allá de la última columna útil es una nota perdida del
      // Excel; descartarla evita que `r="ZZZZZZ1"` pida 321 millones de huecos.
      // El chequeo de encabezados solo mira las primeras columnas.
      if (columna >= MAX_COLUMNAS) continue;
      while (celdas.length < columna) celdas.push("");
      celdas[columna] = valor.trim();
    }
    filas.push(celdas);
  }

  return filas;
}
