/**
 * Codificación a CP850 para la ticketera.
 *
 * Las impresoras térmicas NO hablan UTF-8. Trabajan con páginas de códigos de
 * un byte, y si se les manda UTF-8 en crudo cada tilde sale como dos símbolos
 * raros. "CORTE DEGRADADO" no tiene problema, pero "Peña", "José" o "Ñuñoa" sí,
 * y el nombre del cliente va impreso en el ticket.
 *
 * CP850 (multilingüe latino) es la página que entiende prácticamente todo el
 * parque de impresoras ESC/POS y cubre el español completo. La emparenta
 * CP858, idéntica salvo que reemplaza el punto por el símbolo del euro — que
 * aquí no se usa.
 *
 * Lo que no está en la tabla se degrada a ASCII sin acentos antes que
 * imprimirse como basura: un "Jose" legible es mejor que un "JosÃ©".
 */

/** Unicode → byte CP850. Solo lo que aparece de verdad en un ticket peruano. */
const TABLA: Record<string, number> = {
  // Minúsculas acentuadas
  "á": 0xa0, "é": 0x82, "í": 0xa1, "ó": 0xa2, "ú": 0xa3,
  "à": 0x85, "è": 0x8a, "ì": 0x8d, "ò": 0x95, "ù": 0x97,
  "ä": 0x84, "ë": 0x89, "ï": 0x8b, "ö": 0x94, "ü": 0x81,
  "â": 0x83, "ê": 0x88, "î": 0x8c, "ô": 0x93, "û": 0x96,
  "ñ": 0xa4, "ç": 0x87,

  // Mayúsculas acentuadas
  "Á": 0xb5, "É": 0x90, "Í": 0xd6, "Ó": 0xe0, "Ú": 0xe9,
  "À": 0xb7, "È": 0xd4, "Ì": 0xde, "Ò": 0xe3, "Ù": 0xeb,
  "Ä": 0x8e, "Ë": 0xd3, "Ï": 0xd8, "Ö": 0x99, "Ü": 0x9a,
  "Â": 0xb6, "Ê": 0xd2, "Î": 0xd7, "Ô": 0xe2, "Û": 0xea,
  "Ñ": 0xa5, "Ç": 0x80,

  // Signos que sí se usan
  "¿": 0xa8, "¡": 0xad, "º": 0xa7, "ª": 0xa6, "°": 0xf8,
  "«": 0xae, "»": 0xaf, "·": 0xfa, "±": 0xf1, "¢": 0xbd, "£": 0x9c, "¥": 0xbe,

  // Tipografía que se cuela al copiar y pegar desde Word o el navegador.
  // Sin estas cinco, un nombre de negocio con comillas curvas imprime basura.
  "“": 0x22, "”": 0x22, "‘": 0x27, "’": 0x27, "–": 0x2d, "—": 0x2d, "…": 0x2e,
  " ": 0x20, // espacio duro

  // Líneas simples, para los separadores del ticket
  "─": 0xc4, "═": 0xcd,
};

/** Reemplazo ASCII cuando el carácter no existe en CP850. */
function degradar(c: string): string {
  return c
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?");
}

/**
 * Convierte un texto a bytes CP850.
 *
 * Nunca falla: lo que no se puede representar se degrada. Una impresora que
 * escupe un carácter raro es un problema estético; una que aborta el ticket a
 * mitad de camino deja al cajero sin comprobante.
 */
export function aCp850(texto: string): Buffer {
  const bytes: number[] = [];

  for (const c of texto) {
    const codigo = c.codePointAt(0)!;

    if (codigo >= 0x20 && codigo <= 0x7e) {
      bytes.push(codigo); // ASCII imprimible: pasa tal cual
      continue;
    }
    if (c === "\n") {
      bytes.push(0x0a);
      continue;
    }

    const mapeado = TABLA[c];
    if (mapeado !== undefined) {
      bytes.push(mapeado);
      continue;
    }

    for (const d of degradar(c)) {
      const cod = d.codePointAt(0)!;
      bytes.push(cod >= 0x20 && cod <= 0x7e ? cod : 0x3f);
    }
  }

  return Buffer.from(bytes);
}

/** El camino inverso, construido una sola vez a partir de la misma tabla. */
const TABLA_INVERSA: Record<number, string> = Object.fromEntries(
  Object.entries(TABLA).map(([caracter, byte]) => [byte, caracter]),
);

/**
 * Decodifica bytes CP850 a texto.
 *
 * No hace falta para imprimir —la comunicación con la ticketera es en una sola
 * dirección— pero sí para VERIFICAR: permite leer de vuelta un ticket ya
 * codificado y comprobar que dice exactamente lo que tenía que decir. Es lo
 * que prueba que "José Peña" sobrevive al viaje de ida.
 */
export function deCp850(bytes: Buffer): string {
  let salida = "";
  for (const byte of bytes) {
    if (byte >= 0x20 && byte <= 0x7e) salida += String.fromCharCode(byte);
    else if (byte === 0x0a) salida += "\n";
    else salida += TABLA_INVERSA[byte] ?? "?";
  }
  return salida;
}

/**
 * Largo en COLUMNAS DE IMPRESIÓN, que no es lo mismo que `texto.length`.
 *
 * Importa para alinear a la derecha: una "é" en JavaScript puede ser un solo
 * code point o dos (e + tilde combinante) según de dónde venga el texto, pero
 * en el papel siempre ocupa una columna. Contando mal, los importes de la
 * columna derecha quedan desalineados de a un carácter y la cuenta se vuelve
 * difícil de leer.
 */
export function anchoImpreso(texto: string): number {
  return [...texto.normalize("NFC")].length;
}
