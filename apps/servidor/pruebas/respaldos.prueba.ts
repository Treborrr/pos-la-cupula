/**
 * Pruebas de respaldos.
 *
 * El riesgo más grave del sistema no es un bug: es que se queme el disco de la
 * barbería y no haya copia. Estas pruebas verifican lo que de verdad importa:
 * que el archivo se genere, que se pueda ABRIR con herramientas estándar, que
 * contenga los datos, y —sobre todo— que el destino externo se compruebe de
 * verdad en vez de asumirse.
 */

import { describe, expect, it, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { ServicioDeRespaldos } from "../src/servicios/Respaldos";
import { ServicioPos } from "../src/servicios/Pos";
import { crearItem } from "../src/dominio/catalogo/catalogo";
import { abrirAlmacen, borrar, carpetaTemporal, relojFijo } from "./ayuda";

const correr = promisify(execFile);

const aBorrar: string[] = [];
afterEach(async () => {
  await Promise.all(aBorrar.splice(0).map(borrar));
});

async function conDatos() {
  const dir = await carpetaTemporal();
  aBorrar.push(dir);

  const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
  await pos.transaccion(() => {
    const r = crearItem(pos.p, {
      codigo: "COR",
      nombre: "CORTE CLASICO",
      tipo: "SERVICIO",
      categoria: "Barbería",
      precio: 2000,
    });
    return { eventos: r.eventos, resultado: r };
  });
  await pos.instantanea();
  await pos.cerrar();

  return dir;
}

describe("crear respaldo", () => {
  it("genera un archivo que gzip y tar saben abrir", async () => {
    // Que lo abran las herramientas del sistema es el punto: restaurar no
    // puede depender de este programa ni de que yo esté disponible.
    const dir = await conDatos();
    const respaldos = new ServicioDeRespaldos(dir, relojFijo("2026-09-16T23:05:00.000-05:00"));

    const r = await respaldos.crear("prueba");
    expect(r.ok).toBe(true);
    expect(r.archivo).toMatch(/cupula-2026-09-16-23-05-00-prueba\.tar\.gz$/);
    expect(r.bytes).toBeGreaterThan(0);

    const { stdout } = await correr("tar", ["-tzf", r.archivo!]);
    const dentro = stdout.trim().split("\n");
    expect(dentro.some((n) => n.startsWith("eventos/"))).toBe(true);
    expect(dentro.some((n) => n.startsWith("instantaneas/"))).toBe(true);
  });

  it("el contenido extraído es idéntico al original", async () => {
    const dir = await conDatos();
    const respaldos = new ServicioDeRespaldos(dir, relojFijo());
    const r = await respaldos.crear();

    const destino = await carpetaTemporal("restaurado-");
    aBorrar.push(destino);
    await correr("tar", ["-xzf", r.archivo!, "-C", destino]);

    const archivos = await fs.readdir(path.join(destino, "eventos"));
    expect(archivos.length).toBeGreaterThan(0);

    const original = await fs.readFile(path.join(dir, "eventos", archivos[0]), "utf8");
    const restaurado = await fs.readFile(path.join(destino, "eventos", archivos[0]), "utf8");
    expect(restaurado).toBe(original);

    // Y el log restaurado sigue siendo un log válido: se puede levantar un POS
    // encima y encontrar los datos. Eso es "restaurar" de verdad.
    const revivido = await ServicioPos.abrir(await abrirAlmacen(destino));
    expect(revivido.p.itemPorCodigo("COR")?.nombre).toBe("CORTE CLASICO");
    await revivido.cerrar();
  });

  it("no respalda nada si todavía no hay datos, y lo dice", async () => {
    const dir = await carpetaTemporal();
    aBorrar.push(dir);
    const r = await new ServicioDeRespaldos(dir, relojFijo()).crear();
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/No hay datos/);
  });

  it("conserva los últimos 30 y descarta los anteriores", async () => {
    const dir = await conDatos();
    const reloj = relojFijo("2026-01-01T10:00:00.000-05:00");
    const respaldos = new ServicioDeRespaldos(dir, reloj);

    for (let i = 0; i < 33; i++) {
      reloj.avanzar(24 * 60 * 60 * 1000);
      await respaldos.crear("diario");
    }

    const guardados = (await fs.readdir(path.join(dir, "respaldos"))).filter((n) =>
      n.endsWith(".tar.gz"),
    );
    expect(guardados).toHaveLength(30);
  });
});

