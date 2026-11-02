/**
 * Siembra un log de eventos realista para MEDIR el coste de las rutas.
 * Archivo TEMPORAL de auditoria: se borra al terminar.
 *
 *   tsx sembrar-auditoria-temporal.mts <directorio> <ventas> <sedes> <items> <clientes>
 */

import { ulid } from "ulid";
import type { EventoNuevo } from "@cupula/contratos";
import { AlmacenArchivoJsonl } from "./src/adaptadores/almacen/ArchivoJsonl";
import { hashearContrasena } from "./src/seguridad/contrasenas";

const [dir, nVentasTxt, nSedesTxt, nItemsTxt, nClientesTxt] = process.argv.slice(2);
const N_VENTAS = Number(nVentasTxt ?? 14000);
const N_SEDES = Number(nSedesTxt ?? 1);
const N_ITEMS = Number(nItemsTxt ?? 130);
const N_CLIENTES = Number(nClientesTxt ?? 2500);

// Reloj controlable: avanza dia a dia para que las ventas se repartan en fechas.
let t = new Date("2024-01-02T09:00:00.000-05:00").getTime();
const OFFSET = -5 * 60;
function conOffset(fecha: Date): string {
  const local = new Date(fecha.getTime() + OFFSET * 60_000);
  const p = (n: number, largo = 2) => String(n).padStart(largo, "0");
  return (
    `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}` +
    `T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}` +
    `.${p(local.getUTCMilliseconds(), 3)}-05:00`
  );
}
const reloj = { ahora: () => conOffset(new Date(t)), ms: () => t };

const almacen = await AlmacenArchivoJsonl.abrir({ directorio: dir, reloj, sinBloqueo: true });

// ── Semilla fija (determinista) ───────────────────────────────────────────────
let semilla = 12345;
const rnd = () => {
  semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
  return semilla / 0x7fffffff;
};
const elegir = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;

const sedes = ["principal", ...Array.from({ length: N_SEDES - 1 }, (_, i) => `sede-${i + 2}`)];
const prefijos = ["NV", ...Array.from({ length: N_SEDES - 1 }, (_, i) => `S${i + 2}A`)];

const itemIds = Array.from({ length: N_ITEMS }, () => ulid());
const clienteIds = Array.from({ length: N_CLIENTES }, () => ulid());
const barberoIds = Array.from({ length: Math.max(3, N_SEDES * 3) }, () => ulid());

const inicial: EventoNuevo[] = [];

inicial.push({ tipo: "config.actualizada", datos: { clave: "ventas.exigirTurnoAbierto", valor: false } });
inicial.push({ tipo: "config.actualizada", datos: { clave: "ventas.exigirCliente", valor: false } });
inicial.push({ tipo: "config.actualizada", datos: { clave: "negocio.nombre", valor: "LA CUPULA" } });

for (let i = 0; i < N_SEDES; i++) {
  inicial.push({
    tipo: "sede.creada",
    datos: {
      sedeId: sedes[i]!,
      nombre: i === 0 ? "Principal" : `Sucursal ${i + 1}`,
      direccion: "Av. Siempre Viva 123",
      ciudad: "Bagua",
      prefijoTicket: prefijos[i]!,
    },
  });
}

const CATEGORIAS = ["Barberia", "Cuidado", "Afeitado", "Pomadas", "Shampoo", "Accesorios"];
const MARCAS = ["LA CUPULA", "NIVEL TRES", "FORAJIDO", "AMERICAN CREW", "SUAVECITO", ""];
for (let i = 0; i < N_ITEMS; i++) {
  const esProducto = i % 3 !== 0;
  inicial.push({
    tipo: "item.creado",
    datos: {
      itemId: itemIds[i]!,
      codigo: `${esProducto ? "P" : "S"}${String(i).padStart(4, "0")}`,
      marca: MARCAS[i % MARCAS.length] || undefined,
      nombre: `ITEM ${i} DE PRUEBA`,
      tipo: esProducto ? "PRODUCTO" : "SERVICIO",
      categoria: CATEGORIAS[i % CATEGORIAS.length]!,
      precio: 1500 + (i % 40) * 250,
      costo: esProducto ? 800 + (i % 30) * 120 : undefined,
      stockMinimo: esProducto ? 3 : undefined,
    },
  });
}

for (let i = 0; i < barberoIds.length; i++) {
  inicial.push({
    tipo: "barbero.creado",
    datos: { barberoId: barberoIds[i]!, nombre: `Barbero ${i + 1}`, sedeId: sedes[i % N_SEDES]! },
  });
}

