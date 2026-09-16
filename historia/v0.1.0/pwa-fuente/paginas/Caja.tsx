/**
 * Caja: apertura de turno, arqueo en vivo y cierre.
 *
 * La advertencia sobre los egresos va A LA VISTA, junto al número, y no
 * escondida en un manual: el efectivo esperado no descuenta las salidas de
 * dinero del cajón porque esta versión no registra egresos, y quien cuadra
 * tiene que saberlo en el momento en que lee la diferencia.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type Arqueo, type Turno } from "../lib/api";
import { aCentimos, aTextoConSimbolo, fechaYHora, hora } from "../lib/formato";
import { Aviso, Vacio } from "../componentes/Modal";
import { Recuadro as Cuadro } from "../componentes/Piezas";

export function Caja() {
  const qc = useQueryClient();

  const caja = useQuery({
    queryKey: ["caja"],
    queryFn: () =>
      api.get<
        | { abierto: false; ultimoTurno: Turno | null }
        | { abierto: true; arqueo: Arqueo; advertencia: string }
      >("/caja"),
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
    <div className="flex h-full gap-3 overflow-hidden p-3">
      <section className="scroll-fino min-w-0 flex-1 overflow-y-auto">
        {caja.isLoading ? (
          <Vacio titulo="Cargando…" />
        ) : caja.data?.abierto ? (
          <TurnoAbierto arqueo={caja.data.arqueo} advertencia={caja.data.advertencia} alCerrar={refrescar} />
        ) : (
          <AbrirCaja ultimo={caja.data?.ultimoTurno ?? null} alAbrir={refrescar} />
        )}
      </section>

      <aside className="flex w-80 shrink-0 flex-col">
        <h2 className="mb-2 text-lg font-bold">Turnos anteriores</h2>
        <div className="scroll-fino tarjeta min-h-0 flex-1 overflow-y-auto p-2">
          {(turnos.data?.turnos.length ?? 0) === 0 ? (
            <p className="p-3 text-sm text-tinta/50">Todavía no se cerró ningún turno.</p>
          ) : (
            turnos.data!.turnos.map((t) => (
              <div key={t.id} className="border-b border-black/5 px-2 py-2 last:border-0">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold">{fechaYHora(t.abiertoEn)}</span>
                  {t.cerradoEn ? (
                    <span className="text-tinta/50">cerró {hora(t.cerradoEn)}</span>
                  ) : (
                    <span className="font-semibold text-bien">abierto</span>
                  )}
                </div>
                {t.diferencia !== undefined ? (
                  <div
                    className={`cifra text-sm ${
                      t.diferencia === 0 ? "text-bien" : t.diferencia < 0 ? "text-mal" : "text-aviso"
                    }`}
                  >
                    {t.diferencia === 0
                      ? "cuadró exacto"
                      : t.diferencia < 0
                        ? `faltaron ${aTextoConSimbolo(-t.diferencia)}`
                        : `sobraron ${aTextoConSimbolo(t.diferencia)}`}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

function AbrirCaja({ ultimo, alAbrir }: { ultimo: Turno | null; alAbrir: () => void }) {
  const [monto, setMonto] = useState("");

  const abrir = useMutation({
    mutationFn: () => api.post("/caja/abrir", { montoInicial: aCentimos(monto || "0") ?? 0 }),
    onSuccess: alAbrir,
  });

  return (
    <div className="tarjeta mx-auto max-w-lg p-6">
      <h1 className="mb-1 text-2xl font-bold">Abrir caja</h1>
      <p className="mb-4 text-sm text-tinta/60">
        {ultimo?.cerradoEn
          ? `El último turno cerró el ${fechaYHora(ultimo.cerradoEn)}.`
          : "Todavía no se abrió caja en este sistema."}
      </p>

      <label className="block">
        <span className="etiqueta mb-1 block">¿Con cuánto efectivo arranca el cajón?</span>
        <input
          className="campo cifra text-right text-2xl"
          autoFocus
          inputMode="decimal"
          placeholder="0.00"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && abrir.mutate()}
        />
      </label>

      <button className="boton-primario mt-4 w-full" disabled={abrir.isPending} onClick={() => abrir.mutate()}>
        {abrir.isPending ? "Abriendo…" : "Abrir caja"}
      </button>

      <div className="mt-4">
        <Aviso tono="info">
          Se puede cobrar con la caja cerrada: esas ventas quedan registradas y se reportan aparte.
          Perder una venta porque nadie abrió el turno sería peor.
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
  alCerrar: () => void;
}) {
  const [cerrando, setCerrando] = useState(false);
  const [contado, setContado] = useState("");
  const [notas, setNotas] = useState("");
  const [resultado, setResultado] = useState<{ diferencia: number; integro: boolean } | null>(null);

  const cerrar = useMutation({
    mutationFn: () =>
      api.post<{ diferencia: number; integridad: { ok: boolean } }>("/caja/cerrar", {
        contadoEfectivo: aCentimos(contado || "0") ?? 0,
        notas: notas || undefined,
      }),
    onSuccess: (r) => {
      setResultado({ diferencia: r.diferencia, integro: r.integridad.ok });
      setCerrando(false);
      alCerrar();
    },
  });

  const contadoCentimos = aCentimos(contado);
  const diferenciaPrevia = contadoCentimos === null ? null : contadoCentimos - arqueo.efectivoEnCajon;

  if (resultado) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-6 text-center">
        <h1 className="mb-4 text-2xl font-bold">Turno cerrado</h1>
        <div
          className={`cifra mb-2 text-4xl font-bold ${
            resultado.diferencia === 0 ? "text-bien" : resultado.diferencia < 0 ? "text-mal" : "text-aviso"
          }`}
        >
          {resultado.diferencia === 0
            ? "Cuadró exacto"
            : resultado.diferencia < 0
              ? `Faltaron ${aTextoConSimbolo(-resultado.diferencia)}`
              : `Sobraron ${aTextoConSimbolo(resultado.diferencia)}`}
        </div>

        <div className="mt-4">
          <Aviso tono={resultado.integro ? "bien" : "mal"}>
            {resultado.integro
              ? "✓ Los datos del día están íntegros: la secuencia de eventos y la cadena de hash validan."
              : "✗ La verificación del log encontró problemas. Revisa Ajustes → Diagnóstico."}
          </Aviso>
        </div>

        {resultado.diferencia !== 0 ? (
          <div className="mt-3">
            <Aviso tono="info">{advertencia}</Aviso>
          </div>
        ) : null}

        <button className="boton-primario mt-4 w-full" onClick={() => setResultado(null)}>
          Listo
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Caja abierta</h1>
        <span className="text-sm text-tinta/60">desde {fechaYHora(arqueo.abiertoEn)}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cuadro etiqueta="Ventas" valor={String(arqueo.cantidadVentas)} />
        <Cuadro etiqueta="Efectivo" valor={aTextoConSimbolo(arqueo.medios.EFECTIVO)} />
        <Cuadro etiqueta="YAPE" valor={aTextoConSimbolo(arqueo.medios.YAPE)} />
        <Cuadro etiqueta="Tarjeta" valor={aTextoConSimbolo(arqueo.medios.TARJETA)} />
      </div>

      <div className="tarjeta mt-3 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-semibold">Total vendido</span>
          <span className="cifra text-2xl font-bold">{aTextoConSimbolo(arqueo.totalVendido)}</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between border-t border-black/10 pt-2">
          <span>
            Efectivo esperado en el cajón
            <span className="block text-xs text-tinta/50">
              {aTextoConSimbolo(arqueo.montoInicial)} de apertura +{" "}
              {aTextoConSimbolo(arqueo.medios.EFECTIVO)} cobrados
            </span>
          </span>
          <span className="cifra text-2xl font-bold">{aTextoConSimbolo(arqueo.efectivoEnCajon)}</span>
        </div>
      </div>

      <div className="mt-3">
        <Aviso tono="aviso" titulo="Antes de cuadrar, ten esto en cuenta">
          {advertencia}
        </Aviso>
      </div>

      {arqueo.ventasFueraDeTurno > 0 ? (
        <div className="mt-2">
          <Aviso tono="info">
            Hay {arqueo.ventasFueraDeTurno} venta(s) cobradas con la caja cerrada. Están registradas,
            pero no entran en este arqueo.
          </Aviso>
        </div>
      ) : null}

      {arqueo.ventasAnuladas > 0 ? (
        <div className="mt-2">
          <Aviso tono="info">
            {arqueo.ventasAnuladas} venta(s) anuladas en este turno. No suman al total.
          </Aviso>
        </div>
      ) : null}

      {cerrando ? (
        <div className="tarjeta mt-3 space-y-3 p-4">
          <label className="block">
            <span className="etiqueta mb-1 block">¿Cuánto efectivo hay de verdad en el cajón?</span>
            <input
              className="campo cifra text-right text-2xl"
              autoFocus
              inputMode="decimal"
              placeholder="0.00"
              value={contado}
              onChange={(e) => setContado(e.target.value)}
            />
          </label>

          {diferenciaPrevia !== null ? (
            <div
              className={`cifra rounded-lg px-3 py-2 text-center font-bold ${
                diferenciaPrevia === 0
                  ? "bg-bien/10 text-bien"
                  : diferenciaPrevia < 0
                    ? "bg-mal/10 text-mal"
                    : "bg-aviso/10 text-aviso"
              }`}
            >
              {diferenciaPrevia === 0
                ? "Cuadra exacto"
                : diferenciaPrevia < 0
                  ? `Faltan ${aTextoConSimbolo(-diferenciaPrevia)}`
                  : `Sobran ${aTextoConSimbolo(diferenciaPrevia)}`}
            </div>
          ) : null}

          <input
            className="campo"
            placeholder="Notas del cierre (opcional)"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
          />

          <div className="flex gap-2">
            <button className="boton-suave flex-1" onClick={() => setCerrando(false)}>
              Cancelar
            </button>
            <button
              className="boton-primario flex-1"
              disabled={contadoCentimos === null || cerrar.isPending}
              onClick={() => cerrar.mutate()}
            >
              {cerrar.isPending ? "Cerrando…" : "Cerrar turno"}
            </button>
          </div>
        </div>
      ) : (
        <button className="boton-primario mt-3 w-full" onClick={() => setCerrando(true)}>
          Cerrar turno y arquear
        </button>
      )}
    </div>
  );
}
