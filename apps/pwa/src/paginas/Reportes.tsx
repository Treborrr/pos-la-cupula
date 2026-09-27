/**
 * Reportes. Salen de las proyecciones en memoria, así que son instantáneos.
 *
 * Dos decisiones de diseño que atraviesan toda la pantalla:
 *
 * LO QUE NO SE SABE SE DICE. Un producto sin precio de compra cargado no tiene
 * margen del 100%: no tiene margen calculable. Cada cifra de utilidad viene con
 * su COBERTURA —sobre qué parte de lo vendido se pudo calcular— y donde falta el
 * dato hay una raya, no un cero. Es la diferencia entre un reporte y un adorno.
 *
 * TODO SE COMPARA CONTRA EL PERÍODO ANTERIOR. "Vendí S/ 8,450" no es información
 * hasta que se sabe si el mes pasado fueron 7,000 o 12,000. El servidor calcula
 * el período anterior del mismo largo, así que la comparación siempre es justa.
 *
 * La producción por barbero es un dato de GESTIÓN, no una liquidación: en La
 * Cúpula los barberos tienen sueldo fijo y el sistema no calcula comisiones.
 * Se dice explícitamente en pantalla para que nadie lo use como planilla.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Boxes, Download, Snail, TrendingDown } from "lucide-react";

import { api } from "../lib/api";
import {
  aTextoConSimbolo,
  cantidad,
  diasAtras,
  fecha,
  hoy,
  margenLegible,
  variacionLegible,
} from "../lib/formato";
import { Vacio } from "../componentes/Modal";
import { Dato, EncabezadoPagina, Pagina, Pastilla, Recuadro, Seccion, Segmentado } from "../componentes/Piezas";

// ─────────────────────────────────────────────────────────────────────────────
// Lo que devuelve el servidor (ver consultas/reportes.ts)
// ─────────────────────────────────────────────────────────────────────────────

interface Utilidad {
  ingresoCosteado: number;
  costo: number;
  utilidad: number;
  margen: number | null;
  ingresoSinCostear: number;
  cobertura: number;
}

interface FilaAgrupada extends Utilidad {
  clave: string;
  etiqueta: string;
  cantidad: number;
  total: number;
}

interface TotalesDelPeriodo {
  desde: string;
  hasta: string;
  dias: number;
  total: number;
  cantidadVentas: number;
  ticketPromedio: number;
  medios: { EFECTIVO: number; YAPE: number; TARJETA: number };
  utilidad: Utilidad;
}

interface Reporte extends TotalesDelPeriodo {
  anterior: TotalesDelPeriodo;
  porDia: { dia: string; total: number; cantidad: number; utilidad: number | null }[];
  ranking: FilaAgrupada[];
  porCategoria: FilaAgrupada[];
  porMarca: FilaAgrupada[];
  porBarbero: { barberoId: string; nombre: string; cantidad: number; total: number }[];
  bajoCosto: {
    correlativo: string;
    fecha: string;
    nombre: string;
    precioUnitario: number;
    costoUnitario: number;
    perdida: number;
  }[];
  preciosAbiertos: number;
  inventario: {
    productos: number;
    valorCosto: number;
    valorVenta: number;
    agotados: number;
    bajoMinimo: number;
    enNegativo: number;
    sinCosto: number;
    sinPrecio: number;
  };
  sinRotar: {
    itemId: string;
    nombre: string;
    stock: number;
    diasSinVender: number | null;
    ultimaVenta: string | null;
    inmovilizado: number | null;
  }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Períodos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los períodos que una barbería pregunta de verdad.
 *
 * "Este mes" y "Mes pasado" son de calendario, no ventanas corridas: cuando el
 * dueño pregunta cómo fue septiembre, quiere septiembre, no los últimos 30 días.
 * La versión anterior de esta pantalla solo ofrecía ventanas corridas y esa
 * pregunta no se podía responder.
 */
type IdPeriodo = "hoy" | "semana" | "mes" | "mesPasado" | "anio" | "rango";

