/**
 * Impresora de mentira: arma el ticket completo pero no lo manda a ningún
 * lado.
 *
 * Es la que corre mientras no haya una ticketera configurada. No es un
 * apaño: el ticket que genera sale de la MISMA plantilla y el MISMO recorrido
 * que la impresión real, así que sirve para trabajar el contenido del ticket
 * sin tener la impresora enchufada y sin gastar papel.
 */

import type {
  DatosDelCierre,
  DatosDelNegocio,
  EstadoImpresora,
  Impresora,
  OpcionesDeImpresion,
  ResultadoImpresion,
} from "../../puertos/Impresora";
import type { Venta } from "../../proyecciones/tipos";
import { PERFIL_GENERICO_80, type PerfilImpresora } from "./perfil";
import { renderCierreTexto } from "./renderCierre";
import { renderTicketTexto } from "./renderTicket";
import type { BloqueTicket } from "./plantilla";

export class ImpresoraVistaPrevia implements Impresora {
  constructor(
    private readonly perfil: PerfilImpresora = PERFIL_GENERICO_80,
    private readonly plantilla?: BloqueTicket[],
  ) {}

  async estado(): Promise<EstadoImpresora> {
    return {
      disponible: false,
      descripcion: "Vista previa (sin impresora configurada)",
      detalle:
        "Todavía no se configuró la ticketera. El ticket se genera y se puede ver en pantalla, " +
        "pero no sale en papel. Configúrala en Ajustes → Ticketera.",
    };
  }

  async imprimirVenta(
    venta: Venta,
    negocio: DatosDelNegocio,
    extra: OpcionesDeImpresion = {},
  ): Promise<ResultadoImpresion> {
    return {
      impreso: false,
      sinImpresora: true,
      motivo: "No hay ticketera configurada todavía.",
      vistaPrevia: await renderTicketTexto(
        venta,
        negocio,
        { perfil: this.perfil, plantilla: this.plantilla },
        extra,
      ),
    };
  }

  async imprimirCierre(cierre: DatosDelCierre, negocio: DatosDelNegocio): Promise<ResultadoImpresion> {
    return {
      impreso: false,
      sinImpresora: true,
      motivo: "No hay ticketera configurada todavía.",
      vistaPrevia: renderCierreTexto(cierre, negocio, this.perfil),
    };
  }
}
