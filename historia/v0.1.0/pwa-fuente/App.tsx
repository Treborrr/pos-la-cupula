import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api, ServidorCaido, type EstadoGeneral } from "./lib/api";
import { hora } from "./lib/formato";

import { Cobrar } from "./paginas/Cobrar";
import { Historial } from "./paginas/Historial";
import { Catalogo } from "./paginas/Catalogo";
import { Inventario } from "./paginas/Inventario";
import { Caja } from "./paginas/Caja";
import { Clientes } from "./paginas/Clientes";
import { Reportes } from "./paginas/Reportes";
import { Ajustes } from "./paginas/Ajustes";

const SECCIONES = [
  { ruta: "/", texto: "Cobrar", exacta: true },
  { ruta: "/historial", texto: "Ventas" },
  { ruta: "/caja", texto: "Caja" },
  { ruta: "/inventario", texto: "Inventario" },
  { ruta: "/catalogo", texto: "Catálogo" },
  { ruta: "/clientes", texto: "Clientes" },
  { ruta: "/reportes", texto: "Reportes" },
  { ruta: "/ajustes", texto: "Ajustes" },
];

export function App() {
  const estado = useQuery({
    queryKey: ["estado"],
    queryFn: () => api.get<EstadoGeneral>("/estado"),
    refetchInterval: 15_000,
  });

  // El servidor vive en esta misma máquina. Que no responda no es "se cayó
  // internet": es que el POS está apagado, y hay que decirlo sin rodeos en vez
  // de dejar una pantalla a medias que parece funcionar.
  if (estado.error instanceof ServidorCaido) return <ServidorApagado />;

  return (
    <div className="flex h-full flex-col bg-hueso">
      <Encabezado estado={estado.data} />

      <main className="min-h-0 flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Cobrar />} />
          <Route path="/historial" element={<Historial />} />
          <Route path="/historial/:id" element={<Historial />} />
          <Route path="/caja" element={<Caja />} />
          <Route path="/inventario" element={<Inventario />} />
          <Route path="/catalogo" element={<Catalogo />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/clientes/:id" element={<Clientes />} />
          <Route path="/reportes" element={<Reportes />} />
          <Route path="/ajustes" element={<Ajustes />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Encabezado({ estado }: { estado?: EstadoGeneral }) {
  return (
    <header className="flex shrink-0 items-center gap-4 bg-tinta px-4 py-1.5 text-hueso">
      {/*
        El emblema es ancho y bajo: a poca altura el texto "TATTOO BARBER SHOP"
        se vuelve ilegible y parece una mancha. Se compensa la altura extra
        bajando el padding vertical del encabezado, para no robarle espacio a
        la grilla de cobro.
      */}
      <img src="/iconos/emblema-blanco.png" alt="La Cúpula" className="h-14 w-auto shrink-0" />

      <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {SECCIONES.map((s) => (
          <NavLink
            key={s.ruta}
            to={s.ruta}
            end={s.exacta}
            className={({ isActive }) =>
              `shrink-0 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                isActive ? "bg-laton text-white" : "text-hueso/70 hover:bg-white/10 hover:text-hueso"
              }`
            }
          >
            {s.texto}
          </NavLink>
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-4 text-right text-sm">
        {estado?.alertasDeStock ? (
          <span className="rounded-md bg-aviso/20 px-2 py-1 text-xs font-semibold text-[#f0c060]">
            {estado.alertasDeStock} con stock bajo
          </span>
        ) : null}

        <EstadoDeCaja estado={estado} />

        <div>
          <div className="etiqueta text-hueso/50">Siguiente</div>
          <div className="cifra font-semibold">{estado?.siguienteCorrelativo ?? "—"}</div>
        </div>

        <Reloj />
      </div>
    </header>
  );
}

function EstadoDeCaja({ estado }: { estado?: EstadoGeneral }) {
  if (!estado) return null;

  if (!estado.turnoAbierto) {
    return (
      <NavLink to="/caja" className="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold">
        Caja cerrada
      </NavLink>
    );
  }

  return (
    <div>
      <div className="etiqueta text-hueso/50">Caja</div>
      <div className="text-xs font-semibold text-[#8fd3a8]">
        abierta {hora(estado.turnoAbierto.abiertoEn)}
      </div>
    </div>
  );
}

/**
 * El reloj va a la vista a propósito. Si la hora de la PC está mal, TODO el
 * histórico queda mal fechado y no hay forma de arreglarlo después. Tenerla
 * siempre delante es la manera barata de que alguien lo note el primer día.
 */
function Reloj() {
  const ahora = new Date();
  return (
    <div className="cifra text-right">
      <div className="text-lg leading-none font-semibold">
        {String(ahora.getHours()).padStart(2, "0")}:{String(ahora.getMinutes()).padStart(2, "0")}
      </div>
      <div className="text-[10px] text-hueso/50">
        {ahora.toLocaleDateString("es-PE", { day: "2-digit", month: "short" })}
      </div>
    </div>
  );
}

function ServidorApagado() {
  return (
    <div className="flex h-full items-center justify-center bg-tinta p-8 text-hueso">
      <div className="max-w-md text-center">
        <img src="/iconos/emblema-blanco.png" alt="" className="mx-auto mb-8 h-20 w-auto opacity-40" />
        <h1 className="mb-3 text-2xl font-bold">El POS no está corriendo</h1>
        <p className="mb-6 text-hueso/70">
          No hay conexión con el servidor de esta computadora, así que{" "}
          <strong className="text-hueso">no se puede cobrar</strong>. Ninguna venta se está
          perdiendo: simplemente no se pueden registrar hasta que vuelva.
        </p>
        <div className="rounded-lg bg-white/5 p-4 text-left text-sm text-hueso/70">
          <p className="mb-2 font-semibold text-hueso">Qué hacer:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Espera unos segundos: si se reinició, vuelve solo.</li>
            <li>Reinicia la computadora.</li>
            <li>Si sigue igual, avisa con esta pantalla a la vista.</li>
          </ol>
        </div>
        <button className="boton-laton mt-6 w-full" onClick={() => location.reload()}>
          Reintentar
        </button>
      </div>
    </div>
  );
}
