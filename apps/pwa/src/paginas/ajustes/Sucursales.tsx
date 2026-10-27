/**
 * Las sucursales de la cadena: alta, edición y baja.
 *
 * Qué es de cada local y qué es de la cadena está explicado en
 * `PLAN-MULTISUCURSAL.md`, y resumido en el aviso de arriba de la pantalla:
 * hace falta que quien abre un local segundo entienda, antes de cargar nada,
 * que el catálogo y los clientes NO se duplican.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Power, Store } from "lucide-react";

import { api, FalloDeApi, type Sede } from "../../lib/api";
import { Aviso, Modal } from "../../componentes/Modal";
import { Campo, Pastilla } from "../../componentes/Piezas";

export function SeccionSucursales() {
  const qc = useQueryClient();
  const [editando, setEditando] = useState<Sede | null>(null);
  const [creando, setCreando] = useState(false);

  const sedes = useQuery({
    queryKey: ["sedes"],
    queryFn: () => api.get<{ sedes: Sede[] }>("/sedes"),
  });

  const lista = sedes.data?.sedes ?? [];
  const activas = lista.filter((s) => s.activa).length;

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["sedes"] });
    qc.invalidateQueries({ queryKey: ["estado"] });
  };

  const cambiarEstado = useMutation({
    mutationFn: (s: Sede) => api.post(`/sedes/${s.id}/${s.activa ? "desactivar" : "reactivar"}`),
    onSuccess: refrescar,
  });

  return (
    <div className="space-y-5">
      <Aviso tono="info" titulo="Qué se comparte entre locales y qué no">
        El <strong>catálogo, los precios generales, los clientes y su fidelidad</strong> son de toda la
        cadena: se cargan una sola vez. Lo que lleva cada sucursal por separado es su{" "}
        <strong>stock, su caja, sus barberos y su numeración de tickets</strong>. Un cliente que se
        atiende en dos locales sigue siendo una sola persona.
      </Aviso>

      {cambiarEstado.error ? (
        <Aviso tono="mal" titulo={(cambiarEstado.error as FalloDeApi).message}>
          {(cambiarEstado.error as FalloDeApi).sugerencia}
        </Aviso>
      ) : null}

      <div className="tarjeta divide-y divide-linea">
        {lista.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-hueso-hondo">
              <Store className="h-5 w-5 text-tinta/50" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-semibold ${s.activa ? "" : "text-tinta/40"}`}>{s.nombre}</span>
                <Pastilla tono="laton">Tickets {s.prefijoTicket}</Pastilla>
                {!s.activa ? <Pastilla>Desactivada</Pastilla> : null}
                {s.cajaAbierta ? <Pastilla tono="bien">Caja abierta</Pastilla> : null}
              </div>
              <div className="ayuda">
                {[s.direccion, s.ciudad].filter(Boolean).join(" · ") || "Sin dirección cargada"}
                {s.ticketsEmitidos ? ` · ${s.ticketsEmitidos} tickets emitidos` : ""}
              </div>
            </div>

            <button type="button" className="boton-suave boton-chico" onClick={() => setEditando(s)}>
              Editar
            </button>
            <button
              type="button"
              className="boton-suave boton-chico"
              disabled={cambiarEstado.isPending}
              onClick={() => cambiarEstado.mutate(s)}
            >
              <Power className="h-4 w-4" />
              {s.activa ? "Desactivar" : "Reactivar"}
            </button>
          </div>
        ))}
      </div>

      <button type="button" className="boton-suave" onClick={() => setCreando(true)}>
        <Plus className="h-5 w-5" />
        Abrir otra sucursal
      </button>
      <p className="ayuda">
        {activas === 1
          ? "Hoy hay un solo local. Al abrir el segundo aparece un selector arriba para moverte entre ellos."
          : `${activas} sucursales activas.`}
      </p>

      {creando ? <FormularioDeSede alCerrar={() => setCreando(false)} alGuardar={refrescar} /> : null}
      {editando ? (
        <FormularioDeSede sede={editando} alCerrar={() => setEditando(null)} alGuardar={refrescar} />
      ) : null}
    </div>
  );
}

function FormularioDeSede({
  sede,
  alCerrar,
  alGuardar,
}: {
  sede?: Sede;
  alCerrar: () => void;
  alGuardar: () => void;
}) {
  const [nombre, setNombre] = useState(sede?.nombre ?? "");
  const [direccion, setDireccion] = useState(sede?.direccion ?? "");
  const [ciudad, setCiudad] = useState(sede?.ciudad ?? "");
  const [pie, setPie] = useState(sede?.pie ?? "");
  const [prefijo, setPrefijo] = useState(sede?.prefijoTicket ?? "");

  /**
   * El prefijo se congela en cuanto la sucursal emitió su primer ticket:
   * cambiarlo después partiría su numeración en dos series y un contador no
   * puede explicar eso. El servidor lo rechaza igual; acá se esconde el campo
   * para no ofrecer algo que va a fallar.
   */
  const prefijoCongelado = (sede?.ticketsEmitidos ?? 0) > 0;

  const guardar = useMutation({
    mutationFn: () => {
      const datos = {
        nombre: nombre.trim(),
        direccion: direccion.trim(),
        ciudad: ciudad.trim(),
        pie: pie.trim(),
        ...(prefijoCongelado ? {} : { prefijoTicket: prefijo.trim().toUpperCase() }),
      };
      return sede ? api.patch(`/sedes/${sede.id}`, datos) : api.post("/sedes", datos);
    },
    onSuccess: () => {
      alGuardar();
      alCerrar();
    },
  });

  const faltan: string[] = [];
  if (!nombre.trim()) faltan.push("el nombre");
  if (!prefijoCongelado && !/^[A-Za-z]{2,4}$/.test(prefijo.trim())) faltan.push("el prefijo del ticket");

  const fallo = guardar.error instanceof FalloDeApi ? guardar.error : null;

  return (
    <Modal
      titulo={sede ? `Editar ${sede.nombre}` : "Abrir otra sucursal"}
      alCerrar={alCerrar}
      pie={
        <>
          <button type="button" className="boton-suave" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            type="button"
            className="boton"
            disabled={faltan.length > 0 || guardar.isPending}
            onClick={() => guardar.mutate()}
          >
            {guardar.isPending ? "Guardando…" : sede ? "Guardar" : "Abrir sucursal"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {fallo ? <Aviso tono="mal" titulo={fallo.message}>{fallo.sugerencia}</Aviso> : null}

        <Campo etiqueta="Nombre del local" ayuda="Cómo lo van a llamar entre ustedes.">
          <input
            className="campo"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Centro"
            autoFocus
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Dirección" opcional ayuda="Sale impresa en el ticket de ESTE local.">
            <input className="campo" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
          </Campo>
          <Campo etiqueta="Ciudad" opcional>
            <input className="campo" value={ciudad} onChange={(e) => setCiudad(e.target.value)} />
          </Campo>
        </div>

        <Campo etiqueta="Mensaje al pie del ticket" opcional ayuda="Si lo dejas vacío, usa el del negocio.">
          <input className="campo" value={pie} onChange={(e) => setPie(e.target.value)} />
        </Campo>

        {prefijoCongelado ? (
          <Campo etiqueta="Prefijo del ticket">
            <div className="flex items-center gap-3">
              <span className="cifra text-lg font-semibold">{sede!.prefijoTicket}</span>
              <span className="ayuda">
                Ya emitió {sede!.ticketsEmitidos} tickets, así que no se puede cambiar: partiría su
                numeración en dos series.
              </span>
            </div>
          </Campo>
        ) : (
          <Campo
            etiqueta="Prefijo del ticket"
            ayuda="De 2 a 4 letras. Cada local necesita el suyo para que dos tickets nunca lleven el mismo número."
          >
            <input
              className="campo uppercase"
              value={prefijo}
              maxLength={4}
              onChange={(e) => setPrefijo(e.target.value.toUpperCase())}
              placeholder="SC"
            />
          </Campo>
        )}

        {!sede ? (
          <p className="ayuda">
            La numeración de esta sucursal empieza en {prefijo.trim().toUpperCase() || "XX"}000001. No
            continúa la de ningún otro local.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
