/**
 * La pantalla de inicio del dueño: cómo va el negocio HOY.
 *
 * Antes de que esto existiera, el ADMIN entraba y aterrizaba en "Cobrar" —la
 * pantalla del mostrador— porque el dueño y el cajero compartían el mismo
 * arranque. Un dueño abre el sistema para ver cómo va, no para atender a
 * alguien; con varios locales, menos todavía.
 *
 * Qué entra y qué no: solo lo que se responde HOY y de un vistazo. Lo que
 * necesita elegir un período vive en Reportes, y duplicarlo acá haría que los
 * dos sitios compitan por ser "el lugar donde se mira el negocio".
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Lock,
  LockOpen,
  Receipt,
  Store,
  Wallet,
} from "lucide-react";

import { api } from "../lib/api";
import { aTextoConSimbolo, hora } from "../lib/formato";
import { usarUsuario } from "../lib/sesion";
import { Pagina, Recuadro, Seccion } from "../componentes/Piezas";
import { Vacio } from "../componentes/Modal";

interface SedeDelPanel {
  sedeId: string;
  nombre: string;
  total: number;
  cantidad: number;
  ticketPromedio: number;
  variacion: number | null;
  cajaAbierta: boolean;
  cajaDesde: string | null;
  alertasDeStock: number;
}

interface Panel {
  fecha: string;
  cadena: {
    vendido: number;
    ventas: number;
    ticketPromedio: number;
    sucursales: number;
    cajasAbiertas: number;
  };
  sedes: SedeDelPanel[];
}

export function Inicio() {
  const usuario = usarUsuario();

  const panel = useQuery({
    queryKey: ["panel"],
    queryFn: () => api.get<Panel>("/panel"),
    // El dueño deja esta pantalla abierta mientras trabaja: que se refresque
    // sola, como el resto del sistema.
    refetchInterval: 30_000,
  });

  const d = panel.data;
  const variosLocales = (d?.cadena.sucursales ?? 0) > 1;

  return (
    <Pagina>
      <EncabezadoDelDia nombre={usuario.nombre} fecha={d?.fecha} />

      {!d ? (
        <Vacio titulo="Cargando…" />
      ) : (
        <div className="space-y-6">
          {/* Los cuatro números que contestan "¿cómo va hoy?". Van primero y
              grandes: es lo único que mucha gente va a mirar. */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Recuadro
              etiqueta={variosLocales ? "Vendido hoy en toda la cadena" : "Vendido hoy"}
              valor={aTextoConSimbolo(d.cadena.vendido)}
              tamano="grande"
              nota={d.cadena.ventas === 0 ? "Todavía no hay ventas" : `${d.cadena.ventas} ventas`}
            />
            <Recuadro
              etiqueta="Ticket promedio"
              valor={d.cadena.ventas === 0 ? "—" : aTextoConSimbolo(d.cadena.ticketPromedio)}
              tamano="grande"
              nota="Lo que gasta cada cliente"
            />
            <Recuadro
              etiqueta="Cajas abiertas"
              valor={`${d.cadena.cajasAbiertas} de ${d.cadena.sucursales}`}
              tamano="grande"
              tono={d.cadena.cajasAbiertas === 0 ? "aviso" : undefined}
              nota={
                d.cadena.cajasAbiertas === 0
                  ? "Sin caja abierta no se puede cobrar"
                  : "Locales operando ahora"
              }
            />
            <Recuadro
              etiqueta="Productos bajo mínimo"
              valor={String(d.sedes.reduce((a, s) => a + s.alertasDeStock, 0))}
              tamano="grande"
              tono={d.sedes.some((s) => s.alertasDeStock > 0) ? "aviso" : undefined}
              nota="Sumando todos los locales"
            />
          </div>

          {variosLocales ? <HoyPorSucursal sedes={d.sedes} /> : <ElLocal sede={d.sedes[0]} />}

          <AccesosRapidos variosLocales={variosLocales} />
        </div>
      )}
    </Pagina>
  );
}

/**
 * El saludo con la fecha completa. Parece decoración y no lo es: el reloj de
 * la barra de arriba ya existe porque una PC con la hora mal deja TODO el
 * histórico mal fechado, y repetir la fecha escrita en letras acá es la forma
 * barata de que un error de año o de día salte a la vista el primer día.
 */
