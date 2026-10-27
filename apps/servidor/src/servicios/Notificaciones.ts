/**
 * Orquesta los tres destinos de correo del sistema: alertas técnicas y
 * reporte de cierre al dueño, recibo de venta al cliente, y un canal aparte
 * para lo que algún día tenga que resolver el propio desarrollador.
 *
 * Dos reglas de diseño que valen más que el código:
 *
 *  1. **Nada se manda sin quedar escrito.** Cada intento —salga bien o mal—
 *     se registra como `correo.enviado`. Es lo que permite que el tope
 *     diario, el "esta alerta ya se avisó hoy" y la recuperación tras un
 *     reinicio sobrevivan sin vivir solo en memoria.
 *  2. **Las alertas técnicas se acumulan, no se mandan una por una.** Un
 *     chequeo periódico (`tick`) las junta en una ventana y las manda juntas,
 *     para que un día ruidoso de alertas sueltas no se coma el cupo diario.
 */

import type { ServicioPos } from "./Pos";
import type { Reloj } from "../puertos/Reloj";
import type { EnviadorDeCorreo } from "../puertos/EnviadorDeCorreo";
import type { Alerta } from "../consultas/alertas";
import { construirReporte } from "../consultas/reportes";
import {
  plantillaAlertasTecnicas,
  plantillaCodigoDeVerificacion,
  plantillaReporteDelDia,
  type TurnoCerradoDelDia,
} from "../adaptadores/correo/plantillasInternas";
import { construirReciboHtml, type OpcionesDelRecibo } from "../adaptadores/correo/reciboHtml";
import type { DatosDelNegocio } from "../puertos/Impresora";
import type { Venta, ResumenCorreosDelDia } from "../proyecciones/tipos";

/** Cuánto se espera, desde la primera alerta nueva, antes de mandar el lote. */
const VENTANA_ALERTAS_MS = 20 * 60 * 1000;

/**
 * Cuánto se espera, desde cada cierre de turno, antes de mandar el reporte
 * del día. Cada cierre nuevo reprograma esta espera — es lo que hace que,
 * si cierran caja dos veces el mismo día, solo salga un correo, el del
 * último cierre.
 */
const VENTANA_REPORTE_MS = 60 * 60 * 1000;

const RESUMEN_VACIO = (): ResumenCorreosDelDia => ({
  usadosTotal: 0,
  usadosAlertas: 0,
  codigosAlertaNotificados: new Set<string>(),
  reporteDiaEnviado: false,
});

export class ServicioDeNotificaciones {
  /** Códigos de alerta nuevos de esta ventana, pendientes de mandar juntos. */
  private readonly pendientes = new Map<string, Alerta>();
  private vencimientoLote: number | null = null;
  private proximoReporte: number | null = null;