describe("destino externo", () => {
  it("copia el respaldo afuera cuando el destino sirve", async () => {
    const dir = await conDatos();
    const externo = await carpetaTemporal("externo-");
    aBorrar.push(externo);

    const respaldos = new ServicioDeRespaldos(dir, relojFijo(), externo);
    const r = await respaldos.crear();

    expect(r.copiaExterna).toBeTruthy();
    const copia = await fs.stat(r.copiaExterna!);
    expect(copia.size).toBe(r.bytes);
  });

  it("verifica ESCRIBIENDO de verdad, no solo mirando si la carpeta existe", async () => {
    // Un USB desconectado deja la letra de unidad; OneDrive puede estar
    // pausado. "La carpeta existe" no significa "se puede respaldar".
    const dir = await conDatos();
    const externo = await carpetaTemporal("externo-");
    aBorrar.push(externo);

    const respaldos = new ServicioDeRespaldos(dir, relojFijo(), externo);
    const buena = await respaldos.verificarDestino();
    expect(buena.ok).toBe(true);
    expect(buena.detalle).toMatch(/Verificado/);

    // No debe dejar el archivo de prueba tirado.
    expect(await fs.readdir(externo)).toHaveLength(0);
  });

  it("avisa con un motivo entendible si el destino no sirve", async () => {
    const dir = await conDatos();
    const respaldos = new ServicioDeRespaldos(dir, relojFijo(), "/dev/null/no-se-puede");

    const v = await respaldos.verificarDestino();
    expect(v.ok).toBe(false);
    expect(v.detalle).toMatch(/No se puede respaldar/);

    // Pero el respaldo local se hace igual: perder la copia externa no puede
    // significar quedarse sin ninguna copia.
    const r = await respaldos.crear();
    expect(r.ok).toBe(true);
    expect(r.copiaExterna).toBeUndefined();
  });

  it("sin destino configurado lo dice claro en vez de fingir que está todo bien", async () => {
    const dir = await conDatos();
    const estado = await new ServicioDeRespaldos(dir, relojFijo()).estado();

    expect(estado.destinoExterno).toBeNull();
    expect(estado.destinoExternoEscribible).toBeNull();
    expect(estado.detalleDelDestino).toMatch(/solo en este disco/);
  });
});

describe("estado", () => {
  it("reporta el último respaldo y cuántos hay", async () => {
    const dir = await conDatos();
    const respaldos = new ServicioDeRespaldos(dir, relojFijo("2026-09-16T23:05:00.000-05:00"));

    expect((await respaldos.estado()).ultimo).toBeNull();

    await respaldos.crear("prueba");
    const estado = await respaldos.estado();

    expect(estado.cantidad).toBe(1);
    expect(estado.ultimo?.archivo).toMatch(/prueba\.tar\.gz$/);
    expect(estado.ultimo?.bytes).toBeGreaterThan(0);
  });
});

describe("retención por niveles", () => {
  it("los respaldos horarios no expulsan a los diarios", async () => {
    // El caso que motiva la separación: con respaldo por hora y una poda única
    // de 30 archivos, un mes de cierres desaparece en dos días y medio. Si los
    // datos se corrompen el martes y nadie lo nota hasta el lunes, no queda una
    // sola copia anterior al daño.
    const dir = await conDatos();
    const reloj = relojFijo("2026-09-16T08:00:00.000-05:00");
    const respaldos = new ServicioDeRespaldos(dir, reloj);

    // Diez cierres, uno por día.
    for (let d = 0; d < 10; d++) {
      await respaldos.crear("cierre");
      reloj.avanzar(24 * 60 * 60 * 1000);
    }
    // Y cuarenta horarios encima, más que los 24 que se conservan.
    for (let h = 0; h < 40; h++) {
      await respaldos.crear("horario");
      reloj.avanzar(60 * 60 * 1000);
    }

    const archivos = (await fs.readdir(path.join(dir, "respaldos"))).filter((n) => n.endsWith(".tar.gz"));
    const horarios = archivos.filter((n) => n.endsWith("-horario.tar.gz"));
    const cierres = archivos.filter((n) => n.endsWith("-cierre.tar.gz"));

    expect(horarios).toHaveLength(24);
    // Los diez cierres siguen ahí: es lo que permite volver más de un día atrás.
    expect(cierres).toHaveLength(10);
  });

  it("conserva 30 cierres y descarta el más viejo recién a partir de ahí", async () => {
    const dir = await conDatos();
    const reloj = relojFijo("2026-09-16T08:00:00.000-05:00");
    const respaldos = new ServicioDeRespaldos(dir, reloj);

    for (let d = 0; d < 35; d++) {
      await respaldos.crear("cierre");
      reloj.avanzar(24 * 60 * 60 * 1000);
    }

    const archivos = (await fs.readdir(path.join(dir, "respaldos"))).filter((n) => n.endsWith(".tar.gz"));
    expect(archivos).toHaveLength(30);
    // Se van los más viejos, no los más nuevos.
    expect(archivos.sort()[0]).toContain("2026-09-21");
  });
});
