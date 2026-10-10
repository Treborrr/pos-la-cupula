/**
 * Las alertas que tienen que verse en CUALQUIER pantalla, no solo en
 * Ajustes → Diagnóstico.
 *
 * Antes, que el respaldo externo dejara de poder escribir, que la impresora
 * se desconectara o que el reloj de la PC se atrasara quedaba en un log que
 * nadie lee y en una pantalla que hay que acordarse de abrir. Esto es lo
 * mínimo que, si pasa, tiene que notarse SIN que alguien vaya a buscarlo.
 *
 * A propósito NO incluye la verificación completa de integridad del log
 * (`AlmacenDeEventos.verificar()`): esa recorre el archivo entero desde el
 * génesis, y esto se consulta cada pocos segundos desde cualquier pantalla.
 * Multiplicar ese costo por "siempre" para una falla que casi nunca ocurre
 * —alguien editando el log a mano— no vale la pena; esa sigue viviendo en
 * Diagnóstico, que se revisa a demanda.
 */

export interface Alerta {
  codigo: string;
  mensaje: string;
}

export function calcularAlertas(datos: {
  relojAtrasado: { ultimoEvento: string; alAbrir: string } | null;
  lineasEnCuarentena: number;
  respaldos: { ok: boolean; detalle: string } | null;
  impresoraConfigurada: boolean;
  impresora: { disponible: boolean; detalle?: string };
}): Alerta[] {
  const alertas: Alerta[] = [];

  if (datos.relojAtrasado) {
    alertas.push({
      codigo: "RELOJ_ATRASADO",
      mensaje:
        `La hora de esta computadora parece atrasada: el último registro guardado es de ` +
        `${legible(datos.relojAtrasado.ultimoEvento)} y ahora la PC dice ${legible(datos.relojAtrasado.alAbrir)}. ` +
        `Corrígela antes de seguir vendiendo — si no, todo lo nuevo queda fechado mal.`,
    });
  }

  if (datos.lineasEnCuarentena > 0) {
    alertas.push({
      codigo: "LINEAS_EN_CUARENTENA",
      mensaje:
        `Se apartaron ${datos.lineasEnCuarentena} línea(s) ilegibles al arrancar, casi siempre por un corte ` +
        `de luz a mitad de una venta. Revisa Ajustes → Diagnóstico.`,
    });
  }

  // `respaldos === null` significa que todavía no se hizo ninguna verificación
  // real (recién arrancó el servidor): no hay nada que avisar aún, no es lo
  // mismo que "falló".
  if (datos.respaldos && !datos.respaldos.ok) {
    alertas.push({ codigo: "RESPALDO_SIN_DESTINO", mensaje: datos.respaldos.detalle });
  }

  // Si nunca se configuró una impresora (modo "vistaPrevia", el default),
  // `disponible: false` es el estado NORMAL antes de la puesta a punto, no una
  // falla — avisar acá entrenaría a ignorar la alerta.
  if (datos.impresoraConfigurada && !datos.impresora.disponible) {
    alertas.push({
      codigo: "IMPRESORA_CON_ERROR",
      mensaje: datos.impresora.detalle ?? "La ticketera configurada no está respondiendo.",
    });
  }

  return alertas;
}

/** "2026-09-16T19:42" → "16/09 19:42". */
function legible(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}
