/**
 * Quién está logueado, con las dos acciones que cualquier rol necesita sobre
 * su PROPIA cuenta: cambiar su contraseña y cerrar sesión. Vive en el
 * sidebar, disponible para ADMIN y CAJERO por igual.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut } from "lucide-react";

import { api, FalloDeApi } from "../lib/api";
import { banderaDeSalidaIntencional, type UsuarioDeSesion } from "../lib/sesion";
import { Aviso, Modal } from "./Modal";
import { Campo } from "./Piezas";

export function MenuDeCuenta({ usuario }: { usuario: UsuarioDeSesion }) {
  const qc = useQueryClient();
  const [cambiando, setCambiando] = useState(false);

  const salir = useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onMutate: () => {
      banderaDeSalidaIntencional.valor = true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "yo"] }),
  });

  return (
    <div className="rounded-xl bg-white/[0.06] p-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sm font-semibold text-hueso">
          {usuario.nombre.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <span className="hidden min-w-0 xl:block">
          <span className="block truncate text-sm font-semibold text-hueso">{usuario.nombre}</span>
          <span className="block text-xs text-hueso/55">{usuario.rol === "ADMIN" ? "Administrador" : "Cajero"}</span>
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-hueso/60 transition-colors hover:bg-white/10 hover:text-hueso"
          title="Cambiar mi contraseña"
          onClick={() => setCambiando(true)}
        >
          <KeyRound className="h-4 w-4" />
          <span className="hidden xl:inline">Contraseña</span>
        </button>
        <button
          type="button"
          className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-hueso/60 transition-colors hover:bg-white/10 hover:text-hueso"
          title="Cerrar sesión"
          disabled={salir.isPending}
          onClick={() => salir.mutate()}
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden xl:inline">Salir</span>
        </button>
      </div>

      {cambiando ? <ModalCambiarContrasena alCerrar={() => setCambiando(false)} /> : null}
    </div>
  );
}

function ModalCambiarContrasena({ alCerrar }: { alCerrar: () => void }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");

  const coinciden = nueva.length > 0 && nueva === repetida;
  const valido = actual.length > 0 && nueva.length >= 8 && coinciden;

  const guardar = useMutation({
    mutationFn: () => api.post("/auth/contrasena", { contrasenaActual: actual, contrasenaNueva: nueva }),
    onSuccess: alCerrar,
  });
  const fallo = guardar.error as FalloDeApi | undefined;

  return (
    <Modal
      titulo="Cambiar mi contraseña"
      alCerrar={alCerrar}
      pie={
        <div className="flex gap-3">
          <button className="boton-suave ml-auto" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="boton-primario" disabled={!valido || guardar.isPending} onClick={() => guardar.mutate()}>
            {guardar.isPending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valido) guardar.mutate();
        }}
      >
        {fallo ? <Aviso tono="mal">{fallo.message}</Aviso> : null}

        <Campo etiqueta="Contraseña actual">
          <input
            className="campo"
            type="password"
            autoFocus
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Contraseña nueva" ayuda="Al menos 8 caracteres.">
          <input className="campo" type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
        </Campo>
        <Campo etiqueta="Repite la contraseña nueva">
          <input className="campo" type="password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
        </Campo>
        {repetida.length > 0 && !coinciden ? <p className="text-sm text-mal">Las dos contraseñas no coinciden.</p> : null}
      </form>
    </Modal>
  );
}
