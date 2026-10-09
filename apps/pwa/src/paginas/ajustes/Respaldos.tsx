/**
 * Respaldos.
 *
 * El riesgo más grave del sistema no es un bug: es que se queme el disco y no
 * haya copia. Por eso esta pantalla verifica el destino externo ESCRIBIENDO de
 * verdad y lo dice en grande si no sirve.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Check, Cloud, Folder, FolderPlus, FolderSearch, HardDrive, ShieldCheck, Usb } from "lucide-react";

import { api, type FalloDeApi } from "../../lib/api";
import { Aviso, Modal } from "../../componentes/Modal";
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
  const [buscando, setBuscando] = useState(false);

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
        <div className="flex flex-wrap gap-3">
          {/* El botón primero: tipear una ruta de Windows a mano es la forma
              más segura de que esto quede mal configurado. El campo de texto
              se queda para quien ya sabe la ruta o la tiene copiada. */}
          <button type="button" className="boton-suave shrink-0" onClick={() => setBuscando(true)}>
            <FolderSearch className="h-5 w-5" />
            Elegir carpeta…
          </button>
          <form
            className="flex min-w-72 flex-1 gap-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              guardarDestino.mutate();
            }}
          >
            <input
              className="campo cifra"
              placeholder="…o pega la ruta acá"
              value={destino}
              onChange={(ev) => setDestino(ev.target.value)}
            />
            <button type="submit" className="boton-laton shrink-0" disabled={guardarDestino.isPending}>
              <ShieldCheck className="h-5 w-5" />
              {guardarDestino.isPending ? "Probando…" : "Guardar y probar"}
            </button>
          </form>
        </div>
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

      {buscando ? (
        <ElegirCarpeta
          inicial={destino}
          alCerrar={() => setBuscando(false)}
          alElegir={(ruta) => {
            setDestino(ruta);
            setBuscando(false);
            // Se guarda y se prueba solo: elegir la carpeta y después tener que
            // apretar otro botón es el paso donde la configuración se abandona.
            setTimeout(() => guardarDestino.mutate(), 0);
          }}
        />
      ) : null}

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

// ─────────────────────────────────────────────────────────────────────────────

interface Carpeta {
  nombre: string;
  ruta: string;
}
interface Sugerencia extends Carpeta {
  detalle: string;
  tipo: "nube" | "extraible" | "disco" | "carpeta";
}
interface Listado {
  ruta: string | null;
  padre: string | null;
  carpetas: Carpeta[];
  sugerencias: Sugerencia[];
  escribible?: boolean;
  problema?: string;
}

const ICONO = { nube: Cloud, extraible: Usb, disco: HardDrive, carpeta: Folder } as const;

/**
 * Elegir la carpeta de destino navegando, sin tipear la ruta.
 *
 * NO es el explorador de Windows, y no puede serlo: el POS corre como servicio
 * en la sesión 0, donde una ventana nativa no se ve nunca (el porqué completo
 * está en `consultas/carpetas.ts` del servidor). Este navegador tiene además
 * una ventaja que el nativo no tendría: funciona igual desde el celular.
 *
 * Arranca en las SUGERENCIAS y no en la lista de discos, porque el destino que
 * sirve casi siempre es uno de dos —una carpeta de OneDrive o un USB— y hacer
 * navegar a alguien desde `C:\` hasta su carpeta de OneDrive son seis clics
 * para llegar a algo que el sistema ya sabe dónde está.
 */
