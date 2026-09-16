/**
 * Historial de ventas: consultar, reimprimir y anular.
 *
 * Una venta anulada NO desaparece: queda tachada, con su motivo a la vista y
 * su correlativo intacto. Un salto sin explicación en la numeración es lo que
 * un contador no quiere ver, y borrar una venta es justamente lo que un
 * sistema de dinero no debe permitir.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type Venta } from "../lib/api";
import { aTextoConSimbolo, diasAtras, fechaYHora, hora, hoy } from "../lib/formato";
import { Aviso, Modal, Vacio } from "../componentes/Modal";
import { useEscaner } from "../lib/escaneo";
import { Dato } from "../componentes/Piezas";

const RANGOS = [
  { id: "hoy", texto: "Hoy" },
  { id: "semana", texto: "7 días" },
  { id: "mes", texto: "30 días" },
  { id: "todo", texto: "Todo" },
] as const;

export function Historial() {
  const qc = useQueryClient();
  const [rango, setRango] = useState<(typeof RANGOS)[number]["id"]>("hoy");
  const [busqueda, setBusqueda] = useState("");
  const [abierta, setAbierta] = useState<Venta | null>(null);

  const parametros = new URLSearchParams();
  if (rango === "hoy") parametros.set("dia", hoy());
  else if (rango === "semana") parametros.set("desde", diasAtras(7));
  else if (rango === "mes") parametros.set("desde", diasAtras(30));
  if (busqueda.trim()) parametros.set("q", busqueda.trim());

  const consulta = useQuery({
    queryKey: ["ventas", rango, busqueda],
    queryFn: () =>
      api.get<{
        ventas: Venta[];
        cantidadTotal: number;
        totales: { total: number; cantidad: number; medios: Record<string, number> };
      }>(`/ventas?${parametros}`),
  });

  // Escanear el QR de un ticket abre esa venta. Es el caso de uso que pediste.
  useEscaner({
    activo: !abierta,
    alEscanear: async (valor) => {
      const r = await api.get<{ tipo: string; venta?: Venta }>(
        `/escaneo?valor=${encodeURIComponent(valor)}`,
      );
      if (r.tipo === "venta" && r.venta) setAbierta(r.venta);
    },
  });

  const totales = consulta.data?.totales;

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {RANGOS.map((r) => (
            <button
              key={r.id}
              onClick={() => setRango(r.id)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                rango === r.id ? "bg-tinta text-hueso" : "bg-black/5 hover:bg-black/10"
              }`}
            >
              {r.texto}
            </button>
          ))}
        </div>

        <input
          className="campo max-w-xs flex-1"
          placeholder="Buscar por NV, o disparar el QR del ticket…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />

        {totales ? (
          <div className="ml-auto flex gap-4 text-sm">
            <Dato etiqueta="Ventas" valor={String(totales.cantidad)} tamano="chico" alinear="der" />
            <Dato etiqueta="Efectivo" valor={aTextoConSimbolo(totales.medios.EFECTIVO ?? 0)} tamano="chico" alinear="der" />
            <Dato etiqueta="YAPE" valor={aTextoConSimbolo(totales.medios.YAPE ?? 0)} tamano="chico" alinear="der" />
            <Dato etiqueta="Tarjeta" valor={aTextoConSimbolo(totales.medios.TARJETA ?? 0)} tamano="chico" alinear="der" />
            <Dato etiqueta="Total" valor={aTextoConSimbolo(totales.total)} alinear="der" />
          </div>
        ) : null}
      </div>

      <div className="scroll-fino tarjeta min-h-0 flex-1 overflow-y-auto">
        {consulta.isLoading ? (
          <Vacio titulo="Cargando…" />
        ) : (consulta.data?.ventas.length ?? 0) === 0 ? (
          <Vacio titulo="No hay ventas en este período" />
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-hueso-hondo text-left">
              <tr className="etiqueta">
                <th className="px-3 py-2">Nota</th>
                <th className="px-3 py-2">Hora</th>
                <th className="px-3 py-2">Detalle</th>
                <th className="px-3 py-2">Pago</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {consulta.data!.ventas.map((v) => (
                <tr
                  key={v.id}
                  onClick={() => setAbierta(v)}
                  className={`cursor-pointer border-t border-black/5 hover:bg-laton/5 ${
                    v.anulada ? "text-tinta/40" : ""
                  }`}
                >
                  <td className="cifra px-3 py-2 font-semibold">
                    {v.correlativo}
                    {v.anulada ? (
                      <span className="ml-2 rounded bg-mal/15 px-1.5 py-0.5 text-[10px] font-bold text-mal">
                        ANULADA
                      </span>
                    ) : null}
                  </td>
                  <td className="cifra px-3 py-2">{hora(v.ts)}</td>
                  <td className="max-w-md truncate px-3 py-2">
                    {v.lineas.map((l) => `${l.cantidad}× ${l.nombre}`).join(", ")}
                  </td>
                  <td className="px-3 py-2">{v.pagos.map((p) => p.medio).join(" + ")}</td>
                  <td className={`cifra px-3 py-2 text-right font-bold ${v.anulada ? "line-through" : ""}`}>
                    {aTextoConSimbolo(v.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {abierta ? (
        <DetalleDeVenta
          venta={abierta}
          alCerrar={() => setAbierta(null)}
          alCambiar={() => {
            qc.invalidateQueries({ queryKey: ["ventas"] });
            qc.invalidateQueries({ queryKey: ["catalogo"] });
            setAbierta(null);
          }}
        />
      ) : null}
    </div>
  );
}

function DetalleDeVenta({
  venta,
  alCerrar,
  alCambiar,
}: {
  venta: Venta;
  alCerrar: () => void;
  alCambiar: () => void;
}) {
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const detalle = useQuery({
    queryKey: ["venta", venta.id],
    queryFn: () => api.get<{ venta: Venta; vistaPreviaTicket: string }>(`/ventas/${venta.id}`),
  });

  const anular = useMutation({
    mutationFn: () => api.post(`/ventas/${venta.id}/anular`, { motivo }),
    onSuccess: alCambiar,
  });

  const reimprimir = useMutation({
    mutationFn: () => api.post(`/ventas/${venta.id}/reimprimir`),
  });

  return (
    <Modal
      titulo={`${venta.correlativo} · ${fechaYHora(venta.ts)}`}
      alCerrar={alCerrar}
      ancho="max-w-2xl"
      pie={
        anulando ? (
          <div className="space-y-2">
            <Aviso tono="mal" titulo="Anular esta venta">
              La venta no se borra: queda registrada como anulada, el stock vuelve y el correlativo{" "}
              <strong>{venta.correlativo}</strong> queda consumido para siempre.
            </Aviso>
            <input
              className="campo"
              autoFocus
              placeholder="¿Por qué se anula? (obligatorio)"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <div className="flex gap-2">
              <button className="boton-suave flex-1" onClick={() => setAnulando(false)}>
                Cancelar
              </button>
              <button
                className="boton-peligro flex-1"
                disabled={motivo.trim().length < 3 || anular.isPending}
                onClick={() => anular.mutate()}
              >
                {anular.isPending ? "Anulando…" : "Confirmar anulación"}
              </button>
            </div>
            {anular.error ? <Aviso tono="mal">{(anular.error as Error).message}</Aviso> : null}
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              className="boton-suave flex-1"
              onClick={() => reimprimir.mutate()}
              disabled={reimprimir.isPending}
            >
              {reimprimir.isSuccess ? "Reimpresión registrada" : "Reimprimir"}
            </button>
            {!venta.anulada ? (
              <button className="boton-peligro flex-1" onClick={() => setAnulando(true)}>
                Anular
              </button>
            ) : null}
          </div>
        )
      }
    >
      {venta.anulada ? (
        <Aviso tono="mal" titulo="Venta anulada">
          {venta.motivoAnulacion} · {venta.anuladaEn ? fechaYHora(venta.anuladaEn) : ""}
        </Aviso>
      ) : null}

      <table className="mt-3 w-full text-sm">
        <tbody>
          {venta.lineas.map((l, i) => (
            <tr key={i} className="border-b border-black/5">
              <td className="py-2">
                {l.nombre}
                {l.precioUnitario !== l.precioLista ? (
                  <span className="ml-2 text-xs text-laton">
                    (lista {aTextoConSimbolo(l.precioLista)})
                  </span>
                ) : null}
              </td>
              <td className="cifra py-2 text-right text-tinta/60">
                {l.cantidad} × {aTextoConSimbolo(l.precioUnitario)}
              </td>
              <td className="cifra py-2 text-right font-semibold">{aTextoConSimbolo(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 space-y-1 text-sm">
        {venta.descuento > 0 ? (
          <div className="flex justify-between text-laton">
            <span>Descuento</span>
            <span className="cifra">−{aTextoConSimbolo(venta.descuento)}</span>
          </div>
        ) : null}
        <div className="flex justify-between text-lg font-bold">
          <span>Total</span>
          <span className="cifra">{aTextoConSimbolo(venta.total)}</span>
        </div>
        {venta.pagos.map((p, i) => (
          <div key={i} className="flex justify-between text-tinta/60">
            <span>{p.medio}</span>
            <span className="cifra">{aTextoConSimbolo(p.monto)}</span>
          </div>
        ))}
        {venta.reimpresiones > 0 ? (
          <p className="pt-2 text-xs text-tinta/50">Reimpreso {venta.reimpresiones} vez/veces.</p>
        ) : null}
      </div>

      {detalle.data?.vistaPreviaTicket ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-tinta/60">Ver el ticket</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-tinta p-3 text-[11px] leading-tight text-hueso">
            {detalle.data.vistaPreviaTicket}
          </pre>
        </details>
      ) : null}
    </Modal>
  );
}
