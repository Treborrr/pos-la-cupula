/**
 * La plantilla del ticket es DATOS, no código.
 *
 * Es un arreglo de bloques guardado en configuración. Reordenar el ticket,
 * agregar una línea de texto, sacar el QR o cambiar el pie no requiere
 * recompilar ni desplegar nada: se edita la configuración y el siguiente
 * ticket sale distinto.
 *
 * Esto importa especialmente ahora, porque el contenido definitivo del ticket
 * todavía no está decidido. La plantilla por defecto replica lo que ya
 * imprimía el Excel —para que el cambio de sistema no sorprenda a nadie— y
 * corrige sus dos defectos: la descripción truncada a 18 caracteres y la falta
 * de detalle de los pagos.
 */

export type Alineacion = "izq" | "centro" | "der";

export type BloqueTicket =
  /** El emblema en 1 bit. Si no hay logo configurado, se saltea. */
  | { tipo: "logo" }
  /** Texto con marcadores: "{negocio.nombre}", "{venta.correlativo}", … */
  | { tipo: "texto"; contenido: string; alinear?: Alineacion; negrita?: boolean; tamano?: 1 | 2 | 3 }
  | { tipo: "separador"; caracter?: string }
  /** Las líneas de la venta: cantidad, descripción, importe. */
  | { tipo: "lineas"; mostrarBarbero?: boolean }
  /** Subtotal, descuento y TOTAL. */
  | { tipo: "totales" }
  /** Desglose de pagos, con recibido y vuelto en efectivo. */
  | { tipo: "pagos" }
  | { tipo: "qr"; contenido?: string }
  | { tipo: "espacio"; lineas?: number }
  | { tipo: "corte" }
  /** Bloques que solo se imprimen si se cumple la condición. */
  | { tipo: "si"; condicion: "anulada" | "copia" | "cliente" | "barbero" | "descuento"; bloques: BloqueTicket[] };

/**
 * Plantilla por defecto.
 *
 * Sigue el orden del ticket que ya conocen en la barbería: emblema, datos del
 * negocio, número de nota, fecha, medio de pago, detalle, total y el saludo.
 * Lo nuevo es el QR del final, que escaneado con la pistola abre esa venta en
 * el POS.
 */
export const PLANTILLA_POR_DEFECTO: BloqueTicket[] = [
  { tipo: "logo" },
  { tipo: "espacio", lineas: 1 },

  { tipo: "texto", contenido: "{negocio.nombre}", alinear: "centro", negrita: true },
  { tipo: "texto", contenido: "{negocio.direccion}", alinear: "centro" },
  { tipo: "texto", contenido: "{negocio.ciudad}", alinear: "centro" },
  { tipo: "texto", contenido: "RUC {negocio.ruc}", alinear: "centro" },
  { tipo: "espacio", lineas: 1 },

  // El número de nota va en tamaño doble: es el dato que alguien busca cuando
  // vuelve con el ticket en la mano.
  { tipo: "texto", contenido: "{venta.correlativo}", alinear: "centro", negrita: true, tamano: 2 },
  { tipo: "texto", contenido: "{venta.fecha}  {venta.hora}", alinear: "centro" },

  {
    tipo: "si",
    condicion: "copia",
    bloques: [{ tipo: "texto", contenido: "*** COPIA ***", alinear: "centro", negrita: true }],
  },
  {
    tipo: "si",
    condicion: "anulada",
    bloques: [
      { tipo: "texto", contenido: "*** ANULADA ***", alinear: "centro", negrita: true, tamano: 2 },
      { tipo: "texto", contenido: "{venta.motivoAnulacion}", alinear: "centro" },
    ],
  },
  {
    tipo: "si",
    condicion: "cliente",
    bloques: [{ tipo: "texto", contenido: "Cliente: {cliente.nombre}", alinear: "centro" }],
  },

  // Quién atendió, UNA vez y arriba. Antes salía repetido bajo cada servicio,
  // porque cada línea podía llevar un barbero distinto; desde que la venta
  // tiene uno solo, eso era la misma línea dos o tres veces en el papel.
  {
    tipo: "si",
    condicion: "barbero",
    bloques: [{ tipo: "texto", contenido: "Atendió: {venta.barbero}", alinear: "centro" }],
  },

  { tipo: "separador", caracter: "=" },
  { tipo: "lineas", mostrarBarbero: true },
  { tipo: "separador" },
  { tipo: "totales" },
  { tipo: "pagos" },

  { tipo: "espacio", lineas: 1 },
  { tipo: "texto", contenido: "{negocio.pie}", alinear: "centro", negrita: true },
  { tipo: "espacio", lineas: 1 },

  { tipo: "qr" },
  { tipo: "texto", contenido: "{venta.correlativo}", alinear: "centro" },

  { tipo: "corte" },
];

/**
 * Reemplaza los marcadores `{...}` de un texto.
 *
 * Un marcador desconocido se deja tal cual, a la vista: si alguien escribe
 * `{negocio.telefono}` y no existe, tiene que darse cuenta en el primer ticket
 * de prueba, no quedarse con un hueco silencioso.
 */
export function reemplazar(texto: string, valores: Record<string, string>): string {
  return texto.replace(/\{([a-zA-Z0-9_.]+)\}/g, (completo, clave) => valores[clave] ?? completo);
}

/**
 * ¿Esta línea quedó siendo una etiqueta sin dato?
 *
 * `"RUC {negocio.ruc}"` con el RUC sin cargar imprime `"RUC"` a secas: una
 * palabra suelta en el encabezado del ticket que no dice nada y que parece un
 * error del sistema. Lo mismo con cualquier línea que sea una etiqueta más un
 * marcador.
 *
 * La regla: si la línea TIENE marcadores y TODOS quedaron vacíos, no se
 * imprime. Una línea sin marcadores —el saludo del pie, un separador— se
 * imprime siempre, porque ahí el texto literal ES el contenido.
 */
export function soloEtiquetaSinDato(texto: string, valores: Record<string, string>): boolean {
  const marcadores = [...texto.matchAll(/\{([a-zA-Z0-9_.]+)\}/g)];
  if (marcadores.length === 0) return false;
  return marcadores.every((m) => (valores[m[1]] ?? "").trim() === "");
}
