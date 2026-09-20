/**
 * A dónde se "pinta" un ticket.
 *
 * Existe para resolver un problema concreto: el ticket se necesita en DOS
 * formas —los bytes ESC/POS que van al papel y el texto que se muestra en
 * pantalla— y tenerlas escritas por separado es garantía de que un día
 * divergen. El cajero vería en la vista previa algo distinto de lo que
 * imprimió, que es justo cuando la vista previa deja de servir.
 *
 * Con esta interfaz, `renderTicket` recorre la plantilla UNA sola vez y lo
 * único que cambia es a dónde escribe. Las dos salidas no pueden separarse
 * porque son el mismo recorrido.
 */

import type { Alineacion } from "./plantilla";
import { ConstructorEscPos } from "./escpos";
import { LOGO_TERMICO } from "./logoTermico";
import type { PerfilImpresora } from "./perfil";
import { centrar, qrComoBitmap } from "./qrBitmap";

export interface SalidaDeTicket {
  /** Ancho útil en caracteres. Lo necesita el que parte los textos largos. */
  readonly columnas: number;

  alinear(donde: Alineacion): void;
  negrita(activa: boolean): void;
  tamano(ancho: 1 | 2 | 3, alto: 1 | 2 | 3): void;
  /** Vuelve a izquierda, tamaño 1, sin negrita. */
  normal(): void;

  linea(texto?: string): void;
  separador(caracter?: string): void;
  /** Etiqueta a la izquierda, valor pegado a la derecha. */
  dosColumnas(izquierda: string, derecha: string): void;
  avanzar(lineas?: number): void;

  logo(): Promise<void>;
  qr(contenido: string): Promise<void>;
  cortar(): void;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Salida real: los bytes que recibe la ticketera. */
export class SalidaEscPos implements SalidaDeTicket {
  private readonly b: ConstructorEscPos;

  constructor(private readonly perfil: PerfilImpresora) {
    this.b = new ConstructorEscPos(perfil);
    this.b.iniciar();
  }

  get columnas() {
    return this.perfil.columnas;
  }

  /**
   * Pulso de apertura del cajón de dinero. No va en `SalidaDeTicket` porque no
   * tiene sentido en la vista previa: el cajón es hardware, no contenido.
   */
  abrirCajon() {
    this.b.abrirCajon();
  }

  alinear(donde: Alineacion) {
    this.b.alinear(donde);
  }
  negrita(activa: boolean) {
    this.b.negrita(activa);
  }
  tamano(ancho: 1 | 2 | 3, alto: 1 | 2 | 3) {
    this.b.tamano(ancho, alto);
  }
  normal() {
    this.b.normal();
  }
  linea(texto = "") {
    this.b.linea(texto);
  }
  separador(caracter = "-") {
    this.b.separador(caracter);
  }
  dosColumnas(izquierda: string, derecha: string) {
    this.b.dosColumnas(izquierda, derecha);
  }
  avanzar(lineas = 1) {
    this.b.avanzar(lineas);
  }
  cortar() {
    this.b.cortar();
  }

  async logo(): Promise<void> {
    // Centrado rellenando el bitmap con blanco, no con `ESC a 1`: varias
    // impresoras ignoran la alineación para las imágenes y las pegan a la
    // izquierda.
    const centrado = centrar(LOGO_TERMICO, this.perfil.anchoPuntos);
    this.b.imagen(centrado.ancho, LOGO_TERMICO.alto, centrado.datos);
    this.b.normal();
  }

  async qr(contenido: string): Promise<void> {
    this.b.alinear("centro");
    if (this.perfil.qrPorFirmware) {
      this.b.qrFirmware(contenido);
    } else {
      // Camino lento pero seguro: funciona incluso en las impresoras que dicen
      // soportar GS(k y devuelven basura.
      const imagen = centrar(await qrComoBitmap(contenido), this.perfil.anchoPuntos);
      this.b.imagen(imagen.ancho, imagen.alto, imagen.datos);
    }
    this.b.normal();
  }

  bytes(): Buffer {
    return this.b.construir();
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Salida en texto: lo que se ve en pantalla antes de imprimir.
 *
 * El logo y el QR se representan con marcadores en vez de dibujarse. Es
 * deliberado: la vista previa sirve para revisar QUÉ DICE el ticket, y un QR
 * en ASCII-art no ayuda a nadie a verificar que el total está bien.
 */
export class SalidaTexto implements SalidaDeTicket {
  private lineas: string[] = [];
  private alineacion: Alineacion = "izq";
  private ancho = 1;

  constructor(readonly columnas: number) {}

  alinear(donde: Alineacion) {
    this.alineacion = donde;
  }
  negrita() {
    // El texto plano no tiene negrita. Marcarla con asteriscos ensuciaría la
    // vista previa sin aportar nada: lo que importa es el contenido.
  }
  tamano(ancho: 1 | 2 | 3) {
    this.ancho = ancho;
  }
  normal() {
    this.alineacion = "izq";
    this.ancho = 1;
  }

  linea(texto = "") {
    // En tamaño doble entra la mitad de texto: se centra sobre ese ancho
    // reducido para que la vista previa refleje la posición real en el papel.
    const util = Math.floor(this.columnas / this.ancho);
    this.lineas.push(this.posicionar(texto, util));
  }

  separador(caracter = "-") {
    this.lineas.push(caracter.repeat(this.columnas));
  }

  dosColumnas(izquierda: string, derecha: string) {
    const espacio = this.columnas - izquierda.length - derecha.length;
    if (espacio < 1) {
      this.lineas.push(izquierda);
      this.lineas.push(derecha.padStart(this.columnas));
      return;
    }
    this.lineas.push(izquierda + " ".repeat(espacio) + derecha);
  }

  avanzar(lineas = 1) {
    for (let i = 0; i < lineas; i++) this.lineas.push("");
  }

  async logo(): Promise<void> {
    this.lineas.push(this.posicionar("[ LOGO ]", this.columnas));
  }

  async qr(contenido: string): Promise<void> {
    // El QR siempre va centrado en el papel, así que la vista previa lo
    // muestra centrado aunque venga de un bloque sin alineación explícita.
    const previa = this.alineacion;
    this.alineacion = "centro";
    this.lineas.push(this.posicionar(`[ QR ] ${contenido}`, this.columnas));
    this.alineacion = previa;
  }

  cortar() {
    // El corte no se dibuja: en pantalla el ticket simplemente termina.
  }

  texto(): string {
    return this.lineas.join("\n");
  }

  private posicionar(texto: string, util: number): string {
    if (this.alineacion === "centro") {
      const sobra = Math.max(0, util - texto.length);
      return " ".repeat(Math.floor(sobra / 2)) + texto;
    }
    if (this.alineacion === "der") {
      return texto.padStart(util);
    }
    return texto;
  }
}
