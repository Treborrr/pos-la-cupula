import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  ChevronRight,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  LockOpen,
  Power,
  Receipt,
  RefreshCw,
  Scissors,
  Settings,
  ShoppingCart,
  Store,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { api, elegirSede, ServidorCaido, TODAS_LAS_SEDES, type EstadoGeneral } from "./lib/api";
import { hora } from "./lib/formato";
import {
  banderaDeSalidaIntencional,
  ProveedorDeUsuario,
  usarUsuario,
  type UsuarioDeSesion,
} from "./lib/sesion";
import { usarPrimerosPasos } from "./componentes/PrimerosPasos";
import { BotonLectorDeTicket } from "./componentes/LectorDeTicket";
import { MenuDeCuenta } from "./componentes/MenuDeCuenta";

import { Login } from "./paginas/Login";
import { Cobrar } from "./paginas/Cobrar";
import { Inicio } from "./paginas/Inicio";
import { Historial } from "./paginas/Historial";
import { Catalogo } from "./paginas/Catalogo";
import { Inventario } from "./paginas/Inventario";
import { Caja } from "./paginas/Caja";
import { Clientes } from "./paginas/Clientes";
import { Barberos } from "./paginas/Barberos";
import { Reportes } from "./paginas/Reportes";
import { Ajustes } from "./paginas/Ajustes";

const GRUPOS: {
  titulo: string;
  secciones: {
    ruta: string;
    texto: string;
    icono: LucideIcon;
    exacta?: boolean;
    soloAdmin?: boolean;
    /** El ADMIN igual puede cobrar; lo que cambia es dónde ARRANCA. */
    soloCajero?: boolean;
  }[];
}[] = [
  {
    titulo: "Atender",
    secciones: [
      /**
       * El dueño aterriza en Inicio y el cajero en Cobrar.
       *
       * Antes los dos entraban a Cobrar, que es la pantalla del mostrador:
       * buscar producto, agregar al carrito, cobrar. Un dueño abre el sistema
       * para ver cómo va el negocio, y con varios locales no va a cobrar en
       * ninguno. Cada rol arranca donde de verdad trabaja.
       */
      { ruta: "/", texto: "Inicio", icono: LayoutDashboard, exacta: true, soloAdmin: true },
      { ruta: "/cobrar", texto: "Cobrar", icono: ShoppingCart, soloCajero: true },
      { ruta: "/historial", texto: "Ventas", icono: Receipt },
      { ruta: "/caja", texto: "Caja", icono: Wallet },
    ],
  },
  {
    titulo: "Administrar",
    secciones: [
      { ruta: "/catalogo", texto: "Catálogo", icono: LayoutGrid },
      { ruta: "/inventario", texto: "Inventario", icono: Boxes },
      { ruta: "/clientes", texto: "Clientes", icono: Users },
      { ruta: "/barberos", texto: "Barberos", icono: Scissors },
      // Reportes es información financiera agregada del negocio: solo dueños.
      { ruta: "/reportes", texto: "Reportes", icono: BarChart3, soloAdmin: true },
    ],
  },
  {
    titulo: "Sistema",
    secciones: [{ ruta: "/ajustes", texto: "Ajustes", icono: Settings, soloAdmin: true }],
  },
];

/**
 * La puerta de entrada: nadie ve el shell real sin sesión. El límite de
 * verdad está del lado del servidor (cada ruta exige su rol) — esto es solo
 * para no mostrar una pantalla que de todos modos no va a poder usar.
 */
export function App() {
  const yo = useQuery({
    queryKey: ["auth", "yo"],
    queryFn: () => api.get<{ usuario: UsuarioDeSesion | null }>("/auth/yo"),
    // Sigue preguntando con la sesión abierta: es lo que detecta que a un
    // cajero lo echó otro cajero al loguearse, o que un admin lo desactivó.
    refetchInterval: 30_000,
  });

  const eraUsuario = useRef<UsuarioDeSesion | null>(null);
  const [desconectadoPor, setDesconectadoPor] = useState<string | null>(null);

  useEffect(() => {
    const ahora = yo.data?.usuario ?? null;
    if (eraUsuario.current && !ahora) {
      if (banderaDeSalidaIntencional.valor) {
        // Un "Salir" a propósito no necesita que le expliquen por qué ya no hay sesión.
        banderaDeSalidaIntencional.valor = false;
      } else {
        setDesconectadoPor(
          "Se cerró tu sesión — puede ser que otro cajero haya iniciado la suya, o que se te desconectó por seguridad. Vuelve a entrar.",
        );
      }
    }
    eraUsuario.current = ahora;
  }, [yo.data?.usuario]);

  // El servidor vive en esta misma máquina. Que no responda no es "se cayó
  // internet": es que el POS está apagado, y hay que decirlo sin rodeos.
  if (yo.error instanceof ServidorCaido) return <ServidorApagado />;

  if (yo.isLoading) return null;

  if (!yo.data?.usuario) {
    return (
      <Routes>
        <Route path="/login/admin" element={<Login modoAdmin mensaje={desconectadoPor} />} />
        <Route path="*" element={<Login mensaje={desconectadoPor} />} />
      </Routes>
    );
  }

  return (
    <ProveedorDeUsuario value={yo.data.usuario}>
      <AppAutenticada usuario={yo.data.usuario} />
    </ProveedorDeUsuario>
  );
}

