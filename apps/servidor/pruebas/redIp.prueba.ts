import { describe, expect, it } from "vitest";

import { estaPermitida } from "../src/seguridad/redIp";

describe("estaPermitida", () => {
  it("lista vacía = sin restricción", () => {
    expect(estaPermitida("1.2.3.4", "")).toBe(true);
    expect(estaPermitida("1.2.3.4", "   ")).toBe(true);
  });

  it("coincide una IP suelta", () => {
    expect(estaPermitida("181.64.123.45", "181.64.123.45")).toBe(true);
    expect(estaPermitida("181.64.123.46", "181.64.123.45")).toBe(false);
  });

  it("coincide un rango CIDR", () => {
    expect(estaPermitida("192.168.1.50", "192.168.1.0/24")).toBe(true);
    expect(estaPermitida("192.168.2.50", "192.168.1.0/24")).toBe(false);
  });

  it("acepta varias entradas separadas por coma", () => {
    const lista = "181.64.123.45, 100.64.0.0/10";
    expect(estaPermitida("181.64.123.45", lista)).toBe(true);
    expect(estaPermitida("100.64.5.6", lista)).toBe(true);
    expect(estaPermitida("8.8.8.8", lista)).toBe(false);
  });

  it("normaliza una IPv4 disfrazada de IPv6 antes de comparar", () => {
    expect(estaPermitida("::ffff:192.168.1.50", "192.168.1.0/24")).toBe(true);
  });

  it("una entrada mal escrita en la lista no tumba el chequeo de las demás", () => {
    expect(estaPermitida("181.64.123.45", "esto-no-es-una-ip, 181.64.123.45")).toBe(true);
  });

  it("una IP que no se puede interpretar nunca pasa (fail-closed)", () => {
    expect(estaPermitida("no-es-una-ip", "0.0.0.0/0")).toBe(false);
  });
});
