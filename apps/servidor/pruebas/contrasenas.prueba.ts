/**
 * El hash y la verificación son lo único que no se puede probar por
 * inspección: hay que de verdad calcular un hash y ver que la MISMA
 * contraseña valide y cualquier otra no.
 */

import { describe, expect, it } from "vitest";

import { hashearContrasena, verificarContrasena } from "../src/seguridad/contrasenas";

describe("contraseñas", () => {
  it("la misma contraseña valida contra su propio hash", async () => {
    const hash = await hashearContrasena("una-clave-larga-de-verdad");
    expect(await verificarContrasena("una-clave-larga-de-verdad", hash)).toBe(true);
  });

  it("rechaza una contraseña distinta", async () => {
    const hash = await hashearContrasena("una-clave-larga-de-verdad");
    expect(await verificarContrasena("otra-clave", hash)).toBe(false);
  });

  it("dos hashes de la misma contraseña son distintos (sal aleatoria)", async () => {
    const a = await hashearContrasena("repetida");
    const b = await hashearContrasena("repetida");
    expect(a).not.toBe(b);
    expect(await verificarContrasena("repetida", a)).toBe(true);
    expect(await verificarContrasena("repetida", b)).toBe(true);
  });

  it("el hash trae los parámetros en texto, no solo el resultado", async () => {
    const hash = await hashearContrasena("x");
    expect(hash).toMatch(/^scrypt:\d+:\d+:\d+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("no revienta con un hash corrupto o de otro formato: solo rechaza", async () => {
    await expect(verificarContrasena("cualquiera", "esto no es un hash")).resolves.toBe(false);
    await expect(verificarContrasena("cualquiera", "bcrypt:$2b$10$algo")).resolves.toBe(false);
    await expect(verificarContrasena("cualquiera", "scrypt:abc:8:1:aa:bb")).resolves.toBe(false);
  });
});
