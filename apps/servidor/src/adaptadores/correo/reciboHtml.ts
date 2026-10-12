/**
 * El recibo de venta por correo al cliente, en HTML.
 *
 * NO reutiliza `renderTicket.ts`: ese está armado para una `SalidaDeTicket`
 * de ancho fijo (ESC/POS o su espejo en texto monoespaciado) y no tiene
 * ningún concepto de tabla ni de estilos — forzarlo a producir HTML hubiera
 * significado escribir un sink nuevo igual de grande que esto. Lo que sí
 * comparte es la MISMA información que ve el cliente en el ticket de papel:
 * líneas, precios, medios de pago y el pie del negocio (D5: nota de venta
 * interna, nada de SUNAT — mismo alcance que el ticket impreso).
 */

import { aTextoConSimbolo, type LineaVenta, type MedioPago, type Pago } from "@cupula/contratos";

import type { DatosDelNegocio } from "../../puertos/Impresora";
import type { Venta } from "../../proyecciones/tipos";
import { LOGO_CORREO_PNG_BASE64, LOGO_CORREO_ANCHO } from "./logoCupula";

export interface OpcionesDelRecibo {
  nombresDeBarbero?: Record<string, string>;
  nombreDelCliente?: string;
}

const ETIQUETA_MEDIO: Record<MedioPago, string> = {
  EFECTIVO: "Efectivo",
  YAPE: "YAPE",
  TARJETA: "Tarjeta",
  ADELANTO: "Adelanto a barbero",
};

export function construirReciboHtml(venta: Venta, negocio: DatosDelNegocio, opciones: OpcionesDelRecibo = {}): string {
  const fecha = `${venta.ts.slice(8, 10)}/${venta.ts.slice(5, 7)}/${venta.ts.slice(0, 4)} ${venta.ts.slice(11, 16)}`;

  return `
<div style="max-width:480px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
  <div style="text-align:center;padding:24px 0 8px;">
    <img src="data:image/png;base64,${LOGO_CORREO_PNG_BASE64}" width="${LOGO_CORREO_ANCHO}" alt="${esc(negocio.nombre)}"
         style="max-width:160px;height:auto;" />
  </div>
  <div style="text-align:center;padding-bottom:16px;">
    <div style="font-size:16px;font-weight:bold;">${esc(negocio.nombre)}</div>
    ${negocio.direccion ? `<div style="font-size:13px;color:#555;">${esc(negocio.direccion)}${negocio.ciudad ? `, ${esc(negocio.ciudad)}` : ""}</div>` : ""}
    ${negocio.ruc ? `<div style="font-size:12px;color:#777;">RUC ${esc(negocio.ruc)}</div>` : ""}
  </div>

  <div style="border-top:1px solid #e0e0e0;border-bottom:1px solid #e0e0e0;padding:12px 0;margin-bottom:16px;font-size:13px;">
    <div><strong>Recibo</strong> ${esc(venta.correlativo)}</div>
    <div>${fecha}</div>
    ${opciones.nombreDelCliente ? `<div>Cliente: ${esc(opciones.nombreDelCliente)}</div>` : ""}
  </div>

  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
    <thead>
      <tr style="text-align:left;border-bottom:1px solid #e0e0e0;color:#555;">
        <th style="padding:4px 4px 8px 0;">Detalle</th>
        <th style="padding:4px 0 8px;text-align:center;">Cant.</th>
        <th style="padding:4px 0 8px;text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${venta.lineas.map((l) => filaDeLinea(l, opciones.nombresDeBarbero)).join("")}
    </tbody>
  </table>

  <div style="margin-bottom:16px;font-size:13px;">
    ${filaTotal("Subtotal", venta.subtotal)}
    ${venta.descuento > 0 ? filaTotal("Descuento", -venta.descuento) : ""}
    <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:bold;border-top:1px solid #e0e0e0;padding-top:6px;margin-top:4px;">
      <span>Total</span><span>${aTextoConSimbolo(venta.total)}</span>
    </div>
  </div>

  <div style="margin-bottom:24px;font-size:13px;color:#444;">
    ${venta.pagos.map(filaDePago).join("")}
  </div>

  ${negocio.pie ? `<div style="text-align:center;font-size:13px;color:#777;padding-bottom:24px;">${esc(negocio.pie)}</div>` : ""}
</div>`.trim();
}

function filaDeLinea(l: LineaVenta, nombresDeBarbero?: Record<string, string>): string {
  const barbero = l.barberoId ? nombresDeBarbero?.[l.barberoId] : undefined;
  return `
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:8px 4px 8px 0;">
          ${esc(l.nombre)}
          ${barbero ? `<div style="font-size:11px;color:#888;">Atendió: ${esc(barbero)}</div>` : ""}
        </td>
        <td style="padding:8px 0;text-align:center;">${l.cantidad}</td>
        <td style="padding:8px 0;text-align:right;">${aTextoConSimbolo(l.total)}</td>
      </tr>`;
}

function filaTotal(etiqueta: string, monto: number): string {
  return `<div style="display:flex;justify-content:space-between;padding:2px 0;color:#555;">
    <span>${etiqueta}</span><span>${aTextoConSimbolo(monto)}</span>
  </div>`;
}

function filaDePago(p: Pago): string {
  const vuelto = p.vuelto && p.vuelto > 0 ? ` (vuelto ${aTextoConSimbolo(p.vuelto)})` : "";
  return `<div style="display:flex;justify-content:space-between;padding:2px 0;">
    <span>${ETIQUETA_MEDIO[p.medio]}</span><span>${aTextoConSimbolo(p.monto)}${vuelto}</span>
  </div>`;
}

function esc(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