function EncabezadoDelDia({ nombre, fecha }: { nombre: string; fecha?: string }) {
  const enLetras = fecha
    ? new Date(`${fecha}T12:00:00`).toLocaleDateString("es-PE", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "";

  return (
    <div className="mb-6">
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">
        Hola, {nombre.split(" ")[0]}
      </h1>
      <p className="ayuda mt-1 text-base first-letter:uppercase">{enLetras}</p>
    </div>
  );
}

/**
 * Una fila por local, ordenadas por lo vendido.
 *
 * La barra no es adorno: con veinte filas, comparar números sueltos obliga a
 * leerlos uno por uno, y la barra deja ver de un golpe quién vende el doble
 * que quién. Se escala contra el que más vendió, no contra el total, porque la
 * pregunta es "cuál va mejor", no "qué porción del total es cada uno".
 */
function HoyPorSucursal({ sedes }: { sedes: SedeDelPanel[] }) {
  const mayor = Math.max(...sedes.map((s) => s.total), 1);

  return (
    <Seccion
      titulo="Hoy, local por local"
      descripcion="Ordenados por lo vendido. Toca uno para trabajar en él."
      sinRelleno
      acciones={
        <Link to="/reportes" className="boton-suave boton-chico">
          <BarChart3 className="h-4 w-4" />
          Ver reportes
        </Link>
      }
    >
      <div className="divide-y divide-linea">
        {sedes.map((s) => (
          <div key={s.sedeId} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-6 py-4">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                s.cajaAbierta ? "bg-bien/10 text-bien" : "bg-hueso-hondo text-tinta/40"
              }`}
              title={s.cajaAbierta ? "Caja abierta" : "Caja cerrada"}
            >
              {s.cajaAbierta ? <LockOpen className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
            </span>

            <div className="min-w-48 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-semibold">{s.nombre}</span>
                {s.cajaAbierta && s.cajaDesde ? (
                  <span className="ayuda">abrió {hora(s.cajaDesde)}</span>
                ) : (
                  <span className="ayuda">caja cerrada</span>
                )}
                {s.alertasDeStock > 0 ? (
                  <span className="pastilla bg-aviso/10 text-aviso">
                    <Boxes className="h-3.5 w-3.5" />
                    {s.alertasDeStock} bajo mínimo
                  </span>
                ) : null}
              </div>

              <span className="mt-2 block h-1.5 rounded-full bg-hueso-hondo">
                <span
                  className="block h-1.5 rounded-full bg-laton transition-[width] duration-500"
                  style={{ width: `${Math.round((s.total / mayor) * 100)}%` }}
                />
              </span>
            </div>

            <div className="text-right">
              <div className="cifra text-xl font-semibold tracking-tight">
                {aTextoConSimbolo(s.total)}
              </div>
              <div className="ayuda">
                {s.cantidad === 0 ? "sin ventas" : `${s.cantidad} ventas`}
                {s.variacion !== null ? (
                  <span className={s.variacion >= 0 ? " text-bien" : " text-mal"}>
                    {" · "}
                    {s.variacion >= 0 ? "+" : ""}
                    {s.variacion}%
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Seccion>
  );
}

/** Con un solo local no hay nada que comparar: se muestra su estado y ya. */
function ElLocal({ sede }: { sede?: SedeDelPanel }) {
  if (!sede) return null;

  return (
    <Seccion titulo="La caja de hoy">
      <div className="flex flex-wrap items-center gap-5">
        <span
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${
            sede.cajaAbierta ? "bg-bien/10 text-bien" : "bg-hueso-hondo text-tinta/40"
          }`}
        >
          {sede.cajaAbierta ? <LockOpen className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold">
            {sede.cajaAbierta ? "Caja abierta" : "Caja cerrada"}
          </div>
          <div className="ayuda">
            {sede.cajaAbierta && sede.cajaDesde
              ? `Desde las ${hora(sede.cajaDesde)} · ${sede.cantidad} ventas hoy`
              : "Ábrela desde la pantalla de Caja para empezar a cobrar."}
          </div>
        </div>
        <Link to="/caja" className="boton-suave">
          <Wallet className="h-5 w-5" />
          Ir a Caja
        </Link>
      </div>
    </Seccion>
  );
}

/**
 * Los cuatro sitios a los que el dueño va de verdad desde acá.
 *
 * Son accesos, no un menú paralelo: el menú lateral ya tiene todo. Estos son
 * los que se usan apenas se mira el panel, y tenerlos a un toque evita el
 * rodeo de buscar en la barra lateral lo que la pantalla acaba de señalar.
 */
function AccesosRapidos({ variosLocales }: { variosLocales: boolean }) {
  const accesos = [
    { a: "/reportes", icono: BarChart3, texto: "Reportes", detalle: "Ventas, ganancia y margen" },
    { a: "/historial", icono: Receipt, texto: "Ventas del día", detalle: "Buscar o anular un ticket" },
    { a: "/inventario", icono: Boxes, texto: "Inventario", detalle: "Stock, entradas y traslados" },
    {
      a: "/ajustes#sucursales",
      icono: Store,
      texto: variosLocales ? "Sucursales" : "Abrir otra sucursal",
      detalle: variosLocales ? "Administrar los locales" : "Crecer a un segundo local",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {accesos.map((x) => (
        <Link
          key={x.a}
          to={x.a}
          className="tarjeta group flex items-center gap-4 p-5 transition-colors hover:border-tinta/25 hover:bg-white"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-hueso text-laton-oscuro">
            <x.icono className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{x.texto}</span>
            <span className="ayuda block truncate">{x.detalle}</span>
          </span>
          <ArrowRight className="h-5 w-5 shrink-0 text-tinta/25 transition-transform group-hover:translate-x-0.5 group-hover:text-tinta/50" />
        </Link>
      ))}
    </div>
  );
}
