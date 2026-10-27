/**
 * Multisucursal por HTTP.
 *
 * Lo que importa acá y no se puede probar en el dominio: que la sucursal en la
 * que opera una petición la decida el SERVIDOR a partir de la sesión, y no lo
 * que mande el navegador. Un cajero que apunta a otro local con un parámetro en
 * la URL tiene que seguir cobrando en el suyo.
 */

import { SEDE_PRINCIPAL } from "@cupula/contratos";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { construirApp } from "../src/http/app";
import { ServicioPos } from "../src/servicios/Pos";
import { ServicioDeRespaldos } from "../src/servicios/Respaldos";
import { ImpresoraVistaPrevia } from "../src/adaptadores/impresora/ImpresoraVistaPrevia";
import { relojDelSistema } from "../src/puertos/Reloj";
import { NOMBRE_COOKIE_SESION } from "../src/http/autorizacion";
import {
  abrirAlmacen,
  borrar,
  carpetaTemporal,
  conSesionAdmin,
  dependenciasDeSeguridadDePrueba,
  notificacionesDePrueba,
} from "./ayuda";

const aCerrar: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cerrar of aCerrar.splice(0)) await cerrar();
});

async function apiDePrueba() {
  const dir = await carpetaTemporal();
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
  await pos.guardarConfig("ventas.exigirCliente", false);
  await pos.guardarConfig("ventas.exigirTurnoAbierto", false);
  // Sin red configurada el cajero entra desde cualquier IP, que es lo que
  // necesitan estas pruebas: lo que se ejercita es la sucursal, no la red.
  await pos.guardarConfig("seguridad.redesCajero", "");

  const app = await construirApp({
    pos,
    impresora: new ImpresoraVistaPrevia(),
    respaldos: new ServicioDeRespaldos(dir, relojDelSistema, null),
    notificaciones: notificacionesDePrueba(pos),
    carpetaDatos: dir,
    version: "pruebas",
    ...dependenciasDeSeguridadDePrueba(),
  });
  await conSesionAdmin(app, pos);

  aCerrar.push(async () => {
    await app.close();
    await pos.cerrar();
    await borrar(dir);
  });
  return { app, pos };
}

/** Crea un cajero atado a una sucursal y devuelve su cookie de sesión. */
async function cajeroDe(app: FastifyInstance, sedeId: string, usuario: string) {
  const alta = await app.inject({
    method: "POST",
    url: `/api/usuarios?sede=${SEDE_PRINCIPAL}`,
    payload: { usuario, nombre: `Cajero ${usuario}`, contrasena: "contrasena-larga", sedeId },
  });
  expect(alta.statusCode).toBe(201);

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { usuario, contrasena: "contrasena-larga" },
  });
  const crudo = login.headers["set-cookie"];
  const texto = Array.isArray(crudo) ? crudo[0] : crudo;
  const m = texto ? new RegExp(`${NOMBRE_COOKIE_SESION}=([^;]+)`).exec(texto) : null;
  if (!m) throw new Error(`No se pudo loguear al cajero: ${login.statusCode} ${login.body}`);
  return { cookie: `${NOMBRE_COOKIE_SESION}=${m[1]}`, usuarioId: alta.json().usuario.id as string };
}

async function crearSedeHttp(app: FastifyInstance, nombre: string, prefijo: string) {
  const r = await app.inject({
    method: "POST",
    url: "/api/sedes",
    payload: { nombre, prefijoTicket: prefijo, direccion: `Calle ${nombre}` },
  });
  expect(r.statusCode).toBe(201);
  return r.json().sede.id as string;
}

async function crearServicio(app: FastifyInstance, codigo: string, nombre: string, precio: number) {
  const r = await app.inject({
    method: "POST",
    url: `/api/catalogo?sede=${SEDE_PRINCIPAL}`,
    payload: { codigo, nombre, tipo: "SERVICIO", categoria: "Barbería", precio },
  });
  expect(r.statusCode).toBe(201);
  return r.json().item.id as string;
}

