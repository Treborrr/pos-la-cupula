/**
 * Configuración de la ticketera (Advance ADV-8010N: USB o red, ESC/POS).
 *
 * Guía en tres pasos: cómo está conectada, cuál es, y un ticket de prueba con
 * la lista de qué revisar en el papel.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Cable, CheckCircle2, FileDown, Eye, Network, Printer, RefreshCw, type LucideIcon } from "lucide-react";

import { api, type ResultadoImpresion } from "../../lib/api";
import { Aviso } from "../../componentes/Modal";
import { Campo, CampoGuardable, Casilla } from "../../componentes/Piezas";

interface DatosImpresora {
  estado: { disponible: boolean; descripcion: string; detalle?: string };
  configuracion: {
    modo: string;
    perfil: string;
    nombreCompartido: string;
    host: string;
    puerto: number;
    conLogo: boolean;
    abrirCajon?: boolean;
  };
  perfilesDisponibles: { id: string; nombre: string; anchoPuntos: number; columnas: number; qrPorFirmware: boolean }[];
}

interface ImpresoraWindows {
  nombre: string;
  compartida: string;
  puerto: string;
  controlador: string;
  desconectada: boolean;
}

const MODOS: { id: string; texto: string; ayuda: string; icono: LucideIcon }[] = [
  {
    id: "windows",
    texto: "USB",
    ayuda: "Conectada con cable USB a esta PC y con su driver instalado en Windows. No hace falta compartirla.",
    icono: Cable,
  },
  {
    id: "red",
    texto: "Red",
    ayuda: "Conectada con cable de red al router. Tiene su propia dirección IP.",
    icono: Network,
  },
  {
    id: "vistaPrevia",
    texto: "Sin impresora",
    ayuda: "Los tickets se generan y se pueden ver en pantalla, pero no salen en papel.",
    icono: Eye,
  },
  {
    id: "archivo",
    texto: "A archivo",
    ayuda: "Guarda cada ticket como archivo en vez de imprimirlo. Solo para pruebas técnicas.",
    icono: FileDown,
  },
];

export function SeccionImpresora() {
  const qc = useQueryClient();
  const [resultado, setResultado] = useState<(ResultadoImpresion & { queRevisar: string[] }) | null>(null);

  const datos = useQuery({ queryKey: ["impresora"], queryFn: () => api.get<DatosImpresora>("/impresora") });

  const guardar = useMutation({
    mutationFn: (cambios: Record<string, unknown>) => api.put("/config", cambios),
    onSuccess: () => {
      setResultado(null);
      qc.invalidateQueries({ queryKey: ["impresora"] });
      qc.invalidateQueries({ queryKey: ["estado"] });
      qc.invalidateQueries({ queryKey: ["config"] });
    },
  });

  const probar = useMutation({
    mutationFn: () => api.post<ResultadoImpresion & { queRevisar: string[] }>("/impresora/prueba"),
    onSuccess: (r) => setResultado(r),
  });

  if (!datos.data) return <p className="ayuda">Consultando la impresora…</p>;
  const { configuracion: c, perfilesDisponibles, estado } = datos.data;
  const modo = MODOS.find((m) => m.id === c.modo);

  return (
    <div className="space-y-8">
      {c.modo === "vistaPrevia" ? (
        <Aviso tono="info" titulo="Todavía no hay ticketera configurada">
          Los tickets se generan pero no salen en papel. Elige cómo está conectada en el paso 1.
        </Aviso>
      ) : (
        <Aviso tono={estado.disponible ? "bien" : "aviso"} titulo={estado.descripcion}>
          {estado.detalle}
        </Aviso>
      )}

      <Paso numero={1} titulo="¿Cómo está conectada?">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {MODOS.map((m) => (
            <button
              key={m.id}
              onClick={() => guardar.mutate({ "impresora.modo": m.id })}
              className={`flex h-20 flex-col items-center justify-center gap-1.5 rounded-xl border font-semibold transition-colors ${
                c.modo === m.id ? "border-tinta bg-tinta text-white" : "border-linea bg-white hover:bg-hueso"
              }`}
            >
              <m.icono className="h-6 w-6" />
              {m.texto}
            </button>
          ))}
        </div>
        {modo ? <p className="ayuda mt-3 text-base">{modo.ayuda}</p> : null}

        {c.modo === "windows" ? (
          <div className="mt-5">
            <SelectorImpresoraWindows
              valor={c.nombreCompartido}
              alCambiar={(v) => guardar.mutate({ "impresora.nombreCompartido": v })}
            />
          </div>
        ) : null}

        {c.modo === "red" ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_10rem]">
            <CampoGuardable
              key={`host-${c.host}`}
              etiqueta="Dirección IP de la impresora"
              valor={c.host}
              placeholder="192.168.1.100"
              ayuda="Para saber la IP: apágala, mantén presionado FEED mientras la enciendes y suéltalo. Imprime una hoja de autoprueba que la muestra."
              alGuardar={(v) => guardar.mutate({ "impresora.host": v.trim() })}
            />
            <CampoGuardable
              key={`puerto-${c.puerto}`}
              etiqueta="Puerto"
              valor={String(c.puerto)}
              alGuardar={(v) => guardar.mutate({ "impresora.puerto": Number(v) || 9100 })}
            />
          </div>
        ) : null}
      </Paso>

      <Paso numero={2} titulo="Modelo y opciones">
        <div className="space-y-4">
          <Campo
            etiqueta="Modelo"
            ayuda="Para la Advance ADV-8010N elige su perfil de 80 mm. El de 58 mm es solo si le pones rollo de 58 mm y la configuras para ese ancho."
          >
            <select
              className="campo"
              value={c.perfil}
              onChange={(e) => guardar.mutate({ "impresora.perfil": e.target.value })}
            >
              {perfilesDisponibles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} · {p.columnas} columnas
                </option>
              ))}
            </select>
          </Campo>

          <Casilla
            marcada={c.conLogo}
            alCambiar={(v) => guardar.mutate({ "impresora.conLogo": v })}
            titulo="Imprimir el logo"
          >
            El emblema va en blanco y negro puro. Si en papel sale como una mancha, desactívalo.
          </Casilla>

          <Casilla
            marcada={c.abrirCajon === true}
            alCambiar={(v) => guardar.mutate({ "impresora.abrirCajon": v })}
            titulo="Abrir el cajón de dinero"
          >
            Solo si hay un cajón conectado al puerto RJ11 de la impresora. Se abre al cobrar con efectivo; no al reimprimir.
          </Casilla>
        </div>
      </Paso>

      <Paso numero={3} titulo="Imprimir un ticket de prueba">
        <p className="ayuda mb-4 text-base">No cobra nada ni registra una venta. Revisa el papel con la lista que aparece.</p>
        <button className="boton-primario boton-grande" disabled={probar.isPending} onClick={() => probar.mutate()}>
          <Printer className="h-5 w-5" />
          {probar.isPending ? "Imprimiendo…" : "Imprimir ticket de prueba"}
        </button>

        {resultado ? (
          <div className="mt-5 space-y-4">
            {resultado.impreso ? (
              <>
                <Aviso tono="bien" titulo="Se mandó a la impresora">
                  Revisa el papel:
                </Aviso>
                <ul className="space-y-2">
                  {resultado.queRevisar.map((q, i) => (
                    <li key={i} className="flex gap-3 rounded-xl border border-linea px-4 py-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-tinta/35" />
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : resultado.sinImpresora ? (
              <Aviso tono="info" titulo="Sin impresora configurada">
                El ticket se generó pero no salió en papel. Elige USB o Red en el paso 1.
              </Aviso>
            ) : (
              <Aviso tono="mal" titulo="No se imprimió">
                {resultado.motivo}
              </Aviso>
            )}

            <details>
              <summary className="cursor-pointer font-medium text-tinta/60">Ver el ticket que se generó</summary>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-tinta p-4 font-mono text-xs leading-snug text-hueso">
                {resultado.vistaPrevia}
              </pre>
            </details>
          </div>
        ) : null}
      </Paso>
    </div>
  );
}

function Paso({ numero, titulo, children }: { numero: number; titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tinta text-sm font-semibold text-white">
        {numero}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="mb-3 pt-0.5 text-lg font-semibold">{titulo}</h3>
        {children}
      </div>
    </div>
  );
}

function SelectorImpresoraWindows({ valor, alCambiar }: { valor: string; alCambiar: (v: string) => void }) {
  const consulta = useQuery({
    queryKey: ["impresorasWindows"],
    queryFn: () => api.get<{ disponible: boolean; impresoras: ImpresoraWindows[]; error?: string }>("/impresora/windows"),
  });

  const lista = consulta.data?.impresoras ?? [];
  const elegida = lista.find((p) => p.nombre === valor) ?? lista.find((p) => p.compartida && p.compartida === valor);

  return (
    <div className="space-y-4">
      <Campo etiqueta="Impresora instalada en Windows">
        {consulta.isLoading ? (
          <div className="campo flex items-center text-tinta/50">Buscando las impresoras instaladas…</div>
        ) : lista.length > 0 ? (
          <div className="flex gap-3">
            <select
              className="campo"
              value={elegida ? elegida.nombre : ""}
              onChange={(e) => e.target.value && alCambiar(e.target.value)}
            >
              {!elegida ? <option value="">Elige la ADV-8010N</option> : null}
              {lista.map((p) => (
                <option key={p.nombre} value={p.nombre}>
                  {p.nombre}
                  {p.desconectada ? " (desconectada)" : ""}
                </option>
              ))}
            </select>
            <button
              className="boton-suave shrink-0"
              onClick={() => consulta.refetch()}
              disabled={consulta.isFetching}
              title="Volver a buscar"
            >
              <RefreshCw className={`h-5 w-5 ${consulta.isFetching ? "animate-spin" : ""}`} />
              Buscar de nuevo
            </button>
          </div>
        ) : (
          <Aviso
            tono="aviso"
            titulo={consulta.data?.error ? "No se pudo consultar a Windows" : "Windows no tiene impresoras instaladas"}
            accion={
              <button className="boton-suave boton-chico" onClick={() => consulta.refetch()}>
                <RefreshCw className="h-4 w-4" />
                Buscar de nuevo
              </button>
            }
          >
            {consulta.data?.error ??
              "Conecta la ADV-8010N por USB, instala su driver (CD de la caja o web de Advance) y vuelve a buscar."}
          </Aviso>
        )}
      </Campo>

      {elegida?.desconectada ? (
        <Aviso tono="aviso">Windows la marca como desconectada: revisa que esté encendida y el cable USB.</Aviso>
      ) : null}

      <details>
        <summary className="cursor-pointer font-medium text-tinta/60">¿No aparece en la lista? Escribir el nombre a mano</summary>
        <div className="mt-3">
          <CampoGuardable
            key={valor}
            etiqueta="Nombre de la impresora en Windows"
            valor={valor}
            ayuda="Tal como aparece en Configuración → Impresoras y escáneres, o el nombre con el que está compartida."
            alGuardar={(v) => alCambiar(v.trim())}
          />
        </div>
      </details>
    </div>
  );
}
