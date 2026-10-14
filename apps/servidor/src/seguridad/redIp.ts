/**
 * ¿Esta IP está en la lista de redes permitidas para el cajero?
 *
 * Usa `ipaddr.js` en vez de comparar strings a mano a propósito: una IPv4
 * disfrazada de IPv6 (`::ffff:1.2.3.4`) pasaría de largo un chequeo ingenuo
 * basado en texto, y es exactamente el tipo de bypass sutil que no se
 * quiere en un límite de seguridad. `ipaddr.process()` normaliza eso antes
 * de comparar.
 */

import ipaddr from "ipaddr.js";

/**
 * `lista` es config de la instalación (`seguridad.redesCajero`), separada
 * por comas: IPs sueltas o rangos CIDR — "181.64.123.45,100.64.0.0/10".
 *
 * Vacía = sin restricción. Mismo "apagado por defecto, bien visible si nadie
 * lo configuró" que ya usaba el candado único que este sistema tenía antes.
 */
export function estaPermitida(ip: string, lista: string): boolean {
  const entradas = lista
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (entradas.length === 0) return true;

  let direccion;
  try {
    direccion = ipaddr.process(ip);
  } catch {
    // Una IP que ni siquiera se pudo interpretar nunca puede "estar en la
    // lista": fail-closed, no fail-open.
    return false;
  }

  for (const entrada of entradas) {
    try {
      if (entrada.includes("/")) {
        const rango = ipaddr.parseCIDR(entrada);
        if (direccion.kind() !== rango[0].kind()) continue;
        if (direccion.match(rango)) return true;
      } else {
        const unica = ipaddr.process(entrada);
        if (unica.kind() === direccion.kind() && unica.toString() === direccion.toString()) return true;
      }
    } catch {
      // Una entrada mal escrita en la config no debería tumbar el chequeo
      // entero — se la ignora y se sigue con las demás.
      continue;
    }
  }

  return false;
}
