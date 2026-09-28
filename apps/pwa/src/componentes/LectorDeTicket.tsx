/**
 * Lector de tickets: se dispara la pistola al QR (o se teclea el número) y se
 * ve la venta completa junto con la ficha y el historial del cliente.
 *
 * La pistola se comporta como un teclado, así que no hay nada que "conectar":
 * el campo tiene el foco y lo que la pistola escribe llega ahí.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, ScanLine, Search, UserRound } from "lucide-react";

import { api, type Barbero, type FichaCliente, type ResultadoImpresion, type Venta } from "../lib/api";
import { aTextoConSimbolo, cuandoFue, fechaYHora, nombreConMarca } from "../lib/formato";
import { correlativoDe, escucharLector, marcarLectorAbierto } from "../lib/lector";
import { Aviso, Modal } from "./Modal";
import { Pastilla } from "./Piezas";

export function BotonLectorDeTicket() {
  const [abierto, setAbierto] = useState(false);
  const [correlativo, setCorrelativo] = useState<string | null>(null);

  useEffect(
    () =>
      escucharLector((c) => {
        setAbierto(true);
        if (c) setCorrelativo(c);
      }),
    [],
  );

  useEffect(() => {
    marcarLectorAbierto(abierto);
  }, [abierto]);

  return (
    <>
      <button className="boton-laton px-4 sm:px-5" onClick={() => setAbierto(true)} aria-label="Leer ticket">
        <ScanLine className="h-5 w-5" />
        <span className="hidden sm:inline">Leer ticket</span>
      </button>
      {abierto ? (
        <LectorDeTicket
          correlativo={correlativo}
          alElegir={setCorrelativo}
          alCerrar={() => {
            setAbierto(false);
            setCorrelativo(null);
          }}
        />
      ) : null}
    </>
  );
}

function LectorDeTicket({
  correlativo,
  alElegir,
  alCerrar,
}: {
  correlativo: string | null;
  alElegir: (c: string) => void;
  alCerrar: () => void;
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [error, setError] = useState("");
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    campo.current?.focus();
  }, [correlativo]);

  const venta = useQuery({
    queryKey: ["lector-venta", correlativo],
    queryFn: () => api.get<{ venta: Venta; vistaPreviaTicket: string }>(`/ventas/${correlativo}`),
    enabled: Boolean(correlativo),
    retry: false,
  });

  const v = venta.data?.venta;

  const ficha = useQuery({
    queryKey: ["lector-cliente", v?.clienteId],
    queryFn: () => api.get<FichaCliente>(`/clientes/${v!.clienteId}`),
    enabled: Boolean(v?.clienteId),
    retry: false,
  });

  const barberos = useQuery({
    queryKey: ["barberos", "todos"],
    queryFn: () => api.get<{ barberos: Barbero[] }>("/barberos?incluirInactivos=true"),
  });
  const nombreBarbero = Object.fromEntries((barberos.data?.barberos ?? []).map((b) => [b.id, b.nombre]));

  /**
   * Hoy la venta lleva UN barbero para todo, así que se nombra una sola vez en
   * la cabecera en vez de repetirlo en cada línea. Las ventas de antes del
   * cambio pueden tener uno distinto por servicio: en ese caso queda null y el
   * detalle vuelve a mostrarlo línea por línea.
   */
  const barberosDeLaVenta = [...new Set((v?.lineas ?? []).map((l) => l.barberoId).filter(Boolean))];
  const barberoUnico = barberosDeLaVenta.length === 1 ? (barberosDeLaVenta[0] as string) : null;

  const reimprimir = useMutation({
    mutationFn: () => api.post<{ impresion: ResultadoImpresion }>(`/ventas/${v!.id}/reimprimir`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lector-venta"] });
      qc.invalidateQueries({ queryKey: ["ventas"] });
    },
  });

  function buscar() {
    const c = correlativoDe(texto);
    if (!c) {
      setError("Eso no parece un ticket. Dispara la pistola al QR o escribe el número, por ejemplo 30 o NV000030.");
      // Seleccionado: lo próximo que se escriba o escanee lo reemplaza.
      campo.current?.select();
      return;
    }
    setError("");
    reimprimir.reset();
    setTexto("");
    alElegir(c);
  }

  const impresion = reimprimir.data?.impresion;

  return (
    <Modal
      titulo={v ? `Ticket ${v.correlativo}` : "Leer ticket"}
      subtitulo={v ? fechaYHora(v.ts) : "Consulta una venta y el historial del cliente."}
      alCerrar={alCerrar}
      ancho="max-w-6xl"
      pie={
        v ? (
          <div className="space-y-3">
            {impresion && !impresion.impreso && !impresion.sinImpresora ? (
              <Aviso tono="mal" titulo="No salió en papel">
                {impresion.motivo}
              </Aviso>
            ) : null}
            {reimprimir.error ? <Aviso tono="mal">{(reimprimir.error as Error).message}</Aviso> : null}
            <div className="flex justify-end gap-3">
              <button className="boton-suave" disabled={reimprimir.isPending} onClick={() => reimprimir.mutate()}>
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
        ) : null
      }
    >
      <form
        className="flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          buscar();
        }}
      >
        <div className="relative flex-1">
          <ScanLine className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-tinta/35" />
          <input
            ref={campo}
            className="campo h-14 pl-12 text-lg"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Dispara la pistola al QR del ticket o escribe su número"
            autoComplete="off"
          />
        </div>
        <button type="submit" className="boton-primario h-14 px-6">
          <Search className="h-5 w-5" />
          Buscar
        </button>
      </form>

      <div className="mt-5 space-y-4">
        {error ? <Aviso tono="aviso">{error}</Aviso> : null}

        {!correlativo && !error ? (
          <div className="rounded-2xl border border-dashed border-linea px-6 py-10 text-center">
            <ScanLine className="mx-auto mb-3 h-10 w-10 text-tinta/25" strokeWidth={1.5} />
            <p className="text-lg font-semibold text-tinta/75">Esperando el ticket</p>
            <p className="ayuda mx-auto mt-1 max-w-md text-base">
              La pistola escribe sola lo que lee. Con el cursor en el campo de arriba, apunta al código
              QR del ticket y presiona el gatillo.
            </p>
          </div>
        ) : null}

        {venta.isLoading ? <p className="ayuda">Buscando el ticket…</p> : null}

        {venta.error ? (
          <Aviso tono="mal" titulo="No se encontró ese ticket">
            {(venta.error as Error).message} Puede ser de otra instalación o de antes de dejar el Excel.
          </Aviso>
        ) : null}

        {v ? (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* ── La venta ─────────────────────────────────────────────── */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {v.anulada ? <Pastilla tono="mal">Anulada</Pastilla> : <Pastilla tono="bien">Vigente</Pastilla>}
                {v.reimpresiones > 0 ? (
                  <Pastilla>
                    Reimpreso {v.reimpresiones} {v.reimpresiones === 1 ? "vez" : "veces"}
                  </Pastilla>
                ) : null}
                {barberoUnico && nombreBarbero[barberoUnico] ? (
                  <Pastilla>Atendió {nombreBarbero[barberoUnico]}</Pastilla>
                ) : null}
              </div>

              {v.anulada ? (
                <Aviso tono="mal" titulo="Esta venta fue anulada">
                  {v.motivoAnulacion || "Sin motivo registrado."}
                </Aviso>
              ) : null}

              <div className="divide-y divide-linea rounded-xl border border-linea">
                {v.lineas.map((l, i) => (
                  <div key={i} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{nombreConMarca(l)}</div>
                      <div className="ayuda">
                        {l.cantidad} × {aTextoConSimbolo(l.precioUnitario)}
                        {!barberoUnico && l.barberoId && nombreBarbero[l.barberoId]
                          ? ` · Atendió ${nombreBarbero[l.barberoId]}`
                          : ""}
                      </div>
                    </div>
                    <span className="cifra shrink-0 font-semibold">{aTextoConSimbolo(l.total)}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5 px-1">
                {v.descuento > 0 ? (
                  <>
                    <Fila etiqueta="Subtotal" valor={aTextoConSimbolo(v.subtotal)} />
                    <Fila etiqueta="Descuento" valor={`−${aTextoConSimbolo(v.descuento)}`} />
                  </>
                ) : null}
                <div className="flex items-baseline justify-between pt-1 text-xl font-semibold">
                  <span>Total</span>
                  <span className={`cifra ${v.anulada ? "line-through opacity-50" : ""}`}>
                    {aTextoConSimbolo(v.total)}
                  </span>
                </div>
                {v.pagos.map((p, i) => (
                  <Fila key={i} etiqueta={NOMBRE_MEDIO[p.medio]} valor={aTextoConSimbolo(p.monto)} />
                ))}
              </div>

              {v.notas ? <Aviso tono="info" titulo="Notas">{v.notas}</Aviso> : null}

              <details>
                <summary className="cursor-pointer font-medium text-tinta/60">Ver el ticket como sale impreso</summary>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-tinta p-4 font-mono text-xs leading-snug text-hueso">
                  {venta.data?.vistaPreviaTicket}
                </pre>
              </details>
            </div>

            {/* ── El cliente ───────────────────────────────────────────── */}
            <div className="space-y-4">
              {!v.clienteId ? (
                <Aviso tono="info" titulo="Venta sin cliente">
                  Esta venta se registró antes de que el cliente fuera obligatorio, así que no hay historial
                  que mostrar.
                </Aviso>
              ) : ficha.isLoading ? (
                <p className="ayuda">Cargando el historial del cliente…</p>
              ) : ficha.error ? (
                <Aviso tono="mal">{(ficha.error as Error).message}</Aviso>
              ) : ficha.data ? (
                <>
                  <div className="rounded-2xl bg-laton-claro p-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-laton-oscuro">
                        <UserRound className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xl font-semibold">{ficha.data.cliente.nombre}</div>
                        {ficha.data.cliente.telefono ? (
                          <div className="ayuda cifra">{ficha.data.cliente.telefono}</div>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <MiniDato valor={String(ficha.data.cliente.visitas)} etiqueta="Visitas" />
                      <MiniDato valor={aTextoConSimbolo(ficha.data.cliente.totalGastado)} etiqueta="Gastado" />
                      <MiniDato valor={cuandoFue(ficha.data.cliente.ultimaVisita)} etiqueta="Última visita" />
                    </div>
                    {ficha.data.cliente.notas ? (
                      <p className="mt-3 text-sm text-tinta/70">{ficha.data.cliente.notas}</p>
                    ) : null}
                  </div>

                  {ficha.data.habituales.length > 0 ? (
                    <div>
                      <div className="etiqueta mb-2">Lo que más pide</div>
                      <div className="flex flex-wrap gap-2">
                        {ficha.data.habituales.map((h, i) => (
                          <Pastilla key={i}>
                            {h.nombre} · {h.veces}
                          </Pastilla>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <div className="etiqueta mb-2">Historial de compras · {ficha.data.ventas.length}</div>
                    <div className="scroll-fino max-h-80 divide-y divide-linea overflow-y-auto rounded-xl border border-linea">
                      {ficha.data.ventas.map((x) => (
                        <button
                          key={x.id}
                          onClick={() => {
                            reimprimir.reset();
                            alElegir(x.correlativo);
                          }}
                          className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-hueso ${
                            x.id === v.id ? "bg-laton-claro/60" : ""
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-semibold">
                              <span className="cifra">{x.correlativo}</span>
                              <span className="ml-2 font-normal text-tinta/55">{fechaYHora(x.ts)}</span>
                              {x.anulada ? (
                                <span className="ml-2">
                                  <Pastilla tono="mal">Anulada</Pastilla>
                                </span>
                              ) : null}
                            </div>
                            <div className="ayuda truncate">{x.lineas.map((l) => l.nombre).join(", ")}</div>
                          </div>
                          <span className={`cifra shrink-0 font-semibold ${x.anulada ? "text-tinta/35 line-through" : ""}`}>
                            {aTextoConSimbolo(x.total)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

const NOMBRE_MEDIO: Record<string, string> = { EFECTIVO: "Efectivo", YAPE: "YAPE", TARJETA: "Tarjeta" };

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between text-tinta/65">
      <span>{etiqueta}</span>
      <span className="cifra">{valor}</span>
    </div>
  );
}

function MiniDato({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  return (
    <div className="rounded-xl bg-white/70 px-3 py-2 text-center">
      <div className="cifra truncate text-lg font-semibold">{valor}</div>
      <div className="text-xs text-tinta/55">{etiqueta}</div>
    </div>
  );
}
