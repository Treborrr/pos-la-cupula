/**
 * Respaldos.
 *
 * El riesgo más grave del sistema no es un bug: es que se queme el disco y no
 * haya copia. Por eso esta pantalla verifica el destino externo ESCRIBIENDO de
 * verdad y lo dice en grande si no sirve.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { HardDrive, ShieldCheck } from "lucide-react";

import { api } from "../../lib/api";
import { Aviso } from "../../componentes/Modal";
import { fechaYHora } from "../../lib/formato";
import { tamanoLegible } from "../../componentes/Piezas";

interface EstadoRespaldos {
  carpeta: string;
  ultimo: { archivo: string; cuando: string; bytes: number } | null;
  cantidad: number;
  destinoExterno: string | null;
  destinoExternoEscribible: boolean | null;
  detalleDelDestino?: string;
}

export function SeccionRespaldos({ destinoConfigurado }: { destinoConfigurado: string }) {
  const qc = useQueryClient();
  const [destino, setDestino] = useState(destinoConfigurado);

  const estado = useQuery({ queryKey: ["respaldos"], queryFn: () => api.get<EstadoRespaldos>("/respaldos") });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["respaldos"] });
    qc.invalidateQueries({ queryKey: ["config"] });
  };

  const guardarDestino = useMutation({
    mutationFn: async () => {
      await api.put("/config", { "respaldos.destinoExterno": destino.trim() });
      return api.post<{ ok: boolean; detalle: string }>("/respaldos/verificar-destino");
    },
    onSuccess: refrescar,
  });

  const crear = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; archivo?: string; copiaExterna?: string; motivo?: string }>("/respaldos", {
        etiqueta: "manual",
      }),
    onSuccess: refrescar,
  });

  const e = estado.data;

  return (
    <div className="space-y-6">
      {/* Lo primero que se ve: si hay copia fuera de esta máquina o no. */}
      {e?.destinoExternoEscribible === true ? (
        <Aviso tono="bien" titulo="Hay copia fuera de esta computadora">
          {e.detalleDelDestino}
        </Aviso>
      ) : e?.destinoExternoEscribible === false ? (
        <Aviso tono="mal" titulo="La copia externa NO está funcionando">
          {e.detalleDelDestino} Mientras tanto, la única copia vive en el mismo disco que los datos: si ese disco falla,
          se pierde todo.
        </Aviso>
      ) : (
        <Aviso tono="aviso" titulo="Todavía no hay copia fuera de esta computadora">
          Los respaldos se guardan en el mismo disco que las ventas. Eso protege de un borrado accidental, pero{" "}
          <strong>no</strong> de que el disco se dañe o roben la PC. Configura una carpeta de OneDrive o un USB que quede
          siempre conectado.
        </Aviso>
      )}

      <div>
        <span className="etiqueta mb-2 block">Carpeta externa para la copia</span>
        <form
          className="flex gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            guardarDestino.mutate();
          }}
        >
          <input
            className="campo"
            placeholder="Por ejemplo: C:\Users\...\OneDrive\Respaldos POS  o  D:\RespaldosPOS"
            value={destino}
            onChange={(ev) => setDestino(ev.target.value)}
          />
          <button type="submit" className="boton-laton shrink-0" disabled={guardarDestino.isPending}>
            <ShieldCheck className="h-5 w-5" />
            {guardarDestino.isPending ? "Probando…" : "Guardar y probar"}
          </button>
        </form>
        <p className="ayuda mt-2">
          Al guardar se escribe un archivo de prueba, se lee y se borra: que la carpeta «exista» no alcanza, un USB
          desconectado deja la letra de unidad igual.
        </p>
        {guardarDestino.data ? (
          <div className="mt-3">
            <Aviso tono={guardarDestino.data.ok ? "bien" : "mal"}>{guardarDestino.data.detalle}</Aviso>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-hueso px-5 py-4">
        <div className="flex items-center gap-4">
          <HardDrive className="h-6 w-6 text-tinta/45" />
          <div>
            <div className="etiqueta">Último respaldo</div>
            {e?.ultimo ? (
              <>
                <div className="font-semibold">{fechaYHora(e.ultimo.cuando)}</div>
                <div className="ayuda">
                  {tamanoLegible(e.ultimo.bytes)} · {e.cantidad} guardados
                </div>
              </>
            ) : (
              <div className="font-medium text-tinta/60">Todavía no se hizo ninguno</div>
            )}
          </div>
        </div>
        <button className="boton-suave" disabled={crear.isPending} onClick={() => crear.mutate()}>
          {crear.isPending ? "Creando…" : "Respaldar ahora"}
        </button>
      </div>

      {crear.data ? (
        <Aviso tono={crear.data.ok ? "bien" : "mal"}>
          {crear.data.ok
            ? crear.data.copiaExterna
              ? "Respaldo creado, con copia en la carpeta externa."
              : "Respaldo creado en este disco. Sin copia externa."
            : crear.data.motivo}
        </Aviso>
      ) : null}

      <div className="space-y-2 text-tinta/70">
        <p>
          <strong className="text-tinta">Automático:</strong> cada hora mientras el POS esté encendido —solo si hubo
          movimientos— y al cerrar cada turno. Se conservan las últimas 24 copias horarias y los últimos 30 cierres, así
          que hay un día con detalle fino y un mes para volver más atrás.
        </p>
        <p>
          <strong className="text-tinta">Restaurar</strong> es descomprimir el archivo y copiar las carpetas{" "}
          <code className="rounded bg-hueso px-1.5 py-0.5 text-sm">eventos</code> e{" "}
          <code className="rounded bg-hueso px-1.5 py-0.5 text-sm">instantaneas</code> sobre la instalación. Es un{" "}
          <code className="rounded bg-hueso px-1.5 py-0.5 text-sm">.tar.gz</code> estándar que abre 7-Zip o el propio
          Windows.
        </p>
      </div>
    </div>
  );
}
