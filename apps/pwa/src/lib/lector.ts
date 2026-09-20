/**
 * Comunicación con el lector de tickets, que vive en el menú y está disponible
 * desde cualquier pantalla.
 *
 * Es un evento del navegador y no estado compartido porque lo disparan cosas
 * muy distintas (un botón, la pistola en Cobrar, el historial de un cliente) y
 * ninguna necesita saber nada más del lector.
 */

const EVENTO = "pos:leer-ticket";

let abierto = false;

export function marcarLectorAbierto(valor: boolean) {
  abierto = valor;
}

/** Mientras el lector está abierto, la pistola y los atajos de Cobrar se callan. */
export function lectorAbierto(): boolean {
  return abierto;
}

/** Abre el lector; con un correlativo, abre directamente esa venta. */
export function abrirLector(correlativo?: string) {
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: correlativo ?? null }));
}

export function escucharLector(fn: (correlativo: string | null) => void): () => void {
  const manejar = (e: Event) => fn((e as CustomEvent<string | null>).detail);
  window.addEventListener(EVENTO, manejar);
  return () => window.removeEventListener(EVENTO, manejar);
}

/**
 * Extrae el número de venta de lo que haya llegado.
 *
 * El QR dice "CUP1|V|NV000030", pero si la pistola y la PC tienen distinta
 * distribución de teclado el separador llega cambiado. También se acepta el
 * número tecleado a mano: "NV000030", "nv30" o solo "30".
 */
export function correlativoDe(texto: string): string | null {
  const m = /NV\s*0*(\d{1,6})/i.exec(texto) ?? /^\s*(\d{1,6})\s*$/.exec(texto);
  return m ? `NV${m[1].padStart(6, "0")}` : null;
}

/** ¿Es el QR de un ticket (y no un código de producto o una tarjeta)? */
export function esQrDeTicket(texto: string): string | null {
  const m = /^CUP1.{1,3}V.{1,3}(NV\d{6})$/i.exec(texto.trim());
  return m ? m[1].toUpperCase() : null;
}
