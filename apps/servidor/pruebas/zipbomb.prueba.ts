/**
 * Bomba de descompresión en el import de catálogo.
 *
 * Un .xlsx es un ZIP, y un ZIP de pocos KB puede inflar a cientos de MB. En
 * Railway eso es un OOM que reinicia el servicio. La ruta exige ADMIN, pero un
 * archivo malicioso que alguien le pasa al dueño para que lo importe sigue
 * siendo un vector. `leerZip` corta cada entrada con `maxOutputLength`.
 */
import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { leerXlsx } from "../src/adaptadores/planilla/xlsx";

/** Un .xlsx mínimo (ZIP) con una entrada cuyo contenido descomprimido es `tam`. */
function zipConEntradaGorda(tam: number): Buffer {
  const comprimido = deflateRawSync(Buffer.alloc(tam)); // ceros: comprimen altísimo
  const nombre = Buffer.from("xl/gorda.xml");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comprimido.length, 18);
  local.writeUInt32LE(tam, 22);
  local.writeUInt16LE(nombre.length, 26);
  const entradaLocal = Buffer.concat([local, nombre, comprimido]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comprimido.length, 20);
  central.writeUInt32LE(tam, 24);
  central.writeUInt16LE(nombre.length, 28);
  central.writeUInt32LE(0, 42);
  const dirCentral = Buffer.concat([central, nombre]);

  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(dirCentral.length, 12);
  fin.writeUInt32LE(entradaLocal.length, 16);
  return Buffer.concat([entradaLocal, dirCentral, fin]);
}

describe("bomba de descompresión en el import", () => {
  /**
   * La entrada infla a 60 MB, apenas por encima del tope de 48 MB por archivo.
   * Se queda chica a propósito: una bomba de 500 MB probaría lo mismo, pero
   * construirla reservaría 500 MB en la propia prueba.
   *
   * La señal es de COMPORTAMIENTO, no de memoria (medir RSS da una prueba
   * inestable): con el tope, la entrada gigante se DESCARTA, así que no queda
   * ninguna hoja legible y `leerXlsx` rechaza con un error de negocio. Sin el
   * tope, esos 60 MB se materializarían enteros —y una bomba de verdad serían
   * cientos de MB que tumban el proceso—. Que el error hable de "hoja" y no
   * sea un `ERR_BUFFER_TOO_LARGE` crudo prueba que pasó por el corte.
   */
  it("corta una entrada que se pasa del tope por archivo", () => {
    expect(() => leerXlsx(zipConEntradaGorda(60 * 1024 * 1024))).toThrow(/hoja/i);
  });
});
