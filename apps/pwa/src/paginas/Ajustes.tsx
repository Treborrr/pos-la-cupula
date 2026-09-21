/**
 * Ajustes y diagnóstico.
 *
 * El diagnóstico está pensado para poder LEERSE POR TELÉFONO: todo lo que
 * importa cuando algo falla, en un solo lugar y en castellano.
 */

import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Check, FileSpreadsheet, HardDrive, Printer, Receipt, RefreshCw, Store, type LucideIcon } from "lucide-react";

import { api } from "../lib/api";
import { Aviso } from "../componentes/Modal";
import { TarjetaPrimerosPasos } from "../componentes/PrimerosPasos";
import { SeccionCatalogo } from "./ajustes/Catalogo";
import { SeccionImpresora } from "./ajustes/Impresora";
import { SeccionRespaldos } from "./ajustes/Respaldos";
import { CampoGuardable, Casilla, Dato, EncabezadoPagina, Pagina } from "../componentes/Piezas";

interface Salud {
  version: string;
  log: {
    ultimaSeq: number;
    eventos: number;
    integro: boolean;
    huecos: number[];
    hashRotos: number[];
    enCuarentena: number;
  };
  impresora: { disponible: boolean; descripcion: string; detalle?: string };
  memoria: { usadaMB: number; proyeccionMB: number };
  datos: { items: number; ventas: number; clientes: number; barberos: number };
}

const SECCIONES: { id: string; texto: string; icono: LucideIcon }[] = [
  { id: "negocio", texto: "Negocio", icono: Store },
  { id: "ventas", texto: "Tickets", icono: Receipt },
  { id: "catalogo", texto: "Catálogo", icono: FileSpreadsheet },
  { id: "ticketera", texto: "Ticketera", icono: Printer },
  { id: "respaldos", texto: "Respaldos", icono: HardDrive },
  { id: "diagnostico", texto: "Diagnóstico", icono: Activity },
];

export function Ajustes() {
  const qc = useQueryClient();
  const ubicacion = useLocation();

  const config = useQuery({ queryKey: ["config"], queryFn: () => api.get<Record<string, unknown>>("/config") });

  const guardar = useMutation({
    mutationFn: (cambios: Record<string, unknown>) => api.put("/config", cambios),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
      qc.invalidateQueries({ queryKey: ["estado"] });
    },
  });

  // Los enlaces de "Primeros pasos" llevan a una sección concreta. Solo una
  // vez por enlace: si dependiera de los datos, cada guardado volvería a saltar.
  const hashAplicado = useRef("");
  const hayConfig = Boolean(config.data);
  useEffect(() => {
    if (!ubicacion.hash || !hayConfig || hashAplicado.current === ubicacion.key) return;
    hashAplicado.current = ubicacion.key;
    const t = setTimeout(
      () => document.getElementById(ubicacion.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" }),
      100,
    );
    return () => clearTimeout(t);
  }, [ubicacion.hash, ubicacion.key, hayConfig]);

  return (
    <Pagina ancho="max-w-6xl">
      <EncabezadoPagina titulo="Ajustes" descripcion="Datos del negocio, ticketera, copias de seguridad y estado del sistema." />

      <TarjetaPrimerosPasos />

      <div className="grid gap-8 lg:grid-cols-[13rem_1fr]">
        <nav className="hidden lg:block">
          <ul className="sticky top-0 space-y-1">
            {SECCIONES.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="flex h-11 items-center gap-3 rounded-xl px-3 font-medium text-tinta/65 transition-colors hover:bg-white hover:text-tinta"
                >
                  <s.icono className="h-5 w-5" />
                  {s.texto}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          <Bloque id="negocio" titulo="Datos del negocio" descripcion="Es lo que sale impreso en el encabezado del ticket.">
            {config.data ? (
              <div className="grid gap-5 sm:grid-cols-2">
                {[
                  ["negocio.nombre", "Nombre del negocio"],
                  ["negocio.ruc", "RUC"],
                  ["negocio.direccion", "Dirección"],
                  ["negocio.ciudad", "Ciudad"],
                  ["negocio.pie", "Mensaje al pie del ticket"],
                ].map(([clave, etiqueta]) => (
                  <CampoGuardable
                    key={`${clave}-${String(config.data![clave] ?? "")}`}
                    etiqueta={etiqueta}
                    valor={String(config.data![clave] ?? "")}
                    alGuardar={(v) => guardar.mutate({ [clave]: v })}
                  />
                ))}
              </div>
            ) : null}
          </Bloque>

          <Bloque id="ventas" titulo="Tickets y cobro">
            {config.data ? <AjustesDeVentas config={config.data} alGuardar={(c) => guardar.mutate(c)} /> : null}
          </Bloque>

          <Bloque
            id="catalogo"
            titulo="Cargar catálogo desde Excel"
            descripcion="Para dar de alta servicios y productos en bloque, sin cargarlos uno por uno."
          >
            <SeccionCatalogo />
          </Bloque>

          <Bloque id="ticketera" titulo="Ticketera" descripcion="Advance ADV-8010N o cualquier impresora térmica ESC/POS.">
            <SeccionImpresora />
          </Bloque>

          <Bloque
            id="respaldos"
            titulo="Copias de seguridad"
            descripcion="Para no perder las ventas si la computadora se daña."
          >
            <SeccionRespaldos
              key={String(config.data?.["respaldos.destinoExterno"] ?? "")}
              destinoConfigurado={String(config.data?.["respaldos.destinoExterno"] ?? "")}
            />
          </Bloque>

          <Bloque id="diagnostico" titulo="Diagnóstico" descripcion="Si algo falla, lee esta sección a quien te ayude.">
            <Diagnostico />
          </Bloque>
        </div>
      </div>
    </Pagina>
  );
}

function Bloque({
  id,
  titulo,
  descripcion,
  children,
}: {
  id: string;
  titulo: string;
  descripcion?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="tarjeta scroll-mt-6 p-6 lg:p-8">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">{titulo}</h2>
        {descripcion ? <p className="ayuda mt-1 text-base">{descripcion}</p> : null}
      </div>
      {children}
    </section>
  );
}

function AjustesDeVentas({
  config,
  alGuardar,
}: {
  config: Record<string, unknown>;
  alGuardar: (cambios: Record<string, unknown>) => void;
}) {
  const estado = useQuery({
    queryKey: ["estado"],
    queryFn: () => api.get<{ siguienteCorrelativo: string }>("/estado"),
  });
  const siguiente = Number(String(estado.data?.siguienteCorrelativo ?? "").replace(/\D/g, "")) || 0;
  const [numero, setNumero] = useState("");
  const pedido = Number(numero);
  const valido = Number.isInteger(pedido) && pedido > siguiente && pedido < 1_000_000;

  return (
    <div className="space-y-6">
      <div>
        <div className="etiqueta mb-2">Número del próximo ticket</div>
        <div className="flex flex-wrap items-center gap-4">
          <span className="cifra rounded-xl bg-hueso px-4 py-2.5 text-2xl font-semibold">
            {estado.data?.siguienteCorrelativo ?? "…"}
          </span>
          <form
            className="flex gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (valido) {
                alGuardar({ "ventas.correlativoInicial": pedido });
                setNumero("");
              }
            }}
          >
            <input
              className="campo cifra w-40 text-right"
              inputMode="numeric"
              placeholder={String(siguiente + 1)}
              value={numero}
              onChange={(e) => setNumero(e.target.value.replace(/\D/g, ""))}
            />
            <button type="submit" className="boton-suave" disabled={!valido}>
              <Check className="h-5 w-5" />
              Saltar a este número
            </button>
          </form>
        </div>
        <p className="ayuda mt-2">
          La numeración siempre avanza: solo se puede saltar a un número mayor, y un ticket anulado conserva el suyo. Sirve
          para continuar la numeración de otro talonario.
        </p>
      </div>

      <Casilla
        marcada={Boolean(config["ventas.exigirTurnoAbierto"])}
        alCambiar={(v) => alGuardar({ "ventas.exigirTurnoAbierto": v })}
        titulo="Exigir la caja abierta para cobrar"
      >
        Recomendado dejarlo apagado: si se exige y alguien olvida abrir el turno, no se puede cobrar. Con esto apagado se
        cobra igual y el arqueo del turno siguiente lo muestra aparte.
      </Casilla>
    </div>
  );
}

