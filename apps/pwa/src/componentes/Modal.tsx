import { useEffect, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle, type LucideIcon } from "lucide-react";

export function Modal({
  titulo,
  subtitulo,
  children,
  alCerrar,
  ancho = "max-w-xl",
  pie,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  children: ReactNode;
  alCerrar: () => void;
  ancho?: string;
  pie?: ReactNode;
}) {
  // Escape cierra siempre. En una pantalla de mostrador, quedarse atrapado en
  // un diálogo con un cliente esperando es inaceptable.
  useEffect(() => {
    const manejar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        alCerrar();
      }
    };
    window.addEventListener("keydown", manejar);
    return () => window.removeEventListener("keydown", manejar);
  }, [alCerrar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-tinta/45 p-4 text-left text-base text-tinta backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) alCerrar();
      }}
    >
      <div className={`tarjeta flex max-h-[92vh] w-full flex-col shadow-2xl ${ancho}`}>
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-5 pb-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">{titulo}</h2>
            {subtitulo ? <div className="ayuda mt-1">{subtitulo}</div> : null}
          </div>
          <button onClick={alCerrar} className="boton-icono -mt-1 -mr-2" aria-label="Cerrar">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="scroll-fino min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>

        {pie ? <div className="shrink-0 border-t border-linea px-6 py-4">{pie}</div> : null}
      </div>
    </div>
  );
}

const TONOS: Record<"info" | "aviso" | "mal" | "bien", { clases: string; icono: LucideIcon }> = {
  info: { clases: "border-linea bg-hueso text-tinta/80", icono: Info },
  aviso: { clases: "border-aviso/25 bg-aviso/[0.07] text-aviso", icono: AlertTriangle },
  mal: { clases: "border-mal/25 bg-mal/[0.06] text-mal", icono: XCircle },
  bien: { clases: "border-bien/25 bg-bien/[0.07] text-bien", icono: CheckCircle2 },
};

export function Aviso({
  tono = "info",
  titulo,
  children,
  accion,
}: {
  tono?: "info" | "aviso" | "mal" | "bien";
  titulo?: ReactNode;
  children?: ReactNode;
  accion?: ReactNode;
}) {
  const { clases, icono: Icono } = TONOS[tono];

  return (
    <div className={`flex gap-3 rounded-xl border px-4 py-3 text-[0.95rem] leading-relaxed ${clases}`}>
      <Icono className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        {titulo ? <div className="font-semibold">{titulo}</div> : null}
        {children ? <div className={titulo ? "opacity-90" : ""}>{children}</div> : null}
        {accion ? <div className="mt-3">{accion}</div> : null}
      </div>
    </div>
  );
}

/** Estado vacío honesto: dice qué falta y qué hacer, no solo "sin datos". */
export function Vacio({
  titulo,
  children,
  icono: Icono,
  accion,
}: {
  titulo: string;
  children?: ReactNode;
  icono?: LucideIcon;
  accion?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {Icono ? (
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-hueso text-tinta/40">
          <Icono className="h-8 w-8" strokeWidth={1.75} />
        </div>
      ) : null}
      <p className="text-lg font-semibold text-tinta/80">{titulo}</p>
      {children ? <div className="ayuda mt-1 max-w-md text-base">{children}</div> : null}
      {accion ? <div className="mt-5">{accion}</div> : null}
    </div>
  );
}
