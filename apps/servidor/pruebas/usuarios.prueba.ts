/**
 * Altas, bajas y contraseñas de cuentas de login. Lo que importa probar acá
 * es lo que no se ve a simple vista: los topes (2 admin, 3 cajero, solo
 * cuentan los activos), que un handle liberado se pueda reusar, y que
 * reactivar no resetee la contraseña.
 */

import { describe, expect, it, afterEach } from "vitest";

import { ServicioPos } from "../src/servicios/Pos";
import {
  cambiarContrasena,
  crearUsuario,
  desactivarUsuario,
  reactivarUsuario,
} from "../src/dominio/usuarios/usuarios";
import { abrirAlmacen, borrar, carpetaTemporal } from "./ayuda";

const aBorrar: string[] = [];
afterEach(async () => {
  await Promise.all(aBorrar.splice(0).map(borrar));
});

async function posDePrueba() {
  const dir = await carpetaTemporal();
  aBorrar.push(dir);
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
  return { pos, dir };
}

async function conUsuario(
  pos: ServicioPos,
  usuario: string,
  rol: "ADMIN" | "CAJERO" = "CAJERO",
  hash = "scrypt:hash-de-prueba",
) {
  return pos.transaccion(() => {
    const r = crearUsuario(pos.p, { usuario, nombre: usuario, rol, hash });
    return { eventos: r.eventos, resultado: r.usuarioId };
  });
}

describe("crear usuario", () => {
  it("crea la cuenta activa con el handle normalizado", async () => {
    const { pos } = await posDePrueba();
    const id = await conUsuario(pos, "ana", "CAJERO");

    const u = pos.p.usuarios.get(id)!;
    expect(u.usuario).toBe("ana");
    expect(u.activo).toBe(true);
    expect(pos.p.porNombreDeUsuario.get("ana")).toBe(id);
    await pos.cerrar();
  });

  it("rechaza un handle que ya usa otra cuenta activa", async () => {
    const { pos } = await posDePrueba();
    await conUsuario(pos, "ana");
    await expect(conUsuario(pos, "ana")).rejects.toThrow(/ya existe una cuenta activa/i);
    await pos.cerrar();
  });

  it("permite reusar el handle de una cuenta desactivada", async () => {
    const { pos } = await posDePrueba();
    const viejoId = await conUsuario(pos, "ana");
    await pos.escribir(() => desactivarUsuario(pos.p, viejoId));

    const nuevoId = await conUsuario(pos, "ana");
    expect(nuevoId).not.toBe(viejoId);
    expect(pos.p.porNombreDeUsuario.get("ana")).toBe(nuevoId);
    await pos.cerrar();
  });

  it("tope de 3 cajeros activos", async () => {
    const { pos } = await posDePrueba();
    await conUsuario(pos, "cajero1");
    await conUsuario(pos, "cajero2");
    await conUsuario(pos, "cajero3");
    await expect(conUsuario(pos, "cajero4")).rejects.toThrow(/ya hay 3 cajeros/i);
    await pos.cerrar();
  });

  it("tope de 2 admins activos", async () => {
    const { pos } = await posDePrueba();
    await conUsuario(pos, "dueno1", "ADMIN");
    await conUsuario(pos, "dueno2", "ADMIN");
    await expect(conUsuario(pos, "dueno3", "ADMIN")).rejects.toThrow(/ya hay 2 administradores/i);
    await pos.cerrar();
  });

  it("desactivar un cajero libera el cupo para uno nuevo", async () => {
    const { pos } = await posDePrueba();
    await conUsuario(pos, "cajero1");
    await conUsuario(pos, "cajero2");
    const tercero = await conUsuario(pos, "cajero3");
    await pos.escribir(() => desactivarUsuario(pos.p, tercero));

    await expect(conUsuario(pos, "cajero4")).resolves.toBeTruthy();
    await pos.cerrar();
  });
});

describe("desactivar", () => {
  it("no deja desactivar al único administrador activo", async () => {
    const { pos } = await posDePrueba();
    const id = await conUsuario(pos, "dueno", "ADMIN");
    expect(() => desactivarUsuario(pos.p, id)).toThrow(/único administrador activo/i);
    await pos.cerrar();
  });

  it("permite desactivar un admin si hay otro activo", async () => {
    const { pos } = await posDePrueba();
    const id = await conUsuario(pos, "dueno1", "ADMIN");
    await conUsuario(pos, "dueno2", "ADMIN");
    await pos.escribir(() => desactivarUsuario(pos.p, id));
    expect(pos.p.usuarios.get(id)!.activo).toBe(false);
    await pos.cerrar();
  });

  it("rechaza desactivar una cuenta que no existe", async () => {
    const { pos } = await posDePrueba();
    expect(() => desactivarUsuario(pos.p, "no-existe")).toThrow(/no existe/i);
    await pos.cerrar();
  });
});

describe("reactivar", () => {
  it("vuelve a activarla SIN tocar la contraseña", async () => {
    const { pos } = await posDePrueba();
    const id = await conUsuario(pos, "ana", "CAJERO", "scrypt:hash-original");
    await pos.escribir(() => desactivarUsuario(pos.p, id));
    await pos.escribir(() => reactivarUsuario(pos.p, id));

    const u = pos.p.usuarios.get(id)!;
    expect(u.activo).toBe(true);
    expect(u.hash).toBe("scrypt:hash-original");
    expect(pos.p.porNombreDeUsuario.get("ana")).toBe(id);
    await pos.cerrar();
  });

  it("rechaza reactivar si el handle ya lo tiene otra cuenta activa", async () => {
    const { pos } = await posDePrueba();
    const viejoId = await conUsuario(pos, "ana");
    await pos.escribir(() => desactivarUsuario(pos.p, viejoId));
    await conUsuario(pos, "ana"); // una cuenta nueva se queda con el handle

    expect(() => reactivarUsuario(pos.p, viejoId)).toThrow(/ya lo tiene otra cuenta activa/i);
    await pos.cerrar();
  });

  it("respeta el tope al reactivar", async () => {
    const { pos } = await posDePrueba();
    const id = await conUsuario(pos, "cajero1");
    await pos.escribir(() => desactivarUsuario(pos.p, id));
    await conUsuario(pos, "cajero2");
    await conUsuario(pos, "cajero3");
    await conUsuario(pos, "cajero4");

    expect(() => reactivarUsuario(pos.p, id)).toThrow(/ya hay 3 cajeros/i);
    await pos.cerrar();
  });
});

describe("cambiar contraseña", () => {
  it("actualiza el hash sin tocar nada más", async () => {
    const { pos } = await posDePrueba();
    const id = await conUsuario(pos, "ana", "CAJERO", "scrypt:viejo");
    await pos.escribir(() => cambiarContrasena(pos.p, id, "scrypt:nuevo"));

    const u = pos.p.usuarios.get(id)!;
    expect(u.hash).toBe("scrypt:nuevo");
    expect(u.activo).toBe(true);
    await pos.cerrar();
  });

  it("rechaza cambiar la contraseña de una cuenta que no existe", async () => {
    const { pos } = await posDePrueba();
    expect(() => cambiarContrasena(pos.p, "no-existe", "scrypt:x")).toThrow(/no existe/i);
    await pos.cerrar();
  });
});
