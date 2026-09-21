/**
 * Cargar el catálogo desde un Excel.
 *
 * El flujo es de dos pasos y no de uno: primero se LEE el archivo y se muestra
 * exactamente qué va a pasar con cada fila, y recién entonces aparece el botón
 * de aplicar. Nadie debería autorizar una carga masiva sin ver antes qué
 * cambia — sobre todo en «Reemplazar», donde lo que no viene en el archivo se
 * da de baja.
 */

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, Download, FileSpreadsheet, Upload } from "lucide-react";

import { api, FalloDeApi } from "../../lib/api";
import { Aviso } from "../../componentes/Modal";

type Modo = "agregar" | "reemplazar";

interface Cambio {
  fila: number;
  codigo: string;
  nombre: string;
  accion: "crear" | "actualizar" | "reactivar" | "sin cambios";
  detalle: string[];
}

interface Respuesta {
  aplicado: boolean;
  filas: number;
  problemas: { fila: number; columna: string; problema: string }[];
  plan: {
    cambios: Cambio[];
    aDesactivar: { codigo: string; nombre: string }[];
    resumen: { crear: number; actualizar: number; reactivar: number; sinCambios: number; desactivar: number };
  };
}

export function SeccionCatalogo() {
  const qc = useQueryClient();
  const refArchivo = useRef<HTMLInputElement>(null);

  const [archivo, setArchivo] = useState<{ nombre: string; base64: string } | null>(null);
  const [modo, setModo] = useState<Modo>("agregar");
  const [revision, setRevision] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<Respuesta | null>(null);

  const limpiar = () => {
    setArchivo(null);
    setRevision(null);
    setError(null);
    if (refArchivo.current) refArchivo.current.value = "";
  };

  const enviar = useMutation({
    mutationFn: (aplicar: boolean) =>
      api.post<Respuesta>("/catalogo/importar", { archivo: archivo!.base64, modo, aplicar }),
    onSuccess: (r) => {
      setError(null);
      if (r.aplicado) {
        setListo(r);
        limpiar();
        qc.invalidateQueries({ queryKey: ["catalogo"] });
        qc.invalidateQueries({ queryKey: ["inventario"] });
        qc.invalidateQueries({ queryKey: ["estado"] });
      } else {
        setRevision(r);
      }
    },
    onError: (e) => {
      setRevision(null);
      setError(e instanceof FalloDeApi ? `${e.message}${e.sugerencia ? ` ${e.sugerencia}` : ""}` : String(e));
    },
  });

  async function alElegirArchivo(f: File) {
    setListo(null);
    setError(null);
    setRevision(null);
    // El archivo viaja en base64 dentro del JSON: son unos pocos kilobytes y
    // evita sumar un plugin de subida al servidor.
    const bytes = new Uint8Array(await f.arrayBuffer());
    let binario = "";
    for (const b of bytes) binario += String.fromCharCode(b);
    setArchivo({ nombre: f.name, base64: btoa(binario) });
  }

  // Un cambio de modo invalida la revisión: en «Reemplazar» la lista de bajas
  // es distinta, y dejar la anterior a la vista sería mentir.
  function cambiarModo(nuevo: Modo) {
    setModo(nuevo);
    setRevision(null);
  }

  const r = revision?.plan.resumen;
  const hayProblemas = (revision?.problemas.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-hueso px-5 py-4">
        <div className="flex items-center gap-4">
          <FileSpreadsheet className="h-6 w-6 shrink-0 text-tinta/45" />
          <div>
            <div className="font-semibold">1. Descarga la plantilla</div>
            <div className="ayuda">Trae las instrucciones adentro y ejemplos para ver qué va en cada columna.</div>
          </div>
        </div>
        <a className="boton-suave shrink-0" href="/api/catalogo/plantilla.xlsx" download>
          <Download className="h-5 w-5" />
          Descargar plantilla
        </a>
      </div>

      <div>
        <div className="mb-2 font-semibold">2. Súbela llena</div>
        <input
          ref={refArchivo}
          type="file"
          accept=".xlsx"
          className="campo h-auto py-2.5 file:mr-4 file:rounded-lg file:border-0 file:bg-tinta file:px-4 file:py-2 file:font-semibold file:text-white"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void alElegirArchivo(f);
          }}
        />
      </div>

      <div>
        <div className="mb-2 font-semibold">3. Elige qué hacer con lo que ya está cargado</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <OpcionDeModo
            activo={modo === "agregar"}
            titulo="Agregar"
            descripcion="Carga lo nuevo y actualiza lo que coincida. Lo que no esté en el Excel se queda como está."
            onClick={() => cambiarModo("agregar")}
          />
          <OpcionDeModo
            activo={modo === "reemplazar"}
            titulo="Reemplazar todo"
            descripcion="Además, da de baja todo lo que NO venga en el Excel. El catálogo queda igual al archivo."
            onClick={() => cambiarModo("reemplazar")}
          />
        </div>
        {modo === "reemplazar" ? (
          <p className="ayuda mt-2">
            Dar de baja no borra: los ítems dejan de aparecer en la pantalla de cobro, pero los tickets viejos se
            siguen viendo y si mañana los vuelves a cargar, reaparecen con su historial intacto.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <button className="boton-primario" disabled={!archivo || enviar.isPending} onClick={() => enviar.mutate(false)}>
          <Upload className="h-5 w-5" />
          {enviar.isPending ? "Leyendo…" : "Revisar el archivo"}
        </button>
        {archivo ? <span className="ayuda self-center">{archivo.nombre}</span> : null}
      </div>

      {error ? <Aviso tono="mal" titulo="No se pudo cargar">{error}</Aviso> : null}

      {listo ? (
        <Aviso tono="bien" titulo="Catálogo cargado">
          {listo.plan.resumen.crear} creados · {listo.plan.resumen.actualizar} actualizados
          {listo.plan.resumen.reactivar > 0 ? ` · ${listo.plan.resumen.reactivar} reactivados` : ""}
          {listo.plan.resumen.desactivar > 0 ? ` · ${listo.plan.resumen.desactivar} dados de baja` : ""}
        </Aviso>
      ) : null}

      {revision ? (
        <div className="space-y-4 rounded-2xl border border-linea p-5">
          <div className="font-semibold">Esto es lo que va a pasar</div>

          {hayProblemas ? (
            <Aviso tono="mal" titulo={`Hay ${revision.problemas.length} ${revision.problemas.length === 1 ? "problema" : "problemas"} que corregir`}>
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                {revision.problemas.map((p, i) => (
                  <div key={i} className="text-sm">
                    <strong>Fila {p.fila}</strong>
                    {p.columna ? ` · ${p.columna}` : ""}: {p.problema}
                  </div>
                ))}
              </div>
              <p className="mt-3">Corrige el Excel y vuelve a subirlo. No se cargó nada.</p>
            </Aviso>
          ) : null}

          {r ? (
            <div className="flex flex-wrap gap-2">
              <Pastilla n={r.crear} texto="para crear" tono="bien" />
              <Pastilla n={r.actualizar} texto="para actualizar" tono="normal" />
              <Pastilla n={r.reactivar} texto="para reactivar" tono="normal" />
              <Pastilla n={r.sinCambios} texto="sin cambios" tono="apagado" />
              <Pastilla n={r.desactivar} texto="para dar de baja" tono="mal" />
            </div>
          ) : null}

          {revision.plan.aDesactivar.length > 0 ? (
            <Aviso tono="aviso" titulo={`${revision.plan.aDesactivar.length} ítems van a salir del catálogo`}>
              No vienen en el Excel: {revision.plan.aDesactivar.map((x) => x.nombre).join(", ")}.
            </Aviso>
          ) : null}

          {revision.plan.cambios.length > 0 ? (
            <div className="scroll-fino max-h-72 overflow-y-auto rounded-xl border border-linea">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>Ítem</th>
                    <th>Qué pasa</th>
                  </tr>
                </thead>
                <tbody>
                  {revision.plan.cambios.map((c) => (
                    <tr key={c.fila}>
                      <td className="cifra text-tinta/50">{c.fila}</td>
                      <td>
                        <div className="font-medium">{c.nombre}</div>
                        <div className="ayuda">{c.codigo}</div>
                      </td>
                      <td>
                        <div className={c.accion === "sin cambios" ? "text-tinta/50" : "font-medium"}>{c.accion}</div>
                        {c.detalle.length > 0 ? <div className="ayuda">{c.detalle.join(" · ")}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {!hayProblemas && revision.filas > 0 ? (
            <button
              className={modo === "reemplazar" ? "boton-peligro boton-grande" : "boton-primario boton-grande"}
              disabled={enviar.isPending}
              onClick={() => enviar.mutate(true)}
            >
              {enviar.isPending ? (
                "Cargando…"
              ) : (
                <>
                  {modo === "reemplazar" ? <AlertTriangle className="h-5 w-5" /> : <Check className="h-5 w-5" />}
                  {modo === "reemplazar"
                    ? `Reemplazar el catálogo${r?.desactivar ? ` y dar de baja ${r.desactivar}` : ""}`
                    : `Cargar ${revision.filas} ${revision.filas === 1 ? "ítem" : "ítems"}`}
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OpcionDeModo({
  activo,
  titulo,
  descripcion,
  onClick,
}: {
  activo: boolean;
  titulo: string;
  descripcion: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`rounded-2xl border p-4 text-left transition-colors ${
        activo ? "border-tinta bg-tinta/[0.04] ring-1 ring-tinta" : "border-linea bg-white hover:border-tinta/30"
      }`}
    >
      <div className="flex items-center gap-2 font-semibold">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
            activo ? "border-tinta" : "border-linea"
          }`}
        >
          {activo ? <span className="h-2.5 w-2.5 rounded-full bg-tinta" /> : null}
        </span>
        {titulo}
      </div>
      <div className="ayuda mt-1.5">{descripcion}</div>
    </button>
  );
}

function Pastilla({ n, texto, tono }: { n: number; texto: string; tono: "bien" | "mal" | "normal" | "apagado" }) {
  if (n === 0) return null;
  const colores = {
    bien: "bg-bien/10 text-bien",
    mal: "bg-mal/10 text-mal",
    normal: "bg-hueso-hondo text-tinta",
    apagado: "bg-hueso text-tinta/50",
  };
  return (
    <span className={`pastilla ${colores[tono]}`}>
      <span className="cifra">{n}</span> {texto}
    </span>
  );
}
