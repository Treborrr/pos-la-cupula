/**
 * El envío de correo es un puerto y no un `fetch` suelto en el servicio de
 * notificaciones, por la misma razón que el reloj y el almacén de eventos lo
 * son: los tests necesitan mandar correos de mentira sin tocar la red ni
 * depender de que Resend esté arriba, y el día que cambie el proveedor
 * (Resend por otra cosa) el cambio es escribir un adaptador nuevo, no reabrir
 * toda la lógica de topes y lotes.
 */

export interface EnviadorDeCorreo {
  /**
   * Intenta mandar un correo. Nunca lanza: una falla de red o de la API de
   * Resend es un resultado (`ok: false`), no una excepción — quien llama
   * siempre tiene que poder registrar el intento, haya salido bien o mal.
   */
  enviar(datos: { to: string[]; subject: string; html: string }): Promise<{ ok: boolean; detalle?: string }>;
}
