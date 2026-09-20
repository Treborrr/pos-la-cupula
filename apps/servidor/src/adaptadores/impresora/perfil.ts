/**
 * Perfil de impresora: TODO lo que cambia entre un modelo y otro, en un solo
 * objeto y guardado en configuración.
 *
 * Es la pieza que permitió construir la impresión completa sin tener todavía
 * la ticketera: el renderizador se escribió contra el perfil genérico ESC/POS
 * de 80 mm, que cubre a la enorme mayoría del parque en Perú. Cuando sepamos
 * marca y modelo, lo único a hacer es confirmar o ajustar estos valores —
 * ninguna línea de lógica cambia.
 *
 * Cómo averiguar el modelo: voltear el equipo y leer la etiqueta. En Windows
 * también sale en Panel de control → Dispositivos e impresoras.
 */

export interface PerfilImpresora {
  nombre: string;

  /**
   * Ancho IMPRIMIBLE en puntos, que no es el ancho del papel.
   * 80 mm de papel → 72 mm imprimibles → 576 puntos a 203 dpi (8 puntos/mm).
   * 58 mm de papel → 48 mm imprimibles → 384 puntos.
   */
  anchoPuntos: number;

  /** Caracteres por línea con la fuente A. 576 puntos / 12 px = 48… pero casi
   *  todas las impresoras usan 42 en la práctica por el espaciado. */
  columnas: number;

  /**
   * Número de página de códigos para `ESC t n`. 2 = CP850 en la mayoría de los
   * modelos compatibles con Epson. Si salen símbolos raros donde van las
   * tildes, este es el valor a tocar primero.
   */
  paginaDeCodigos: number;

  /**
   * ¿La impresora sabe hacer QR por firmware (`GS ( k`)?
   *
   * En `false` el QR se manda como imagen bitmap: más lento y más bytes, pero
   * funciona SIEMPRE. Varias genéricas chinas anuncian soportar `GS ( k` y
   * devuelven basura, así que ante la duda conviene arrancar en `false`,
   * verificar, y recién después activarlo.
   */
  qrPorFirmware: boolean;

  /** Tamaño del módulo del QR impreso por firmware, 1–16. */
  qrTamano: number;

  corte: "parcial" | "total" | "ninguno";

  /** Líneas en blanco antes de cortar, para que el papel salga del cabezal. */
  lineasAlFinal: number;

  /** ¿Hay cajón de dinero conectado al puerto RJ11 de la impresora? */
  cajonDeDinero: boolean;
}

/**
 * El perfil por defecto. Genérico ESC/POS de 80 mm — lo que hablan Epson,
 * Xprinter, 3nStar, POS-80 y compañía.
 *
 * `qrPorFirmware` arranca en `false` a propósito: el fallback en bitmap
 * funciona en el 100% de los casos, así que la primera impresión sale bien
 * aunque el modelo sea una genérica caprichosa. Activarlo después es un clic
 * y se gana velocidad.
 */
export const PERFIL_GENERICO_80: PerfilImpresora = {
  nombre: "Genérica ESC/POS 80 mm",
  anchoPuntos: 576,
  columnas: 42,
  paginaDeCodigos: 2,
  qrPorFirmware: false,
  qrTamano: 6,
  corte: "parcial",
  lineasAlFinal: 4,
  cajonDeDinero: false,
};

/** Para las de 58 mm, que también se ven en negocios chicos. */
export const PERFIL_GENERICO_58: PerfilImpresora = {
  ...PERFIL_GENERICO_80,
  nombre: "Genérica ESC/POS 58 mm",
  anchoPuntos: 384,
  columnas: 32,
};

/**
 * Epson TM-T20 / TM-T88 y compatibles reales. El QR por firmware aquí sí es de
 * fiar, y es notablemente más rápido que mandarlo como imagen.
 */
export const PERFIL_EPSON_80: PerfilImpresora = {
  ...PERFIL_GENERICO_80,
  nombre: "Epson TM-T20 / TM-T88 (80 mm)",
  qrPorFirmware: true,
};

/**
 * La ticketera que compró la barbería: Advance ADV-8010N, térmica de 80 mm,
 * ESC/POS, con USB y LAN.
 *
 * Solo se aparta de la genérica en las columnas: son 48 y no 42. La forma de
 * confirmarlo en el papel es la fila de números del ticket de prueba — si
 * entra en una sola línea, el perfil es el correcto.
 */
export const PERFIL_ADVANCE_80: PerfilImpresora = {
  ...PERFIL_GENERICO_80,
  nombre: "Advance ADV-8010N (80 mm)",
  columnas: 48,
};

/** La misma máquina cargada con papel de 58 mm. */
export const PERFIL_ADVANCE_58: PerfilImpresora = {
  ...PERFIL_ADVANCE_80,
  nombre: "Advance ADV-8010N con papel de 58 mm",
  anchoPuntos: 384,
  columnas: 32,
};

// El orden importa: es el que ve el usuario en la lista de Ajustes, y la
// ticketera real va primero.
export const PERFILES = {
  advance80: PERFIL_ADVANCE_80,
  advance58: PERFIL_ADVANCE_58,
  generico80: PERFIL_GENERICO_80,
  generico58: PERFIL_GENERICO_58,
  epson80: PERFIL_EPSON_80,
} as const;

export type NombrePerfil = keyof typeof PERFILES;

export function perfilPorNombre(nombre: string | undefined): PerfilImpresora {
  return PERFILES[(nombre ?? "advance80") as NombrePerfil] ?? PERFIL_ADVANCE_80;
}