const PERIODOS = [
  { id: "hoy", texto: "Hoy" },
  { id: "semana", texto: "7 días" },
  { id: "mes", texto: "Este mes" },
  { id: "mesPasado", texto: "Mes pasado" },
  { id: "anio", texto: "Este año" },
  { id: "rango", texto: "Elegir…" },
] as const;

function rangoDe(id: IdPeriodo): { desde: string; hasta: string } {
  const h = hoy();
  const [anio, mes] = [Number(h.slice(0, 4)), Number(h.slice(5, 7))];
  const dosDigitos = (n: number) => String(n).padStart(2, "0");
  /** Último día de un mes, sin pelear con los años bisiestos a mano. */
  const finDeMes = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);

  switch (id) {
    case "hoy":
      return { desde: h, hasta: h };
    case "semana":
      return { desde: diasAtras(6), hasta: h };
    case "mes":
      return { desde: `${anio}-${dosDigitos(mes)}-01`, hasta: h };
    case "mesPasado": {
      const a = mes === 1 ? anio - 1 : anio;
      const m = mes === 1 ? 12 : mes - 1;
      return { desde: `${a}-${dosDigitos(m)}-01`, hasta: finDeMes(a, m) };
    }
    case "anio":
      return { desde: `${anio}-01-01`, hasta: h };
    case "rango":
      return { desde: diasAtras(29), hasta: h };
  }
}

