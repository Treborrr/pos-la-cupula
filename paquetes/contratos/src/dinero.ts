/**
 * Dinero — siempre céntimos enteros, nunca decimales.
 *
 * `0.1 + 0.2 !== 0.3` en punto flotante. En un sistema que maneja dinero eso es
 * un céntimo de diferencia que aparece meses después como un arqueo
 * descuadrado que nadie puede explicar. Todo monto que cruce el dominio, el
 * log de eventos o la red va en céntimos: S/ 25.00 es `2500`.
 *
 * La conversión a texto ocurre SOLO al mostrar o al imprimir.
 */

/** Monto en céntimos de sol. Entero, puede ser negativo (vueltos, diferencias). */
export type Centimos = number;

export const SIMBOLO = "S/";

/**
 * Convierte lo que escribió una persona ("25", "25.5", "25,50", "S/ 25.50") a
 * céntimos. Devuelve null si no es un monto legible — el que llama decide qué
 * hacer con eso, aquí no se adivina.
 */
export function aCentimos(entrada: string | number): Centimos | null {
  if (typeof entrada === "number") {
    if (!Number.isFinite(entrada)) return null;
    // Math.round y no trunc: 25.555 * 100 = 2555.4999… en flotante.
    return Math.round(entrada * 100);
  }

  const limpio = entrada
    .replace(/\s/g, "")
    .replace(/^S\/\.?/i, "")
    .replace(",", ".");

  if (!/^-?\d*\.?\d*$/.test(limpio) || limpio === "" || limpio === "." || limpio === "-") {
    return null;
  }

  const n = Number(limpio);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** 2500 → "25.00". Sin símbolo: el símbolo lo pone quien maqueta. */
export function aTexto(c: Centimos): string {
  const negativo = c < 0;
  const abs = Math.abs(c);
  const soles = Math.floor(abs / 100);
  const cent = abs % 100;
  return `${negativo ? "-" : ""}${soles}.${String(cent).padStart(2, "0")}`;
}

/** 2500 → "S/ 25.00". Para pantalla. */
export function aTextoConSimbolo(c: Centimos): string {
  return `${SIMBOLO} ${aTexto(c)}`;
}

/**
 * 2500 → "S/ 25.00" con separador de miles. Para reportes y totales grandes,
 * donde "S/ 1234550.00" es ilegible.
 */
export function aTextoLargo(c: Centimos): string {
  const negativo = c < 0;
  const abs = Math.abs(c);
  const soles = Math.floor(abs / 100);
  const cent = abs % 100;
  const conMiles = String(soles).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negativo ? "-" : ""}${SIMBOLO} ${conMiles}.${String(cent).padStart(2, "0")}`;
}

/**
 * Multiplica un precio por una cantidad que puede ser fraccionaria (media hora
 * de tatuaje, 1.5 de algo). Redondea al céntimo con el criterio de siempre:
 * medio céntimo hacia arriba, que es lo que espera cualquiera que revise la
 * cuenta a mano.
 */
export function multiplicar(precio: Centimos, cantidad: number): Centimos {
  return Math.round(precio * cantidad);
}

export function sumar(...montos: Centimos[]): Centimos {
  return montos.reduce((a, b) => a + b, 0);
}
