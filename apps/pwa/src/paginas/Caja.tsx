/**
 * Caja: apertura de turno, arqueo en vivo y cierre.
 *
 * La advertencia sobre los egresos va A LA VISTA, junto al número: el efectivo
 * esperado no descuenta las salidas de dinero del cajón porque esta versión no
 * registra egresos, y quien cuadra tiene que saberlo cuando lee la diferencia.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, History, Lock, LockOpen, ShieldCheck, XCircle } from "lucide-react";

import { api, type Arqueo, type Turno } from "../lib/api";
import { aCentimos, aTextoConSimbolo, fechaYHora, hora } from "../lib/formato";
import { Aviso, Vacio } from "../componentes/Modal";
import { EncabezadoPagina, Pagina, Recuadro } from "../componentes/Piezas";

export function Caja() {
  const qc = useQueryClient();
  const [cierre, setCierre] = useState<{ diferencia: number; integro: boolean; advertencia: string } | null>(null);

  const caja = useQuery({
    queryKey: ["caja"],
    queryFn: () =>
      api.get<{ abierto: false; ultimoTurno: Turno | null } | { abierto: true; arqueo: Arqueo; advertencia: string }>(
        "/caja",
      ),
    refetchInterval: 10_000,
  });

  const turnos = useQuery({
    queryKey: ["turnos"],
    queryFn: () => api.get<{ turnos: Turno[] }>("/caja/turnos?limite=15"),
  });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["caja"] });
    qc.invalidateQueries({ queryKey: ["turnos"] });
    qc.invalidateQueries({ queryKey: ["estado"] });
  };

  return (
    <Pagina>
      <EncabezadoPagina
        titulo="Caja"
        descripcion="Abre el turno al empezar el día con el efectivo del cajón, y ciérralo al terminar contando lo que hay."
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div>
          {cierre ? (
            <ResultadoDelCierre resultado={cierre} alTerminar={() => setCierre(null)} />
          ) : caja.isLoading ? (
            <Vacio titulo="Cargando…" />
          ) : caja.data?.abierto ? (
            <TurnoAbierto
              arqueo={caja.data.arqueo}
              advertencia={caja.data.advertencia}
              alCerrar={(r) => {
                setCierre(r);
                refrescar();
              }}
            />
          ) : (
            <AbrirCaja ultimo={caja.data?.ultimoTurno ?? null} alAbrir={refrescar} />
          )}
        </div>

        <aside className="tarjeta h-fit overflow-hidden">
          <div className="flex items-center gap-2 border-b border-linea px-5 py-4">
            <History className="h-5 w-5 text-tinta/50" />
            <h2 className="font-semibold">Turnos anteriores</h2>
          </div>
          {(turnos.data?.turnos.length ?? 0) === 0 ? (
            <p className="ayuda p-5">Todavía no se cerró ningún turno.</p>
          ) : (
            <ul className="scroll-fino max-h-[32rem] divide-y divide-linea overflow-y-auto">
              {turnos.data!.turnos.map((t) => (
                <li key={t.id} className="px-5 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{fechaYHora(t.abiertoEn)}</span>
                    {t.cerradoEn ? (
                      <span className="ayuda">cerró {hora(t.cerradoEn)}</span>
                    ) : (
                      <span className="text-sm font-semibold text-bien">abierto</span>
                    )}
                  </div>
                  {t.diferencia !== undefined ? (
                    <div
                      className={`cifra text-sm ${
                        t.diferencia === 0 ? "text-bien" : t.diferencia < 0 ? "text-mal" : "text-aviso"
                      }`}
                    >
                      {t.diferencia === 0
                        ? "Cuadró exacto"
                        : t.diferencia < 0
                          ? `Faltaron ${aTextoConSimbolo(-t.diferencia)}`
                          : `Sobraron ${aTextoConSimbolo(t.diferencia)}`}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </Pagina>
  );
}

function AbrirCaja({ ultimo, alAbrir }: { ultimo: Turno | null; alAbrir: () => void }) {
  const [monto, setMonto] = useState("");

  const abrir = useMutation({
    mutationFn: () => api.post("/caja/abrir", { montoInicial: aCentimos(monto || "0") ?? 0 }),
    onSuccess: alAbrir,
  });

  return (
    <div className="tarjeta p-8">
      <div className="mb-6 flex items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-hueso text-tinta/60">
          <Lock className="h-7 w-7" />
        </span>
        <div>
          <h2 className="text-2xl font-semibold">La caja está cerrada</h2>
          <p className="ayuda text-base">
            {ultimo?.cerradoEn
              ? `El último turno cerró el ${fechaYHora(ultimo.cerradoEn)}.`
              : "Todavía no se abrió caja en este sistema."}
          </p>
        </div>
      </div>

      <form
        className="max-w-md space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          abrir.mutate();
        }}
      >
        <label className="block">
          <span className="etiqueta mb-2 block">¿Con cuánto efectivo empieza el cajón?</span>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-xl text-tinta/40">S/</span>
            <input
              className="campo cifra h-16 pl-14 text-right text-3xl"
              autoFocus
              inputMode="decimal"
              placeholder="0.00"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
            />
          </div>
          <span className="ayuda mt-2 block">Cuenta los billetes y monedas para dar vuelto. Si no hay, déjalo en cero.</span>
        </label>

        {abrir.error ? <Aviso tono="mal">{(abrir.error as Error).message}</Aviso> : null}

        <button type="submit" className="boton-primario boton-grande w-full" disabled={abrir.isPending}>
          <LockOpen className="h-5 w-5" />
          {abrir.isPending ? "Abriendo…" : "Abrir caja"}
        </button>
      </form>

      <div className="mt-6 max-w-md">
        <Aviso tono="info">
          Se puede cobrar con la caja cerrada: esas ventas quedan registradas y aparecen aparte en el arqueo del próximo
          turno.
        </Aviso>
      </div>
    </div>
  );
}

function TurnoAbierto({
  arqueo,
  advertencia,
  alCerrar,
}: {
  arqueo: Arqueo;
  advertencia: string;
  alCerrar: (r: { diferencia: number; integro: boolean; advertencia: string }) => void;
}) {
  const [cerrando, setCerrando] = useState(false);
  const [contado, setContado] = useState("");
  const [notas, setNotas] = useState("");

  const cerrar = useMutation({
    mutationFn: () =>
      api.post<{ diferencia: number; integridad: { ok: boolean } }>("/caja/cerrar", {
        contadoEfectivo: aCentimos(contado || "0") ?? 0,
        notas: notas || undefined,
      }),
    onSuccess: (r) => alCerrar({ diferencia: r.diferencia, integro: r.integridad.ok, advertencia }),
  });

  const contadoCentimos = contado.trim() === "" ? null : aCentimos(contado);
  const diferenciaPrevia = contadoCentimos === null ? null : contadoCentimos - arqueo.efectivoEnCajon;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-bien/10 text-bien">
          <LockOpen className="h-6 w-6" />
        </span>
        <div>
          <h2 className="text-2xl font-semibold">Caja abierta</h2>
          <p className="ayuda text-base">
            Desde el {fechaYHora(arqueo.abiertoEn)} · empezó con {aTextoConSimbolo(arqueo.montoInicial)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Recuadro etiqueta="Ventas" valor={String(arqueo.cantidadVentas)} />
        <Recuadro etiqueta="Efectivo" valor={aTextoConSimbolo(arqueo.medios.EFECTIVO)} />
        <Recuadro etiqueta="YAPE" valor={aTextoConSimbolo(arqueo.medios.YAPE)} />
        <Recuadro etiqueta="Tarjeta" valor={aTextoConSimbolo(arqueo.medios.TARJETA)} />
      </div>

      <div className="tarjeta divide-y divide-linea">
        <div className="flex items-baseline justify-between px-6 py-5">
          <span className="text-lg font-medium">Total vendido</span>
          <span className="cifra text-3xl font-semibold tracking-tight">{aTextoConSimbolo(arqueo.totalVendido)}</span>
        </div>
        <div className="flex items-baseline justify-between px-6 py-5">
          <span>
            <span className="text-lg font-medium">Efectivo que debería haber en el cajón</span>
            <span className="ayuda block">
              {aTextoConSimbolo(arqueo.montoInicial)} de apertura + {aTextoConSimbolo(arqueo.medios.EFECTIVO)} cobrados
            </span>
          </span>
          <span className="cifra text-3xl font-semibold tracking-tight">{aTextoConSimbolo(arqueo.efectivoEnCajon)}</span>
        </div>
      </div>

      {arqueo.ventasFueraDeTurno > 0 ? (
        <Aviso tono="aviso" titulo={`${arqueo.ventasFueraDeTurno} venta(s) cobradas con la caja cerrada`}>
          Suman {aTextoConSimbolo(arqueo.totalFueraDeTurno ?? 0)}
          {arqueo.efectivoFueraDeTurno ? `, de los cuales ${aTextoConSimbolo(arqueo.efectivoFueraDeTurno)} fueron en efectivo` : ""}.
          Están registradas pero no entran en este arqueo: si ese efectivo está en el cajón, tenlo en cuenta al contar.
        </Aviso>
      ) : null}

      {arqueo.ventasAnuladas > 0 ? (
        <Aviso tono="info">{arqueo.ventasAnuladas} venta(s) anuladas en este turno. No suman al total.</Aviso>
      ) : null}

      {cerrando ? (
        <div className="tarjeta space-y-5 p-6">
          <div>
            <h3 className="text-xl font-semibold">Cerrar el turno</h3>
            <p className="ayuda text-base">Cuenta todo el efectivo del cajón y escribe el monto.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="etiqueta mb-2 block">Efectivo contado</span>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-xl text-tinta/40">S/</span>
                <input
                  className="campo cifra h-16 pl-14 text-right text-3xl"
                  autoFocus
                  inputMode="decimal"
                  placeholder="0.00"
                  value={contado}
                  onChange={(e) => setContado(e.target.value)}
                />
              </div>
            </label>
            <div className="flex flex-col">
              <span className="etiqueta mb-2 block">Resultado</span>
              <div
                className={`cifra flex h-16 items-center justify-center rounded-xl text-xl font-semibold ${
                  diferenciaPrevia === null
                    ? "bg-hueso text-tinta/40"
                    : diferenciaPrevia === 0
                      ? "bg-bien/10 text-bien"
                      : diferenciaPrevia < 0
                        ? "bg-mal/10 text-mal"
                        : "bg-aviso/10 text-aviso"
                }`}
              >
                {diferenciaPrevia === null
                  ? `Se esperan ${aTextoConSimbolo(arqueo.efectivoEnCajon)}`
                  : diferenciaPrevia === 0
                    ? "Cuadra exacto"
                    : diferenciaPrevia < 0
                      ? `Faltan ${aTextoConSimbolo(-diferenciaPrevia)}`
                      : `Sobran ${aTextoConSimbolo(diferenciaPrevia)}`}
              </div>
            </div>
          </div>

          <Aviso tono="aviso" titulo="Antes de cuadrar">
            {advertencia}
          </Aviso>

          <label className="block">
            <span className="etiqueta mb-2 block">
              Notas del cierre <span className="font-normal text-tinta/40">· opcional</span>
            </span>
            <input
              className="campo"
              placeholder="Por ejemplo: se sacaron S/ 20 para compras"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </label>

          {cerrar.error ? <Aviso tono="mal">{(cerrar.error as Error).message}</Aviso> : null}

          <div className="flex justify-end gap-3">
            <button className="boton-suave" onClick={() => setCerrando(false)}>
              Cancelar
            </button>
            <button
              className="boton-primario"
              disabled={contadoCentimos === null || cerrar.isPending}
              onClick={() => cerrar.mutate()}
            >
              <ShieldCheck className="h-5 w-5" />
              {cerrar.isPending ? "Cerrando…" : "Cerrar turno"}
            </button>
          </div>
        </div>
      ) : (
        <button className="boton-primario boton-grande w-full" onClick={() => setCerrando(true)}>
          <Lock className="h-5 w-5" />
          Cerrar turno y contar la caja
        </button>
      )}
    </div>
  );
}

function ResultadoDelCierre({
  resultado,
  alTerminar,
}: {
  resultado: { diferencia: number; integro: boolean; advertencia: string };
  alTerminar: () => void;
}) {
    const cuadro = resultado.diferencia === 0;
    return (
      <div className="tarjeta p-8 text-center">
        {cuadro ? (
          <CheckCircle2 className="mx-auto mb-3 h-14 w-14 text-bien" strokeWidth={1.5} />
        ) : (
          <XCircle className={`mx-auto mb-3 h-14 w-14 ${resultado.diferencia < 0 ? "text-mal" : "text-aviso"}`} strokeWidth={1.5} />
        )}
        <h2 className="text-2xl font-semibold">Turno cerrado</h2>
        <div
          className={`cifra mt-3 text-4xl font-semibold tracking-tight ${
            cuadro ? "text-bien" : resultado.diferencia < 0 ? "text-mal" : "text-aviso"
          }`}
        >
          {cuadro
            ? "Cuadró exacto"
            : resultado.diferencia < 0
              ? `Faltaron ${aTextoConSimbolo(-resultado.diferencia)}`
              : `Sobraron ${aTextoConSimbolo(resultado.diferencia)}`}
        </div>

        <div className="mx-auto mt-6 max-w-lg space-y-3 text-left">
          <Aviso tono={resultado.integro ? "bien" : "mal"}>
            {resultado.integro
              ? "Los datos del día están íntegros: la secuencia de ventas y la cadena de verificación validan."
              : "La verificación de los datos encontró problemas. Revisa Ajustes → Diagnóstico."}
          </Aviso>
          {!cuadro ? <Aviso tono="info">{resultado.advertencia}</Aviso> : null}
        </div>

        <button
          className="boton-primario boton-grande mt-6 w-full max-w-lg"
          onClick={alTerminar}
        >
          Listo
        </button>
      </div>
    );
  }
