/**
 * Barberos: alta, producción por semana (incluidos los cortes gratis) y
 * adelantos pendientes.
 *
 * "Liquidar" salda los adelantos, no paga sueldo: en La Cúpula los barberos
 * tienen sueldo fijo y el sistema no calcula comisiones. Lo que se ve acá es
 * dato de gestión para que el dueño decida con los números delante.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  CheckCircle2,
  ChevronRight,
  Gift,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";

import { api, FalloDeApi, type Barbero } from "../lib/api";
import { aTextoConSimbolo, diasAtras, fecha, fechaYHora, hoy } from "../lib/formato";
import { usarUsuario } from "../lib/sesion";
import { Aviso, Modal, Vacio } from "../componentes/Modal";
import { EncabezadoPagina, Pagina, Pastilla } from "../componentes/Piezas";

interface LineaDeBarbero {
  correlativo: string;
  ts: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  total: number;
  gratis: boolean;
}

interface SemanaDeBarbero {
  desde: string;
  hasta: string;
  lineas: LineaDeBarbero[];
  total: number;
  cantidad: number;
  cantidadGratis: number;
}

interface AdelantoDeBarbero {
  id: string;
  ts: string;
  monto: number;
  origen: "EFECTIVO" | "VENTA";
  detalle: string;
}

interface ReporteDeBarbero {
  barbero: Barbero;
  semanas: SemanaDeBarbero[];
  adelantosPendientes: AdelantoDeBarbero[];
  saldoPendiente: number;
  ultimaLiquidacion: { ts: string; monto: number } | null;
}

export function Barberos() {
  const qc = useQueryClient();
  const usuario = usarUsuario();
  const esAdmin = usuario.rol === "ADMIN";
  const [nombre, setNombre] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<Barbero | null>(null);
  const [viendo, setViendo] = useState<Barbero | null>(null);

  const barberos = useQuery({
    queryKey: ["barberos", "admin"],
    queryFn: () => api.get<{ barberos: Barbero[] }>("/barberos?incluirInactivos=true"),
  });
  const refrescar = () => qc.invalidateQueries({ queryKey: ["barberos"] });

  const crear = useMutation({
    mutationFn: () => api.post("/barberos", { nombre }),
    onSuccess: () => {
      setNombre("");
      refrescar();
    },
  });
  const cambiarEstado = useMutation({
    mutationFn: (b: Barbero) => api.post(`/barberos/${b.id}/${b.activo ? "desactivar" : "reactivar"}`),
    onSuccess: () => {
      setConfirmando(null);
      refrescar();
    },
  });

  const lista = barberos.data?.barberos ?? [];

  return (
    <Pagina>
      <EncabezadoPagina
        titulo="Barberos"
        descripcion="Quién atendió cada servicio, su producción semana a semana y los adelantos pendientes. No se calculan comisiones: sueldo fijo."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="tarjeta overflow-hidden">
          {lista.length === 0 ? (
            <Vacio icono={UserRound} titulo="Todavía no hay barberos">
              Agrégalos con el formulario. Sirven para saber quién atendió cada servicio.
            </Vacio>
          ) : (
            <ul className="divide-y divide-linea">
              {lista.map((b) => (
                <li key={b.id} className="flex items-center gap-4 px-5 py-4">
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-semibold ${
                      b.activo ? "bg-laton-claro text-laton-oscuro" : "bg-hueso text-tinta/35"
                    }`}
                  >
                    {b.nombre.charAt(0).toUpperCase()}
                  </span>
                  {editando === b.id ? (
                    <RenombrarBarbero
                      barbero={b}
                      alTerminar={() => {
                        setEditando(null);
                        refrescar();
                      }}
                    />
                  ) : (
                    <>
                      <button
                        className="min-w-0 flex-1 truncate text-left text-lg font-medium hover:underline"
                        onClick={() => setViendo(b)}
                      >
                        <span className={b.activo ? "" : "text-tinta/40"}>{b.nombre}</span>
                      </button>
                      {!b.activo ? <Pastilla>Inactivo</Pastilla> : null}
                      <button
                        className="boton-suave boton-chico"
                        onClick={() => setViendo(b)}
                        title="Ver producción y adelantos"
                      >
                        <Receipt className="h-4 w-4" />
                        Reporte
                      </button>
                      {esAdmin ? (
                        <button className="boton-icono" onClick={() => setEditando(b.id)} aria-label={`Renombrar a ${b.nombre}`} title="Renombrar">
                          <Pencil className="h-5 w-5" />
                        </button>
                      ) : null}
                      {esAdmin ? (
                        b.activo ? (
                          <button className="boton-suave boton-chico" onClick={() => setConfirmando(b)}>
                            Desactivar
                          </button>
                        ) : (
                          <button className="boton-suave boton-chico" onClick={() => cambiarEstado.mutate(b)}>
                            <RotateCcw className="h-4 w-4" />
                            Reactivar
                          </button>
                        )
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          {esAdmin ? (
            <div className="tarjeta p-5">
              <h2 className="mb-4 text-lg font-semibold">Agregar barbero</h2>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (nombre.trim()) crear.mutate();
                }}
              >
                <input
                  className="campo"
                  placeholder="Nombre"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                />
                <button type="submit" className="boton-primario w-full" disabled={!nombre.trim() || crear.isPending}>
                  <Plus className="h-5 w-5" />
                  Agregar
                </button>
              </form>
              {crear.error ? (
                <div className="mt-3">
                  <Aviso tono="mal">{(crear.error as Error).message}</Aviso>
                </div>
              ) : null}
            </div>
          ) : null}
          <Aviso tono="info">
            Solo se registra quién atendió, como dato para los reportes. <strong>No se calculan comisiones</strong>: en La
            Cúpula los barberos tienen sueldo fijo.
          </Aviso>
        </div>

        {confirmando ? (
          <Modal
            titulo={`¿Desactivar a ${confirmando.nombre}?`}
            alCerrar={() => setConfirmando(null)}
            pie={
              <div className="flex justify-end gap-3">
                <button className="boton-suave" onClick={() => setConfirmando(null)}>
                  Cancelar
                </button>
                <button className="boton-primario" disabled={cambiarEstado.isPending} onClick={() => cambiarEstado.mutate(confirmando)}>
                  Sí, desactivar
                </button>
              </div>
            }
          >
            <p className="text-tinta/75">
              Deja de aparecer al cobrar. Sus ventas anteriores y su producción en los reportes se conservan, y puedes
              reactivarlo cuando quieras.
            </p>
          </Modal>
        ) : null}
      </div>

      {viendo ? <ReporteDeBarbero barbero={viendo} alCerrar={() => setViendo(null)} /> : null}
    </Pagina>
  );
}

function RenombrarBarbero({ barbero, alTerminar }: { barbero: Barbero; alTerminar: () => void }) {
  const [nombre, setNombre] = useState(barbero.nombre);
  const guardar = useMutation({
    mutationFn: () => api.patch(`/barberos/${barbero.id}`, { nombre }),
    onSuccess: alTerminar,
  });
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => campo.current?.select(), []);

  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (nombre.trim()) guardar.mutate();
      }}
    >
      <input ref={campo} className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <button type="submit" className="boton-primario" disabled={!nombre.trim() || guardar.isPending}>
        Guardar
      </button>
      <button type="button" className="boton-icono" onClick={alTerminar} aria-label="Cancelar">
        <X className="h-5 w-5" />
      </button>
    </form>
  );
}

/** Últimos ~120 días: suficiente historia sin necesitar un selector de período. */
function ReporteDeBarbero({ barbero, alCerrar }: { barbero: Barbero; alCerrar: () => void }) {
  const qc = useQueryClient();
  const usuario = usarUsuario();
  const [liquidando, setLiquidando] = useState(false);
  const [notas, setNotas] = useState("");

  const reporte = useQuery({
    queryKey: ["barberos", barbero.id, "reporte"],
    queryFn: () =>
      api.get<ReporteDeBarbero>(`/barberos/${barbero.id}/reporte?desde=${diasAtras(119)}&hasta=${hoy()}`),
  });

  const liquidar = useMutation({
    mutationFn: () => api.post(`/barberos/${barbero.id}/liquidar`, { notas: notas.trim() || undefined }),
    onSuccess: () => {
      setLiquidando(false);
      setNotas("");
      qc.invalidateQueries({ queryKey: ["barberos", barbero.id, "reporte"] });
    },
  });
  const falloLiquidar = liquidar.error as FalloDeApi | undefined;

  const r = reporte.data;

  return (
    <Modal titulo={barbero.nombre} subtitulo="Producción por semana y adelantos" alCerrar={alCerrar} ancho="max-w-3xl">
      {!r ? (
        <p className="ayuda py-8 text-center">Cargando…</p>
      ) : (
        <div className="space-y-6">
          <div className="rounded-2xl border border-linea bg-hueso p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="etiqueta">Adelantos pendientes</div>
                <div className={`cifra text-3xl font-semibold ${r.saldoPendiente > 0 ? "text-mal" : "text-bien"}`}>
                  {aTextoConSimbolo(r.saldoPendiente)}
                </div>
                {r.ultimaLiquidacion ? (
                  <p className="ayuda mt-1">
                    Última liquidación: {fechaYHora(r.ultimaLiquidacion.ts)} · {aTextoConSimbolo(r.ultimaLiquidacion.monto)}
                  </p>
                ) : null}
              </div>
              {r.saldoPendiente > 0 && usuario.rol === "ADMIN" ? (
                <button className="boton-primario" onClick={() => setLiquidando(true)}>
                  <ShieldCheck className="h-5 w-5" />
                  Liquidar
                </button>
              ) : null}
            </div>

            {r.adelantosPendientes.length > 0 ? (
              <ul className="mt-4 space-y-2 border-t border-linea pt-4">
                {r.adelantosPendientes.map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-tinta/70">
                      <Banknote className="mr-1.5 inline h-3.5 w-3.5 text-tinta/40" />
                      {fecha(a.ts)} · {a.detalle}
                    </span>
                    <span className="cifra shrink-0 font-semibold">{aTextoConSimbolo(a.monto)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div>
            <h3 className="etiqueta mb-3">Producción por semana</h3>
            {r.semanas.length === 0 ? (
              <p className="ayuda py-6 text-center">Sin ventas en los últimos meses.</p>
            ) : (
              <div className="space-y-4">
                {r.semanas.map((s) => (
                  <details key={s.desde} className="rounded-xl border border-linea" open={s === r.semanas[0]}>
                    <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 font-medium">
                      <span className="flex items-center gap-2">
                        <ChevronRight className="h-4 w-4 shrink-0 text-tinta/40 transition-transform [details[open]_&]:rotate-90" />
                        Semana del {fecha(`${s.desde}T00:00:00-05:00`)} al {fecha(`${s.hasta}T00:00:00-05:00`)}
                      </span>
                      <span className="flex items-center gap-3">
                        {s.cantidadGratis > 0 ? (
                          <Pastilla tono="laton">
                            <Gift className="h-3.5 w-3.5" /> {s.cantidadGratis} gratis
                          </Pastilla>
                        ) : null}
                        <span className="ayuda">{s.cantidad} serv.</span>
                        <span className="cifra font-semibold">{aTextoConSimbolo(s.total)}</span>
                      </span>
                    </summary>
                    <ul className="divide-y divide-linea border-t border-linea">
                      {s.lineas.map((l, i) => (
                        <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                          <span className="min-w-0 truncate text-tinta/70">
                            {fecha(l.ts)} · {l.correlativo} · {l.cantidad > 1 ? `${l.cantidad} × ` : ""}
                            {l.nombre}
                          </span>
                          <span className={`cifra shrink-0 font-semibold ${l.gratis ? "text-laton-oscuro" : ""}`}>
                            {l.gratis ? "Gratis" : aTextoConSimbolo(l.total)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {liquidando && r ? (
        <Modal
          titulo="¿Liquidar los adelantos?"
          alCerrar={() => setLiquidando(false)}
          pie={
            <div className="flex justify-end gap-3">
              <button className="boton-suave" onClick={() => setLiquidando(false)}>
                Cancelar
              </button>
              <button className="boton-primario" disabled={liquidar.isPending} onClick={() => liquidar.mutate()}>
                <CheckCircle2 className="h-5 w-5" />
                {liquidar.isPending ? "Guardando…" : "Sí, liquidar"}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-tinta/75">
              Queda registrado que se le pagaron <strong>{aTextoConSimbolo(r.saldoPendiente)}</strong> de adelantos a{" "}
              {barbero.nombre}. No calcula ni paga sueldo — eso sigue fuera del sistema — solo deja la cuenta en cero
              para la semana que entra.
            </p>
            <label className="block">
              <span className="etiqueta mb-2 block">
                Notas <span className="font-normal text-tinta/40">· opcional</span>
              </span>
              <input className="campo" value={notas} onChange={(e) => setNotas(e.target.value)} />
            </label>
            {falloLiquidar ? <Aviso tono="mal">{falloLiquidar.message}</Aviso> : null}
          </div>
        </Modal>
      ) : null}
    </Modal>
  );
}