  constructor(
    private readonly pos: ServicioPos,
    private readonly reloj: Reloj,
    private readonly enviador: EnviadorDeCorreo,
    /** Lee las alertas técnicas activas en este momento (ver `alertasActivas`). */
    private readonly obtenerAlertas: () => Promise<Alerta[]>,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Contador y tope
  // ───────────────────────────────────────────────────────────────────────────

  private hoy(): string {
    return this.reloj.ahora().slice(0, 10);
  }

  private resumenDeHoy(): ResumenCorreosDelDia {
    return this.pos.p.correosPorDia.get(this.hoy()) ?? RESUMEN_VACIO();
  }

  contadorDeHoy(): { usadosHoy: number; topeTotal: number; usadosAlertas: number; topeAlertas: number } {
    const r = this.resumenDeHoy();
    return {
      usadosHoy: r.usadosTotal,
      topeTotal: this.pos.config<number>("notificaciones.topeTotalDiario"),
      usadosAlertas: r.usadosAlertas,
      topeAlertas: this.pos.config<number>("notificaciones.topeAlertasDiario"),
    };
  }

  private async registrar(
    categoria: "alerta_tecnica" | "alerta_dev" | "reporte_dia" | "recibo_venta" | "verificacion_cuenta",
    destinatarios: string[],
    asunto: string,
    resultado: { ok: boolean; detalle?: string },
    extra?: { codigosAlerta?: string[]; ventaId?: string },
  ): Promise<void> {
    await this.pos.escribir(() => [
      {
        tipo: "correo.enviado",
        datos: { categoria, destinatarios, asunto, ok: resultado.ok, detalle: resultado.detalle, ...extra },
      },
    ]);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Chequeo periódico: alertas acumuladas + reporte pendiente
  // ───────────────────────────────────────────────────────────────────────────

  async tick(): Promise<void> {
    await this.revisarAlertas();
    await this.revisarReportePendiente();
  }

  private async revisarAlertas(): Promise<void> {
    const correoDueno = this.pos.config<string>("negocio.correoDueno");
    if (!correoDueno) return;

    const activas = await this.obtenerAlertas();
    const yaAvisadas = this.resumenDeHoy().codigosAlertaNotificados;
    for (const a of activas) {
      if (!yaAvisadas.has(a.codigo)) this.pendientes.set(a.codigo, a);
    }

    if (this.pendientes.size === 0) return;

    if (this.vencimientoLote === null) {
      this.vencimientoLote = this.reloj.ms() + VENTANA_ALERTAS_MS;
      return;
    }
    if (this.reloj.ms() < this.vencimientoLote) return;

    const lote = [...this.pendientes.values()];
    this.pendientes.clear();
    this.vencimientoLote = null;

    const { usadosAlertas, topeAlertas } = this.contadorDeHoy();
    if (usadosAlertas >= topeAlertas) {
      await this.registrar(
        "alerta_tecnica",
        [correoDueno],
        "(tope de alertas alcanzado)",
        { ok: false, detalle: `Se alcanzó el tope de ${topeAlertas} alertas/día. No se mandó.` },
        { codigosAlerta: lote.map((a) => a.codigo) },
      );
      return;
    }

    const { asunto, html } = plantillaAlertasTecnicas(lote);
    const resultado = await this.enviador.enviar({ to: [correoDueno], subject: asunto, html });
    await this.registrar("alerta_tecnica", [correoDueno], asunto, resultado, {
      codigosAlerta: lote.map((a) => a.codigo),
    });
  }

  private async revisarReportePendiente(): Promise<void> {
    if (this.proximoReporte === null) return;
    if (this.reloj.ms() < this.proximoReporte) return;
    this.proximoReporte = null;
    await this.enviarReporteDelDia();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Reporte de cierre del día
  // ───────────────────────────────────────────────────────────────────────────

  /** Se llama al cerrar un turno. Reprograma el envío — no lo manda al toque. */
  alCerrarTurno(): void {
    this.proximoReporte = this.reloj.ms() + VENTANA_REPORTE_MS;
  }

  private async enviarReporteDelDia(): Promise<void> {
    const correoDueno = this.pos.config<string>("negocio.correoDueno");
    if (!correoDueno) return;
    // Pudo haber salido ya por `recuperarAlArrancar`, o por un lote anterior
    // del mismo día si el servidor se reinició justo en el medio.
    if (this.resumenDeHoy().reporteDiaEnviado) return;

    const hoy = this.hoy();
    /**
     * El reporte del día va CONSOLIDADO, de toda la cadena: es un correo al
     * dueño y lo que quiere saber es cómo le fue al negocio. El desglose por
     * local lo tiene en la pantalla de Reportes, que compara las sucursales
     * entre sí.
     */
    const reporte = construirReporte(this.pos.p, null, hoy, hoy);
    const turnosCerrados: TurnoCerradoDelDia[] = [...this.pos.p.turnos.values()]
      .filter((t) => t.cerradoEn?.slice(0, 10) === hoy)
      .map((t) => ({ horaCierre: t.cerradoEn!.slice(11, 16), diferencia: t.diferencia ?? 0 }));

    const { asunto, html } = plantillaReporteDelDia({
      fecha: hoy,
      nombreNegocio: this.pos.config<string>("negocio.nombre"),
      reporte,
      turnosCerrados,
    });

    const resultado = await this.enviador.enviar({ to: [correoDueno], subject: asunto, html });
    await this.registrar("reporte_dia", [correoDueno], asunto, resultado);
  }

  /**
   * Al arrancar: si hoy ya hubo un cierre sin que haya salido su reporte,
   * decide si ya pasó la ventana de espera (lo manda ya) o si todavía no
   * (vuelve a programar el debounce). Todo se recalcula del log, no de un
   * timestamp en memoria — un reinicio a mitad de la espera no pierde el
   * reporte del día.
   */
  async recuperarAlArrancar(): Promise<void> {
    if (this.resumenDeHoy().reporteDiaEnviado) return;

    const hoy = this.hoy();
    const cierresHoy = [...this.pos.p.turnos.values()].filter((t) => t.cerradoEn?.slice(0, 10) === hoy);
    if (cierresHoy.length === 0) return;

    const ultimoCierre = cierresHoy.reduce((a, b) => (a.cerradoEn! > b.cerradoEn! ? a : b));
    const vencimiento = new Date(ultimoCierre.cerradoEn!).getTime() + VENTANA_REPORTE_MS;

    if (this.reloj.ms() >= vencimiento) {
      await this.enviarReporteDelDia();
    } else {
      this.proximoReporte = vencimiento;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Recibo de venta por correo al cliente
  // ───────────────────────────────────────────────────────────────────────────

  async notificarRecibo(
    destinatario: string,
    venta: Venta,
    negocio: DatosDelNegocio,
    opciones: OpcionesDelRecibo = {},
  ): Promise<{ ok: boolean; detalle?: string }> {
    const { usadosHoy, topeTotal } = this.contadorDeHoy();
    if (usadosHoy >= topeTotal) {
      const resultado = { ok: false, detalle: `Se alcanzó el tope de ${topeTotal} correos de hoy.` };
      await this.registrar("recibo_venta", [destinatario], `Recibo ${venta.correlativo}`, resultado, {
        ventaId: venta.id,
      });
      return resultado;
    }

    const asunto = negocio.nombre ? `Tu recibo — ${negocio.nombre} ${venta.correlativo}` : `Tu recibo ${venta.correlativo}`;
    const html = construirReciboHtml(venta, negocio, opciones);
    const resultado = await this.enviador.enviar({ to: [destinatario], subject: asunto, html });
    await this.registrar("recibo_venta", [destinatario], asunto, resultado, { ventaId: venta.id });
    return resultado;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Código de "Mi cuenta"
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * El código de 6 dígitos que confirma un cambio de nombre/correo/teléfono/
   * contraseña en "Mi cuenta". Cuenta contra el mismo tope total compartido
   * que el recibo de venta — nunca contra el sub-tope de alertas, que es
   * para otra cosa.
   */
  async enviarCodigoDeVerificacion(
    destinatario: string,
    codigo: string,
    camposEnTexto: string[],
  ): Promise<{ ok: boolean; detalle?: string }> {
    const { usadosHoy, topeTotal } = this.contadorDeHoy();
    if (usadosHoy >= topeTotal) {
      const resultado = { ok: false, detalle: `Se alcanzó el tope de ${topeTotal} correos de hoy.` };
      await this.registrar("verificacion_cuenta", [destinatario], "Código de confirmación", resultado);
      return resultado;
    }

    const { asunto, html } = plantillaCodigoDeVerificacion(codigo, camposEnTexto);
    const resultado = await this.enviador.enviar({ to: [destinatario], subject: asunto, html });
    await this.registrar("verificacion_cuenta", [destinatario], asunto, resultado);
    return resultado;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Canal del desarrollador
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Para fallas que solo el desarrollador puede resolver por código o
   * infraestructura. Hoy nada las dispara todavía — el canal queda listo.
   * Igual que con las demás categorías, respeta el tope total: comparte la
   * misma cuenta de Resend.
   *
   * `negocio.correoDev` es config de la instalación, igual que
   * `negocio.correoDueno` — no una variable de entorno. Se asigna desde
   * Ajustes, como cualquier otro dato.
   */
  async notificarDev(asunto: string, html: string): Promise<{ ok: boolean; detalle?: string }> {
    const correoDev = this.pos.config<string>("negocio.correoDev");
    if (!correoDev) return { ok: false, detalle: "No hay correo de desarrollador configurado." };

    const { usadosHoy, topeTotal } = this.contadorDeHoy();
    if (usadosHoy >= topeTotal) {
      const resultado = { ok: false, detalle: `Se alcanzó el tope de ${topeTotal} correos de hoy.` };
      await this.registrar("alerta_dev", [correoDev], asunto, resultado);
      return resultado;
    }

    const resultado = await this.enviador.enviar({ to: [correoDev], subject: asunto, html });
    await this.registrar("alerta_dev", [correoDev], asunto, resultado);
    return resultado;
  }
}
