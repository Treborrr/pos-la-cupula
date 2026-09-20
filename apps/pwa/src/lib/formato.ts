/**
 * Formateo para pantalla. La lógica de dinero vive en @cupula/contratos y es
 * la misma que usa el servidor: aquí solo se decide cómo se ve.
 */

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
