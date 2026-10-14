/**
 * Los cajeros del mostrador: hasta 3 cuentas, usuario y contraseña elegidos
 * acá mismo al crearlas. Los dueños NO se gestionan desde esta pantalla —se
 * crean aparte, directo contra el log (`herramientas/crear-usuario.mts`)—
 * y aparecen solo de lectura, para que se pueda confirmar que las dos
 * cuentas existen.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, RotateCcw, UserX } from "lucide-react";

import { api, FalloDeApi, type RolUsuario } from "../../lib/api";
import { Aviso, Modal } from "../../componentes/Modal";
import { Campo, Pastilla } from "../../componentes/Piezas";

const TOPE_CAJEROS = 3;

interface UsuarioAdmin {
  id: string;
  usuario: string;
  nombre: string;
  rol: RolUsuario;
  activo: boolean;
}

export function SeccionUsuarios() {
  const qc = useQueryClient();
  const [creando, setCreando] = useState(false);
  const [reseteando, setReseteando] = useState<UsuarioAdmin | null>(null);

  const usuarios = useQuery({
    queryKey: ["usuarios"],
    queryFn: () => api.get<{ usuarios: UsuarioAdmin[] }>("/usuarios"),
  });

  const lista = usuarios.data?.usuarios ?? [];
  const cajeros = lista.filter((u) => u.rol === "CAJERO");
  const duenos = lista.filter((u) => u.rol === "ADMIN");
  const cajerosActivos = cajeros.filter((u) => u.activo).length;

  const refrescar = () => qc.invalidateQueries({ queryKey: ["usuarios"] });

  const cambiarEstado = useMutation({
    mutationFn: (u: UsuarioAdmin) => api.post(`/usuarios/${u.id}/${u.activo ? "desactivar" : "reactivar"}`),
    onSuccess: refrescar,
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="etiqueta">
            Cajeros · {cajerosActivos}/{TOPE_CAJEROS} activos
          </div>
          {cajerosActivos < TOPE_CAJEROS ? (
            <button className="boton-suave boton-chico" onClick={() => setCreando(true)}>
              <Plus className="h-4 w-4" />
              Agregar cajero
            </button>
          ) : null}
        </div>

        {cajeros.length === 0 ? (
          <p className="ayuda rounded-xl border border-dashed border-linea p-5 text-center">
            Todavía no hay cuentas de cajero.
          </p>
        ) : (
          <ul className="divide-y divide-linea rounded-xl border border-linea">
            {cajeros.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-semibold ${
                    u.activo ? "bg-laton-claro text-laton-oscuro" : "bg-hueso text-tinta/35"
                  }`}
                >
                  {u.nombre.trim().charAt(0).toUpperCase() || "?"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block font-medium ${u.activo ? "" : "text-tinta/40"}`}>{u.nombre}</span>
                  <span className="ayuda cifra block">@{u.usuario}</span>
                </span>
                {!u.activo ? <Pastilla>Inactivo</Pastilla> : null}
                <button
                  className="boton-icono"
                  title="Resetear contraseña"
                  aria-label={`Resetear la contraseña de ${u.nombre}`}
                  onClick={() => setReseteando(u)}
                >
                  <KeyRound className="h-5 w-5" />
                </button>
                {u.activo ? (
                  <button className="boton-suave boton-chico" onClick={() => cambiarEstado.mutate(u)}>
                    <UserX className="h-4 w-4" />
                    Desactivar
                  </button>
                ) : (
                  <button className="boton-suave boton-chico" onClick={() => cambiarEstado.mutate(u)}>
                    <RotateCcw className="h-4 w-4" />
                    Reactivar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="etiqueta mb-2">Dueños</div>
        <ul className="divide-y divide-linea rounded-xl border border-linea">
          {duenos.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tinta/10 font-semibold text-tinta">
                {u.nombre.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{u.nombre}</span>
                <span className="ayuda cifra block">@{u.usuario}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="ayuda mt-2">
          Las cuentas de dueño no se gestionan desde acá: se crean y se cambian directo en el servidor.
        </p>
      </div>

      {creando ? <ModalCrearCajero alCerrar={() => setCreando(false)} alCrear={refrescar} /> : null}
      {reseteando ? <ModalResetearContrasena usuario={reseteando} alCerrar={() => setReseteando(null)} /> : null}
    </div>
  );
}

function ModalCrearCajero({ alCerrar, alCrear }: { alCerrar: () => void; alCrear: () => void }) {
  const [usuario, setUsuario] = useState("");
  const [nombre, setNombre] = useState("");
  const [contrasena, setContrasena] = useState("");

  const valido = usuario.trim().length >= 3 && nombre.trim().length > 0 && contrasena.length >= 8;

  const crear = useMutation({
    mutationFn: () => api.post("/usuarios", { usuario: usuario.trim(), nombre: nombre.trim(), contrasena }),
    onSuccess: () => {
      alCrear();
      alCerrar();
    },
  });
  const fallo = crear.error as FalloDeApi | undefined;

  return (
    <Modal
      titulo="Agregar cajero"
      alCerrar={alCerrar}
      pie={
        <div className="flex gap-3">
          <button className="boton-suave ml-auto" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="boton-primario" disabled={!valido || crear.isPending} onClick={() => crear.mutate()}>
            {crear.isPending ? "Creando…" : "Crear"}
          </button>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valido) crear.mutate();
        }}
      >
        {fallo ? <Aviso tono="mal">{fallo.message}</Aviso> : null}

        <Campo etiqueta="Nombre" ayuda="Para identificarlo en los reportes.">
          <input className="campo" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </Campo>
        <Campo etiqueta="Usuario" ayuda="Con qué va a entrar. Sin espacios ni tildes.">
          <input
            className="campo"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </Campo>
        <Campo etiqueta="Contraseña" ayuda="Al menos 8 caracteres.">
          <input className="campo" type="password" value={contrasena} onChange={(e) => setContrasena(e.target.value)} />
        </Campo>
      </form>
    </Modal>
  );
}

function ModalResetearContrasena({ usuario, alCerrar }: { usuario: UsuarioAdmin; alCerrar: () => void }) {
  const [contrasenaNueva, setContrasenaNueva] = useState("");
  const valido = contrasenaNueva.length >= 8;

  const resetear = useMutation({
    mutationFn: () => api.post(`/usuarios/${usuario.id}/contrasena`, { contrasenaNueva }),
    onSuccess: alCerrar,
  });
  const fallo = resetear.error as FalloDeApi | undefined;

  return (
    <Modal
      titulo={`Resetear la contraseña de ${usuario.nombre}`}
      subtitulo="Se cierra la sesión que tuviera abierta ahora mismo."
      alCerrar={alCerrar}
      pie={
        <div className="flex gap-3">
          <button className="boton-suave ml-auto" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="boton-primario" disabled={!valido || resetear.isPending} onClick={() => resetear.mutate()}>
            {resetear.isPending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valido) resetear.mutate();
        }}
      >
        {fallo ? <Aviso tono="mal">{fallo.message}</Aviso> : null}

        <Campo etiqueta="Contraseña nueva" ayuda="Al menos 8 caracteres.">
          <input
            className="campo"
            type="password"
            autoFocus
            value={contrasenaNueva}
            onChange={(e) => setContrasenaNueva(e.target.value)}
          />
        </Campo>
      </form>
    </Modal>
  );
}
