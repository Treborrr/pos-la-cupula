/**
 * Pruebas de la API de punta a punta, con `inject` de Fastify: recorren el
 * camino completo (HTTP → dominio → disco → proyección) sin abrir un puerto.
 */

import { describe, expect, it, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";

import { construirApp } from "../src/http/app";
import { ImpresoraVistaPrevia } from "../src/adaptadores/impresora/ImpresoraVistaPrevia";
import { ServicioPos } from "../src/servicios/Pos";
import { ServicioDeRespaldos } from "../src/servicios/Respaldos";
import { relojDelSistema } from "../src/puertos/Reloj";
import { abrirAlmacen, borrar, carpetaTemporal } from "./ayuda";

const aCerrar: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of aCerrar.splice(0)) await fn().catch(() => undefined);
});

async function apiDePrueba(
  opciones: { exigirCliente?: boolean } = {},
): Promise<{ app: FastifyInstance; pos: ServicioPos }> {
  const dir = await carpetaTemporal();
  const pos = await ServicioPos.abrir(await abrirAlmacen(dir));
  // Salvo que la prueba sea justamente sobre la regla, se apaga: lo que se
  // ejercita aquí es el camino HTTP → dominio → disco.
  await pos.guardarConfig("ventas.exigirCliente", opciones.exigirCliente ?? false);
  const app = await construirApp({
    pos,
    impresora: new ImpresoraVistaPrevia(),
    respaldos: new ServicioDeRespaldos(dir, relojDelSistema, null),
    version: "pruebas",
  });
  aCerrar.push(async () => {
    await app.close();
    await pos.cerrar();
    await borrar(dir);
  });
  return { app, pos };
}

async function crearServicio(app: FastifyInstance, codigo: string, nombre: string, precio: number) {
  const r = await app.inject({
    method: "POST",
    url: "/api/catalogo",
    payload: { codigo, nombre, tipo: "SERVICIO", categoria: "Barbería", precio },
  });
  expect(r.statusCode).toBe(201);
  return r.json().item.id as string;
}

describe("catálogo", () => {
  it("crea un ítem y lo devuelve en el listado", async () => {
    const { app } = await apiDePrueba();
    await crearServicio(app, "COR", "CORTE CLASICO", 2000);

    const r = await app.inject({ method: "GET", url: "/api/catalogo" });
    expect(r.json().items).toHaveLength(1);
    expect(r.json().categorias).toEqual(["Barbería"]);
  });

  it("rechaza un código repetido con un mensaje que explica el daño", async () => {
    // El Excel tenía LANG, CEVC y MENU repetidos, y eso volvía invendibles a
    // tres productos sin que nadie se enterara.
    const { app } = await apiDePrueba();
    await crearServicio(app, "COR", "CORTE CLASICO", 2000);

    const r = await app.inject({
      method: "POST",
      url: "/api/catalogo",
      payload: { codigo: "cor", nombre: "OTRA COSA", tipo: "SERVICIO", categoria: "X", precio: 100 },
    });

    expect(r.statusCode).toBe(400);
    expect(r.json().error.codigo).toBe("CODIGO_REPETIDO");
    expect(r.json().error.sugerencia).toMatch(/no se puede vender/);
  });
});

