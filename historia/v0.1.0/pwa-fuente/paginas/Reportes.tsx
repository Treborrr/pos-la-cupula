/**
 * Reportes. Salen de las proyecciones en memoria, así que son instantáneos.
 *
 * La producción por barbero es un dato de GESTIÓN, no una liquidación: en La
 * Cúpula los barberos tienen sueldo fijo y el sistema no calcula comisiones.
 * Se dice explícitamente en pantalla para que nadie lo use como planilla.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "../lib/api";
import { aTextoConSimbolo, cantidad, diasAtras, fecha, hoy } from "../lib/formato";
import { Vacio } from "../componentes/Modal";
import { Recuadro } from "../componentes/Piezas";

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
];

export function Reportes() {
  const [dias, setDias] = useState(30);
  const desde = diasAtras(dias);
  const hasta = hoy();

  const resumen = useQuery({
    queryKey: ["resumen", desde, hasta],
    queryFn: () => api.get<Resumen>(`/reportes/resumen?desde=${desde}&hasta=${hasta}`),
  });

  const r = resumen.data;
  const maximoDia = Math.max(1, ...(r?.porDia.map((d) => d.total) ?? [1]));

  return (
    <div className="scroll-fino h-full overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-xl font-bold">Reportes</h1>
        <div className="flex gap-1">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              onClick={() => setDias(p.id)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                dias === p.id ? "bg-tinta text-hueso" : "bg-black/5 hover:bg-black/10"
              }`}
            >
              {p.texto}
            </button>
          ))}
        </div>
        {r ? (
          <button
            className="boton-suave ml-auto px-3 text-sm"
            onClick={() => descargarCsv(r)}
          >
            Exportar CSV
          </button>
        ) : null}
      </div>

      {!r ? (
        <Vacio titulo="Cargando…" />
      ) : r.cantidadVentas === 0 ? (
        <Vacio titulo="No hay ventas en este período" />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Recuadro etiqueta="Vendido" valor={aTextoConSimbolo(r.total)} tamano="grande" />
            <Recuadro etiqueta="Ventas" valor={String(r.cantidadVentas)} />
            <Recuadro etiqueta="Ticket promedio" valor={aTextoConSimbolo(r.ticketPromedio)} />
            <Recuadro
              etiqueta="Por día"
              valor={aTextoConSimbolo(Math.round(r.total / Math.max(1, r.porDia.length)))}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Recuadro etiqueta="Efectivo" valor={aTextoConSimbolo(r.medios.EFECTIVO)} />
            <Recuadro etiqueta="YAPE" valor={aTextoConSimbolo(r.medios.YAPE)} />
            <Recuadro etiqueta="Tarjeta" valor={aTextoConSimbolo(r.medios.TARJETA)} />
          </div>

          <section className="tarjeta p-4">
            <h2 className="mb-3 font-bold">Por día</h2>
            {/*
              Se dibuja un espacio por CADA día del período, incluidos los que
              no tuvieron ventas. Graficar solo los días con movimiento
              deformaba el gráfico —un único día llenaba todo el ancho con una
              barra gigante— y además escondía la información más útil: los
              días flojos.
            */}
            <div className="flex h-40 items-end gap-px">
              {diasDelPeriodo(r).map((d) => (
                <div
                  key={d.dia}
                  className="group flex h-full flex-1 items-end"
                  title={`${fecha(d.dia + "T00:00:00")} · ${aTextoConSimbolo(d.total)} · ${d.cantidad} venta${d.cantidad === 1 ? "" : "s"}`}
                >
                  <div
                    className={`w-full rounded-t transition-colors ${
                      d.total > 0 ? "bg-laton/70 group-hover:bg-laton" : "bg-black/5"
                    }`}
                    style={{ height: `${d.total > 0 ? Math.max(3, (d.total / maximoDia) * 100) : 2}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-xs text-tinta/50">
              <span>{fecha(r.desde + "T00:00:00")}</span>
              <span>{fecha(r.hasta + "T00:00:00")}</span>
            </div>
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="tarjeta p-4">
              <h2 className="mb-2 font-bold">Lo que más se vende</h2>
              <Tabla
                filas={r.ranking.slice(0, 15).map((i) => ({
                  nombre: i.nombre,
                  medio: `${cantidad(i.cantidad)} u.`,
                  total: i.total,
                }))}
              />
            </section>

            <section className="tarjeta p-4">
              <h2 className="font-bold">Producción por barbero</h2>
              <p className="mb-2 text-xs text-tinta/50">
                Dato de gestión, <strong>no una liquidación</strong>: el sistema no calcula
                comisiones porque los barberos tienen sueldo fijo.
              </p>
              {r.porBarbero.length === 0 ? (
                <p className="py-6 text-center text-sm text-tinta/50">
                  Nadie fue asignado como barbero en las ventas de este período.
                </p>
              ) : (
                <Tabla
                  filas={r.porBarbero.map((b) => ({
                    nombre: b.nombre,
                    medio: `${cantidad(b.cantidad)} serv.`,
                    total: b.total,
                  }))}
                />
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Completa el período con los días sin ventas.
 *
 * El servidor devuelve solo los días que tuvieron movimiento, que es lo
 * correcto para el API. Rellenar los huecos es decisión de cómo se dibuja, y
 * por eso se hace aquí.
 */
function diasDelPeriodo(r: Resumen): { dia: string; total: number; cantidad: number }[] {
  const conVentas = new Map(r.porDia.map((d) => [d.dia, d]));
  const dias: { dia: string; total: number; cantidad: number }[] = [];

  // Mediodía UTC para no cruzar a otro día al sumar 24 h con horario de verano
  // en el medio. Perú no lo tiene, pero el navegador puede estar en otra zona.
  const cursor = new Date(`${r.desde}T12:00:00Z`);
  const fin = new Date(`${r.hasta}T12:00:00Z`);

  while (cursor <= fin && dias.length < 400) {
    const dia = cursor.toISOString().slice(0, 10);
    dias.push(conVentas.get(dia) ?? { dia, total: 0, cantidad: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dias;
}

function Tabla({ filas }: { filas: { nombre: string; medio: string; total: number }[] }) {
  const maximo = Math.max(1, ...filas.map((f) => f.total));
  return (
    <div className="space-y-1">
      {filas.map((f, i) => (
        <div key={i} className="relative rounded px-2 py-1.5 text-sm">
          <div
            className="absolute inset-y-0 left-0 rounded bg-laton/15"
            style={{ width: `${(f.total / maximo) * 100}%` }}
          />
          <div className="relative flex justify-between gap-2">
            <span className="truncate">{f.nombre}</span>
            <span className="shrink-0 text-tinta/50">{f.medio}</span>
            <span className="cifra w-20 shrink-0 text-right font-semibold">
              {aTextoConSimbolo(f.total)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * CSV con BOM y punto y coma: es lo que Excel en español abre bien de un doble
 * clic. Sin el BOM, los acentos salen rotos; con coma, mete todo en una
 * columna. Detalles aburridos que deciden si el contador puede usar el archivo.
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
  ];

  const texto =
    "﻿" +
    filas
      .map((f) => f.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(";"))
      .join("\n");

  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `cupula-${r.desde}-a-${r.hasta}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
