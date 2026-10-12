/**
 * Adaptador real del puerto `EnviadorDeCorreo`, contra la API de Resend.
 *
 * Sin dependencia nueva: Node 22 trae `fetch` global, y la API de Resend es
 * un POST con JSON — no hace falta su SDK para esto.
 *
 * `apiKey` y `from` llegan de variables de entorno (`RESEND_API_KEY`,
 * `RESEND_FROM`), nunca de la configuración del negocio ni de un valor
 * escrito en el código: son credenciales de la cuenta de Resend, no un dato
 * de la instalación. Si falta cualquiera de las dos, este adaptador no
 * intenta la llamada — devuelve `ok:false` con el motivo, igual que la
 * impresora en modo "vistaPrevia" no intenta imprimir en un puerto que no
 * existe.
 */

import type { EnviadorDeCorreo } from "../../puertos/EnviadorDeCorreo";

const URL_RESEND = "https://api.resend.com/emails";

export class EnviadorResend implements EnviadorDeCorreo {
  constructor(
    private readonly apiKey: string | null,
    private readonly from: string | null,
  ) {}

  async enviar(datos: { to: string[]; subject: string; html: string }): Promise<{ ok: boolean; detalle?: string }> {
    if (!this.apiKey || !this.from) {
      return { ok: false, detalle: "Resend no está configurado: falta RESEND_API_KEY o RESEND_FROM." };
    }

    try {
      const respuesta = await fetch(URL_RESEND, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: this.from, to: datos.to, subject: datos.subject, html: datos.html }),
      });

      if (!respuesta.ok) {
        const cuerpo = await respuesta.text().catch(() => "");
        return { ok: false, detalle: `Resend respondió ${respuesta.status}: ${cuerpo.slice(0, 200)}` };
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, detalle: e instanceof Error ? e.message : String(e) };
    }
  }
}