function ElegirCarpeta({
  inicial,
  alElegir,
  alCerrar,
}: {
  inicial: string;
  alElegir: (ruta: string) => void;
  alCerrar: () => void;
}) {
  const qc = useQueryClient();
  // Arranca donde ya estaba configurado, si había algo: lo más probable es que
  // quieran cambiar a una carpeta vecina, no empezar de cero.
  const [ruta, setRuta] = useState<string | null>(inicial.trim() || null);
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("Respaldos POS");

  const listado = useQuery({
    queryKey: ["carpetas", ruta],
    queryFn: () => api.get<Listado>(`/carpetas${ruta ? `?ruta=${encodeURIComponent(ruta)}` : ""}`),
  });

  const crear = useMutation({
    mutationFn: () => api.post<{ ruta: string }>("/carpetas", { dentroDe: ruta, nombre: nombreNuevo.trim() }),
    onSuccess: (r) => {
      setCreando(false);
      setRuta(r.ruta);
      qc.invalidateQueries({ queryKey: ["carpetas"] });
    },
  });

  const l = listado.data;
  const enRaiz = !ruta;
  const puedeElegir = Boolean(ruta) && l?.escribible !== false && !l?.problema;

  return (
    <Modal
      titulo="Elegir la carpeta del respaldo"
      subtitulo={ruta ?? "Discos y carpetas de esta computadora"}
      alCerrar={alCerrar}
      ancho="max-w-3xl"
      pie={
        <div className="flex flex-wrap items-center gap-3">
          {ruta && !l?.problema ? (
            <button className="boton-suave" onClick={() => setCreando(true)}>
              <FolderPlus className="h-5 w-5" />
              Crear carpeta aquí
            </button>
          ) : null}
          <button className="boton-suave ml-auto" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="boton-primario" disabled={!puedeElegir} onClick={() => alElegir(ruta!)}>
            <Check className="h-5 w-5" />
            Guardar aquí
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* La ruta elegida, siempre visible: es lo que se va a guardar, y verla
            en crudo es lo que permite darse cuenta de que uno se metió en la
            carpeta equivocada. */}
        {ruta ? (
          <div className="flex items-center gap-3 rounded-xl bg-hueso px-4 py-3">
            {l?.padre !== null && l?.padre !== undefined ? (
              <button className="boton-icono shrink-0" onClick={() => setRuta(l.padre)} title="Subir un nivel">
                <ArrowLeft className="h-5 w-5" />
              </button>
            ) : (
              <button className="boton-icono shrink-0" onClick={() => setRuta(null)} title="Ver los discos">
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <span className="cifra min-w-0 flex-1 truncate text-sm">{ruta}</span>
            {l?.escribible === false ? <span className="ayuda shrink-0 text-mal">sin permiso de escritura</span> : null}
          </div>
        ) : null}

        {l?.problema ? <Aviso tono="mal">{l.problema}</Aviso> : null}

        {crear.error ? (
          <Aviso tono="mal" titulo={(crear.error as FalloDeApi).message}>
            {(crear.error as FalloDeApi).sugerencia}
          </Aviso>
        ) : null}

        {creando ? (
          <form
            className="flex gap-3 rounded-xl border border-linea p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (nombreNuevo.trim()) crear.mutate();
            }}
          >
            <input
              className="campo"
              autoFocus
              value={nombreNuevo}
              onChange={(e) => setNombreNuevo(e.target.value)}
              placeholder="Nombre de la carpeta nueva"
            />
            <button type="submit" className="boton-primario shrink-0" disabled={!nombreNuevo.trim() || crear.isPending}>
              {crear.isPending ? "Creando…" : "Crear"}
            </button>
            <button type="button" className="boton-suave shrink-0" onClick={() => setCreando(false)}>
              Cancelar
            </button>
          </form>
        ) : null}

        {/* En la raíz, primero lo que de verdad protege. Una carpeta en C: no
            es un respaldo: es el mismo disco donde ya están los datos. */}
        {enRaiz && (l?.sugerencias.length ?? 0) > 0 ? (
          <div>
            <h3 className="etiqueta mb-2">Lo que conviene usar</h3>
            <div className="space-y-2">
              {l!.sugerencias.map((s) => {
                const Icono = ICONO[s.tipo];
                return (
                  <button
                    key={s.ruta}
                    className="flex w-full items-start gap-3 rounded-xl border border-linea p-4 text-left transition-colors hover:border-tinta/30 hover:bg-hueso"
                    onClick={() => setRuta(s.ruta)}
                  >
                    <Icono className="mt-0.5 h-5 w-5 shrink-0 text-laton-oscuro" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{s.nombre}</span>
                      <span className="ayuda block">{s.detalle}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div>
          {enRaiz ? <h3 className="etiqueta mb-2">O navega desde aquí</h3> : null}
          {listado.isLoading ? (
            <p className="ayuda py-6 text-center">Leyendo…</p>
          ) : (l?.carpetas.length ?? 0) === 0 ? (
            <p className="ayuda py-6 text-center">
              {l?.problema ? "" : "No hay carpetas adentro. Puedes guardar el respaldo acá mismo, o crear una."}
            </p>
          ) : (
            <ul className="scroll-fino max-h-72 divide-y divide-linea overflow-y-auto rounded-xl border border-linea">
              {l!.carpetas.map((c) => (
                <li key={c.ruta}>
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hueso"
                    onClick={() => setRuta(c.ruta)}
                  >
                    <Folder className="h-5 w-5 shrink-0 text-tinta/40" />
                    <span className="min-w-0 truncate">{c.nombre}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="ayuda">
          Entra a la carpeta donde quieras la copia y toca <strong>Guardar aquí</strong>. Al guardar se escribe un
          archivo de prueba para confirmar que de verdad se puede: que la carpeta exista no alcanza.
        </p>
      </div>
    </Modal>
  );
}