export function Reportes() {
  const [periodo, setPeriodo] = useState<IdPeriodo>("mes");
  const [rango, setRango] = useState(rangoDe("rango"));

  const { desde, hasta } = periodo === "rango" ? rango : rangoDe(periodo);

  const consulta = useQuery({
    queryKey: ["resumen", desde, hasta],
    queryFn: () => api.get<Reporte>(`/reportes/resumen?desde=${desde}&hasta=${hasta}`),
  });

  const r = consulta.data;

  return (
    <Pagina>
      <EncabezadoPagina
        titulo="Reportes"
        descripcion="Cuánto se vendió, cuánto se ganó de verdad, qué se mueve y qué está durmiendo en el depósito. No incluye ventas anuladas."
        acciones={
          <>
            <Segmentado opciones={PERIODOS} valor={periodo} alCambiar={setPeriodo} />
            {r ? (
              <button className="boton-suave" onClick={() => descargarCsv(r)}>
                <Download className="h-5 w-5" />
                Descargar para Excel
              </button>
            ) : null}
          </>
        }
      />

      {periodo === "rango" ? (
        <div className="tarjeta mb-6 flex flex-wrap items-end gap-4 p-5">
          <label className="block">
            <span className="etiqueta mb-2 block">Desde</span>
            <input
              type="date"
              className="campo w-auto"
              value={rango.desde}
              max={rango.hasta}
              onChange={(e) => setRango((v) => ({ ...v, desde: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="etiqueta mb-2 block">Hasta</span>
            <input
              type="date"
              className="campo w-auto"
              value={rango.hasta}
              min={rango.desde}
              onChange={(e) => setRango((v) => ({ ...v, hasta: e.target.value }))}
            />
          </label>
          <p className="ayuda pb-3">Se compara contra los {r?.dias ?? 0} días anteriores a esa fecha.</p>
        </div>
      ) : null}

      {!r ? (
        <Vacio titulo="Cargando…" />
      ) : (
        <div className="space-y-6">
          <Totales r={r} />

          {/* El inventario NO depende del período —es una foto de hoy— así que va
              separado y con su propio encabezado, para que nadie lea "plata en
              stock" como si fuera del mes elegido. */}
          {r.cantidadVentas === 0 ? (
            <div className="tarjeta">
              <Vacio icono={BarChart3} titulo="No hay ventas en este período">
                Elige un período más largo o vuelve cuando haya ventas registradas. El inventario de abajo es de hoy y
                no depende del período.
              </Vacio>
            </div>
          ) : (
            <>
              <VentasPorDia r={r} />
              <div className="grid gap-6 lg:grid-cols-2">
                <Agrupado
                  titulo="Por categoría"
                  descripcion="Cuánto pesa cada línea del negocio y con qué margen."
                  filas={r.porCategoria}
                />
                <Agrupado
                  titulo="Por marca"
                  descripcion="Solo productos: los servicios no tienen marca."
                  filas={r.porMarca}
                  vacio="Todavía no se vendió ningún producto con marca en este período."
                />
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <Agrupado titulo="Lo que más se vende" filas={r.ranking.slice(0, 12)} />
                <div className="space-y-6">
                  <FormasDePago r={r} />
                  <PorBarbero r={r} />
                </div>
              </div>
              {r.bajoCosto.length > 0 ? <BajoCosto r={r} /> : null}
            </>
          )}

          <Inventario r={r} />
          {r.sinRotar.length > 0 ? <SinRotar r={r} /> : null}
        </div>
      )}
    </Pagina>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bloques
// ─────────────────────────────────────────────────────────────────────────────

/** Variación porcentual. Se calcula acá y no en el servidor para cada cifra. */
function variacion(ahora: number, antes: number): number | null {
  if (antes === 0) return null;
  return Math.round(((ahora - antes) / Math.abs(antes)) * 1000) / 10;
}

function Totales({ r }: { r: Reporte }) {
  const u = r.utilidad;
  const ua = r.anterior.utilidad;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Recuadro
          etiqueta="Vendido"
          valor={aTextoConSimbolo(r.total)}
          tamano="grande"
          nota={`${variacionLegible(variacion(r.total, r.anterior.total))} vs. ${r.anterior.dias} días antes`}
        />
        <Recuadro
          etiqueta="Ganancia"
          valor={u.margen === null ? "—" : aTextoConSimbolo(u.utilidad)}
          tamano="grande"
          tono={u.utilidad < 0 ? "mal" : undefined}
          nota={
            u.margen === null
              ? "Falta cargar precios de compra"
              : `${variacionLegible(variacion(u.utilidad, ua.utilidad))} vs. antes`
          }
        />
        <Recuadro
          etiqueta="Margen"
          valor={margenLegible(u.margen)}
          tamano="grande"
          nota={u.margen === null ? "Sin costos cargados" : `Calculado sobre el ${u.cobertura}% de lo vendido`}
          tono={u.cobertura > 0 && u.cobertura < 50 ? "aviso" : undefined}
        />
        <Recuadro
          etiqueta="Ventas"
          valor={String(r.cantidadVentas)}
          tamano="grande"
          nota={`Ticket promedio ${aTextoConSimbolo(r.ticketPromedio)}`}
        />
      </div>

      {/* La cobertura es la advertencia más importante de la pantalla: dice qué
          parte del margen es real y qué parte es un hueco de datos. */}
      {u.ingresoSinCostear > 0 ? (
        <div className="tarjeta flex flex-wrap items-center gap-x-6 gap-y-2 p-5">
          <Dato
            etiqueta="Con costo conocido"
            valor={aTextoConSimbolo(u.ingresoCosteado)}
            tamano="chico"
            nota="Base del margen"
          />
          <Dato
            etiqueta="Sin costo conocido"
            valor={aTextoConSimbolo(u.ingresoSinCostear)}
            tamano="chico"
            nota="Queda fuera del cálculo"
            tono="aviso"
          />
          <Dato etiqueta="Costo de lo vendido" valor={aTextoConSimbolo(u.costo)} tamano="chico" />
          <p className="ayuda min-w-64 flex-1">
            Los servicios no llevan costo de mercadería, así que nunca entran al margen. Los productos sí: si un
            producto no tiene precio de compra cargado, su venta queda afuera en vez de contarse como ganancia pura.
          </p>
        </div>
      ) : null}
    </>
  );
}

function VentasPorDia({ r }: { r: Reporte }) {
  const dias = diasDelPeriodo(r);
  const maximo = Math.max(1, ...dias.map((d) => d.total));

  return (
    <Seccion titulo="Ventas por día" descripcion="Pasa el cursor por una barra para ver el detalle.">
      {/* Un espacio por CADA día del período, incluidos los que no tuvieron
          ventas: esconderlos deformaba el gráfico y ocultaba lo más útil, los
          días flojos. */}
      <div className="flex h-56 items-end gap-[3px]">
        {dias.map((d) => (
          <div
            key={d.dia}
            className="group flex h-full flex-1 items-end"
            title={
              `${fecha(d.dia + "T00:00:00")} · ${aTextoConSimbolo(d.total)} · ${d.cantidad} venta${d.cantidad === 1 ? "" : "s"}` +
              (d.utilidad !== null ? ` · ganancia ${aTextoConSimbolo(d.utilidad)}` : "")
            }
          >
            <div
              className={`w-full rounded-t-md transition-colors ${
                d.total > 0 ? "bg-laton/60 group-hover:bg-laton-oscuro" : "bg-hueso-hondo"
              }`}
              style={{ height: `${d.total > 0 ? Math.max(3, (d.total / maximo) * 100) : 1.5}%` }}
            />
          </div>
        ))}
      </div>
      <div className="ayuda mt-2 flex justify-between">
        <span>{fecha(r.desde + "T00:00:00")}</span>
        <span>{dias.length} días</span>
        <span>{fecha(r.hasta + "T00:00:00")}</span>
      </div>
    </Seccion>
  );
}

/**
 * Una agrupación con su barra, su margen y su cobertura.
 *
 * Sirve para categoría, marca e ítem: son la misma pregunta sobre distinta
 * clave, así que comparten la presentación. Que se vean iguales no es pereza —es
 * lo que permite comparar entre bloques sin recalibrar la vista.
 */
function Agrupado({
  titulo,
  descripcion,
  filas,
  vacio,
}: {
  titulo: string;
  descripcion?: string;
  filas: FilaAgrupada[];
  vacio?: string;
}) {
  const maximo = Math.max(1, ...filas.map((f) => f.total));

  return (
    <Seccion titulo={titulo} descripcion={descripcion}>
      {filas.length === 0 ? (
        <p className="ayuda py-6 text-center">{vacio ?? "Sin datos en este período."}</p>
      ) : (
        <div className="space-y-4">
          {filas.map((f) => (
            <div key={f.clave}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{f.etiqueta}</span>
                <span className="flex shrink-0 items-baseline gap-3">
                  <span className="ayuda">{cantidad(f.cantidad)} u.</span>
                  {/* El margen al lado del total: sin él, el ranking de "lo que
                      más se vende" puede estar encabezado por lo que menos deja. */}
                  <span
                    className={`cifra w-16 text-right text-sm ${f.margen !== null && f.margen < 0 ? "text-mal" : "text-tinta/55"}`}
                    title={
                      f.margen === null
                        ? "No se puede calcular: falta el precio de compra"
                        : `Ganancia ${aTextoConSimbolo(f.utilidad)} · calculado sobre el ${f.cobertura}% de lo vendido`
                    }
                  >
                    {margenLegible(f.margen)}
                  </span>
                  <span className="cifra w-24 text-right font-semibold">{aTextoConSimbolo(f.total)}</span>
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-hueso-hondo">
                <div className="h-full rounded-full bg-laton" style={{ width: `${(f.total / maximo) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Seccion>
  );
}

function FormasDePago({ r }: { r: Reporte }) {
  return (
    <Seccion titulo="Formas de pago">
      <div className="space-y-4">
        {(
          [
            ["Efectivo", r.medios.EFECTIVO],
            ["YAPE", r.medios.YAPE],
            ["Tarjeta", r.medios.TARJETA],
          ] as const
        ).map(([nombre, monto]) => (
          <div key={nombre}>
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{nombre}</span>
              <span className="cifra font-semibold">{aTextoConSimbolo(monto)}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-hueso-hondo">
              <div
                className="h-full rounded-full bg-tinta"
                style={{ width: `${r.total ? (monto / r.total) * 100 : 0}%` }}
              />
            </div>
            <div className="ayuda mt-1">{r.total ? Math.round((monto / r.total) * 100) : 0}% del total</div>
          </div>
        ))}
      </div>

      {r.preciosAbiertos > 0 ? (
        <p className="ayuda mt-5 border-t border-linea pt-4">
          {r.preciosAbiertos} {r.preciosAbiertos === 1 ? "línea se cobró" : "líneas se cobraron"} con el precio escrito
          a mano, porque el ítem no tiene precio de lista. Ponerles precio desde Catálogo evita que cada cajero cobre
          distinto por lo mismo.
        </p>
      ) : null}
    </Seccion>
  );
}

function PorBarbero({ r }: { r: Reporte }) {
  const maximo = Math.max(1, ...r.porBarbero.map((b) => b.total));

  return (
    <Seccion
      titulo="Producción por barbero"
      descripcion="Dato de gestión, no una liquidación: el sistema no calcula comisiones."
    >
      {r.porBarbero.length === 0 ? (
        <p className="ayuda py-6 text-center">
          No se eligió barbero en las ventas de este período. Al cobrar, elige quién atendió debajo del nombre del
          cliente.
        </p>
      ) : (
        <div className="space-y-4">
          {r.porBarbero.map((b) => (
            <div key={b.barberoId}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{b.nombre}</span>
                <span className="flex shrink-0 items-baseline gap-3">
                  <span className="ayuda">{cantidad(b.cantidad)} serv.</span>
                  <span className="cifra w-24 text-right font-semibold">{aTextoConSimbolo(b.total)}</span>
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-hueso-hondo">
                <div className="h-full rounded-full bg-laton" style={{ width: `${(b.total / maximo) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Seccion>
  );
}

function BajoCosto({ r }: { r: Reporte }) {
  const total = r.bajoCosto.reduce((a, b) => a + b.perdida, 0);

  return (
    <Seccion
      titulo={
        <span className="flex items-center gap-2">
          <TrendingDown className="h-5 w-5 text-mal" />
          Se vendió por debajo del costo
        </span>
      }
      descripcion={`${r.bajoCosto.length} ${r.bajoCosto.length === 1 ? "línea" : "líneas"} · ${aTextoConSimbolo(total)} de pérdida. Puede ser una liquidación a propósito; conviene revisar que no sea un precio mal cargado.`}
      sinRelleno
    >
      <div className="scroll-fino overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Venta</th>
              <th className="text-right">Se cobró</th>
              <th className="text-right">Costaba</th>
              <th className="text-right">Pérdida</th>
            </tr>
          </thead>
          <tbody>
            {r.bajoCosto.slice(0, 20).map((b, i) => (
              <tr key={i}>
                <td className="font-medium">{b.nombre}</td>
                <td className="ayuda cifra">
                  {b.correlativo} · {fecha(b.fecha + "T00:00:00")}
                </td>
                <td className="cifra text-right">{aTextoConSimbolo(b.precioUnitario)}</td>
                <td className="cifra text-right text-tinta/55">{aTextoConSimbolo(b.costoUnitario)}</td>
                <td className="cifra text-right font-semibold text-mal">−{aTextoConSimbolo(b.perdida)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.bajoCosto.length > 20 ? (
        <p className="ayuda px-6 py-4">Se muestran las 20 de mayor pérdida, de {r.bajoCosto.length} en total.</p>
      ) : null}
    </Seccion>
  );
}

function Inventario({ r }: { r: Reporte }) {
  const i = r.inventario;

  return (
    <Seccion
      titulo={
        <span className="flex items-center gap-2">
          <Boxes className="h-5 w-5" />
          Inventario, hoy
        </span>
      }
      descripcion="Una foto del momento: no depende del período elegido arriba."
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Dato
          etiqueta="Plata en stock"
          valor={aTextoConSimbolo(i.valorCosto)}
          nota={i.sinCosto > 0 ? `A costo · ${i.sinCosto} sin costo cargado` : "A precio de compra"}
          tono={i.sinCosto > 0 ? "aviso" : undefined}
        />
        <Dato
          etiqueta="Si se vendiera todo"
          valor={aTextoConSimbolo(i.valorVenta)}
          nota={i.sinPrecio > 0 ? `A venta · ${i.sinPrecio} sin precio` : "A precio de venta"}
        />
        <Dato
          etiqueta="Agotados"
          valor={String(i.agotados)}
          nota={`de ${i.productos} productos`}
          tono={i.agotados > 0 ? "aviso" : undefined}
        />
        <Dato
          etiqueta="Stock negativo"
          valor={String(i.enNegativo)}
          nota={i.enNegativo > 0 ? "Hay que contar y ajustar" : "Todo cuadra"}
          tono={i.enNegativo > 0 ? "mal" : undefined}
        />
      </div>

      {i.valorCosto > 0 && i.valorVenta > 0 ? (
        <p className="ayuda mt-5 border-t border-linea pt-4">
          Si se vendiera todo el stock a precio de lista, quedarían{" "}
          <strong className="text-tinta">{aTextoConSimbolo(i.valorVenta - i.valorCosto)}</strong> de ganancia.
          {i.sinCosto > 0 || i.sinPrecio > 0
            ? " La cifra no incluye los productos a los que les falta el precio de compra o el de venta."
            : ""}
        </p>
      ) : null}
    </Seccion>
  );
}

function SinRotar({ r }: { r: Reporte }) {
  const inmovilizado = r.sinRotar.reduce((a, s) => a + (s.inmovilizado ?? 0), 0);

  return (
    <Seccion
      titulo={
        <span className="flex items-center gap-2">
          <Snail className="h-5 w-5" />
          No se vendieron en este período
        </span>
      }
      descripcion={`${r.sinRotar.length} productos con stock que no se movieron${inmovilizado > 0 ? `, con ${aTextoConSimbolo(inmovilizado)} inmovilizados` : ""}. Primero los que nunca se vendieron.`}
      sinRelleno
    >
      <div className="scroll-fino overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="text-right">Stock</th>
              <th>Última venta</th>
              <th className="text-right">Plata parada</th>
            </tr>
          </thead>
          <tbody>
            {r.sinRotar.slice(0, 25).map((s) => (
              <tr key={s.itemId}>
                <td className="font-medium">{s.nombre}</td>
                <td className="cifra text-right">{cantidad(s.stock)}</td>
                <td>
                  {s.ultimaVenta === null ? (
                    <Pastilla>Nunca se vendió</Pastilla>
                  ) : (
                    <span className="text-tinta/65">
                      {fecha(s.ultimaVenta + "T00:00:00")} · hace {s.diasSinVender} días
                    </span>
                  )}
                </td>
                <td className="cifra text-right text-tinta/65">
                  {s.inmovilizado === null ? "—" : aTextoConSimbolo(s.inmovilizado)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.sinRotar.length > 25 ? (
        <p className="ayuda px-6 py-4">Se muestran 25 de {r.sinRotar.length}. Descarga el Excel para verlos todos.</p>
      ) : null}
    </Seccion>
  );
}

/**
 * Completa el período con los días sin ventas. El servidor devuelve solo los
 * días con movimiento; rellenar los huecos es decisión de cómo se dibuja.
 */
function diasDelPeriodo(r: Reporte): Reporte["porDia"] {
  const conVentas = new Map(r.porDia.map((d) => [d.dia, d]));
  const dias: Reporte["porDia"] = [];

  // Mediodía UTC para no cruzar de día al sumar 24 h.
  const cursor = new Date(`${r.desde}T12:00:00Z`);
  const fin = new Date(`${r.hasta}T12:00:00Z`);

  while (cursor <= fin && dias.length < 400) {
    const dia = cursor.toISOString().slice(0, 10);
    dias.push(conVentas.get(dia) ?? { dia, total: 0, cantidad: 0, utilidad: null });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dias;
}

/**
 * CSV con BOM y punto y coma: es lo que Excel en español abre bien de un doble
 * clic. Sin el BOM, los acentos salen rotos; con coma, mete todo en una columna.
 *
 * Donde el dato no existe va vacío, NO cero: una celda vacía en Excel no
 * participa de un promedio, un 0 sí y lo arruina.
 */
function descargarCsv(r: Reporte) {
  const s = (centimos: number) => (centimos / 100).toFixed(2);
  const sOpcional = (c: number | null) => (c === null ? "" : s(c));
  const pct = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));

  const filasAgrupadas = (titulo: string, filas: FilaAgrupada[]) => [
    [],
    [titulo, "Unidades", "Vendido", "Costo", "Ganancia", "Margen %", "Cobertura %"],
    ...filas.map((f) => [
      f.etiqueta,
      String(f.cantidad),
      s(f.total),
      f.margen === null ? "" : s(f.costo),
      f.margen === null ? "" : s(f.utilidad),
      pct(f.margen),
      String(f.cobertura),
    ]),
  ];

  const filas: string[][] = [
    ["Reporte", `${r.desde} a ${r.hasta}`, `${r.dias} días`],
    ["Comparado contra", `${r.anterior.desde} a ${r.anterior.hasta}`],
    [],
    ["", "Este período", "Período anterior"],
    ["Total vendido", s(r.total), s(r.anterior.total)],
    ["Cantidad de ventas", String(r.cantidadVentas), String(r.anterior.cantidadVentas)],
    ["Ticket promedio", s(r.ticketPromedio), s(r.anterior.ticketPromedio)],
    ["Costo de lo vendido", s(r.utilidad.costo), s(r.anterior.utilidad.costo)],
    ["Ganancia", s(r.utilidad.utilidad), s(r.anterior.utilidad.utilidad)],
    ["Margen %", pct(r.utilidad.margen), pct(r.anterior.utilidad.margen)],
    ["Cobertura del margen %", String(r.utilidad.cobertura), String(r.anterior.utilidad.cobertura)],
    ["Vendido sin costo conocido", s(r.utilidad.ingresoSinCostear), s(r.anterior.utilidad.ingresoSinCostear)],
    [],
    ["Medio de pago", "Monto"],
    ["Efectivo", s(r.medios.EFECTIVO)],
    ["YAPE", s(r.medios.YAPE)],
    ["Tarjeta", s(r.medios.TARJETA)],
    [],
    ["Día", "Ventas", "Total", "Ganancia"],
    ...diasDelPeriodo(r).map((d) => [d.dia, String(d.cantidad), s(d.total), sOpcional(d.utilidad)]),
    ...filasAgrupadas("Categoría", r.porCategoria),
    ...filasAgrupadas("Marca", r.porMarca),
    ...filasAgrupadas("Ítem", r.ranking),
    [],
    ["Barbero", "Servicios", "Total"],
    ...r.porBarbero.map((b) => [b.nombre, String(b.cantidad), s(b.total)]),
    [],
    ["Inventario a hoy"],
    ["Productos activos", String(r.inventario.productos)],
    ["Valor a costo", s(r.inventario.valorCosto)],
    ["Valor a precio de venta", s(r.inventario.valorVenta)],
    ["Agotados", String(r.inventario.agotados)],
    ["Con stock negativo", String(r.inventario.enNegativo)],
    ["Sin costo cargado", String(r.inventario.sinCosto)],
    ["Sin precio de venta", String(r.inventario.sinPrecio)],
  ];

  if (r.bajoCosto.length > 0) {
    filas.push(
      [],
      ["Vendido por debajo del costo"],
      ["Producto", "Venta", "Fecha", "Se cobró", "Costaba", "Pérdida"],
      ...r.bajoCosto.map((b) => [
        b.nombre,
        b.correlativo,
        b.fecha,
        s(b.precioUnitario),
        s(b.costoUnitario),
        s(b.perdida),
      ]),
    );
  }

  if (r.sinRotar.length > 0) {
    filas.push(
      [],
      ["Sin vender en el período"],
      ["Producto", "Stock", "Última venta", "Días sin vender", "Plata parada"],
      ...r.sinRotar.map((x) => [
        x.nombre,
        String(x.stock),
        x.ultimaVenta ?? "nunca",
        x.diasSinVender === null ? "" : String(x.diasSinVender),
        sOpcional(x.inmovilizado),
      ]),
    );
  }

  const texto =
    "﻿" +
    filas.map((f) => f.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(";")).join("\n");

  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `cupula-${r.desde}-a-${r.hasta}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
