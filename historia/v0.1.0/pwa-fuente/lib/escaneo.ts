/**
 * Detección de la pistola QR (keyboard-wedge).
 *
 * La Motorola se comporta como un teclado: "escribe" lo que leyó y termina con
 * Enter. Simple de conectar, traicionero de programar bien, por tres razones:
 *
 * 1. EL FOCO. El cajero puede tener el cursor en el campo de cantidad cuando
 *    dispara. Sin interceptar, el ticket termina con una cantidad de
 *    "CUP1|V|NV000030".
 *
 * 2. DISTINGUIR PERSONA DE PISTOLA. Una persona escribe a 80-300 ms por tecla;
 *    la pistola, a menos de 30. Ese hueco es enorme y la medición es confiable.
 *    Pero hay que hacerla bien: si se toma por escaneo lo que escribió una
 *    persona, se le roban las teclas mientras tipea.
 *
 * 3. EL LAYOUT. La pistola emula un teclado; si está en US y la PC en español,
 *    los acentos llegan mal. Como el QR de la tarjeta de fidelidad de La
 *    Cúpula lleva NOMBRES, eso importa. El cotejo se hace normalizado en el
 *    servidor, pero conviene verificarlo en sitio: escanear un nombre con
 *    tilde y mirar qué llega.
 */

import { useEffect, useRef } from "react";

/** Más lento que esto entre teclas y es una persona, no la pistola. */
const MS_ENTRE_TECLAS = 35;
/** Menos caracteres que esto y no vale la pena arriesgarse a interceptar. */
const LARGO_MINIMO = 4;
/** Si pasa esto sin un Enter, lo acumulado se descarta. */
const MS_HASTA_OLVIDAR = 600;

export interface OpcionesDeEscaneo {
  /** Se llama con lo leído, ya completo. */
  alEscanear: (valor: string) => void;
  activo?: boolean;
}

export function useEscaner({ alEscanear, activo = true }: OpcionesDeEscaneo): void {
  // En una ref y no en estado: esto cambia en cada tecla y no tiene por qué
  // provocar un repintado.
  const buffer = useRef("");
  const ultimaTecla = useRef(0);
  const intervalos = useRef<number[]>([]);
  const alEscanearRef = useRef(alEscanear);
  alEscanearRef.current = alEscanear;

  useEffect(() => {
    if (!activo) return;

    function reiniciar() {
      buffer.current = "";
      intervalos.current = [];
    }

    function manejar(evento: KeyboardEvent) {
      // Un atajo del sistema o de la aplicación nunca es un escaneo.
      if (evento.ctrlKey || evento.altKey || evento.metaKey) return reiniciar();

      const ahora = performance.now();
      const desdeLaUltima = ahora - ultimaTecla.current;
      ultimaTecla.current = ahora;

      if (desdeLaUltima > MS_HASTA_OLVIDAR) reiniciar();

      if (evento.key === "Enter") {
        const leido = buffer.current;
        const muestras = intervalos.current;
        reiniciar();

        if (leido.length < LARGO_MINIMO || muestras.length === 0) return;

        // El promedio solo no alcanza: una persona que teclea rápido y hace
        // una pausa larga puede promediar bajo. Se exige además que NINGUNA
        // tecla haya llegado con una demora humana.
        const promedio = muestras.reduce((a, b) => a + b, 0) / muestras.length;
        const maximo = Math.max(...muestras);
        const esPistola = promedio < MS_ENTRE_TECLAS && maximo < MS_ENTRE_TECLAS * 3;
        if (!esPistola) return;

        // Recién aquí se le quita el Enter a quien tuviera el foco: si no fuera
        // un escaneo, el formulario tiene que poder enviarse con normalidad.
        evento.preventDefault();
        evento.stopPropagation();
        limpiarDelCampoEnfocado(leido);
        alEscanearRef.current(leido);
        return;
      }

      // Solo caracteres imprimibles. Shift, flechas y demás no son contenido
      // pero tampoco cortan el escaneo.
      if (evento.key.length !== 1) return;

      if (buffer.current !== "") intervalos.current.push(desdeLaUltima);
      buffer.current += evento.key;
    }

    // En fase de captura: hay que ver la tecla ANTES que el input que tenga el
    // foco, para poder decidir si es un escaneo.
    window.addEventListener("keydown", manejar, true);
    return () => window.removeEventListener("keydown", manejar, true);
  }, [activo]);
}

/**
 * Si el escaneo se coló en un campo de texto que tenía el foco, hay que
 * sacarlo: interceptar el Enter llega tarde para los caracteres anteriores,
 * que ya fueron escritos por el navegador.
 */
function limpiarDelCampoEnfocado(leido: string): void {
  const activo = document.activeElement;
  if (!(activo instanceof HTMLInputElement) && !(activo instanceof HTMLTextAreaElement)) return;

  if (activo.value.endsWith(leido)) {
    const limpio = activo.value.slice(0, -leido.length);
    // Se usa el setter nativo para que React se entere del cambio: asignar
    // .value directamente no dispara su sistema de eventos sintéticos y el
    // estado del componente quedaría desincronizado de lo que se ve.
    const prototipo =
      activo instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototipo, "value")?.set;
    setter?.call(activo, limpio);
    activo.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/**
 * Atajos de teclado del mostrador. Un cajero con práctica no debería tener que
 * tocar el mouse para cobrar.
 */
export function useAtajos(mapa: Record<string, () => void>, activo = true): void {
  const mapaRef = useRef(mapa);
  mapaRef.current = mapa;

  useEffect(() => {
    if (!activo) return;

    function manejar(evento: KeyboardEvent) {
      const accion = mapaRef.current[evento.key];
      if (!accion) return;

      // Escape funciona siempre; el resto de atajos no roba teclas mientras
      // alguien escribe en un campo.
      const escribiendo =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;
      if (escribiendo && evento.key !== "Escape" && !evento.key.startsWith("F")) return;

      evento.preventDefault();
      accion();
    }

    window.addEventListener("keydown", manejar);
    return () => window.removeEventListener("keydown", manejar);
  }, [activo]);
}
