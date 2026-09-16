import { useEffect, type ReactNode } from "react";

export function Modal({
  titulo,
  children,
  alCerrar,
  ancho = "max-w-lg",
  pie,
}: {
  titulo: string;
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) alCerrar();
      }}
    >
      <div className={`tarjeta flex max-h-[90vh] w-full flex-col ${ancho}`}>
        <div className="flex shrink-0 items-center justify-between border-b border-black/10 px-5 py-3">
          <h2 className="text-lg font-bold">{titulo}</h2>
          <button
            onClick={alCerrar}
            className="rounded-md px-2 py-1 text-2xl leading-none text-tinta/40 hover:bg-black/5 hover:text-tinta"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="scroll-fino min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {pie ? <div className="shrink-0 border-t border-black/10 px-5 py-3">{pie}</div> : null}
      </div>
    </div>
  );
}

export function Aviso({
  tono = "info",
  titulo,
  children,
}: {
  tono?: "info" | "aviso" | "mal" | "bien";
  titulo?: string;
  children: ReactNode;
}) {
  const estilos = {
    info: "bg-black/5 text-tinta/80 border-black/10",
    aviso: "bg-aviso/10 text-aviso border-aviso/30",
    mal: "bg-mal/10 text-mal border-mal/30",
    bien: "bg-bien/10 text-bien border-bien/30",
  }[tono];

  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${estilos}`}>
      {titulo ? <div className="font-semibold">{titulo}</div> : null}
      <div>{children}</div>
    </div>
  );
}

/** Estado vacío honesto: dice qué falta y qué hacer, no solo "sin datos". */
export function Vacio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <p className="mb-1 text-lg font-semibold text-tinta/70">{titulo}</p>
      {children ? <div className="max-w-sm text-sm text-tinta/50">{children}</div> : null}
    </div>
  );
}