// Un ADMIN con contrasena conocida.
const hash = await hashearContrasena("una-clave-de-prueba-bien-larga");
inicial.push({
  tipo: "usuario.creado",
  datos: { usuarioId: ulid(), usuario: "admin-prueba", nombre: "Admin de prueba", rol: "ADMIN", hash },
});
const hashCajero = await hashearContrasena("otra-clave-de-prueba-larga");
inicial.push({
  tipo: "usuario.creado",
  datos: { usuarioId: ulid(), usuario: "cajero-prueba", nombre: "Cajero de prueba", rol: "CAJERO", hash: hashCajero, sedeId: "principal" },
});

await almacen.agregar(inicial);

// ── Clientes y entradas de stock ──────────────────────────────────────────────
for (let desde = 0; desde < N_CLIENTES; desde += 500) {
  t += 60_000;
  await almacen.agregar(
    clienteIds.slice(desde, desde + 500).map((clienteId, i) => ({
      tipo: "cliente.registrado" as const,
      datos: { clienteId, nombre: `Cliente ${desde + i}`, telefono: `98765${String(desde + i).padStart(4, "0")}` },
    })),
  );
}

t += 60_000;
await almacen.agregar(
  itemIds.flatMap((itemId, i) =>
    i % 3 === 0
      ? []
      : sedes.map((sedeId) => ({
          tipo: "stock.entrada" as const,
          datos: { itemId, sedeId, cantidad: 40, costoUnitario: 800 + (i % 30) * 120, motivo: "Carga inicial" },
        })),
  ),
);

// ── Ventas, repartidas por dia y por sede ─────────────────────────────────────
const correlativoPorSede = new Array<number>(N_SEDES).fill(29);
const VENTAS_POR_DIA = Math.max(1, Math.round(N_VENTAS / 700)); // ~2 anios de operacion
let hechas = 0;
let dia = 0;

while (hechas < N_VENTAS) {
  dia++;
  // 09:00 del dia siguiente
  t = new Date("2024-01-02T09:00:00.000-05:00").getTime() + dia * 86_400_000;

  const lote: EventoNuevo[] = [];
  for (let k = 0; k < VENTAS_POR_DIA && hechas < N_VENTAS; k++, hechas++) {
    const s = hechas % N_SEDES;
    correlativoPorSede[s]!++;
    const nLineas = 1 + Math.floor(rnd() * 3);
    const lineas = Array.from({ length: nLineas }, () => {
      const idx = Math.floor(rnd() * N_ITEMS);
      const esProducto = idx % 3 !== 0;
      const precio = 1500 + (idx % 40) * 250;
      const cantidad = 1;
      return {
        itemId: itemIds[idx]!,
        codigo: `${esProducto ? "P" : "S"}${String(idx).padStart(4, "0")}`,
        marca: MARCAS[idx % MARCAS.length] || undefined,
        nombre: `ITEM ${idx} DE PRUEBA`,
        tipo: (esProducto ? "PRODUCTO" : "SERVICIO") as "PRODUCTO" | "SERVICIO",
        cantidad,
        precioUnitario: precio,
        precioLista: precio,
        costoUnitario: esProducto ? 800 + (idx % 30) * 120 : null,
        barberoId: elegir(barberoIds.filter((_, i) => i % N_SEDES === s)) ?? barberoIds[0]!,
        total: precio * cantidad,
      };
    });
    const total = lineas.reduce((a, l) => a + l.total, 0);
    lote.push({
      tipo: "venta.registrada",
      datos: {
        ventaId: ulid(),
        correlativo: `${prefijos[s]}${String(correlativoPorSede[s]).padStart(6, "0")}`,
        sedeId: sedes[s]!,
        lineas,
        subtotal: total,
        descuento: 0,
        total,
        pagos: [{ medio: rnd() < 0.6 ? "EFECTIVO" : "YAPE", monto: total }],
        clienteId: elegir(clienteIds),
        turnoId: null,
        claveIdempotencia: ulid(),
      },
    });
  }
  if (lote.length > 0) await almacen.agregar(lote);
}

await almacen.cerrar();
console.log(
  JSON.stringify({ eventos: almacen.ultimaSeq(), ventas: N_VENTAS, sedes: N_SEDES, items: N_ITEMS, clientes: N_CLIENTES, dias: dia }),
);
