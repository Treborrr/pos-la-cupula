#!/usr/bin/env node
/**
 * Llena el POS con datos de DEMOSTRACIÓN para poder recorrerlo.
 *
 * Existe porque un sistema recién instalado tiene todas las pantallas vacías:
 * el historial no muestra nada, los reportes no tienen qué graficar y el
 * arqueo da cero. Así no se puede juzgar si la herramienta sirve.
 *
 * TODO LO QUE CARGA ES INVENTADO salvo los tres servicios de barbería, que
 * salen del Excel real. Los nombres de barberos y clientes, los productos y
 * las ventas son de mentira.
 *
 * Para empezar de cero:  rm -rf datos-dev  (y reiniciar el servidor)
 *
 * Uso:  node herramientas/sembrar-demostracion.mjs [--url http://localhost:7070]
 */

import { argv, exit } from "node:process";

const argumentos = argv.slice(2);
const posicionUrl = argumentos.indexOf("--url");
const url = (posicionUrl >= 0 ? argumentos[posicionUrl + 1] : "http://localhost:7070").replace(/\/$/, "");

const ulid = () => {
  const C = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let s = "";
  for (let i = 0; i < 26; i++) s += C[Math.floor(Math.random() * 32)];
  return s;
};

async function api(metodo, ruta, cuerpo) {
  const res = await fetch(`${url}/api${ruta}`, {
    method: metodo,
    headers: cuerpo ? { "Content-Type": "application/json" } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await res.json().catch(() => null);
  if (!res.ok && res.status !== 200) return { error: datos?.error, estado: res.status };
  return datos;
}

try {
  await fetch(`${url}/api/salud`);
} catch {
  console.error(`No responde el POS en ${url}. Levántalo con  npm run dev.`);
  exit(1);
}

console.log("Sembrando datos de DEMOSTRACIÓN…\n");

// ── Catálogo ─────────────────────────────────────────────────────────────────

const SERVICIOS = [
  // Estos tres SÍ son reales: salen del Excel de la barbería.
  { codigo: "COR", nombre: "CORTE CLASICO", precio: 2000, orden: 10 },
  { codigo: "COR-D", nombre: "CORTE DEGRADADO", precio: 2500, orden: 20 },
  { codigo: "BAR", nombre: "BARBA", precio: 1000, orden: 30 },
];

/**
 * Los productos llevan MARCA y PRECIO DE COMPRA, y uno entra SIN PRECIO.
 *
 * No es adorno: sin costos, el reporte de margen sale vacío y quien mira la
 * demostración concluye que esa parte no funciona. Y el producto sin precio
 * está para que se vea el caso que trae el catálogo real —119 de 137 llegaron
 * así— y cómo se cobra escribiendo el precio en el momento.
 */
const PRODUCTOS = [
  { codigo: "CERA", marca: "NIVEL TRES", nombre: "PASTA MODELADORA", precio: 2500, costo: 1400, stockMinimo: 3, stockInicial: 12, categoria: "Productos", orden: 100 },
  { codigo: "GEL", marca: "ROLBA", nombre: "GOMINA FIJADORA", precio: 1800, costo: 1000, stockMinimo: 3, stockInicial: 8, categoria: "Productos", orden: 110 },
  { codigo: "SHAMP", marca: "DON NISH", nombre: "SHAMPOO", precio: 3200, costo: 2100, stockMinimo: 2, stockInicial: 2, categoria: "Productos", orden: 120 },
  { codigo: "VAPE", marca: "OXBIR", nombre: "VAPE DESECHABLE", precio: 4500, costo: 2800, stockMinimo: 5, stockInicial: 20, categoria: "Vapes", orden: 200 },
  { codigo: "PIPA", marca: "VPRA", nombre: "PIPA", precio: 3500, costo: 2000, stockMinimo: 2, stockInicial: 7, categoria: "Vapes", orden: 210 },
  { codigo: "MALLA", marca: "VPRA", nombre: "MALLA PARA PIPA", precio: 200, costo: 80, stockMinimo: 20, stockInicial: 100, categoria: "Vapes", orden: 220 },
  { codigo: "TRIM", marca: "KEMOI", nombre: "TRIMMER", precio: 12000, costo: 8500, stockMinimo: 1, stockInicial: 3, categoria: "Equipos", orden: 300 },
  // Sin precio y sin costo: el caso que hay que poder ver funcionando.
  { codigo: "LACA", marca: "FORAJIDO", nombre: "FIJADOR DORADO", precio: null, stockMinimo: 2, stockInicial: 6, categoria: "Productos", orden: 130 },
];

const items = {};
for (const s of SERVICIOS) {
  const r = await api("POST", "/catalogo", { ...s, tipo: "SERVICIO", categoria: "Barbería" });
  if (r.item) items[s.codigo] = r.item.id;
}
for (const p of PRODUCTOS) {
  const r = await api("POST", "/catalogo", { ...p, tipo: "PRODUCTO" });
  if (r.item) items[p.codigo] = r.item.id;
}
console.log(`  catálogo: ${Object.keys(items).length} ítems`);

// ── Barberos y clientes (inventados) ─────────────────────────────────────────

const barberos = [];
for (const nombre of ["Jhon", "Kevin", "Marco"]) {
  const r = await api("POST", "/barberos", { nombre });
  if (r.barbero) barberos.push(r.barbero.id);
}

const clientes = [];
for (const [nombre, telefono] of [
  ["José Ramírez", "987654321"],
  ["Carlos Mendoza", "912345678"],
  // Homónimo a propósito: así se ve cómo el POS pregunta en vez de adivinar
  // cuando el QR de la tarjeta de fidelidad solo trae el nombre.
  ["Carlos Mendoza", "998877665"],
  ["Luis Peña", ""],
  ["Andrés Quispe", "944332211"],
]) {
  const r = await api("POST", "/clientes", { nombre, telefono: telefono || undefined });
  if (r.cliente) clientes.push(r.cliente.id);
}
console.log(`  ${barberos.length} barberos y ${clientes.length} clientes (inventados)`);

// Una tarjeta de fidelidad vinculada, para ver la identificación exacta.
if (clientes[0]) {
  await api("POST", `/clientes/${clientes[0]}/fidelidad`, {
    serial: "clxk3j2n90000abcd1234efgh",
    origen: "serial",
  });
}

// ── Caja y ventas ────────────────────────────────────────────────────────────

await api("POST", "/caja/abrir", { montoInicial: 5000 });

const azar = (a) => a[Math.floor(Math.random() * a.length)];
const VENTAS = [
  { lineas: [["COR-D", 1]], medio: "YAPE", cliente: 0 },
  { lineas: [["COR", 1], ["BAR", 1]], medio: "EFECTIVO", recibido: 5000 },
  { lineas: [["COR-D", 1], ["CERA", 1]], medio: "TARJETA", cliente: 1 },
  { lineas: [["COR", 2]], medio: "EFECTIVO", recibido: 5000 },
  { lineas: [["VAPE", 1], ["MALLA", 2]], medio: "YAPE" },
  { lineas: [["COR-D", 1], ["BAR", 1]], mixto: true, cliente: 3 },
  { lineas: [["BAR", 1]], medio: "EFECTIVO", recibido: 1000 },
  { lineas: [["COR", 1], ["GEL", 1]], medio: "YAPE", cliente: 4 },
  { lineas: [["SHAMP", 3]], medio: "TARJETA", descuento: 500 },
  { lineas: [["COR-D", 1]], medio: "EFECTIVO", recibido: 3000 },
  // La LACA no aparece en ninguna venta a propósito: no tiene precio, así que
  // no se puede vender. Queda en el catálogo y en el inventario para que se vea
  // el caso —y para que Reportes la muestre entre lo que no rota—.
];

let cobradas = 0;
let primeraVenta = null;

/**
 * Cuánto cuesta una línea por unidad.
 *
 * Falla ruidosamente si el ítem no tiene precio: el servidor rechazaría la
 * venta igual, y es mejor enterarse acá con el nombre del producto que recibir
 * un error de la API sobre una venta a medio armar.
 */
const precioDeLinea = ([codigo]) => {
  const def = [...SERVICIOS, ...PRODUCTOS].find((x) => x.codigo === codigo);
  if (def?.precio === null || def?.precio === undefined) {
    throw new Error(`"${codigo}" no tiene precio de lista y no se puede vender. Sácalo de las ventas de ejemplo.`);
  }
  return def.precio;
};

for (const v of VENTAS) {
  const lineas = v.lineas.map(([codigo, cantidad]) => ({
    itemId: items[codigo],
    cantidad,
    barberoId: SERVICIOS.some((s) => s.codigo === codigo) ? azar(barberos) : null,
  }));

  const subtotal = v.lineas.reduce((a, linea) => a + precioDeLinea(linea) * linea[1], 0);
  const total = subtotal - (v.descuento ?? 0);

  const pagos = v.mixto
    ? [
        { medio: "EFECTIVO", monto: Math.floor(total / 2) },
        { medio: "YAPE", monto: total - Math.floor(total / 2) },
      ]
    : [
        {
          medio: v.medio,
          monto: total,
          ...(v.recibido ? { recibido: v.recibido, vuelto: Math.max(0, v.recibido - total) } : {}),
        },
      ];

  const r = await api("POST", "/ventas", {
    lineas,
    pagos,
    descuento: v.descuento ?? 0,
    // Cliente en TODAS las ventas. La instalación viene con "cliente
    // obligatorio" activado, así que las ventas sin cliente eran rechazadas y
    // la demostración quedaba con tres ventas de once y los reportes vacíos.
    // Las que no eligen uno en particular reciben un cliente rotado, y el
    // índice se envuelve: una venta que pedía el cliente 4 de una lista de 4
    // quedaba sin cliente y se rechazaba igual.
    clienteId: clientes.length ? clientes[(v.cliente ?? cobradas) % clientes.length] : null,
    claveIdempotencia: ulid(),
  });

  if (r.venta) {
    cobradas++;
    primeraVenta ??= r.venta;
  } else {
    console.error("   ✗", r.error?.mensaje);
  }
}
console.log(`  ${cobradas} ventas cobradas`);

// Una anulada, para ver cómo queda tachada y cómo vuelve el stock.
if (primeraVenta) {
  await api("POST", `/ventas/${primeraVenta.id}/anular`, { motivo: "El cliente se arrepintió" });
  console.log(`  1 venta anulada (${primeraVenta.correlativo})`);
}

// Un movimiento de inventario, para que el kardex tenga historia.
if (items["CERA"]) {
  await api("POST", "/inventario/entrada", {
    itemId: items["CERA"],
    cantidad: 6,
    motivo: "Compra a proveedor",
    referencia: "Factura 1234",
  });
}
if (items["PIPA"]) {
  await api("POST", "/inventario/merma", {
    itemId: items["PIPA"],
    cantidad: 1,
    motivo: "Se rompió al desembalar",
  });
}

const estado = await api("GET", "/estado");
console.log(`\nListo. Siguiente nota: ${estado.siguienteCorrelativo}`);
console.log(`\n   ${url}\n`);
console.log("Para empezar de cero:  rm -rf datos-dev  y reiniciar el servidor.");
