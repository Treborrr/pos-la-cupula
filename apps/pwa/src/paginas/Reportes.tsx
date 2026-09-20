/**
 * Reportes. Salen de las proyecciones en memoria, así que son instantáneos.
 *
 * La producción por barbero es un dato de GESTIÓN, no una liquidación: en La
 * Cúpula los barberos tienen sueldo fijo y el sistema no calcula comisiones.
 * Se dice explícitamente en pantalla para que nadie lo use como planilla.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download } from "lucide-react";

import { api } from "../lib/api";
import { aTextoConSimbolo, cantidad, diasAtras, fecha, hoy } from "../lib/formato";
import { Vacio } from "../componentes/Modal";
import { EncabezadoPagina, Pagina, Recuadro, Seccion, Segmentado } from "../componentes/Piezas";

interface Resumen {
  desde: string;
  hasta: string;
  total: number;
  cantidadVentas: number;
  ticketPromedio: number;
  medios: { EFECTIVO: number; YAPE: number; TARJETA: number };
  porDia: { dia: string; total: number; cantidad: number }[];
  ranking: { itemId: string; nombre: string; cantidad: number; total: number }[];
  porBarbero: { barberoId: string; nombre: string; cantidad: number; total: number }[];
}

const PERIODOS = [
  { id: 7, texto: "7 días" },
  { id: 30, texto: "30 días" },
  { id: 90, texto: "90 días" },
  { id: 365, texto: "Un año" },
] as const;

export function Reportes() {
  const [dias, setDias] = useState<(typeof PERIODOS)[number]["id"]>(30);
  // "7 días" son 7 días contando hoy: desde hace 6 días hasta hoy inclusive.
  const desde = diasAtras(dias - 1);
  const hasta = hoy();

  const resumen = useQuery({
    queryKey: ["resumen", desde, hasta],
    queryFn: () => api.get<Resumen>(`/reportes/resumen?desde=${desde}&hasta=${hasta}`),
  });

  const r = resumen.data;
  const periodo = r ? diasDelPeriodo(r) : [];
  const maximoDia = Math.max(1, ...periodo.map((d) => d.total));

  return (
    <Pagina>
      <EncabezadoPagina
        titulo="Reportes"
        descripcion="Cuánto se vendió, cómo pagaron, qué se vende más y cuánto produjo cada barbero. No incluye ventas anuladas."
        acciones={
          <>
            <Segmentado opciones={PERIODOS} valor={dias} alCambiar={setDias} />
            {r && r.cantidadVentas > 0 ? (
              <button className="boton-suave" onClick={() => descargarCsv(r)}>
                <Download className="h-5 w-5" />
                Descargar para Excel
              </button>
            ) : null}
          </>
        }
      />

      {!r ? (
        <Vacio titulo="Cargando…" />
      ) : r.cantidadVentas === 0 ? (
        <div className="tarjeta">
          <Vacio icono={BarChart3} titulo="No hay ventas en este período">
            Elige un período más largo o vuelve cuando haya ventas registradas.
          </Vacio>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Recuadro etiqueta="Vendido" valor={aTextoConSimbolo(r.total)} tamano="grande" />
            <Recuadro etiqueta="Ventas" valor={String(r.cantidadVentas)} tamano="grande" />
            <Recuadro etiqueta="Ticket promedio" valor={aTextoConSimbolo(r.ticketPromedio)} tamano="grande" />
            <Recuadro
              etiqueta="Promedio por día"
              valor={aTextoConSimbolo(Math.round(r.total / Math.max(1, periodo.length)))}
              tamano="grande"
              nota={`${periodo.length} días`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
            <Seccion titulo="Ventas por día" descripcion="Pasa el cursor por una barra para ver el detalle.">
              {/* Un espacio por CADA día del período, incluidos los que no
                  tuvieron ventas: esconderlos deformaba el gráfico y ocultaba
                  lo más útil, los días flojos. */}
              <div className="flex h-56 items-end gap-[3px]">
                {periodo.map((d) => (
                  <div
                    key={d.dia}
                    className="group flex h-full flex-1 items-end"
                    title={`${fecha(d.dia + "T00:00:00")} · ${aTextoConSimbolo(d.total)} · ${d.cantidad} venta${d.cantidad === 1 ? "" : "s"}`}
                  >
                    <div
                      className={`w-full rounded-t-md transition-colors ${
                        d.total > 0 ? "bg-laton/60 group-hover:bg-laton-oscuro" : "bg-hueso-hondo"
                      }`}
                      style={{ height: `${d.total > 0 ? Math.max(3, (d.total / maximoDia) * 100) : 1.5}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="ayuda mt-2 flex justify-between">
                <span>{fecha(r.desde + "T00:00:00")}</span>
                <span>{fecha(r.hasta + "T00:00:00")}</span>
              </div>
            </Seccion>

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
                      <div className="h-full rounded-full bg-tinta" style={{ width: `${r.total ? (monto / r.total) * 100 : 0}%` }} />
                    </div>
                    <div className="ayuda mt-1">{r.total ? Math.round((monto / r.total) * 100) : 0}% del total</div>
                  </div>
                ))}
              </div>
            </Seccion>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Seccion titulo="Lo que más se vende">
              <Barras
                filas={r.ranking.slice(0, 12).map((i) => ({
                  nombre: i.nombre,
                  detalle: `${cantidad(i.cantidad)} u.`,
                  total: i.total,
                }))}
              />
            </Seccion>

            <Seccion
              titulo="Producción por barbero"
              descripcion="Dato de gestión, no una liquidación: el sistema no calcula comisiones."
            >
              {r.porBarbero.length === 0 ? (
                <p className="ayuda py-6 text-center">
                  No se eligió barbero en las ventas de este período. Al cobrar, elige quién atendió debajo del nombre del cliente.
                </p>
              ) : (
                <Barras
                  filas={r.porBarbero.map((b) => ({
                    nombre: b.nombre,
                    detalle: `${cantidad(b.cantidad)} serv.`,
                    total: b.total,
                  }))}
                />
              )}
            </Seccion>
          </div>
        </div>
      )}
    </Pagina>
  );
}

/**
 * Completa el período con los días sin ventas. El servidor devuelve solo los
 * días con movimiento; rellenar los huecos es decisión de cómo se dibuja.
 */
function diasDelPeriodo(r: Resumen): { dia: string; total: number; cantidad: number }[] {
  const conVentas = new Map(r.porDia.map((d) => [d.dia, d]));
  const dias: { dia: string; total: number; cantidad: number }[] = [];

  // Mediodía UTC para no cruzar de día al sumar 24 h.
  const cursor = new Date(`${r.desde}T12:00:00Z`);
  const fin = new Date(`${r.hasta}T12:00:00Z`);

  while (cursor <= fin && dias.length < 400) {
    const dia = cursor.toISOString().slice(0, 10);
    dias.push(conVentas.get(dia) ?? { dia, total: 0, cantidad: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dias;
}

function Barras({ filas }: { filas: { nombre: string; detalle: string; total: number }[] }) {
  const maximo = Math.max(1, ...filas.map((f) => f.total));
  return (
    <div className="space-y-4">
      {filas.map((f, i) => (
        <div key={i}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-medium">{f.nombre}</span>
            <span className="flex shrink-0 items-baseline gap-3">
              <span className="ayuda">{f.detalle}</span>
              <span className="cifra w-24 text-right font-semibold">{aTextoConSimbolo(f.total)}</span>
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-hueso-hondo">
            <div className="h-full rounded-full bg-laton" style={{ width: `${(f.total / maximo) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * CSV con BOM y punto y coma: es lo que Excel en español abre bien de un doble
 * clic. Sin el BOM, los acentos salen rotos; con coma, mete todo en una columna.
 */
function descargarCsv(r: Resumen) {
  const filas: string[][] = [
    ["Reporte", `${r.desde} a ${r.hasta}`],
    [],
    ["Total vendido", (r.total / 100).toFixed(2)],
    ["Cantidad de ventas", String(r.cantidadVentas)],
    ["Ticket promedio", (r.ticketPromedio / 100).toFixed(2)],
    [],
    ["Medio de pago", "Monto"],
    ["Efectivo", (r.medios.EFECTIVO / 100).toFixed(2)],
    ["YAPE", (r.medios.YAPE / 100).toFixed(2)],
    ["Tarjeta", (r.medios.TARJETA / 100).toFixed(2)],
    [],
    ["Día", "Ventas", "Total"],
    ...r.porDia.map((d) => [d.dia, String(d.cantidad), (d.total / 100).toFixed(2)]),
    [],
    ["Ítem", "Unidades", "Total"],
    ...r.ranking.map((i) => [i.nombre, String(i.cantidad), (i.total / 100).toFixed(2)]),
    [],
    ["Barbero", "Servicios", "Total"],
    ...r.porBarbero.map((b) => [b.nombre, String(b.cantidad), (b.total / 100).toFixed(2)]),
  ];

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
