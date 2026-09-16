/**
 * Clientes e integración con la tarjeta de fidelidad de TarjetaCloud.
 *
 * El QR de La Cúpula está configurado en modo "nombre": lleva el nombre del
 * cliente en texto plano, no un identificador único. Eso significa que dos
 * personas que se llaman igual NO se pueden distinguir por el escaneo, y la
 * pantalla lo dice en vez de elegir una al azar.
 *
 * Al vincular una tarjeta se guarda CÓMO se supo (serial / nombre / manual):
 * un vínculo por serial es exacto, uno por nombre es una apuesta razonable, y
 * poder distinguirlos después vale la pena.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type Cliente, type Venta } from "../lib/api";
import { aTextoConSimbolo, cuandoFue, fechaYHora } from "../lib/formato";
import { Aviso, Modal, Vacio } from "../componentes/Modal";
import { useEscaner } from "../lib/escaneo";
import { Recuadro } from "../componentes/Piezas";

export function Clientes() {
  const qc = useQueryClient();
  const [busqueda, setBusqueda] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [creando, setCreando] = useState<{ nombre: string; serial?: string } | null>(null);

  const clientes = useQuery({
    queryKey: ["clientes", busqueda],
    queryFn: () => api.get<{ clientes: Cliente[] }>(`/clientes?q=${encodeURIComponent(busqueda)}`),
  });

  // Escanear una tarjeta aquí abre la ficha, o propone dar de alta a esa persona.
  useEscaner({
    activo: !abierto && !creando,
    alEscanear: async (valor) => {
      const r = await api.get<any>(`/escaneo?valor=${encodeURIComponent(valor)}`);
      if (r.tipo === "cliente") setAbierto(r.cliente.id);
      else if (r.tipo === "clienteAmbiguo") setBusqueda(r.leido);
      else if (r.tipo === "nada") {
        setCreando(
          r.esSerialDeTarjeta ? { nombre: "", serial: r.leido } : { nombre: r.leido },
        );
      }
    },
  });

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-xl font-bold">Clientes</h1>
        <input
          className="campo max-w-sm flex-1"
          placeholder="Buscar por nombre o teléfono, o disparar la tarjeta…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <button className="boton-primario" onClick={() => setCreando({ nombre: busqueda })}>
          + Nuevo
        </button>
      </div>

      <div className="scroll-fino tarjeta min-h-0 flex-1 overflow-y-auto">
        {(clientes.data?.clientes.length ?? 0) === 0 ? (
          <Vacio titulo={busqueda ? "Nadie coincide" : "Todavía no hay clientes"}>
            Se pueden dar de alta aquí, al cobrar, o escaneando su tarjeta de fidelidad.
          </Vacio>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-hueso-hondo text-left">
              <tr className="etiqueta">
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Teléfono</th>
                <th className="px-3 py-2">Tarjeta</th>
                <th className="px-3 py-2 text-right">Visitas</th>
                <th className="px-3 py-2 text-right">Gastado</th>
                <th className="px-3 py-2">Última vez</th>
              </tr>
            </thead>
            <tbody>
              {clientes.data!.clientes.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setAbierto(c.id)}
                  className="cursor-pointer border-t border-black/5 hover:bg-laton/5"
                >
                  <td className="px-3 py-2 font-semibold">{c.nombre}</td>
                  <td className="cifra px-3 py-2 text-tinta/60">{c.telefono ?? "—"}</td>
                  <td className="px-3 py-2">
                    {c.seriales.length > 0 ? (
                      <span className="rounded bg-laton/15 px-1.5 py-0.5 text-xs font-semibold text-laton">
                        vinculada
                      </span>
                    ) : (
                      <span className="text-xs text-tinta/30">—</span>
                    )}
                  </td>
                  <td className="cifra px-3 py-2 text-right">{c.visitas}</td>
                  <td className="cifra px-3 py-2 text-right">{aTextoConSimbolo(c.totalGastado)}</td>
                  <td className="px-3 py-2 text-tinta/60">{cuandoFue(c.ultimaVisita)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {abierto ? <Ficha clienteId={abierto} alCerrar={() => setAbierto(null)} /> : null}

      {creando ? (
        <NuevoCliente
          inicial={creando}
          alCerrar={() => setCreando(null)}
          alCrear={() => {
            qc.invalidateQueries({ queryKey: ["clientes"] });
            setCreando(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Ficha({ clienteId, alCerrar }: { clienteId: string; alCerrar: () => void }) {
  const qc = useQueryClient();
  const [serial, setSerial] = useState("");

  const ficha = useQuery({
    queryKey: ["cliente", clienteId],
    queryFn: () =>
      api.get<{
        cliente: Cliente;
        ventas: Venta[];
        habituales: { nombre: string; veces: number }[];
      }>(`/clientes/${clienteId}`),
  });

  const vincular = useMutation({
    mutationFn: () => api.post(`/clientes/${clienteId}/fidelidad`, { serial, origen: "manual" }),
    onSuccess: () => {
      setSerial("");
      qc.invalidateQueries({ queryKey: ["cliente", clienteId] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
    },
  });

  if (!ficha.data) return null;
  const { cliente, ventas, habituales } = ficha.data;

  return (
    <Modal titulo={cliente.nombre} alCerrar={alCerrar} ancho="max-w-2xl">
      <div className="grid grid-cols-3 gap-2">
        <Recuadro etiqueta="Visitas" valor={String(cliente.visitas)} />
        <Recuadro etiqueta="Gastado" valor={aTextoConSimbolo(cliente.totalGastado)} />
        <Recuadro etiqueta="Última vez" valor={cuandoFue(cliente.ultimaVisita)} />
      </div>

      {habituales.length > 0 ? (
        <p className="mt-3 text-sm">
          <span className="etiqueta">Lo de siempre: </span>
          {habituales.map((h) => `${h.nombre} (${h.veces})`).join(", ")}
        </p>
      ) : null}

      <h3 className="etiqueta mt-4 mb-1">Tarjeta de fidelidad</h3>
      {cliente.seriales.length > 0 ? (
        <div className="space-y-1">
          {cliente.seriales.map((s) => (
            <code key={s} className="block rounded bg-black/5 px-2 py-1 text-xs">
              {s}
            </code>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <Aviso tono="info">
            Sin tarjeta vinculada. Con el serial vinculado, escanear la tarjeta identifica a esta
            persona <strong>de forma exacta</strong>, sin depender del nombre.
          </Aviso>
          <div className="flex gap-2">
            <input
              className="campo"
              placeholder="Disparar la tarjeta o pegar el serial"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
            />
            <button
              className="boton-suave px-4"
              disabled={serial.trim().length < 3 || vincular.isPending}
              onClick={() => vincular.mutate()}
            >
              Vincular
            </button>
          </div>
          {vincular.error ? <Aviso tono="mal">{(vincular.error as Error).message}</Aviso> : null}
        </div>
      )}

      <h3 className="etiqueta mt-4 mb-1">Visitas</h3>
      <div className="scroll-fino max-h-72 overflow-y-auto rounded-lg border border-black/10">
        {ventas.length === 0 ? (
          <p className="p-4 text-center text-sm text-tinta/50">Todavía no compró nada.</p>
        ) : (
          ventas.map((v) => (
            <div
              key={v.id}
              className={`flex justify-between border-b border-black/5 px-3 py-2 text-sm last:border-0 ${
                v.anulada ? "text-tinta/35 line-through" : ""
              }`}
            >
              <span>
                <span className="cifra font-semibold">{v.correlativo}</span>
                <span className="ml-2 text-tinta/60">{fechaYHora(v.ts)}</span>
              </span>
              <span className="cifra font-semibold">{aTextoConSimbolo(v.total)}</span>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

function NuevoCliente({
  inicial,
  alCerrar,
  alCrear,
}: {
  inicial: { nombre: string; serial?: string };
  alCerrar: () => void;
  alCrear: () => void;
}) {
  const [nombre, setNombre] = useState(inicial.nombre);
  const [telefono, setTelefono] = useState("");

  const crear = useMutation({
    mutationFn: () =>
      api.post<{ cliente: Cliente; homonimos: { id: string; nombre: string }[] }>("/clientes", {
        nombre,
        telefono: telefono || undefined,
        serial: inicial.serial,
      }),
    onSuccess: alCrear,
  });

  return (
    <Modal
      titulo="Nuevo cliente"
      alCerrar={alCerrar}
      pie={
        <button
          className="boton-primario w-full"
          disabled={!nombre.trim() || crear.isPending}
          onClick={() => crear.mutate()}
        >
          Guardar
        </button>
      }
    >
      <div className="space-y-3">
        {inicial.serial ? (
          <Aviso tono="info" titulo="Tarjeta de fidelidad escaneada">
            Se va a vincular al cliente que crees aquí.
            <code className="mt-1 block text-xs">{inicial.serial}</code>
          </Aviso>
        ) : null}

        <label className="block">
          <span className="etiqueta mb-1 block">Nombre</span>
          <input className="campo" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>

        <label className="block">
          <span className="etiqueta mb-1 block">Teléfono (opcional)</span>
          <input
            className="campo cifra"
            inputMode="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
          />
        </label>

        {crear.data && crear.data.homonimos.length > 0 ? (
          <Aviso tono="aviso" titulo="Ya había alguien con ese nombre">
            Se creó igual (dos personas pueden llamarse igual de verdad), pero conviene revisar que
            no sea un duplicado.
          </Aviso>
        ) : null}
      </div>
    </Modal>
  );
}
