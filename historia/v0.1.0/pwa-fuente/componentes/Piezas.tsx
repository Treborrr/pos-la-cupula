/**
 * Las piezas que se repetían en todas las pantallas.
 *
 * Había cinco versiones casi iguales de "un recuadro con una etiqueta chica y
 * un número grande" —llamadas Dato, Cuadro y Mini según la pantalla— y dos de
 * "un campo de texto que muestra el botón de guardar solo si cambió". Además
 * de ser ruido, divergían: una mostraba el valor en cifras tabulares y otra
 * no, así que las mismas cantidades se veían distintas según dónde las miraras.
 */

import { useState, type ReactNode } from "react";

/**
 * Un número con su etiqueta. `tamano` cubre los tres usos reales: en línea
 * dentro de una barra de totales, en una cuadrícula, o destacado.
 */
export function Dato({
  etiqueta,
  valor,
  nota,
  tamano = "normal",
  alinear = "izq",
  tono,
}: {
  etiqueta: string;
  valor: string;
  nota?: string;
  tamano?: "chico" | "normal" | "grande";
  alinear?: "izq" | "der";
  tono?: "bien" | "mal" | "aviso";
}) {
  const tamanos = { chico: "text-sm", normal: "text-xl", grande: "text-2xl" };
  const tonos = { bien: "text-bien", mal: "text-mal", aviso: "text-aviso" };

  return (
    <div className={alinear === "der" ? "text-right" : ""}>
      <div className="etiqueta">{etiqueta}</div>
      {/* Cifras tabulares SIEMPRE: sin esto las columnas de importes bailan de
          fila en fila y una lista de totales se vuelve difícil de barrer. */}
      <div className={`cifra font-bold ${tamanos[tamano]} ${tono ? tonos[tono] : ""}`}>{valor}</div>
      {nota ? <div className="text-xs text-tinta/50">{nota}</div> : null}
    </div>
  );
}

/** El mismo dato, dentro de una tarjeta. Para las cuadrículas de resumen. */
export function Recuadro(props: Parameters<typeof Dato>[0]) {
  return (
    <div className="tarjeta p-3">
      <Dato {...props} />
    </div>
  );
}

/**
 * Campo de texto que solo ofrece guardar si el valor cambió.
 *
 * El botón aparece recién al editar: un formulario con seis botones "Guardar"
 * siempre visibles no deja ver cuál está pendiente de verdad.
 */
export function CampoGuardable({
  etiqueta,
  ayuda,
  valor,
  alGuardar,
  textoBoton = "Guardar",
}: {
  etiqueta: string;
  ayuda?: ReactNode;
  valor: string;
  alGuardar: (v: string) => void;
  textoBoton?: string;
}) {
  const [texto, setTexto] = useState(valor);
  const sucio = texto !== valor;

  return (
    <label className="block">
      <span className="etiqueta mb-1 block">{etiqueta}</span>
      <div className="flex gap-2">
        <input className="campo" value={texto} onChange={(e) => setTexto(e.target.value)} />
        {sucio ? (
          <button className="boton-laton px-4" onClick={() => alGuardar(texto)}>
            {textoBoton}
          </button>
        ) : null}
      </div>
      {ayuda ? <span className="mt-1 block text-xs text-tinta/45">{ayuda}</span> : null}
    </label>
  );
}

/** Campo de formulario simple, con su etiqueta y su ayuda. */
export function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string;
  ayuda?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="etiqueta mb-1 block">{etiqueta}</span>
      {children}
      {ayuda ? <span className="mt-1 block text-xs text-tinta/45">{ayuda}</span> : null}
    </label>
  );
}

/**
 * Tamaño de archivo legible. Un respaldo recién instalado pesa unos cientos
 * de bytes, y mostrar "0 KB" hace pensar que falló.
 */
export function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
