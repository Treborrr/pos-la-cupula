/**
 * Comandos ESC/POS, envueltos en algo legible.
 *
 * ESC/POS es un protocolo de bytes de los años 80: `0x1B 0x61 0x01` significa
 * "centrar". Escribirlo así en el renderizador del ticket lo volvería
 * imposible de revisar, así que aquí se le pone nombre a cada secuencia y una
 * referencia de qué hace. El renderizador arma tickets, no bytes.
 *
 * Referencia: comandos estándar de Epson, que es lo que implementan (con
 * suerte variable) las impresoras compatibles.
 */

import { aCp850 } from "./cp850";
import type { PerfilImpresora } from "./perfil";

const ESC = 0x1b;
const GS = 0x1d;

export class ConstructorEscPos {
  private partes: Buffer[] = [];

  constructor(private readonly perfil: PerfilImpresora) {}

  private crudo(...bytes: number[]): this {
    this.partes.push(Buffer.from(bytes));
    return this;
  }

  /** `ESC @` — reinicia la impresora y descarta cualquier estado anterior.
   *  Va siempre primero: si el ticket previo se cortó a mitad de un comando,
   *  la impresora puede haber quedado en negrita o en tamaño doble. */
  iniciar(): this {
    this.crudo(ESC, 0x40);
    // `ESC t n` — página de códigos. Sin esto las tildes salen como símbolos.
    this.crudo(ESC, 0x74, this.perfil.paginaDeCodigos);
    return this;
  }

  texto(s: string): this {
    this.partes.push(aCp850(s));
    return this;
  }

  linea(s = ""): this {
    return this.texto(s + "\n");
  }

  /** `ESC a n` — 0 izquierda, 1 centro, 2 derecha. */
  alinear(donde: "izq" | "centro" | "der"): this {
    return this.crudo(ESC, 0x61, { izq: 0, centro: 1, der: 2 }[donde]);
  }

  /** `ESC E n` */
  negrita(activa: boolean): this {
    return this.crudo(ESC, 0x45, activa ? 1 : 0);
  }

  /** `ESC - n` — subrayado, 0 a 2 de grosor. */
  subrayado(grosor: 0 | 1 | 2): this {
    return this.crudo(ESC, 0x2d, grosor);
  }

  /**
   * `GS ! n` — tamaño. Los 4 bits altos multiplican el ancho y los 4 bajos el
   * alto, cada uno de 1 a 8 veces.
   */
  tamano(ancho: 1 | 2 | 3, alto: 1 | 2 | 3): this {
    return this.crudo(GS, 0x21, ((ancho - 1) << 4) | (alto - 1));
  }

  normal(): this {
    return this.tamano(1, 1).negrita(false).subrayado(0).alinear("izq");
  }

  /** `ESC d n` — avanza n líneas. */
  avanzar(lineas = 1): this {
    return this.crudo(ESC, 0x64, Math.max(0, Math.min(255, lineas)));
  }

  /** `GS V m` — corte. 66 = parcial dejando un puentecito de papel. */
  cortar(): this {
    if (this.perfil.corte === "ninguno") return this.avanzar(this.perfil.lineasAlFinal);
    this.avanzar(this.perfil.lineasAlFinal);
    return this.crudo(GS, 0x56, this.perfil.corte === "parcial" ? 66 : 65, 0);
  }

  /** `ESC p m t1 t2` — pulso al cajón de dinero. Sin cajón no hace nada. */
  abrirCajon(): this {
    if (!this.perfil.cajonDeDinero) return this;
    return this.crudo(ESC, 0x70, 0, 25, 250);
  }

  /** Una línea de guiones del ancho del papel. */
  separador(caracter = "-"): this {
    return this.linea(caracter.repeat(this.perfil.columnas));
  }

  /**
   * Dos columnas: etiqueta a la izquierda, valor pegado a la derecha.
   * Es lo que hace legible la lista de importes.
   */
  dosColumnas(izquierda: string, derecha: string): this {
    const espacio = this.perfil.columnas - izquierda.length - derecha.length;
    if (espacio < 1) {
      // No entra en una línea: se parte antes que desalinear la columna de
      // importes, que es la que alguien va a leer.
      this.linea(izquierda);
      return this.linea(derecha.padStart(this.perfil.columnas));
    }
    return this.linea(izquierda + " ".repeat(espacio) + derecha);
  }

  /**
   * Imagen en blanco y negro, comando `GS v 0`.
   *
   * `datos` viene empaquetado a 1 bit por punto, 8 puntos por byte, fila por
   * fila. Es el formato que espera la impresora tal cual, así que no hay
   * conversión en tiempo de impresión: imprimir el logo es copiar un buffer.
   */
  imagen(ancho: number, alto: number, datos: Buffer): this {
    const bytesPorFila = Math.ceil(ancho / 8);
    this.crudo(
      GS,
      0x76,
      0x30,
      0, // modo normal, sin escalar
      bytesPorFila & 0xff,
      (bytesPorFila >> 8) & 0xff,
      alto & 0xff,
      (alto >> 8) & 0xff,
    );
    this.partes.push(datos);
    return this;
  }

  /**
   * QR por firmware (`GS ( k`). Cuatro comandos en secuencia: tamaño del
   * módulo, nivel de corrección, cargar los datos e imprimir.
   *
   * Solo se usa si el perfil lo habilita: varias impresoras genéricas
   * anuncian soportarlo y devuelven basura. El fallback en bitmap vive en
   * `renderTicket`, que es quien decide cuál usar.
   */
  qrFirmware(contenido: string): this {
    const datos = aCp850(contenido);
    const largo = datos.length + 3;

    // Modelo 2
    this.crudo(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0);
    // Tamaño del módulo
    this.crudo(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, this.perfil.qrTamano);
    // Corrección de errores M (15%): suficiente para un ticket que se escanea
    // en el mostrador y no se llena de dedos.
    this.crudo(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);
    // Cargar los datos
    this.crudo(GS, 0x28, 0x6b, largo & 0xff, (largo >> 8) & 0xff, 0x31, 0x50, 0x30);
    this.partes.push(datos);
    // Imprimir
    this.crudo(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);

    return this;
  }

  construir(): Buffer {
    return Buffer.concat(this.partes);
  }
}