describe("administrar sucursales por HTTP", () => {
  it("lista la principal sembrada y la nueva", async () => {
    const { app } = await apiDePrueba();
    await crearSedeHttp(app, "Centro", "SC");

    const r = await app.inject({ method: "GET", url: "/api/sedes" });
    const ids = r.json().sedes.map((s: { id: string }) => s.id);
    expect(ids).toContain(SEDE_PRINCIPAL);
    expect(ids).toContain("centro");
  });

  it("un cajero no puede ni ver ni crear sucursales", async () => {
    const { app } = await apiDePrueba();
    const { cookie } = await cajeroDe(app, SEDE_PRINCIPAL, "kevin");

    const ver = await app.inject({ method: "GET", url: "/api/sedes", headers: { cookie } });
    expect(ver.statusCode).toBe(403);

    const crear = await app.inject({
      method: "POST",
      url: "/api/sedes",
      headers: { cookie },
      payload: { nombre: "Trucha", prefijoTicket: "TR" },
    });
    expect(crear.statusCode).toBe(403);
  });
});

describe("la sucursal del cajero la decide el servidor", () => {
  /**
   * La prueba central de todo esto. Si falla, "cada cajero ve solo su local"
   * deja de ser una regla y pasa a ser una sugerencia que se salta con un
   * parámetro en la URL.
   */
  it("un cajero cobra SIEMPRE en su local, aunque pida otro por parámetro", async () => {
    const { app, pos } = await apiDePrueba();
    const centro = await crearSedeHttp(app, "Centro", "SC");
    const corte = await crearServicio(app, "COR", "CORTE", 2000);
    const { cookie } = await cajeroDe(app, centro, "kevin");

    const r = await app.inject({
      method: "POST",
      // Pide explícitamente la principal: tiene que ser ignorado.
      url: `/api/ventas?sede=${SEDE_PRINCIPAL}`,
      headers: { cookie },
      payload: {
        lineas: [{ itemId: corte, cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: "01K5B7M3QW8ZX2VDNPQR4T6Y9A",
      },
    });

    expect(r.statusCode).toBe(201);
    const venta = pos.p.ventas.get(r.json().venta.id)!;
    expect(venta.sedeId).toBe(centro);
    expect(venta.correlativo.startsWith("SC")).toBe(true);
  });

  it("el cajero ve el stock de su local, no el del otro", async () => {
    const { app, pos } = await apiDePrueba();
    const centro = await crearSedeHttp(app, "Centro", "SC");

    const cera = await app.inject({
      method: "POST",
      url: `/api/catalogo?sede=${SEDE_PRINCIPAL}`,
      payload: { codigo: "CERA", nombre: "CERA", tipo: "PRODUCTO", categoria: "Productos", precio: 1500 },
    });
    const itemId = cera.json().item.id as string;

    // Entra mercadería SOLO en la principal (el ADMIN opera ahí por defecto
    // cuando no elige otra... salvo que haya varias: por eso se pide explícita).
    await app.inject({
      method: "POST",
      url: `/api/inventario/entrada?sede=${SEDE_PRINCIPAL}`,
      payload: { itemId, cantidad: 10, motivo: "Compra" },
    });

    expect(pos.p.stockDe(SEDE_PRINCIPAL, itemId)).toBe(10);
    expect(pos.p.stockDe(centro, itemId)).toBe(0);

    const { cookie } = await cajeroDe(app, centro, "kevin");
    const r = await app.inject({ method: "GET", url: "/api/inventario", headers: { cookie } });
    const producto = r.json().productos.find((p: { id: string }) => p.id === itemId);
    expect(producto.stock).toBe(0);
  });

  it("cada cajero abre y arquea SU caja, sin verse entre locales", async () => {
    const { app } = await apiDePrueba();
    const centro = await crearSedeHttp(app, "Centro", "SC");
    const corte = await crearServicio(app, "COR", "CORTE", 2000);

    const kevin = await cajeroDe(app, SEDE_PRINCIPAL, "kevin");
    const ana = await cajeroDe(app, centro, "ana");

    for (const c of [kevin.cookie, ana.cookie]) {
      const r = await app.inject({
        method: "POST",
        url: "/api/caja/abrir",
        headers: { cookie: c },
        payload: { montoInicial: 10000 },
      });
      expect(r.statusCode).toBe(201);
    }

    // Ana cobra en Centro.
    await app.inject({
      method: "POST",
      url: "/api/ventas",
      headers: { cookie: ana.cookie },
      payload: {
        lineas: [{ itemId: corte, cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: "01K5B7M3QW8ZX2VDNPQR4T6Y9B",
      },
    });

    const cajaDeAna = await app.inject({ method: "GET", url: "/api/caja", headers: { cookie: ana.cookie } });
    const cajaDeKevin = await app.inject({ method: "GET", url: "/api/caja", headers: { cookie: kevin.cookie } });

    expect(cajaDeAna.json().arqueo.efectivoEnCajon).toBe(12000);
    // El cajón de Kevin no se enteró de la venta de Ana.
    expect(cajaDeKevin.json().arqueo.efectivoEnCajon).toBe(10000);
    expect(cajaDeKevin.json().arqueo.cantidadVentas).toBe(0);
  });

  it("mover un cajero de local le cierra la sesión", async () => {
    const { app } = await apiDePrueba();
    const centro = await crearSedeHttp(app, "Centro", "SC");
    const { cookie, usuarioId } = await cajeroDe(app, SEDE_PRINCIPAL, "kevin");

    const antes = await app.inject({ method: "GET", url: "/api/estado", headers: { cookie } });
    expect(antes.json().sede.id).toBe(SEDE_PRINCIPAL);

    await app.inject({ method: "POST", url: `/api/usuarios/${usuarioId}/sede`, payload: { sedeId: centro } });

    /**
     * La cookie vieja deja de valer. Si siguiera viva, el cajero seguiría
     * cobrando en su local anterior hasta que venciera.
     */
    const despues = await app.inject({ method: "GET", url: "/api/estado", headers: { cookie } });
    expect(despues.statusCode).toBe(401);
  });
});

describe("traslados por HTTP", () => {
  it("mueve mercadería y devuelve el stock de los dos lados", async () => {
    const { app } = await apiDePrueba();
    const centro = await crearSedeHttp(app, "Centro", "SC");

    const cera = await app.inject({
      method: "POST",
      url: `/api/catalogo?sede=${SEDE_PRINCIPAL}`,
      payload: { codigo: "CERA", nombre: "CERA", tipo: "PRODUCTO", categoria: "Productos", precio: 1500 },
    });
    const itemId = cera.json().item.id as string;

    await app.inject({
      method: "POST",
      url: `/api/inventario/entrada?sede=${SEDE_PRINCIPAL}`,
      payload: { itemId, cantidad: 10, motivo: "Compra" },
    });

    const r = await app.inject({
      method: "POST",
      url: "/api/sedes/traslados",
      payload: { itemId, desdeSedeId: SEDE_PRINCIPAL, haciaSedeId: centro, cantidad: 4, motivo: "Reposición" },
    });

    expect(r.statusCode).toBe(201);
    expect(r.json().desde.stock).toBe(6);
    expect(r.json().hacia.stock).toBe(4);
  });

  it("se niega a mover más de lo que hay, con un mensaje que dice cuánto hay", async () => {
    const { app } = await apiDePrueba();
    const centro = await crearSedeHttp(app, "Centro", "SC");

    const cera = await app.inject({
      method: "POST",
      url: `/api/catalogo?sede=${SEDE_PRINCIPAL}`,
      payload: { codigo: "CERA", nombre: "CERA", tipo: "PRODUCTO", categoria: "Productos", precio: 1500 },
    });
    const itemId = cera.json().item.id as string;

    const r = await app.inject({
      method: "POST",
      url: "/api/sedes/traslados",
      payload: { itemId, desdeSedeId: SEDE_PRINCIPAL, haciaSedeId: centro, cantidad: 5, motivo: "x" },
    });

    // Todo `ErrorDeNegocio` sale como 400 (ver el manejador en `http/app.ts`).
    expect(r.statusCode).toBe(400);
    expect(r.json().error.codigo).toBe("STOCK_INSUFICIENTE");
  });

  it("un cajero no puede trasladar mercadería", async () => {
    const { app } = await apiDePrueba();
    await crearSedeHttp(app, "Centro", "SC");
    const { cookie } = await cajeroDe(app, SEDE_PRINCIPAL, "kevin");

    const r = await app.inject({
      method: "POST",
      url: "/api/sedes/traslados",
      headers: { cookie },
      payload: { itemId: "x", desdeSedeId: SEDE_PRINCIPAL, haciaSedeId: "centro", cantidad: 1, motivo: "x" },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe("precios por sucursal por HTTP", () => {
  it("el precio propio solo cambia el de esa sucursal", async () => {
    const { app, pos } = await apiDePrueba();
    const centro = await crearSedeHttp(app, "Centro", "SC");
    const corte = await crearServicio(app, "COR", "CORTE", 2000);

    const r = await app.inject({
      method: "PUT",
      url: `/api/catalogo/${corte}/precio-sede`,
      payload: { sedeId: centro, precio: 2500, motivo: "Zona más cara" },
    });
    expect(r.statusCode).toBe(200);

    expect(pos.p.precioEn(centro, corte)).toBe(2500);
    expect(pos.p.precioEn(SEDE_PRINCIPAL, corte)).toBe(2000);

    const listado = await app.inject({ method: "GET", url: `/api/catalogo/${corte}/precios-sede` });
    const deCentro = listado.json().porSede.find((s: { sedeId: string }) => s.sedeId === centro);
    expect(deCentro.precio).toBe(2500);
    expect(deCentro.propio).toBe(true);
  });

  it("el cajero ve el precio de SU sucursal en el catálogo", async () => {
    const { app } = await apiDePrueba();
    const centro = await crearSedeHttp(app, "Centro", "SC");
    const corte = await crearServicio(app, "COR", "CORTE", 2000);
    await app.inject({
      method: "PUT",
      url: `/api/catalogo/${corte}/precio-sede`,
      payload: { sedeId: centro, precio: 2500 },
    });

    const { cookie } = await cajeroDe(app, centro, "ana");
    const r = await app.inject({ method: "GET", url: `/api/catalogo?sede=${SEDE_PRINCIPAL}`, headers: { cookie } });
    const item = r.json().items.find((i: { id: string }) => i.id === corte);

    // `precio` es el EFECTIVO de su local: así la grilla de cobro cobra lo que
    // corresponde sin saber que existen otras sucursales.
    expect(item.precio).toBe(2500);
    expect(item.precioCadena).toBe(2000);
    expect(item.precioPropio).toBe(true);
  });
});

/**
 * Con varios locales, un ADMIN que no eligió sucursal está mirando LA CADENA.
 *
 * Leer así es lo natural: el dueño abre el sistema para ver cómo va el negocio.
 * Escribir, no: no existe una respuesta correcta a "¿en cuál de los 22?", y
 * dejar que el servidor elija uno de reserva haría que una venta o una entrada
 * de stock caigan en un local donde nadie las hizo, sin ninguna señal hasta
 * que una caja no cuadre.
 */
describe("un ADMIN sin sucursal elegida", () => {
  it("LEE la cadena entera", async () => {
    const { app } = await apiDePrueba();
    await crearSedeHttp(app, "Centro", "SC");

    const r = await app.inject({ method: "GET", url: "/api/estado" });
    // `sede: null` es la señal de "estás mirando todo", y la pantalla la usa
    // para dejar el selector en «Todas».
    expect(r.json().sede).toBeNull();
    expect(r.json().siguienteCorrelativo).toBeNull();
  });

  it("NO puede cobrar hasta elegir una", async () => {
    const { app } = await apiDePrueba();
    await crearSedeHttp(app, "Centro", "SC");
    const corte = await crearServicio(app, "COR", "CORTE", 2000);

    const r = await app.inject({
      method: "POST",
      url: "/api/ventas",
      payload: {
        lineas: [{ itemId: corte, cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: "01K5B7M3QW8ZX2VDNPQR4T6Y9D",
      },
    });

    expect(r.statusCode).toBe(400);
    expect(r.json().error.codigo).toBe("SEDE_NO_ELEGIDA");
    expect(r.json().error.sugerencia).toMatch(/selector/i);
  });

  it("tampoco abrir la caja ni mover stock", async () => {
    const { app } = await apiDePrueba();
    await crearSedeHttp(app, "Centro", "SC");

    for (const url of ["/api/caja/abrir", "/api/inventario/entrada"]) {
      const r = await app.inject({ method: "POST", url, payload: { montoInicial: 0, itemId: "x", cantidad: 1, motivo: "x" } });
      expect(r.json().error.codigo, url).toBe("SEDE_NO_ELEGIDA");
    }
  });

  it("con UNA sola sucursal no pregunta nada: ahí la cadena y el local son lo mismo", async () => {
    const { app } = await apiDePrueba();
    const corte = await crearServicio(app, "COR", "CORTE", 2000);

    const r = await app.inject({
      method: "POST",
      url: "/api/ventas",
      payload: {
        lineas: [{ itemId: corte, cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: "01K5B7M3QW8ZX2VDNPQR4T6Y9E",
      },
    });
    expect(r.statusCode).toBe(201);
  });
});
