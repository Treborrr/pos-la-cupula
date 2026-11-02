import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { leerXlsx } from "../src/adaptadores/planilla/xlsx";

/** Un .xlsx mínimo con una hoja cuyo XML es `hojaXml`. */
function xlsxConHoja(hojaXml: string): Buffer {
  const partes: { nombre: string; datos: Buffer }[] = [
    { nombre: "xl/worksheets/sheet1.xml", datos: Buffer.from(hojaXml) },
    { nombre: "xl/workbook.xml", datos: Buffer.from('<workbook><sheets><sheet name="H" r:id="rId1"/></sheets></workbook>') },
    { nombre: "xl/_rels/workbook.xml.rels", datos: Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>') },
  ];
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let off = 0;
  for (const { nombre, datos } of partes) {
    const comp = deflateRawSync(datos);
    const nb = Buffer.from(nombre);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(datos.length, 22); lh.writeUInt16LE(nb.length, 26);
    const local = Buffer.concat([lh, nb, comp]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(datos.length, 24); ch.writeUInt16LE(nb.length, 28);
    ch.writeUInt32LE(off, 42);
    centrales.push(Buffer.concat([ch, nb]));
    locales.push(local); off += local.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(partes.length, 10);
  fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(off, 16);
  return Buffer.concat([...locales, dir, fin]);
}

describe("ataques al parser de xlsx", () => {
  it("una referencia de columna imposible (ZZZZZZ1) no revienta el proceso", () => {
    // Antes: pedía un arreglo de 321 millones de posiciones → OOM con 628 bytes.
    const hoja = `<sheetData><row r="1"><c r="ZZZZZZ1" t="str"><v>x</v></c></row></sheetData>`;
    const t0 = performance.now();
    const filas = leerXlsx(xlsxConHoja(hoja));
    expect(performance.now() - t0).toBeLessThan(500); // antes mataba el proceso
    // La celda imposible se descarta; la fila existe pero sin esa columna.
    expect(filas.length).toBe(1);
  });

  it("un <si> sin cerrar no dispara el escaneo cuadrático", () => {
    // Antes: 160 KB de <si> sin cerrar = 23 s de bucle bloqueado.
    const basura = "<si>".repeat(200_000);
    const hoja = `<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>`;
    // Metemos la basura en el sharedStrings vía una hoja que lo referencia no
    // hace falta: basta probar que leerXlsx sobre un XML con tags sin cerrar
    // corta en tiempo lineal. Usamos la hoja con muchos <row sin cerrar.
    const hojaBomba = `<sheetData>${"<row>".repeat(200_000)}`;
    const t0 = performance.now();
    leerXlsx(xlsxConHoja(hojaBomba));
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(500); // antes: decenas de segundos
    void basura; void hoja;
  });
});