function Diagnostico() {
  const salud = useQuery({ queryKey: ["salud"], queryFn: () => api.get<Salud>("/salud") });

  if (!salud.data) return <p className="ayuda">Consultando…</p>;
  const s = salud.data;

  return (
    <div className="space-y-5">
      <Aviso tono={s.log.integro ? "bien" : "mal"} titulo={s.log.integro ? "Los datos están íntegros" : "La verificación encontró problemas"}>
        {s.log.integro ? (
          <>
            Los {s.log.eventos} registros forman una secuencia sin huecos y la cadena de verificación valida: nadie editó
            los archivos por fuera del sistema.
          </>
        ) : (
          <>
            {s.log.huecos.length > 0 ? `Faltan los registros ${s.log.huecos.join(", ")}. ` : ""}
            {s.log.hashRotos.length > 0
              ? `La cadena no valida en ${s.log.hashRotos.join(", ")}: el archivo fue modificado por fuera del POS. `
              : ""}
            {s.log.enCuarentena > 0
              ? `Hay ${s.log.enCuarentena} línea(s) apartadas por ilegibles, casi siempre por un corte de luz durante una venta. `
              : ""}
            Restaura el último respaldo antes de seguir operando.
          </>
        )}
      </Aviso>

      <div className="grid grid-cols-2 gap-5 rounded-2xl bg-hueso p-5 sm:grid-cols-4">
        <Dato etiqueta="Versión" valor={s.version} tamano="chico" />
        <Dato etiqueta="Ventas" valor={String(s.datos.ventas)} tamano="chico" />
        <Dato etiqueta="Clientes" valor={String(s.datos.clientes)} tamano="chico" />
        <Dato
          etiqueta="Memoria"
          valor={`${s.memoria.usadaMB} MB`}
          tamano="chico"
          // La PC objetivo tiene 4 GB: si esto crece sin techo, se ve aquí.
          nota={s.memoria.usadaMB > 400 ? "Más de lo esperado" : "Normal"}
        />
      </div>

      <div>
        <div className="etiqueta mb-2">Ticketera</div>
        <Aviso tono={s.impresora.disponible ? "bien" : "aviso"} titulo={s.impresora.descripcion}>
          {s.impresora.detalle}
        </Aviso>
      </div>

      <button className="boton-suave" onClick={() => salud.refetch()} disabled={salud.isFetching}>
        <RefreshCw className={`h-5 w-5 ${salud.isFetching ? "animate-spin" : ""}`} />
        Verificar de nuevo
      </button>
    </div>
  );
}
