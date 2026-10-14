/**
 * Las piezas que se repiten en todas las pantallas.
 */

import { useState, type ReactNode } from "react";
import { Check, type LucideIcon } from "lucide-react";

/**
 * Encabezado de cada pantalla: qué es, qué se hace aquí, y la acción principal.
 * La descripción no es decorado: es lo que guía a quien la abre por primera vez.
 */
export function EncabezadoPagina({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string;
  descripcion?: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">{titulo}</h1>
        {descripcion ? <p className="ayuda mt-1 max-w-3xl text-base">{descripcion}</p> : null}
      </div>
      {acciones ? <div className="flex flex-wrap items-center gap-2">{acciones}</div> : null}
    </div>
  );
}

/** Contenedor estándar de una pantalla con scroll propio. */
export function Pagina({ children, ancho = "max-w-7xl" }: { children: ReactNode; ancho?: string }) {
  return (
    <div className="scroll-fino h-full overflow-y-auto">
      <div className={`mx-auto w-full px-4 py-6 md:px-8 md:py-8 ${ancho}`}>{children}</div>
    </div>
  );
}

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
  icono: Icono,
}: {
  etiqueta: string;
  valor: string;
  nota?: string;
  tamano?: "chico" | "normal" | "grande";
  alinear?: "izq" | "der";
  tono?: "bien" | "mal" | "aviso";
  icono?: LucideIcon;
}) {
  const tamanos = { chico: "text-lg", normal: "text-2xl", grande: "text-3xl" };
  const tonos = { bien: "text-bien", mal: "text-mal", aviso: "text-aviso" };

  return (
    <div className={alinear === "der" ? "text-right" : ""}>
      <div className={`etiqueta flex items-center gap-2 ${alinear === "der" ? "justify-end" : ""}`}>
        {Icono ? <Icono className="h-4 w-4" /> : null}
        {etiqueta}
      </div>
      {/* Cifras tabulares SIEMPRE: sin esto las columnas de importes bailan. */}
      <div className={`cifra mt-1 font-semibold tracking-tight ${tamanos[tamano]} ${tono ? tonos[tono] : ""}`}>
        {valor}
      </div>
      {nota ? <div className="ayuda mt-0.5">{nota}</div> : null}
    </div>
  );
}

/** El mismo dato, dentro de una tarjeta. Para las cuadrículas de resumen. */
export function Recuadro(props: Parameters<typeof Dato>[0]) {
  return (
    <div className="tarjeta p-5">
      <Dato {...props} />
    </div>
  );
}

/** Sección con título dentro de una pantalla. */
export function Seccion({
  titulo,
  descripcion,
  acciones,
  children,
  className = "",
  sinRelleno = false,
}: {
  titulo?: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
  children: ReactNode;
  className?: string;
  sinRelleno?: boolean;
}) {
  return (
    <section className={`tarjeta ${sinRelleno ? "overflow-hidden" : "p-6"} ${className}`}>
      {titulo ? (
        <div className={`flex flex-wrap items-start justify-between gap-3 ${sinRelleno ? "px-6 pt-5 pb-4" : "mb-5"}`}>
          <div>
            <h2 className="text-lg font-semibold">{titulo}</h2>
            {descripcion ? <p className="ayuda mt-0.5">{descripcion}</p> : null}
          </div>
          {acciones}
        </div>
      ) : null}
      {children}
    </section>
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
  placeholder,
}: {
  etiqueta: string;
  ayuda?: ReactNode;
  valor: string;
  alGuardar: (v: string) => void;
  textoBoton?: string;
  placeholder?: string;
}) {
  const [texto, setTexto] = useState(valor);
  const sucio = texto !== valor;

  return (
    <label className="block">
      <span className="etiqueta mb-2 block">{etiqueta}</span>
      <div className="flex gap-2">
        <input
          className="campo"
          value={texto}
          placeholder={placeholder}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sucio && alGuardar(texto)}
        />
        {sucio ? (
          <button type="button" className="boton-laton" onClick={() => alGuardar(texto)}>
            <Check className="h-5 w-5" />
            {textoBoton}
          </button>
        ) : null}
      </div>
      {ayuda ? <span className="ayuda mt-2 block">{ayuda}</span> : null}
    </label>
  );
}

/** Campo de formulario simple, con su etiqueta y su ayuda. */
export function Campo({
  etiqueta,
  ayuda,
  children,
  opcional = false,
}: {
  etiqueta: string;
  ayuda?: ReactNode;
  children: ReactNode;
  opcional?: boolean;
}) {
  return (
    <label className="block">
      <span className="etiqueta mb-2 block">
        {etiqueta}
        {opcional ? <span className="font-normal text-tinta/40"> · opcional</span> : null}
      </span>
      {children}
      {ayuda ? <span className="ayuda mt-2 block">{ayuda}</span> : null}
    </label>
  );
}

/** Grupo de opciones excluyentes, del tamaño de un dedo. */
export function Segmentado<T extends string | number>({
  opciones,
  valor,
  alCambiar,
}: {
  opciones: readonly { id: T; texto: string; icono?: LucideIcon }[];
  valor: T;
  alCambiar: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-linea bg-white p-1">
      {opciones.map((o) => {
        const Icono = o.icono;
        const activo = o.id === valor;
        return (
          <button
            key={String(o.id)}
            type="button"
            onClick={() => alCambiar(o.id)}
            className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[0.95rem] font-semibold transition-colors ${
              activo ? "bg-tinta text-white" : "text-tinta/60 hover:text-tinta"
            }`}
          >
            {Icono ? <Icono className="h-4 w-4" /> : null}
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

/** Casilla con título y explicación. */
export function Casilla({
  marcada,
  alCambiar,
  titulo,
  children,
}: {
  marcada: boolean;
  alCambiar: (v: boolean) => void;
  titulo: string;
  children?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-4 rounded-xl border border-linea p-4 transition-colors hover:bg-hueso">
      <input
        type="checkbox"
        className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer accent-tinta"
        checked={marcada}
        onChange={(e) => alCambiar(e.target.checked)}
      />
      <span>
        <span className="block font-semibold">{titulo}</span>
        {children ? <span className="ayuda mt-1 block">{children}</span> : null}
      </span>
    </label>
  );
}

/** Pastilla de estado. */
export function Pastilla({
  tono = "neutro",
  children,
}: {
  tono?: "neutro" | "bien" | "mal" | "aviso" | "laton";
  children: ReactNode;
}) {
  const tonos = {
    neutro: "bg-hueso-hondo text-tinta/70",
    bien: "bg-bien/10 text-bien",
    mal: "bg-mal/10 text-mal",
    aviso: "bg-aviso/10 text-aviso",
    laton: "bg-laton-claro text-laton-oscuro",
  };
  return <span className={`pastilla ${tonos[tono]}`}>{children}</span>;
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
