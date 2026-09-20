/**
 * El reloj es un puerto y no `new Date()` suelto por el código, por dos
 * razones prácticas:
 *
 *  1. Los tests necesitan controlar el tiempo. Un test de "se cerró el turno a
 *     las 23:00" que dependa del reloj real es un test que falla de noche.
 *  2. El offset de zona horaria se decide en UN lugar. Lima es -05:00 todo el
 *     año (no hay horario de verano), pero escribirlo a mano en veinte lugares
 *     es cómo se termina con la mitad de los eventos en UTC.
 */

export interface Reloj {
  /** ISO 8601 con offset explícito: "2026-09-16T19:42:11.204-05:00". */
  ahora(): string;
  /** Milisegundos desde epoch. Para medir duraciones, no para guardar. */
  ms(): number;
}

/** Zona de Lima. Fija: Perú no cambia la hora en todo el año. */
const OFFSET_MINUTOS = -5 * 60;

function conOffset(fecha: Date, offsetMinutos: number): string {
  const local = new Date(fecha.getTime() + offsetMinutos * 60_000);
  const p = (n: number, largo = 2) => String(n).padStart(largo, "0");
  const signo = offsetMinutos >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutos);

  return (
    `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}` +
    `T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}` +
    `.${p(local.getUTCMilliseconds(), 3)}` +
    `${signo}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
}

export const relojDelSistema: Reloj = {
  ahora: () => conOffset(new Date(), OFFSET_MINUTOS),
  ms: () => Date.now(),
};

/**
 * Reloj de mentira para los tests. Arranca donde se le diga y solo avanza
 * cuando se le pide.
 */
export function relojFijo(inicioIso = "2026-09-16T10:00:00.000-05:00"): Reloj & {
  avanzar(ms: number): void;
  fijar(iso: string): void;
} {
  let t = new Date(inicioIso).getTime();
  return {
    ahora: () => conOffset(new Date(t), OFFSET_MINUTOS),
    ms: () => t,
    avanzar: (ms: number) => {
      t += ms;
    },
    fijar: (iso: string) => {
      t = new Date(iso).getTime();
    },
  };
}
