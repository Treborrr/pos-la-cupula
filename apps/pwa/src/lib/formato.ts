/**
 * Formateo para pantalla. La lógica de dinero vive en @cupula/contratos y es
 * la misma que usa el servidor: aquí solo se decide cómo se ve.
 */

import { aTextoConSimbolo } from "@cupula/contratos";

export { aCentimos, aTexto, aTextoConSimbolo, aTextoLargo } from "@cupula/contratos";

/** "2026-09-16T19:42:11.204-05:00" → "19:42" */
export function hora(iso: string): string {
  return iso.slice(11, 16);
}

/** "2026-09-16T…" → "16/09/2026" */
export function fecha(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function fechaYHora(iso: string): string {
  return `${fecha(iso)} ${hora(iso)}`;
}

/** Hoy en Lima, como "2026-09-16". Es la clave de los índices por día. */
export function hoy(): string {
  const ahora = new Date();
  const lima = new Date(ahora.getTime() - 5 * 60 * 60 * 1000);
  return lima.toISOString().slice(0, 10);
}

export function diasAtras(dias: number): string {
  const ahora = new Date();
  const lima = new Date(ahora.getTime() - 5 * 60 * 60 * 1000 - dias * 86_400_000);
  return lima.toISOString().slice(0, 10);
}

/** "hace 3 días", "ayer", "hoy". Para el historial de un cliente. */
export function cuandoFue(iso?: string): string {
  if (!iso) return "nunca vino";
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} días`;
  if (dias < 60) return "hace un mes";
  if (dias < 365) return `hace ${Math.floor(dias / 30)} meses`;
  return `hace más de un año`;
}

/** Cantidades: 1 y no "1.000", pero 1.5 sí se muestra. */
export function cantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

/**
 * Un monto que puede no existir.
 *
 * Existe para que las cinco pantallas que muestran precios digan LO MISMO
 * cuando el dato falta. Un "S/ 0.00" ahí sería mentira —el producto no es
 * gratis, es que nadie le puso precio todavía— y es la clase de mentira que
 * termina en un cobro equivocado.
 */
export function montoOAusente(centimos: number | null | undefined, ausente = "—"): string {
  return centimos === null || centimos === undefined ? ausente : aTextoConSimbolo(centimos);
}

/**
 * Un porcentaje de variación con su signo: "↑ 12.5%", "↓ 3%", "—".
 *
 * `null` se muestra como raya y no como "0%": no hubo período anterior contra
 * el cual comparar, y un 0% afirmaría que se vendió igual.
 */
export function variacionLegible(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (v === 0) return "igual";
  return `${v > 0 ? "↑" : "↓"} ${Math.abs(v)}%`;
}

/** El porcentaje de margen, o una raya si no se pudo calcular. */
export function margenLegible(margen: number | null | undefined): string {
  return margen === null || margen === undefined ? "—" : `${margen}%`;
}
