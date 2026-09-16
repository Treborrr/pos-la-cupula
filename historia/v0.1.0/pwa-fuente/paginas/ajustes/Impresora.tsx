/**
 * Configuración de la ticketera.
 *
 * Toda la impresión está construida y probada; lo único que falta es saber
 * contra qué equipo se habla. Esta pantalla es donde eso se decide, y el botón
 * de prueba es lo primero que hay que tocar el día que llegue la impresora.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../../lib/api";
import { Aviso } from "../../componentes/Modal";
import { CampoGuardable } from "../../componentes/Piezas";

interface DatosImpresora {
  estado: { disponible: boolean; descripcion: string; detalle?: string };
  configuracion: {
    modo: string;
    perfil: string;
    nombreCompartido: string;
    host: string;
    puerto: number;
    conLogo: boolean;
  };
  perfilesDisponibles: {
    id: string;
    nombre: string;
    anchoPuntos: number;
    columnas: number;
    qrPorFirmware: boolean;
  }[];
}

const MODOS = [
  {
    id: "vistaPrevia",
    texto: "Sin impresora",
    ayuda: "El ticket se genera y se puede ver en pantalla, pero no sale en papel.",
  },
  {
    id: "windows",
    texto: "USB (Windows)",
    ayuda: "La impresora se comparte en Windows con un nombre y el POS le escribe directo.",
  },
  {
    id: "red",
    texto: "Red (Ethernet)",
    ayuda: "La impresora tiene su propia IP. Puerto 9100, que es el estándar.",
  },
  {
    id: "archivo",
    texto: "A archivo",
    ayuda: "Guarda cada ticket como .bin en vez de imprimirlo. Para depurar sin gastar papel.",
  },
];

export function SeccionImpresora() {
  const qc = useQueryClient();
  const [resultado, setResultado] = useState<{
    impreso: boolean;
    motivo?: string;
    vistaPrevia: string;
    queRevisar: string[];
  } | null>(null);

  const datos = useQuery({
    queryKey: ["impresora"],
    queryFn: () => api.get<DatosImpresora>("/impresora"),
  });

  const guardar = useMutation({
    mutationFn: (cambios: Record<string, unknown>) => api.put("/config", cambios),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["impresora"] });
      qc.invalidateQueries({ queryKey: ["estado"] });
    },
  });

  const probar = useMutation({
    mutationFn: () => api.post<typeof resultado>("/impresora/prueba"),
    onSuccess: (r) => setResultado(r),
  });

  if (!datos.data) return <p className="text-sm text-tinta/50">Consultando la impresora…</p>;
  const { configuracion: c, perfilesDisponibles } = datos.data;

  return (
    <div className="space-y-4">
      <Aviso tono={datos.data.estado.disponible ? "bien" : "aviso"}>
        <strong>{datos.data.estado.descripcion}</strong>
        {datos.data.estado.detalle ? (
          <span className="mt-1 block">{datos.data.estado.detalle}</span>
        ) : null}
      </Aviso>

      <div>
        <span className="etiqueta mb-2 block">¿Cómo está conectada?</span>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {MODOS.map((m) => (
            <button
              key={m.id}
              onClick={() => guardar.mutate({ "impresora.modo": m.id })}
              className={`boton text-sm ${c.modo === m.id ? "boton-laton" : "boton-suave"}`}
            >
              {m.texto}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-tinta/50">
          {MODOS.find((m) => m.id === c.modo)?.ayuda}
        </p>
      </div>

      {c.modo === "windows" ? (
        <CampoGuardable
          etiqueta="Nombre con el que está compartida en Windows"
          ayuda='Panel de control → Dispositivos e impresoras → clic derecho → Propiedades → Compartir. Tiene que coincidir exactamente, sin espacios.'
          valor={c.nombreCompartido}
          alGuardar={(v) => guardar.mutate({ "impresora.nombreCompartido": v })}
        />
      ) : null}

      {c.modo === "red" ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <CampoGuardable
              etiqueta="Dirección IP"
              valor={c.host}
              alGuardar={(v) => guardar.mutate({ "impresora.host": v })}
            />
          </div>
          <CampoGuardable
            etiqueta="Puerto"
            valor={String(c.puerto)}
            alGuardar={(v) => guardar.mutate({ "impresora.puerto": Number(v) || 9100 })}
          />
        </div>
      ) : null}

      <div>
        <span className="etiqueta mb-1 block">Modelo</span>
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
        <p className="mt-1 text-xs text-tinta/50">
          Ante la duda, deja el genérico de 80 mm: lo hablan casi todas. Si el QR sale mal, es
          porque el firmware de esa impresora miente sobre soportarlo — el genérico lo manda como
          imagen y siempre funciona.
        </p>
      </div>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={c.conLogo}
          onChange={(e) => guardar.mutate({ "impresora.conLogo": e.target.checked })}
        />
        <span className="text-sm">
          <strong>Imprimir el logo</strong>
          <span className="block text-tinta/55">
            El emblema va convertido a blanco y negro puro. Si en papel sale como una mancha,
            desactívalo o pídeme una versión simplificada.
          </span>
        </span>
      </label>

      <div className="border-t border-black/10 pt-4">
        <button className="boton-primario w-full" disabled={probar.isPending} onClick={() => probar.mutate()}>
          {probar.isPending ? "Imprimiendo…" : "Imprimir ticket de prueba"}
        </button>
        <p className="mt-2 text-xs text-tinta/50">
          Es lo primero que hay que hacer cuando llegue la impresora. No cobra nada ni registra una
          venta.
        </p>
      </div>

      {resultado ? (
        <div className="space-y-2">
          <Aviso tono={resultado.impreso ? "bien" : "mal"}>
            {resultado.impreso
              ? "Se mandó a la impresora. Revisa el papel."
              : `No se imprimió: ${resultado.motivo}`}
          </Aviso>

          {resultado.impreso ? (
            <div className="tarjeta p-3">
              <p className="etiqueta mb-2">Qué revisar en el papel</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-tinta/70">
                {resultado.queRevisar.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <details>
            <summary className="cursor-pointer text-sm font-semibold text-tinta/60">
              Ver el ticket que se generó
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-tinta p-3 text-[11px] leading-tight text-hueso">
              {resultado.vistaPrevia}
            </pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}
