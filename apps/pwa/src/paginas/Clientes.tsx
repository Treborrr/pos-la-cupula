/**
 * Clientes e integración con la tarjeta de fidelidad de TarjetaCloud.
 *
 * El QR de La Cúpula está configurado en modo "nombre": lleva el nombre del
 * cliente en texto plano, no un identificador único. Dos personas que se
 * llaman igual NO se distinguen por el escaneo, y la pantalla lo dice en vez
 * de elegir una al azar.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Pencil, Search, UserPlus, UserRound, Users } from "lucide-react";

import { abrirLector } from "../lib/lector";
import { api, type Cliente, type FichaCliente } from "../lib/api";
import { aTextoConSimbolo, cuandoFue, fechaYHora } from "../lib/formato";
import { Aviso, Modal, Vacio } from "../componentes/Modal";
import { useEscaner } from "../lib/escaneo";
import { Campo, EncabezadoPagina, Pagina, Pastilla, Recuadro } from "../componentes/Piezas";
import { limpiarNombre } from "../componentes/CampoCliente";
import { FalloDeApi } from "../lib/api";

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
        setCreando(r.esSerialDeTarjeta ? { nombre: "", serial: r.leido } : { nombre: r.leido });
      }
    },
  });

  const lista = clientes.data?.clientes ?? [];

  return (
    <Pagina>
      <EncabezadoPagina
        titulo="Clientes"
        descripcion="Quiénes vienen, cuántas veces y qué piden. Toca un cliente para ver su historial o vincular su tarjeta de fidelidad."
        acciones={
          <button className="boton-primario" onClick={() => setCreando({ nombre: busqueda })}>
            <UserPlus className="h-5 w-5" />
            Nuevo cliente
          </button>
        }
      />

      <div className="tarjeta overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-linea p-4">
          <div className="relative min-w-72 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-tinta/35" />
            <input
              className="campo pl-12"
              placeholder="Buscar por nombre o teléfono"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <span className="ayuda flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            También puedes escanear su tarjeta de fidelidad.
          </span>
        </div>

        {clientes.isLoading ? (
          <Vacio titulo="Cargando…" />
        ) : lista.length === 0 ? (
          <Vacio
            icono={busqueda ? Search : Users}
            titulo={busqueda ? "Nadie coincide" : "Todavía no hay clientes"}
            accion={
              <button className="boton-primario" onClick={() => setCreando({ nombre: busqueda })}>
                <UserPlus className="h-5 w-5" />
                {busqueda ? `Crear «${busqueda}»` : "Crear el primer cliente"}
              </button>
            }
          >
            Se dan de alta solos al cobrar, escribiendo su nombre. También aquí, o escaneando su tarjeta de fidelidad.
          </Vacio>
        ) : (
          <div className="scroll-fino overflow-x-auto">
            <table className="tabla tabla-clic">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Teléfono</th>
                  <th>Tarjeta</th>
                  <th className="text-right">Visitas</th>
                  <th className="text-right">Gastado</th>
                  <th>Última visita</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.id} onClick={() => setAbierto(c.id)}>
                    <td className="font-medium">{c.nombre}</td>
                    <td className="cifra text-tinta/65">{c.telefono || "—"}</td>
                    <td>{c.seriales.length > 0 ? <Pastilla tono="laton">Vinculada</Pastilla> : <span className="text-tinta/30">—</span>}</td>
                    <td className="cifra text-right">{c.visitas}</td>
                    <td className="cifra text-right">{aTextoConSimbolo(c.totalGastado)}</td>
                    <td className="text-tinta/65">{cuandoFue(c.ultimaVisita)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {abierto ? <Ficha clienteId={abierto} alCerrar={() => setAbierto(null)} /> : null}

      {creando ? (
        <NuevoCliente
          inicial={creando}
          alCerrar={() => setCreando(null)}
          alCrear={(id) => {
            qc.invalidateQueries({ queryKey: ["clientes"] });
            setCreando(null);
            setAbierto(id);
          }}
        />
      ) : null}
    </Pagina>
  );
}

function Ficha({ clienteId, alCerrar }: { clienteId: string; alCerrar: () => void }) {
  const qc = useQueryClient();
  const [serial, setSerial] = useState("");
  const [editando, setEditando] = useState(false);

  const ficha = useQuery({
    queryKey: ["cliente", clienteId],
    queryFn: () => api.get<FichaCliente>(`/clientes/${clienteId}`),
  });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["cliente", clienteId] });
    qc.invalidateQueries({ queryKey: ["clientes"] });
  };

  const vincular = useMutation({
    mutationFn: () => api.post(`/clientes/${clienteId}/fidelidad`, { serial, origen: "manual" }),
    onSuccess: () => {
      setSerial("");
      refrescar();
    },
  });

  if (!ficha.data) return null;
  const { cliente, ventas, habituales } = ficha.data;

  return (
    <Modal
      titulo={cliente.nombre}
      subtitulo={cliente.telefono || "Sin teléfono"}
      alCerrar={alCerrar}
      ancho="max-w-3xl"
    >
      <div className="space-y-6">
        {editando ? (
          <EditarCliente
            cliente={cliente}
            alTerminar={() => {
              setEditando(false);
              refrescar();
            }}
          />
        ) : (
          <div className="flex justify-end">
            <button className="boton-suave boton-chico" onClick={() => setEditando(true)}>
              <Pencil className="h-4 w-4" />
              Editar datos
            </button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <Recuadro etiqueta="Visitas" valor={String(cliente.visitas)} />
          <Recuadro etiqueta="Gastado" valor={aTextoConSimbolo(cliente.totalGastado)} />
          <Recuadro etiqueta="Última visita" valor={cuandoFue(cliente.ultimaVisita)} tamano="chico" />
        </div>

        {cliente.notas ? <Aviso tono="info" titulo="Notas">{cliente.notas}</Aviso> : null}

        {habituales.length > 0 ? (
          <div>
            <div className="etiqueta mb-2">Lo que más pide</div>
            <div className="flex flex-wrap gap-2">
              {habituales.map((h, i) => (
                <Pastilla key={i}>
                  {h.nombre} · {h.veces}
                </Pastilla>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <div className="etiqueta mb-2">Tarjeta de fidelidad</div>
          {cliente.seriales.length > 0 ? (
            <div className="space-y-2">
              {cliente.seriales.map((s) => (
                <div key={s} className="flex items-center gap-3 rounded-xl bg-laton-claro px-4 py-3">
                  <CreditCard className="h-5 w-5 text-laton-oscuro" />
                  <code className="text-sm">{s}</code>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="ayuda text-base">
                Sin tarjeta vinculada. Con la tarjeta vinculada, escanearla identifica a esta persona de forma exacta, sin
                depender del nombre.
              </p>
              <div className="flex gap-3">
                <input
                  className="campo"
                  placeholder="Escanea la tarjeta o pega el serial"
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                />
                <button
                  className="boton-suave"
                  disabled={serial.trim().length < 3 || vincular.isPending}
                  onClick={() => vincular.mutate()}
                >
                  Vincular
                </button>
              </div>
              {vincular.error ? <Aviso tono="mal">{(vincular.error as Error).message}</Aviso> : null}
            </div>
          )}
        </div>

        <div>
          <div className="etiqueta mb-2">Historial de compras · {ventas.length}</div>
          <div className="scroll-fino max-h-72 divide-y divide-linea overflow-y-auto rounded-xl border border-linea">
            {ventas.length === 0 ? (
              <p className="ayuda p-6 text-center">Todavía no compró nada.</p>
            ) : (
              ventas.map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    alCerrar();
                    abrirLector(v.correlativo);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-hueso"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">
                      <span className="cifra">{v.correlativo}</span>
                      <span className="ml-2 font-normal text-tinta/55">{fechaYHora(v.ts)}</span>
                      {v.anulada ? (
                        <span className="ml-2">
                          <Pastilla tono="mal">Anulada</Pastilla>
                        </span>
                      ) : null}
                    </span>
                    <span className="ayuda block truncate">{v.lineas.map((l) => l.nombre).join(", ")}</span>
                  </span>
                  <span className={`cifra shrink-0 font-semibold ${v.anulada ? "text-tinta/35 line-through" : ""}`}>
                    {aTextoConSimbolo(v.total)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function EditarCliente({ cliente, alTerminar }: { cliente: Cliente; alTerminar: () => void }) {
  const [nombre, setNombre] = useState(cliente.nombre);
  const [telefono, setTelefono] = useState(cliente.telefono ?? "");
  const [notas, setNotas] = useState(cliente.notas ?? "");

  const guardar = useMutation({
    mutationFn: () => api.patch(`/clientes/${cliente.id}`, { nombre, telefono, notas }),
    onSuccess: alTerminar,
  });

  return (
    <div className="space-y-4 rounded-2xl border border-linea p-5">
      <h3 className="text-lg font-semibold">Editar datos</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Nombre">
          <input
            className="campo font-semibold tracking-wide uppercase"
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(limpiarNombre(e.target.value))}
          />
        </Campo>
        <Campo etiqueta="Teléfono" opcional>
          <input className="campo cifra" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
        </Campo>
      </div>
      <Campo etiqueta="Notas" opcional ayuda="Por ejemplo: prefiere tijera, alérgico a cierta cera.">
        <textarea className="campo" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
      </Campo>
      {guardar.error ? <Aviso tono="mal">{(guardar.error as Error).message}</Aviso> : null}
      <div className="flex justify-end gap-3">
        <button className="boton-suave" onClick={alTerminar}>
          Cancelar
        </button>
        <button className="boton-primario" disabled={!nombre.trim() || guardar.isPending} onClick={() => guardar.mutate()}>
          Guardar
        </button>
      </div>
    </div>
  );
}

function NuevoCliente({
  inicial,
  alCerrar,
  alCrear,
}: {
  inicial: { nombre: string; serial?: string };
  alCerrar: () => void;
  alCrear: (id: string) => void;
}) {
  const [nombre, setNombre] = useState(limpiarNombre(inicial.nombre));
  const [telefono, setTelefono] = useState("");

  const crear = useMutation({
    mutationFn: (permitirHomonimo: boolean) =>
      api.post<{ cliente: Cliente }>("/clientes", {
        nombre: nombre.trim(),
        telefono: telefono || undefined,
        serial: inicial.serial,
        permitirHomonimo: permitirHomonimo || undefined,
      }),
    onSuccess: (r) => alCrear(r.cliente.id),
  });

  // Ya existe alguien con ese nombre: se ofrece ir a su ficha en vez de repetirlo.
  const repetido = crear.error instanceof FalloDeApi && crear.error.info.codigo === "CLIENTE_REPETIDO";
  const existente = useQuery({
    queryKey: ["clientes", "repetido", nombre],
    queryFn: () => api.get<{ clientes: Cliente[] }>(`/clientes?q=${encodeURIComponent(nombre.trim())}&limite=50`),
    enabled: repetido,
  });
  const mismo = existente.data?.clientes.find(
    (c) => c.nombre.localeCompare(nombre.trim(), "es", { sensitivity: "base" }) === 0,
  );

  return (
    <Modal
      titulo="Nuevo cliente"
      subtitulo="Con el nombre basta. El teléfono sirve para distinguir a dos personas que se llaman igual."
      alCerrar={alCerrar}
      pie={
        repetido ? (
          <div className="flex flex-wrap justify-end gap-3">
            <button className="boton-suave" disabled={crear.isPending} onClick={() => crear.mutate(true)}>
              Es otra persona: crear igual
            </button>
            <button className="boton-primario" disabled={!mismo} onClick={() => mismo && alCrear(mismo.id)}>
              Ver el cliente que ya existe
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-3">
            <button className="boton-suave" onClick={alCerrar}>
              Cancelar
            </button>
            <button className="boton-primario" disabled={!nombre.trim() || crear.isPending} onClick={() => crear.mutate(false)}>
              <UserRound className="h-5 w-5" />
              {crear.isPending ? "Guardando…" : "Crear cliente"}
            </button>
          </div>
        )
      }
    >
      <div className="space-y-5">
        {inicial.serial ? (
          <Aviso tono="info" titulo="Tarjeta de fidelidad escaneada">
            Se va a vincular al cliente que crees aquí.
            <code className="mt-1 block text-xs">{inicial.serial}</code>
          </Aviso>
        ) : null}

        {repetido ? (
          <Aviso tono="aviso" titulo={`Ya existe un cliente llamado ${mismo?.nombre ?? nombre.trim()}`}>
            Para no repetirlo, abre el que ya existe. Solo si de verdad es otra persona con el mismo nombre, créalo igual
            y anota su teléfono para distinguirlos.
          </Aviso>
        ) : (
          <>
            <Campo etiqueta="Nombre">
              <input
                className="campo font-semibold tracking-wide uppercase"
                autoFocus
                value={nombre}
                placeholder="NOMBRE Y APELLIDO"
                onChange={(e) => setNombre(limpiarNombre(e.target.value))}
              />
            </Campo>
            <Campo etiqueta="Teléfono" opcional>
              <input
                className="campo cifra"
                inputMode="tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && nombre.trim() && crear.mutate(false)}
              />
            </Campo>
            {crear.error ? <Aviso tono="mal">{(crear.error as Error).message}</Aviso> : null}
          </>
        )}
      </div>
    </Modal>
  );
}
