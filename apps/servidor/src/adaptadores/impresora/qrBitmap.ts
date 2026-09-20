/**
 * QR como imagen bitmap, para cuando no se puede confiar en el firmware.
 *
 * Es el camino LENTO pero seguro. Varias impresoras genéricas anuncian
 * soportar `GS ( k` (el QR por firmware) y devuelven basura o nada; con el
 * bitmap el QR sale sí o sí, porque imprimir puntos es lo único que toda
 * impresora térmica sabe hacer bien.
 *
 * Cuesta unos pocos kilobytes más por ticket y unas décimas de segundo. Para
 * una barbería que emite 20 tickets al día es irrelevante; para no imprimir el
 * QR, no.
 */

import QRCode from "qrcode";

export interface ImagenMono {
  ancho: number;
  alto: number;
  /** 1 bit por punto, 8 puntos por byte, fila por fila. Formato `GS v 0`. */
  datos: Buffer;
}

/**
 * Genera el QR y lo empaqueta listo para `GS v 0`.
 *
 * `escala` es cuántos puntos de impresora ocupa cada módulo del QR. Con 4 sale
 * un QR de ~1.5 cm en papel de 80 mm: se lee sin problema con la pistola y con
 * la cámara de un celular. Menos de 3 empieza a fallar en papel térmico
 * barato, que corre la tinta.
 */
export async function qrComoBitmap(contenido: string, escala = 4, margenModulos = 2): Promise<ImagenMono> {
  const qr = QRCode.create(contenido, { errorCorrectionLevel: "M" });
  const lado = qr.modules.size;
  const modulos = qr.modules.data;

  // El margen (zona tranquila) NO es decorativo: sin él, muchos lectores no
  // encuentran el patrón de posición y el QR simplemente no se lee.
  const ladoTotal = lado + margenModulos * 2;
  const ancho = ladoTotal * escala;
  const alto = ancho;
  const bytesPorFila = Math.ceil(ancho / 8);
  const datos = Buffer.alloc(bytesPorFila * alto, 0);

  for (let fila = 0; fila < alto; fila++) {
    const moduloY = Math.floor(fila / escala) - margenModulos;
    if (moduloY < 0 || moduloY >= lado) continue;

    for (let columna = 0; columna < ancho; columna++) {
      const moduloX = Math.floor(columna / escala) - margenModulos;
      if (moduloX < 0 || moduloX >= lado) continue;

      if (modulos[moduloY * lado + moduloX]) {
        // Bit en 1 = punto negro. El bit más significativo es el de la
        // izquierda, de ahí el 7 - (columna % 8).
        datos[fila * bytesPorFila + (columna >> 3)] |= 0x80 >> (columna & 7);
      }
    }
  }

  return { ancho, alto, datos };
}

/**
 * Centra una imagen dentro del ancho del papel.
 *
 * `ESC a 1` centra texto, pero NO centra las imágenes en todas las
 * impresoras: varias las pegan siempre a la izquierda. Rellenar el bitmap con
 * blanco a ambos lados funciona en todas.
 */
export function centrar(imagen: ImagenMono, anchoPapel: number): ImagenMono {
  if (imagen.ancho >= anchoPapel) return imagen;

  // El desplazamiento se redondea a byte: mover una imagen una cantidad de
  // puntos que no sea múltiplo de 8 obligaría a correr los bits uno por uno,
  // y no vale la pena por un error de posición de menos de un milímetro.
  const bytesOrigen = Math.ceil(imagen.ancho / 8);
  const bytesDestino = Math.ceil(anchoPapel / 8);
  const desplazamiento = Math.floor((bytesDestino - bytesOrigen) / 2);

  const datos = Buffer.alloc(bytesDestino * imagen.alto, 0);
  for (let fila = 0; fila < imagen.alto; fila++) {
    imagen.datos.copy(
      datos,
      fila * bytesDestino + desplazamiento,
      fila * bytesOrigen,
      (fila + 1) * bytesOrigen,
    );
  }

  return { ancho: bytesDestino * 8, alto: imagen.alto, datos };
}
