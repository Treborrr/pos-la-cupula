/**
 * Correos internos: alertas técnicas agrupadas y el reporte de cierre del
 * día, los dos para `negocio.correoDueno`. Sin logo ni diseño elaborado a
 * propósito — a diferencia del recibo al cliente, nadie pidió que estos se
 * vean bonitos, y la prioridad es que se lean rápido desde el teléfono.
 */

import { aTextoConSimbolo, type Centimos } from "@cupula/contratos";

import type { Alerta } from "../../consultas/alertas";
import type { Reporte } from "../../consultas/reportes";

function envoltorio(titulo: string, cuerpoHtml: string): string {
  return `
<div style="max-width:480px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:14px;">
  <h2 style="font-size:17px;margin:16px 0;">${titulo}</h2>
  ${cuerpoHtml}
</div>`.trim();
}

/** Un solo correo con todas las alertas técnicas que se acumularon en la ventana. */
export function plantillaAlertasTecnicas(alertas: Alerta[]): { asunto: string; html: string } {
  const asunto =
    alertas.length === 1 ? `Atención: ${tituloCorto(alertas[0].codigo)}` : `Atención: ${alertas.length} avisos del POS`;

  const html = envoltorio(
    "El sistema avisa:",
    `<ul style="padding-left:18px;">
      ${alertas.map((a) => `<li style="margin-bottom:10px;">${a.mensaje}</li>`).join("")}
    </ul>`,
  );

  return { asunto, html };
}

function tituloCorto(codigo: string): string {
  const titulos: Record<string, string> = {
    RELOJ_ATRASADO: "la hora de la PC está atrasada",
    LINEAS_EN_CUARENTENA: "hubo líneas ilegibles en el log",
    RESPALDO_SIN_DESTINO: "el respaldo externo no está funcionando",
    IMPRESORA_CON_ERROR: "la impresora no responde",
  };
  return titulos[codigo] ?? codigo;
}

export interface TurnoCerradoDelDia {
  horaCierre: string;
  diferencia: Centimos;
}

/** El reporte de cierre del día: ventas, propinas, qué comprar, y la caja si no cuadró. */
export function plantillaReporteDelDia(datos: {
  fecha: string;
  nombreNegocio: string;
  reporte: Reporte;
  turnosCerrados: TurnoCerradoDelDia[];
}): { asunto: string; html: string } {
  const { reporte, turnosCerrados } = datos;
  const descuadres = turnosCerrados.filter((t) => t.diferencia !== 0);

  const prefijoNegocio = datos.nombreNegocio ? `${datos.nombreNegocio} — ` : "";
  const asunto =
    descuadres.length > 0
      ? `${prefijoNegocio}Cierre del ${datos.fecha}: caja no cuadró`
      : `${prefijoNegocio}Cierre del ${datos.fecha}`;

  const html = envoltorio(
    `${prefijoNegocio}Cierre del día — ${datos.fecha}`,
    `
    <div style="margin-bottom:16px;">
      <div><strong>Vendido:</strong> ${aTextoConSimbolo(reporte.total)} (${reporte.cantidadVentas} ventas)</div>
      <div>Efectivo: ${aTextoConSimbolo(reporte.medios.EFECTIVO)} · YAPE: ${aTextoConSimbolo(reporte.medios.YAPE)} · Tarjeta: ${aTextoConSimbolo(reporte.medios.TARJETA)}</div>
    </div>

    ${
      descuadres.length > 0
        ? `<div style="background:#fdecea;border:1px solid #f5c6cb;border-radius:6px;padding:10px 12px;margin-bottom:16px;">
            <strong>Caja no cuadró</strong>
            <ul style="padding-left:18px;margin:6px 0 0;">
              ${descuadres
                .map(
                  (t) =>
                    `<li>Turno de las ${t.horaCierre}: ${t.diferencia < 0 ? "falta" : "sobra"} ${aTextoConSimbolo(Math.abs(t.diferencia))}</li>`,
                )
                .join("")}
            </ul>
          </div>`
        : `<div style="color:#2e7d32;margin-bottom:16px;">Caja cuadrada en los ${turnosCerrados.length} turno(s) de hoy.</div>`
    }

    ${
      reporte.propinas.length > 0
        ? `<div style="margin-bottom:16px;">
            <strong>Propinas de hoy:</strong>
            <ul style="padding-left:18px;margin:6px 0 0;">
              ${reporte.propinas.map((p) => `<li>${p.nombre}: ${aTextoConSimbolo(p.total)}</li>`).join("")}
            </ul>
          </div>`
        : ""
    }

    ${
      reporte.paraReponer.length > 0
        ? `<div>
            <strong>Qué comprar:</strong>
            <ul style="padding-left:18px;margin:6px 0 0;">
              ${reporte.paraReponer
                .slice(0, 15)
                .map((p) => `<li>${p.nombre} — quedan ${p.stock}, sugerido reponer ${p.sugeridas}</li>`)
                .join("")}
            </ul>
          </div>`
        : `<div style="color:#555;">Sin productos para reponer hoy.</div>`
    }
    `,
  );

  return { asunto, html };
}

/**
 * El código de 6 dígitos que confirma un cambio en "Mi cuenta" (nombre,
 * correo, teléfono y/o contraseña — lo que sea que se haya pedido cambiar,
 * todo junto en un solo correo, no uno por campo).
 */
export function plantillaCodigoDeVerificacion(
  codigo: string,
  camposEnTexto: string[],
): { asunto: string; html: string } {
  const html = envoltorio(
    "Confirma el cambio en tu cuenta",
    `
    <p>Pediste actualizar: <strong>${camposEnTexto.join(", ")}</strong>.</p>
    <div style="text-align:center;margin:20px 0;">
      <span style="display:inline-block;font-size:28px;font-weight:bold;letter-spacing:4px;background:#f5f5f5;padding:12px 20px;border-radius:8px;">${codigo}</span>
    </div>
    <p style="color:#555;">Este código vence en 15 minutos. Nada se aplica hasta que lo escribas.</p>
    <p style="color:#777;font-size:12px;">Si no pediste este cambio, ignora este correo: no se aplica nada sin el código.</p>
    `,
  );

  return { asunto: "Tu código de confirmación", html };
}