describe("cobrar por HTTP", () => {
  it("cobra, devuelve el correlativo y la vista previa del ticket", async () => {
    const { app } = await apiDePrueba();
    const itemId = await crearServicio(app, "COR-D", "CORTE DEGRADADO", 2500);

    const r = await app.inject({
      method: "POST",
      url: "/api/ventas",
      payload: {
        lineas: [{ itemId, cantidad: 2 }],
        pagos: [{ medio: "YAPE", monto: 5000 }],
        claveIdempotencia: ulid(),
      },
    });

    expect(r.statusCode).toBe(201);
    const cuerpo = r.json();
    expect(cuerpo.venta.correlativo).toBe("NV000030");
    expect(cuerpo.venta.total).toBe(5000);
    // La ticketera todavía no está configurada, pero el ticket se genera igual.
    expect(cuerpo.impresion.impreso).toBe(false);
    expect(cuerpo.impresion.vistaPrevia).toContain("LA CÚPULA TATTOO BARBER SHOP");
    expect(cuerpo.impresion.vistaPrevia).toContain("CUP1|V|NV000030");
  });

  it("el mismo POST dos veces responde 200 y no cobra de nuevo", async () => {
    const { app, pos } = await apiDePrueba();
    const itemId = await crearServicio(app, "COR", "CORTE", 2000);
    const payload = {
      lineas: [{ itemId, cantidad: 1 }],
      pagos: [{ medio: "EFECTIVO", monto: 2000 }],
      claveIdempotencia: ulid(),
    };

    const primera = await app.inject({ method: "POST", url: "/api/ventas", payload });
    const segunda = await app.inject({ method: "POST", url: "/api/ventas", payload });

    expect(primera.statusCode).toBe(201);
    expect(segunda.statusCode).toBe(200);
    expect(segunda.json().duplicada).toBe(true);
    expect(segunda.json().venta.correlativo).toBe(primera.json().venta.correlativo);
    expect(pos.p.ventas.size).toBe(1);
  });

  it("traduce el error de negocio a 400 con un mensaje para el mostrador", async () => {
    const { app } = await apiDePrueba();
    const itemId = await crearServicio(app, "COR", "CORTE", 2000);

    const r = await app.inject({
      method: "POST",
      url: "/api/ventas",
      payload: {
        lineas: [{ itemId, cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 1500 }],
        claveIdempotencia: ulid(),
      },
    });

    expect(r.statusCode).toBe(400);
    expect(r.json().error.codigo).toBe("PAGOS_NO_CUADRAN");
    expect(r.json().error.mensaje).toMatch(/Faltan S\/ 5\.00/);
  });

  it("anula con motivo y la venta queda marcada, no borrada", async () => {
    const { app } = await apiDePrueba();
    const itemId = await crearServicio(app, "COR", "CORTE", 2000);
    const venta = (
      await app.inject({
        method: "POST",
        url: "/api/ventas",
        payload: {
          lineas: [{ itemId, cantidad: 1 }],
          pagos: [{ medio: "EFECTIVO", monto: 2000 }],
          claveIdempotencia: ulid(),
        },
      })
    ).json().venta;

    const sinMotivo = await app.inject({
      method: "POST",
      url: `/api/ventas/${venta.id}/anular`,
      payload: { motivo: "" },
    });
    expect(sinMotivo.statusCode).toBe(400);

    const r = await app.inject({
      method: "POST",
      url: `/api/ventas/${venta.correlativo}/anular`, // también acepta correlativo
      payload: { motivo: "Cobro duplicado" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().venta.anulada).toBe(true);

    const listado = await app.inject({ method: "GET", url: "/api/ventas" });
    expect(listado.json().ventas).toHaveLength(1);
    expect(listado.json().totales.total).toBe(0); // anulada: no suma
  });
});

describe("enrutador de escaneos", () => {
  it("reconoce el QR de un ticket y devuelve la venta", async () => {
    const { app } = await apiDePrueba();
    const itemId = await crearServicio(app, "COR", "CORTE", 2000);
    await app.inject({
      method: "POST",
      url: "/api/ventas",
      payload: {
        lineas: [{ itemId, cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: ulid(),
      },
    });

    const r = await app.inject({ method: "GET", url: "/api/escaneo?valor=CUP1|V|NV000030" });
    expect(r.json().tipo).toBe("venta");
    expect(r.json().venta.correlativo).toBe("NV000030");
  });

  it("reconoce un código del catálogo", async () => {
    const { app } = await apiDePrueba();
    await crearServicio(app, "COR-D", "CORTE DEGRADADO", 2500);

    const r = await app.inject({ method: "GET", url: "/api/escaneo?valor=cor-d" });
    expect(r.json().tipo).toBe("item");
    expect(r.json().item.nombre).toBe("CORTE DEGRADADO");
  });

  it("el ítem escaneado viene completo, igual que el del catálogo", async () => {
    // El escaneo devolvía el ítem CRUDO, sin `nombreCompleto` ni `stock`,
    // mientras `/catalogo` los incluía. La pantalla de cobro usa los dos: al
    // escanear un producto sin precio mostraba "undefined no tiene precio".
    const { app } = await apiDePrueba();
    await app.inject({
      method: "POST",
      url: "/api/catalogo",
      payload: {
        codigo: "LACA",
        marca: "FORAJIDO",
        nombre: "LACA DORADA",
        tipo: "PRODUCTO",
        categoria: "Productos",
        precio: null,
        stockInicial: 4,
      },
    });

    const escaneado = (await app.inject({ method: "GET", url: "/api/escaneo?valor=LACA" })).json().item;
    const delCatalogo = (await app.inject({ method: "GET", url: "/api/catalogo" })).json().items[0];

    expect(escaneado.nombreCompleto).toBe("FORAJIDO LACA DORADA");
    expect(escaneado.stock).toBe(4);
    expect(escaneado.precio).toBeNull();
    // La forma tiene que ser la MISMA: es el mismo objeto para la misma pantalla.
    expect(Object.keys(escaneado).sort()).toEqual(Object.keys(delCatalogo).sort());
  });

  it("crear y editar un ítem también devuelven la forma completa", async () => {
    const { app } = await apiDePrueba();
    const creado = (
      await app.inject({
        method: "POST",
        url: "/api/catalogo",
        payload: { marca: "NIVEL TRES", nombre: "CERA", tipo: "PRODUCTO", categoria: "P", precio: 4500, stockInicial: 3 },
      })
    ).json().item;

    expect(creado.nombreCompleto).toBe("NIVEL TRES CERA");
    expect(creado.stock).toBe(3);

    const editado = (
      await app.inject({ method: "PATCH", url: `/api/catalogo/${creado.id}`, payload: { marca: "FORAJIDO" } })
    ).json().item;
    expect(editado.nombreCompleto).toBe("FORAJIDO CERA");
    expect(editado.stock).toBe(3);
  });

  it("identifica al cliente por el nombre que trae el QR de fidelidad", async () => {
    // El programa de La Cúpula está en modo qrContent:"nombre".
    const { app } = await apiDePrueba();
    await app.inject({ method: "POST", url: "/api/clientes", payload: { nombre: "José Ramírez" } });

    // Llega sin tildes, como puede pasar si la pistola tiene otro layout.
    const r = await app.inject({ method: "GET", url: "/api/escaneo?valor=JOSE RAMIREZ" });
    expect(r.json().tipo).toBe("cliente");
    // Guardado en mayúsculas: todos los nombres se normalizan al darlos de alta.
    expect(r.json().cliente.nombre).toBe("JOSÉ RAMÍREZ");
    expect(r.json().exacto).toBe(false); // por nombre, no por serial
  });

  it("avisa cuando hay homónimos en vez de elegir uno al azar", async () => {
    const { app } = await apiDePrueba();
    await app.inject({ method: "POST", url: "/api/clientes", payload: { nombre: "Carlos Mendoza" } });
    // El segundo hay que pedirlo a propósito: el alta normal ya rechaza un
    // nombre repetido. Dos personas pueden llamarse igual de verdad, y es ese
    // caso —el único que produce ambigüedad— el que se está probando.
    await app.inject({
      method: "POST",
      url: "/api/clientes",
      payload: { nombre: "Carlos Mendoza", permitirHomonimo: true },
    });

    const r = await app.inject({ method: "GET", url: "/api/escaneo?valor=Carlos Mendoza" });
    expect(r.json().tipo).toBe("clienteAmbiguo");
    expect(r.json().candidatos).toHaveLength(2);
  });

  it("identifica por serial de TarjetaCloud de forma exacta", async () => {
    const { app } = await apiDePrueba();
    const cliente = (
      await app.inject({ method: "POST", url: "/api/clientes", payload: { nombre: "Luis Torres" } })
    ).json().cliente;

    const serial = "clxk3j2n90000abcd1234efgh";
    await app.inject({
      method: "POST",
      url: `/api/clientes/${cliente.id}/fidelidad`,
      payload: { serial, origen: "serial" },
    });

    const r = await app.inject({ method: "GET", url: `/api/escaneo?valor=${serial}` });
    expect(r.json().tipo).toBe("cliente");
    expect(r.json().exacto).toBe(true);
  });

  it("distingue una tarjeta desconocida de un código inexistente", async () => {
    const { app } = await apiDePrueba();

    const tarjeta = await app.inject({
      method: "GET",
      url: "/api/escaneo?valor=clzzzz111122223333444455",
    });
    expect(tarjeta.json().esSerialDeTarjeta).toBe(true);
    expect(tarjeta.json().mensaje).toMatch(/Tarjeta de fidelidad no registrada/);

    const basura = await app.inject({ method: "GET", url: "/api/escaneo?valor=XYZ99" });
    expect(basura.json().esSerialDeTarjeta).toBe(false);
    expect(basura.json().sugerencia).toMatch(/Catálogo/);
  });
});

describe("inventario y caja por HTTP", () => {
  it("descuenta stock al vender y lo refleja en el kardex", async () => {
    const { app } = await apiDePrueba();
    const item = (
      await app.inject({
        method: "POST",
        url: "/api/catalogo",
        payload: {
          codigo: "CERA",
          nombre: "CERA MODELADORA",
          tipo: "PRODUCTO",
          categoria: "Productos",
          precio: 3500,
          stockMinimo: 3,
          stockInicial: 10,
        },
      })
    ).json().item;

    await app.inject({
      method: "POST",
      url: "/api/ventas",
      payload: {
        lineas: [{ itemId: item.id, cantidad: 8 }],
        pagos: [{ medio: "TARJETA", monto: 28000 }],
        claveIdempotencia: ulid(),
      },
    });

    const inventario = await app.inject({ method: "GET", url: "/api/inventario" });
    expect(inventario.json().productos[0].stock).toBe(2);
    // Mínimo 3 y quedan 2: por debajo. (Y con 3 también avisaría: el campo se
    // llama "avisar cuando queden", así que en 3 hay que avisar.)
    expect(inventario.json().productos[0].bajoMinimo).toBe(true);

    const kardex = await app.inject({ method: "GET", url: `/api/inventario/${item.id}/kardex` });
    const movimientos = kardex.json().movimientos;
    expect(movimientos[0].origen).toBe("venta");
    expect(movimientos[0].cantidad).toBe(-8);
    expect(movimientos[0].saldo).toBe(2);
    expect(movimientos[1].origen).toBe("entrada");
  });

  it("abre, arquea y cierra el turno mostrando la advertencia de egresos", async () => {
    const { app } = await apiDePrueba();
    const itemId = await crearServicio(app, "COR", "CORTE", 2000);

    await app.inject({ method: "POST", url: "/api/caja/abrir", payload: { montoInicial: 5000 } });
    await app.inject({
      method: "POST",
      url: "/api/ventas",
      payload: {
        lineas: [{ itemId, cantidad: 1 }],
        pagos: [{ medio: "EFECTIVO", monto: 2000 }],
        claveIdempotencia: ulid(),
      },
    });

    const caja = await app.inject({ method: "GET", url: "/api/caja" });
    expect(caja.json().arqueo.efectivoEnCajon).toBe(7000);
    expect(caja.json().advertencia).toMatch(/no descuenta las salidas/);

    const cierre = await app.inject({
      method: "POST",
      url: "/api/caja/cerrar",
      payload: { contadoEfectivo: 6950 },
    });
    expect(cierre.json().diferencia).toBe(-50);
    expect(cierre.json().integridad.ok).toBe(true);
  });
});

describe("«stock bajo» dice lo mismo en todos lados", () => {
  /**
   * Tres pantallas mostraban tres respuestas a la misma pregunta: sobre el
   * catálogo real, el encabezado avisaba "0 con stock bajo" mientras la tabla
   * de inventario marcaba 28 productos. Dos números contradictorios en la misma
   * pantalla hacen que el dueño deje de creerle a los dos.
   */
  async function conProductos(app: Awaited<ReturnType<typeof apiDePrueba>>["app"]) {
    const alta = (codigo: string, stockMinimo: number, stockInicial: number) =>
      app.inject({
        method: "POST",
        url: "/api/catalogo",
        payload: { codigo, nombre: codigo, tipo: "PRODUCTO", categoria: "P", precio: 1000, stockMinimo, stockInicial },
      });

    await alta("SINMIN", 0, 0); // sin mínimo fijado y agotado
    await alta("ENMIN", 2, 2); // justo en su mínimo
    await alta("SOBRE", 2, 5); // por encima
    await alta("VACIO", 3, 0); // agotado y con mínimo
  }

  const nombresAlerta = (r: { alertas: { nombre: string }[] }) => r.alertas.map((a) => a.nombre).sort();

  it("el encabezado, la tabla y el reporte cuentan lo mismo", async () => {
    const { app } = await apiDePrueba();
    await conProductos(app);

    const inventario = (await app.inject({ method: "GET", url: "/api/inventario" })).json();
    const estado = (await app.inject({ method: "GET", url: "/api/estado" })).json();
    const hoy = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const reporte = (
      await app.inject({ method: "GET", url: `/api/reportes/resumen?desde=${hoy}&hasta=${hoy}` })
    ).json();

    const enTabla = inventario.productos.filter((p: { bajoMinimo: boolean }) => p.bajoMinimo).length;

    expect(enTabla).toBe(inventario.alertas.length);
    expect(enTabla).toBe(estado.alertasDeStock);
    expect(enTabla).toBe(reporte.inventario.bajoMinimo);
  });

  it("un mínimo en 0 significa «no me avises», no «avísame en cero»", async () => {
    // Es el valor por defecto de todo producto que entra sin la columna STOCK
    // MÍNIMO, o sea el catálogo entero del cliente. Si avisara, los agotados
    // saldrían dos veces y la alerta dejaría de señalar lo que el dueño pidió.
    const { app } = await apiDePrueba();
    await conProductos(app);

    const inventario = (await app.inject({ method: "GET", url: "/api/inventario" })).json();

    expect(nombresAlerta(inventario)).toEqual(["ENMIN", "VACIO"]);
    // SINMIN está agotado y no aparece como alerta, pero sí como agotado.
    expect(inventario.productos.find((p: { codigo: string }) => p.codigo === "SINMIN").stock).toBe(0);
  });

  it("avisa AL LLEGAR al mínimo, no al pasarlo", async () => {
    // El campo se llama "avisar cuando queden": si dice 2, en 2 hay que avisar.
    // Antes era `<` y el aviso llegaba un producto tarde.
    const { app } = await apiDePrueba();
    await conProductos(app);

    const inventario = (await app.inject({ method: "GET", url: "/api/inventario" })).json();
    const enMin = inventario.productos.find((p: { codigo: string }) => p.codigo === "ENMIN");
    const sobre = inventario.productos.find((p: { codigo: string }) => p.codigo === "SOBRE");

    expect(enMin.bajoMinimo).toBe(true);
    expect(sobre.bajoMinimo).toBe(false);
  });

  it("el stock negativo siempre alerta, aunque no haya mínimo fijado", async () => {
    const { app } = await apiDePrueba();
    const item = (
      await app.inject({
        method: "POST",
        url: "/api/catalogo",
        payload: { codigo: "NEG", nombre: "NEG", tipo: "PRODUCTO", categoria: "P", precio: 1000, stockInicial: 1 },
      })
    ).json().item;

    // Se vende más de lo que había: el POS no bloquea, pero el saldo queda en −2.
    await app.inject({
      method: "POST",
      url: "/api/ventas",
      payload: {
        lineas: [{ itemId: item.id, cantidad: 3 }],
        pagos: [{ medio: "EFECTIVO", monto: 3000 }],
        claveIdempotencia: ulid(),
      },
    });

    const inventario = (await app.inject({ method: "GET", url: "/api/inventario" })).json();
    expect(inventario.productos[0].stock).toBe(-2);
    expect(inventario.productos[0].bajoMinimo).toBe(true);
    expect(inventario.alertas).toHaveLength(1);
  });
});

describe("salud", () => {
  it("reporta integridad, memoria y estado de la impresora", async () => {
    const { app } = await apiDePrueba();
    await crearServicio(app, "COR", "CORTE", 2000);

    const r = await app.inject({ method: "GET", url: "/api/salud" });
    const cuerpo = r.json();
    expect(cuerpo.log.integro).toBe(true);
    // Dos: el `item.creado` de arriba y el `config.actualizada` que escribe
    // `apiDePrueba` al apagar la exigencia de cliente.
    expect(cuerpo.log.eventos).toBe(2);
    expect(cuerpo.impresora.disponible).toBe(false);
    expect(cuerpo.memoria.usadaMB).toBeGreaterThan(0);
  });

  it("devuelve 404 con forma de error para rutas de API inexistentes", async () => {
    const { app } = await apiDePrueba();
    const r = await app.inject({ method: "GET", url: "/api/no-existe" });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.codigo).toBe("NO_ENCONTRADO");
  });
});