function AppAutenticada({ usuario }: { usuario: UsuarioDeSesion }) {
  const estado = useQuery({
    queryKey: ["estado"],
    queryFn: () => api.get<EstadoGeneral>("/estado"),
    refetchInterval: 15_000,
  });

  const grupos = GRUPOS.map((g) => ({
    ...g,
    secciones: g.secciones.filter(
      (s) =>
        (!s.soloAdmin || usuario.rol === "ADMIN") &&
        // Para el cajero, "Cobrar" ES su inicio y vive en "/": una segunda
        // entrada de menú al mismo sitio solo confunde.
        (!s.soloCajero || usuario.rol !== "ADMIN"),
    ),
  })).filter((g) => g.secciones.length > 0);

  return (
    <div className="flex h-full flex-col bg-hueso">
      <BarraDeAlertas alertas={estado.data?.alertas} />

      <div className="flex min-h-0 flex-1 md:flex-row">
        <MenuLateral estado={estado.data} grupos={grupos} usuario={usuario} />

        <MenuMovil grupos={grupos} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <BarraSuperior estado={estado.data} />
          <main className="min-h-0 flex-1 overflow-hidden">
            <Routes>
              {/* La raíz depende del rol: el dueño ve el panel, el cajero la
                  pantalla de cobro. El ADMIN llega a cobrar por /cobrar. */}
              <Route path="/" element={usuario.rol === "ADMIN" ? <Inicio /> : <Cobrar />} />
              <Route path="/cobrar" element={<Cobrar />} />
              <Route path="/historial" element={<Historial />} />
              <Route path="/historial/:id" element={<Historial />} />
              <Route path="/caja" element={<Caja />} />
              <Route path="/inventario" element={<Inventario />} />
              <Route path="/catalogo" element={<Catalogo />} />
              <Route path="/clientes" element={<Clientes />} />
              <Route path="/clientes/:id" element={<Clientes />} />
              <Route path="/barberos" element={<Barberos />} />
              {usuario.rol === "ADMIN" ? <Route path="/reportes" element={<Reportes />} /> : null}
              {usuario.rol === "ADMIN" ? <Route path="/ajustes" element={<Ajustes />} /> : null}
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  );
}

/**
 * Lo que tiene que verse SIN que nadie vaya a buscarlo: el reloj atrasado, el
 * respaldo que dejó de poder escribir, la impresora que se desconectó. Antes
 * esto vivía en un log que nadie lee y en Ajustes → Diagnóstico, una pantalla
 * que hay que acordarse de abrir.
 *
 * No se puede cerrar: "persistente" es el punto. Desaparece sola cuando el
 * problema de verdad se resuelve, no cuando alguien la tapa.
 */
function BarraDeAlertas({ alertas }: { alertas?: { codigo: string; mensaje: string }[] }) {
  if (!alertas || alertas.length === 0) return null;

  return (
    <div className="shrink-0 divide-y divide-white/15 bg-mal text-white">
      {alertas.map((a) => (
        <div key={a.codigo} className="flex items-start gap-2 px-4 py-2 text-sm leading-snug sm:px-6">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">{a.mensaje}</span>
        </div>
      ))}
    </div>
  );
}

/** En el celular el menú lateral no entra: pasa a una barra de íconos. */
function MenuMovil({ grupos }: { grupos: typeof GRUPOS }) {
  return (
    <nav className="scroll-fino flex shrink-0 gap-1 overflow-x-auto bg-tinta px-2 py-2 md:hidden">
      {grupos.flatMap((g) => g.secciones).map((s) => (
        <NavLink
          key={s.ruta}
          to={s.ruta}
          end={s.exacta}
          className={({ isActive }) =>
            `flex h-14 min-w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2 text-xs font-medium ${
              isActive ? "bg-white text-tinta" : "text-hueso/70"
            }`
          }
        >
          <s.icono className="h-5 w-5" />
          {s.texto}
        </NavLink>
      ))}
    </nav>
  );
}

