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
import { Ban, HandCoins, Printer, Receipt, ScanLine, Search, X } from "lucide-react";

import { api, type Barbero, type Propina, type ResultadoImpresion, type Venta } from "../lib/api";
import { aCentimos, aTextoConSimbolo, diasAtras, fecha, fechaYHora, hora, hoy, nombreConMarca } from "../lib/formato";
import { Aviso, Modal, Vacio } from "../componentes/Modal";
import { useEscaner } from "../lib/escaneo";
import { EncabezadoPagina, Pagina, Pastilla, Recuadro, Segmentado } from "../componentes/Piezas";

const RANGOS = [
  { id: "hoy", texto: "Hoy" },
  { id: "semana", texto: "7 días" },
  { id: "mes", texto: "30 días" },
  { id: "todo", texto: "Todo" },
] as const;

const NOMBRE_MEDIO: Record<string, string> = { EFECTIVO: "Efectivo", YAPE: "YAPE", TARJETA: "Tarjeta" };

export function Historial() {
  const qc = useQueryClient();
  const [rango, setRango] = useState<(typeof RANGOS)[number]["id"]>("hoy");
  const [busqueda, setBusqueda] = useState("");
  const [abierta, setAbierta] = useState<Venta | null>(null);

  // Buscando se mira TODO el historial: quien busca un NV no sabe (ni tiene
  // por qué saber) de qué día era.
  const buscando = busqueda.trim().length > 0;
  const parametros = new URLSearchParams();
  if (!buscando) {
    if (rango === "hoy") parametros.set("dia", hoy());
    else if (rango === "semana") parametros.set("desde", diasAtras(6));
    else if (rango === "mes") parametros.set("desde", diasAtras(29));
  } else {
    parametros.set("q", busqueda.trim());
  }

  const consulta = useQuery({
    queryKey: ["ventas", buscando ? "busqueda" : rango, busqueda],
    queryFn: () =>
      api.get<{
        ventas: Venta[];
        cantidadTotal: number;
        totales: { total: number; cantidad: number; medios: Record<string, number> };
      }>(`/ventas?${parametros}`),
  });

  // Escanear el QR de un ticket abre esa venta.
  useEscaner({
    activo: !abierta,
    alEscanear: async (valor) => {
      const r = await api.get<{ tipo: string; venta?: Venta }>(`/escaneo?valor=${encodeURIComponent(valor)}`);
      if (r.tipo === "venta" && r.venta) setAbierta(r.venta);
    },
  });

  const totales = consulta.data?.totales;
  const ventas = consulta.data?.ventas ?? [];

  return (
    <Pagina>
      <EncabezadoPagina
        titulo="Ventas"
        descripcion="Consulta lo cobrado. Toca una venta para ver el detalle, reimprimir el ticket o anularla."
        acciones={
          buscando ? null : (
            <Segmentado opciones={RANGOS} valor={rango} alCambiar={(v) => setRango(v)} />
          )
        }
      />

      {totales && !buscando ? (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Recuadro etiqueta="Total vendido" valor={aTextoConSimbolo(totales.total)} />
          <Recuadro etiqueta="Ventas" valor={String(totales.cantidad)} />
          <Recuadro etiqueta="Efectivo" valor={aTextoConSimbolo(totales.medios.EFECTIVO ?? 0)} />
          <Recuadro etiqueta="YAPE" valor={aTextoConSimbolo(totales.medios.YAPE ?? 0)} />
          <Recuadro etiqueta="Tarjeta" valor={aTextoConSimbolo(totales.medios.TARJETA ?? 0)} />
        </div>
      ) : null}

      <div className="tarjeta overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-linea p-4">
          <div className="relative min-w-72 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-tinta/35" />
            <input
              className="campo pl-12"
              placeholder="Buscar por número de ticket o por servicio"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            {buscando ? (
              <button
                className="boton-icono absolute top-1/2 right-1 -translate-y-1/2"
                onClick={() => setBusqueda("")}
                aria-label="Limpiar búsqueda"
              >
                <X className="h-5 w-5" />
              </button>
            ) : null}
          </div>
          <span className="ayuda flex items-center gap-2">
            <ScanLine className="h-4 w-4" />
            También puedes disparar la pistola al QR del ticket.
          </span>
        </div>

        {consulta.isLoading ? (
          <Vacio titulo="Cargando…" />
        ) : ventas.length === 0 ? (
          <Vacio icono={buscando ? Search : Receipt} titulo={buscando ? "Nada coincide" : "No hay ventas en este período"}>
            {buscando
              ? "Prueba con el número del ticket (por ejemplo 30 o NV000030) o con el nombre del servicio."
              : "Cuando cobres en la pantalla Cobrar, las ventas aparecen aquí."}
          </Vacio>
        ) : (
          <div className="scroll-fino overflow-x-auto">
            <table className="tabla tabla-clic">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>{rango === "hoy" && !buscando ? "Hora" : "Fecha"}</th>
                  <th>Detalle</th>
                  <th>Pago</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {ventas.map((v) => (
                  <tr key={v.id} onClick={() => setAbierta(v)} className={v.anulada ? "text-tinta/45" : ""}>
                    <td className="whitespace-nowrap">
                      <span className="cifra font-semibold">{v.correlativo}</span>
                      {v.anulada ? (
                        <span className="ml-2">
                          <Pastilla tono="mal">Anulada</Pastilla>
                        </span>
                      ) : null}
                    </td>
                    <td className="cifra whitespace-nowrap text-tinta/65">
                      {rango === "hoy" && !buscando ? hora(v.ts) : `${fecha(v.ts)} ${hora(v.ts)}`}
                    </td>
                    <td className="max-w-md truncate">
                      {v.lineas.map((l) => `${l.cantidad > 1 ? `${l.cantidad} × ` : ""}${nombreConMarca(l)}`).join(", ")}
                    </td>
                    <td className="whitespace-nowrap text-tinta/65">
                      {v.pagos.map((p) => NOMBRE_MEDIO[p.medio] ?? p.medio).join(" + ")}
                    </td>
                    <td className={`cifra text-right font-semibold whitespace-nowrap ${v.anulada ? "line-through" : ""}`}>
                      {aTextoConSimbolo(v.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {abierta ? (
        <DetalleDeVenta
          venta={abierta}
          alCerrar={() => setAbierta(null)}
          alCambiar={() => {
            qc.invalidateQueries({ queryKey: ["ventas"] });
            qc.invalidateQueries({ queryKey: ["catalogo"] });
            qc.invalidateQueries({ queryKey: ["inventario"] });
            qc.invalidateQueries({ queryKey: ["estado"] });
            setAbierta(null);
          }}
        />
      ) : null}
    </Pagina>
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
  const qc = useQueryClient();
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [agregandoPropinaEn, setAgregandoPropinaEn] = useState<number | null>(null);
  const [textoPropina, setTextoPropina] = useState("");

  const detalle = useQuery({
    queryKey: ["venta", venta.id],
    queryFn: () => api.get<{ venta: Venta; vistaPreviaTicket: string; propinas: Propina[] }>(`/ventas/${venta.id}`),
  });
  const barberos = useQuery({
    queryKey: ["barberos"],
    queryFn: () => api.get<{ barberos: Barbero[] }>("/barberos"),
  });
  const nombreDe = (barberoId: string) => barberos.data?.barberos.find((b) => b.id === barberoId)?.nombre ?? "";

  const agregarPropina = useMutation({
    mutationFn: (datos: { lineaIndex: number; barberoId: string; monto: number }) =>
      api.post(`/ventas/${venta.id}/propina`, datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["venta", venta.id] });
      qc.invalidateQueries({ queryKey: ["reportes"] });
      setAgregandoPropinaEn(null);
      setTextoPropina("");
    },
  });

  const anular = useMutation({
    mutationFn: () => api.post(`/ventas/${venta.id}/anular`, { motivo }),
    onSuccess: alCambiar,
  });

  const reimprimir = useMutation({
    mutationFn: () => api.post<{ impresion: ResultadoImpresion }>(`/ventas/${venta.id}/reimprimir`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["venta", venta.id] });
      qc.invalidateQueries({ queryKey: ["ventas"] });
    },
  });
  const impresion = reimprimir.data?.impresion;

  return (
    <Modal
      titulo={`Ticket ${venta.correlativo}`}
      subtitulo={fechaYHora(venta.ts)}
      alCerrar={alCerrar}
      ancho="max-w-2xl"
      pie={
        anulando ? (
          <div className="space-y-4">
            <Aviso tono="mal" titulo="¿Anular esta venta?">
              La venta no se borra: queda registrada como anulada, el stock de los productos vuelve y el número{" "}
              <strong>{venta.correlativo}</strong> no se vuelve a usar.
            </Aviso>
            <label className="block">
              <span className="etiqueta mb-2 block">Motivo de la anulación</span>
              <input
                className="campo"
                autoFocus
                placeholder="Por ejemplo: se cobró dos veces"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </label>
            {anular.error ? <Aviso tono="mal">{(anular.error as Error).message}</Aviso> : null}
            <div className="flex gap-3">
              <button className="boton-suave flex-1" onClick={() => setAnulando(false)}>
                Volver
              </button>
              <button
                className="boton-primario flex-1 bg-mal hover:bg-mal/90"
                disabled={motivo.trim().length < 3 || anular.isPending}
                onClick={() => anular.mutate()}
              >
                {anular.isPending ? "Anulando…" : "Sí, anular la venta"}
              </button>
            </div>
            {motivo.trim().length < 3 ? <p className="ayuda text-center">Escribe el motivo para poder anular.</p> : null}
          </div>
        ) : (
          <div className="space-y-3">
            {impresion && !impresion.impreso && !impresion.sinImpresora ? (
              <Aviso tono="mal" titulo="No salió en papel">
                {impresion.motivo}
              </Aviso>
            ) : null}
            {reimprimir.error ? <Aviso tono="mal">{(reimprimir.error as Error).message}</Aviso> : null}
            <div className="flex gap-3">
              {!venta.anulada ? (
                <button className="boton-peligro" onClick={() => setAnulando(true)}>
                  <Ban className="h-5 w-5" />
                  Anular
                </button>
              ) : null}
              <button
                className="boton-suave ml-auto"
                onClick={() => reimprimir.mutate()}
                disabled={reimprimir.isPending}
              >
                <Printer className="h-5 w-5" />
                {reimprimir.isPending
                  ? "Imprimiendo…"
                  : impresion?.impreso
                    ? "Copia impresa"
                    : impresion?.sinImpresora
                      ? "Reimpresión registrada"
                      : "Reimprimir copia"}
              </button>
              <button className="boton-primario" onClick={alCerrar}>
                Cerrar
              </button>
            </div>
          </div>
        )
      }
    >
      <div className="space-y-4">
        {venta.anulada ? (
          <Aviso tono="mal" titulo="Venta anulada">
            {venta.motivoAnulacion}
            {venta.anuladaEn ? ` · ${fechaYHora(venta.anuladaEn)}` : ""}
          </Aviso>
        ) : null}

        <div className="divide-y divide-linea rounded-xl border border-linea">
          {venta.lineas.map((l, i) => {
            const propina = detalle.data?.propinas.find((p) => p.lineaIndex === i);
            return (
              <div key={i} className="px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold">{nombreConMarca(l)}</div>
                    <div className="ayuda">
                      {l.cantidad} × {aTextoConSimbolo(l.precioUnitario)}
                      {/* Sin precio de lista no hubo ajuste: el precio se escribió
                          al cobrar porque el ítem no tenía ninguno. Decir "precio
                          de lista S/ 0.00" haría parecer que se regaló algo. */}
                      {l.precioLista === null
                        ? " · precio escrito al cobrar"
                        : l.precioUnitario !== l.precioLista
                          ? ` · precio de lista ${aTextoConSimbolo(l.precioLista)}`
                          : ""}
                    </div>
                  </div>
                  <span className="cifra shrink-0 font-semibold">{aTextoConSimbolo(l.total)}</span>
                </div>

                {/* La propina es aparte del cobro: no se suma al total de la
                    venta, solo se anota para que el dueño sepa cuánto recibe
                    cada barbero (D6: sueldo fijo, sin comisiones). */}
                {l.barberoId ? (
                  propina ? (
                    <p className="mt-1.5 flex items-center gap-1.5 text-sm text-bien">
                      <HandCoins className="h-4 w-4" />
                      Propina para {nombreDe(l.barberoId)}: {aTextoConSimbolo(propina.monto)}
                    </p>
                  ) : agregandoPropinaEn === i ? (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="ayuda">Propina para {nombreDe(l.barberoId)}</span>
                      <div className="relative w-32">
                        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-tinta/40">
                          S/
                        </span>
                        <input
                          className="campo cifra h-9 pl-9 text-right"
                          placeholder="0.00"
                          inputMode="decimal"
                          autoFocus
                          value={textoPropina}
                          onChange={(e) => setTextoPropina(e.target.value)}
                        />
                      </div>
                      <button
                        className="boton-icono h-9 w-9"
                        aria-label="Guardar propina"
                        disabled={agregarPropina.isPending || !aCentimos(textoPropina)}
                        onClick={() => {
                          const monto = aCentimos(textoPropina);
                          if (!monto || !l.barberoId) return;
                          agregarPropina.mutate({ lineaIndex: i, barberoId: l.barberoId, monto });
                        }}
                      >
                        <HandCoins className="h-4 w-4" />
                      </button>
                      <button
                        className="boton-icono h-9 w-9"
                        aria-label="Cancelar"
                        onClick={() => {
                          setAgregandoPropinaEn(null);
                          setTextoPropina("");
                        }}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium text-tinta/55 hover:text-tinta"
                      onClick={() => {
                        setAgregandoPropinaEn(i);
                        setTextoPropina("");
                      }}
                    >
                      <HandCoins className="h-4 w-4" />
                      Agregar propina olvidada
                    </button>
                  )
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="space-y-1.5 px-1">
          {venta.descuento > 0 ? (
            <div className="flex justify-between text-tinta/65">
              <span>Descuento</span>
              <span className="cifra">−{aTextoConSimbolo(venta.descuento)}</span>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between text-xl font-semibold">
            <span>Total</span>
            <span className={`cifra ${venta.anulada ? "line-through opacity-50" : ""}`}>
              {aTextoConSimbolo(venta.total)}
            </span>
          </div>
          {venta.pagos.map((p, i) => (
            <div key={i} className="flex justify-between text-tinta/65">
              <span>{NOMBRE_MEDIO[p.medio] ?? p.medio}</span>
              <span className="cifra">{aTextoConSimbolo(p.monto)}</span>
            </div>
          ))}
          {(detalle.data?.venta.reimpresiones ?? venta.reimpresiones) > 0 ? (
            <p className="ayuda pt-2">
              Reimpreso {detalle.data?.venta.reimpresiones ?? venta.reimpresiones}{" "}
              {(detalle.data?.venta.reimpresiones ?? venta.reimpresiones) === 1 ? "vez" : "veces"}.
            </p>
          ) : null}
        </div>

        {detalle.data?.vistaPreviaTicket ? (
          <details>
            <summary className="cursor-pointer font-medium text-tinta/60">Ver el ticket como sale impreso</summary>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-tinta p-4 font-mono text-xs leading-snug text-hueso">
              {detalle.data.vistaPreviaTicket}
            </pre>
          </details>
        ) : null}
      </div>
    </Modal>
  );
}
