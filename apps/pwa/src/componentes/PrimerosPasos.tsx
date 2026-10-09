/**
 * Primeros pasos: lo mínimo para que el POS quede listo para atender.
 *
 * Se calcula del estado real (no de casillas que alguien marca a mano), así
 * que un paso se da por hecho solo cuando de verdad está hecho.
 */

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";

import { api, type Barbero, type Item } from "../lib/api";

interface Paso {
  id: string;
  titulo: string;
  detalle: string;
  hecho: boolean;
  ir: string;
  textoIr: string;
}

export function usarPrimerosPasos() {
  const config = useQuery({ queryKey: ["config"], queryFn: () => api.get<Record<string, unknown>>("/config") });
  const catalogo = useQuery({
    queryKey: ["catalogo"],
    queryFn: () => api.get<{ items: Item[]; categorias: string[] }>("/catalogo"),
  });
  const barberos = useQuery({ queryKey: ["barberos"], queryFn: () => api.get<{ barberos: Barbero[] }>("/barberos") });
  const ventas = useQuery({
    queryKey: ["ventas", "existe"],
    queryFn: () => api.get<{ cantidadTotal: number }>("/ventas?limite=1"),
    staleTime: 60_000,
  });
  // /respaldos prueba escribir en el destino: se consulta con calma, no en cada pantalla.
  const respaldos = useQuery({
    queryKey: ["respaldos"],
    queryFn: () => api.get<{ destinoExternoEscribible: boolean | null }>("/respaldos"),
    staleTime: 5 * 60_000,
  });

  const listos = Boolean(config.data && catalogo.data && barberos.data && ventas.data && respaldos.data);

  const pasos: Paso[] = [
    {
      /**
       * PRIMERO los datos del negocio, antes que el catálogo.
       *
       * Arrancan vacíos —la configuración de un negocio es un dato de la
       * instalación, no del programa— y sin este paso el asistente podía llegar
       * a "5 de 5 listos" con el encabezado del ticket en blanco. El ticket es
       * lo único del sistema que el cliente final se lleva en la mano.
       */
      id: "negocio",
      titulo: "Poner los datos del negocio",
      detalle: "Nombre, dirección y RUC: es el encabezado de cada ticket que se imprime.",
      hecho: Boolean(String(config.data?.["negocio.nombre"] ?? "").trim()),
      ir: "/ajustes#negocio",
      textoIr: "Ir a Ajustes",
    },
    {
      id: "catalogo",
      titulo: "Cargar servicios y productos",
      detalle: "Lo que se vende, con su precio. Los productos llevan stock.",
      hecho: (catalogo.data?.items.length ?? 0) > 0,
      ir: "/catalogo",
      textoIr: "Ir a Catálogo",
    },
    {
      id: "barberos",
      titulo: "Registrar a los barberos",
      detalle: "Para saber quién atendió cada servicio.",
      hecho: (barberos.data?.barberos.length ?? 0) > 0,
      ir: "/catalogo#barberos",
      textoIr: "Agregar barberos",
    },
    {
      id: "ticketera",
      titulo: "Conectar la ticketera",
      detalle: "Elige cómo está conectada e imprime un ticket de prueba.",
      hecho: Boolean(config.data && config.data["impresora.modo"] !== "vistaPrevia"),
      ir: "/ajustes#ticketera",
      textoIr: "Configurar",
    },
    {
      id: "respaldos",
      titulo: "Activar la copia de seguridad externa",
      detalle: "Una carpeta de OneDrive o un USB fijo. Sin esto, si el disco falla se pierde todo.",
      hecho: respaldos.data?.destinoExternoEscribible === true,
      ir: "/ajustes#respaldos",
      textoIr: "Configurar",
    },
    {
      id: "venta",
      titulo: "Hacer la primera venta",
      detalle: "Agrega un servicio en Cobrar, elige la forma de pago y cobra.",
      hecho: (ventas.data?.cantidadTotal ?? 0) > 0,
      ir: "/",
      textoIr: "Ir a Cobrar",
    },
  ];

  return { pasos, listos, hechos: pasos.filter((p) => p.hecho).length, total: pasos.length };
}

export function TarjetaPrimerosPasos() {
  const { pasos, listos, hechos, total } = usarPrimerosPasos();
  if (!listos || hechos === total) return null;
  const siguiente = pasos.find((p) => !p.hecho);

  return (
    <section className="tarjeta mb-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-linea px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold">Primeros pasos</h2>
          <p className="ayuda mt-0.5">
            {hechos} de {total} listos. Completa lo que falta para dejar el sistema preparado.
          </p>
        </div>
        <div className="h-2 w-48 overflow-hidden rounded-full bg-hueso-hondo">
          <div className="h-full rounded-full bg-laton" style={{ width: `${(hechos / total) * 100}%` }} />
        </div>
      </div>
      <ol className="divide-y divide-linea">
        {pasos.map((p) => (
          <li key={p.id} className="flex items-center gap-4 px-6 py-4">
            {p.hecho ? (
              <CheckCircle2 className="h-6 w-6 shrink-0 text-bien" />
            ) : (
              <Circle className={`h-6 w-6 shrink-0 ${p === siguiente ? "text-laton" : "text-tinta/25"}`} />
            )}
            <div className="min-w-0 flex-1">
              <div className={`font-semibold ${p.hecho ? "text-tinta/45 line-through" : ""}`}>{p.titulo}</div>
              {!p.hecho ? <div className="ayuda">{p.detalle}</div> : null}
            </div>
            {!p.hecho ? (
              <Link to={p.ir} className={p === siguiente ? "boton-primario boton-chico" : "boton-suave boton-chico"}>
                {p.textoIr}
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