function MenuLateral({
  estado,
  grupos,
  usuario,
}: {
  estado?: EstadoGeneral;
  grupos: typeof GRUPOS;
  usuario: UsuarioDeSesion;
}) {
  const pasos = usarPrimerosPasos();

  return (
    <aside className="hidden w-20 shrink-0 flex-col bg-tinta text-hueso md:flex xl:w-60">
      <div className="flex h-20 shrink-0 items-center justify-center px-4 xl:justify-start xl:px-6">
        <img src="/iconos/emblema-blanco.png" alt="La Cúpula" className="h-12 w-auto max-w-full object-contain" />
      </div>

      <nav className="scroll-fino min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-1">
        {grupos.map((g) => (
          <div key={g.titulo}>
            <div className="mb-1.5 hidden px-3 text-xs font-semibold tracking-wider text-hueso/35 uppercase xl:block">
              {g.titulo}
            </div>
            <div className="space-y-1">
              {g.secciones.map((s) => (
                <NavLink
                  key={s.ruta}
                  to={s.ruta}
                  end={s.exacta}
                  title={s.texto}
                  className={({ isActive }) =>
                    `flex h-11 items-center justify-center gap-3 rounded-xl px-3 text-base font-medium transition-colors xl:justify-start ${
                      isActive ? "bg-white text-tinta" : "text-hueso/70 hover:bg-white/10 hover:text-white"
                    }`
                  }
                >
                  <s.icono className="h-5 w-5 shrink-0" />
                  <span className="hidden xl:inline">{s.texto}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 space-y-2 p-3">
        {usuario.rol === "ADMIN" && pasos.listos && pasos.hechos < pasos.total ? (
          <NavLink
            to="/ajustes"
            className="hidden rounded-xl bg-white/[0.06] p-3 transition-colors hover:bg-white/10 xl:block"
          >
            <div className="flex items-center justify-between text-sm font-semibold">
              <span>Configuración inicial</span>
              <ChevronRight className="h-4 w-4 text-hueso/50" />
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-laton" style={{ width: `${(pasos.hechos / pasos.total) * 100}%` }} />
            </div>
            <div className="mt-1.5 text-xs text-hueso/55">
              {pasos.hechos} de {pasos.total} pasos listos
            </div>
          </NavLink>
        ) : null}

        <EstadoDeCaja estado={estado} />
        <MenuDeCuenta usuario={usuario} />
      </div>
    </aside>
  );
}

function EstadoDeCaja({ estado }: { estado?: EstadoGeneral }) {
  if (!estado) return null;

  /**
   * La caja es de UN local. Mirando toda la cadena, "Caja cerrada" no se
   * refiere a nada: hay siete, unas abiertas y otras no. Se esconde, y el
   * recuento de cajas abiertas lo da la pantalla de Inicio, que sí sabe
   * contarlas.
   */
  if (!estado.sede) return null;

  const abierta = Boolean(estado.turnoAbierto);

  return (
    <NavLink
      to="/caja"
      title={abierta ? "Caja abierta" : "Caja cerrada"}
      className="flex items-center justify-center gap-3 rounded-xl bg-white/[0.06] p-3 transition-colors hover:bg-white/10 xl:justify-start"
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          abierta ? "bg-bien/25 text-[#8fd3a8]" : "bg-white/10 text-hueso/60"
        }`}
      >
        {abierta ? <LockOpen className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
      </span>
      <span className="hidden min-w-0 xl:block">
        <span className="block text-sm font-semibold">{abierta ? "Caja abierta" : "Caja cerrada"}</span>
        <span className="block truncate text-xs text-hueso/55">
          {abierta ? `desde las ${hora(estado.turnoAbierto!.abiertoEn)}` : "Toca para abrir el turno"}
        </span>
      </span>
    </NavLink>
  );
}

function BarraSuperior({ estado }: { estado?: EstadoGeneral }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-linea bg-white px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3 md:gap-6">
        <Reloj />
        <SelectorDeSucursal estado={estado} />
        {/* Mirando toda la cadena no hay "próximo ticket": cada local tiene su
            serie, y mostrar la de una al azar sería mentir. */}
        {estado?.siguienteCorrelativo ? (
          <div className="hidden items-center gap-2 text-sm text-tinta/60 md:flex">
            Próximo ticket
            <span className="cifra rounded-lg bg-hueso px-2.5 py-1 font-semibold text-tinta">
              {estado.siguienteCorrelativo}
            </span>
          </div>
        ) : null}
        {estado?.alertasDeStock ? (
          <NavLink to="/inventario" className="pastilla bg-aviso/10 text-aviso hover:bg-aviso/15">
            <Boxes className="h-3.5 w-3.5" />
            {estado.alertasDeStock}
            <span className="hidden sm:inline">con stock bajo</span>
          </NavLink>
        ) : null}
      </div>

      <BotonLectorDeTicket />
    </header>
  );
}

/**
 * En qué local estás parado. Solo aparece cuando hay más de una sucursal: con
 * un solo local sería ruido permanente que no decide nada.
 *
 * Va en la barra de arriba, SIEMPRE a la vista, y no escondido en un menú,
 * porque de él dependen el stock, la caja y los precios que se están mirando.
 * Alguien que no sabe en qué local está puede trasladar mercadería al revés o
 * cambiarle el precio al local equivocado.
 *
 * El cajero no lo ve: su sucursal la resuelve el servidor desde su cuenta y no
 * puede cambiarla, así que un selector sería una promesa falsa.
 */
function SelectorDeSucursal({ estado }: { estado?: EstadoGeneral }) {
  const usuario = usarUsuario();
  const qc = useQueryClient();

  const sedes = estado?.sedes ?? [];
  if (usuario.rol !== "ADMIN" || sedes.length < 2) return null;

  // `sede` viene en null cuando se está mirando la cadena entera.
  const valor = estado?.sede?.id ?? TODAS_LAS_SEDES;

  return (
    <label className="flex items-center gap-2 text-sm">
      <Store className="h-4 w-4 shrink-0 text-tinta/50" />
      <select
        className="max-w-56 min-w-0 rounded-lg bg-hueso px-2.5 py-1.5 font-semibold text-tinta"
        value={valor}
        onChange={(e) => {
          elegirSede(e.target.value);
          // Se tira TODA la caché: el stock, la caja, el catálogo y los
          // reportes que están en pantalla son de la sucursal anterior. Dejar
          // una sola consulta vieja significaría mostrar el stock de un local
          // mientras el encabezado dice el nombre del otro.
          qc.clear();
        }}
      >
        {/* "Todas" primero: es el punto de partida natural del dueño de una
            cadena, que mira el conjunto y recién después baja a un local. */}
        <option value={TODAS_LAS_SEDES}>Todas ({sedes.length} sucursales)</option>
        {sedes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * El reloj va a la vista a propósito. Si la hora de la PC está mal, TODO el
 * histórico queda mal fechado; tenerla siempre delante es la manera barata de
 * que alguien lo note el primer día.
 */
function Reloj() {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex items-baseline gap-2">
      <span className="cifra text-xl font-semibold">
        {String(ahora.getHours()).padStart(2, "0")}:{String(ahora.getMinutes()).padStart(2, "0")}
      </span>
      <span className="hidden text-sm text-tinta/55 sm:inline">{fechaLarga(ahora)}</span>
    </div>
  );
}

/** "Miércoles 16 de setiembre": solo la primera letra en mayúscula. */
function fechaLarga(d: Date): string {
  const t = d.toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long" }).replace(",", "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function ServidorApagado() {
  return (
    <div className="flex h-full items-center justify-center bg-tinta p-8 text-hueso">
      <div className="max-w-lg text-center">
        <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-white/[0.06]">
          <Power className="h-10 w-10 text-hueso/60" strokeWidth={1.5} />
        </div>
        <h1 className="mb-3 text-3xl font-semibold">El POS no está corriendo</h1>
        <p className="mb-8 text-lg text-hueso/70">
          No hay conexión con el servidor de esta computadora, así que{" "}
          <strong className="text-hueso">no se puede cobrar</strong>. Ninguna venta se está perdiendo:
          simplemente no se pueden registrar hasta que vuelva.
        </p>
        <div className="rounded-2xl bg-white/[0.06] p-6 text-left">
          <p className="mb-3 font-semibold text-hueso">Qué hacer</p>
          <ol className="space-y-3 text-hueso/75">
            {[
              "Espera unos segundos: si se reinició, vuelve solo.",
              "Si sigue igual, reinicia la computadora.",
              "Si aun así no vuelve, avisa con esta pantalla a la vista.",
            ].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold">
                  {i + 1}
                </span>
                {t}
              </li>
            ))}
          </ol>
        </div>
        <button className="boton-laton boton-grande mt-8 w-full" onClick={() => location.reload()}>
          <RefreshCw className="h-5 w-5" />
          Reintentar
        </button>
      </div>
    </div>
  );
}
