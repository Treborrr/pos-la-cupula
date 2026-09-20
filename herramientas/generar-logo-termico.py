#!/usr/bin/env python3
"""
Convierte el logo a la versión que sabe imprimir una ticketera térmica.

El problema: `marca/logo-cupula-negro.png` es un emblema vintage de 8152 px con
filigranas, dos arcos de texto y "SINCE 2020" en microtipografía. Una impresora
térmica imprime a 203 dpi, SIN escala de grises: cada punto es negro o blanco,
nada en el medio. Reducir ese detalle a 576 puntos y umbralizarlo empasta el
ojo del domo y borra el texto chico. Es física del papel, no un problema de
software.

Qué hace este script:

  1. Recorta el margen transparente.
  2. Reduce con LANCZOS al ancho pedido (por defecto 384 puntos, no 576: a
     dos tercios del ancho del papel el trazo queda más grueso en proporción y
     sobrevive mejor al umbral).
  3. Aplica **dithering de Atkinson**, que es el que mejor rinde en térmica.
     Floyd-Steinberg reparte el error entre todos los vecinos y ensucia las
     zonas claras con puntos sueltos; Atkinson reparte solo 6/8 del error y
     deja los blancos limpios y los negros sólidos, que es justo lo que
     necesita un emblema de line art.
  4. Empaqueta a 1 bit por punto en el formato que espera `GS v 0`, y lo
     escribe como módulo TypeScript para que el bundler lo incluya: imprimir
     el logo termina siendo copiar un buffer, sin procesar nada en cada venta.

Genera además un PNG de control para mirar cómo va a salir ANTES de gastar
papel.

Uso:  python3 herramientas/generar-logo-termico.py [ancho]
"""

import base64
import sys
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "marca" / "logo-cupula-negro.png"
DESTINO_TS = RAIZ / "apps" / "servidor" / "src" / "adaptadores" / "impresora" / "logoTermico.ts"
DESTINO_VISTA = RAIZ / "marca" / "logo-termico-vista-previa.png"

ANCHO = int(sys.argv[1]) if len(sys.argv) > 1 else 384


def recortar(img: Image.Image) -> Image.Image:
    caja = img.getchannel("A").getbbox()
    return img.crop(caja) if caja else img


def a_gris_sobre_blanco(img: Image.Image) -> Image.Image:
    """El logo es negro sobre transparente; el papel es blanco."""
    fondo = Image.new("RGBA", img.size, (255, 255, 255, 255))
    fondo.paste(img, (0, 0), img)
    return fondo.convert("L")


def atkinson(img: Image.Image) -> Image.Image:
    """
    Dithering de Atkinson. Reparte 1/8 del error a seis vecinos (6/8 del total,
    el resto se descarta), lo que sube el contraste y deja los blancos limpios.
    Es el algoritmo del Macintosh original y sigue siendo el mejor para line
    art en blanco y negro puro.
    """
    ancho, alto = img.size
    pix = [[float(v) for v in fila] for fila in _filas(img)]

    for y in range(alto):
        for x in range(ancho):
            viejo = pix[y][x]
            nuevo = 255.0 if viejo >= 128 else 0.0
            pix[y][x] = nuevo
            error = (viejo - nuevo) / 8.0

            for dx, dy in ((1, 0), (2, 0), (-1, 1), (0, 1), (1, 1), (0, 2)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < ancho and 0 <= ny < alto:
                    pix[ny][nx] += error

    salida = Image.new("1", (ancho, alto))
    salida.putdata([1 if pix[y][x] >= 128 else 0 for y in range(alto) for x in range(ancho)])
    return salida


def _filas(img: Image.Image):
    datos = list(img.getdata())
    ancho = img.size[0]
    return [datos[i * ancho : (i + 1) * ancho] for i in range(img.size[1])]


def empaquetar(img: Image.Image) -> bytes:
    """1 bit por punto, 8 por byte, fila por fila. Bit en 1 = punto negro."""
    ancho, alto = img.size
    bytes_por_fila = (ancho + 7) // 8
    salida = bytearray(bytes_por_fila * alto)
    pixeles = img.load()

    for y in range(alto):
        for x in range(ancho):
            if pixeles[x, y] == 0:  # negro en modo "1"
                salida[y * bytes_por_fila + (x >> 3)] |= 0x80 >> (x & 7)

    return bytes(salida)


def main() -> None:
    if not ORIGEN.exists():
        raise SystemExit(f"No está el logo en {ORIGEN}")

    original = recortar(Image.open(ORIGEN).convert("RGBA"))
    escala = ANCHO / original.width
    alto = round(original.height * escala)

    gris = a_gris_sobre_blanco(original.resize((ANCHO, alto), Image.LANCZOS))

    # Un poco de contraste antes de umbralizar: el LANCZOS deja los trazos
    # finos en gris medio y, sin esto, el dithering los convierte en puntitos
    # sueltos en vez de en líneas.
    from PIL import ImageEnhance

    gris = ImageEnhance.Contrast(gris).enhance(1.6)

    mono = atkinson(gris)
    datos = empaquetar(mono)

    # Vista previa ampliada x2, para poder juzgarla en pantalla sin imprimir.
    mono.convert("L").resize((ANCHO * 2, alto * 2), Image.NEAREST).save(DESTINO_VISTA)

    DESTINO_TS.write_text(
        f'''/**
 * Logo de La Cúpula listo para la ticketera. GENERADO — no editar a mano.
 *
 * Regenerar con:  python3 herramientas/generar-logo-termico.py [ancho]
 *
 * {ANCHO} x {alto} puntos, 1 bit por punto, empaquetado para `GS v 0`.
 * Dithering de Atkinson sobre el logo original de {original.width} px.
 *
 * Va embebido como base64 en vez de como archivo aparte para que el
 * empaquetador lo incluya en el bundle: en producción no hay una carpeta de
 * recursos que se pueda perder al copiar la instalación a otra máquina.
 */

export const LOGO_TERMICO = {{
  ancho: {ANCHO},
  alto: {alto},
  datos: Buffer.from(
    "{base64.b64encode(datos).decode()}",
    "base64",
  ),
}};
''',
        encoding="utf-8",
    )

    print(f"Logo térmico: {ANCHO} x {alto} puntos, {len(datos)} bytes")
    print(f"  módulo TS:    {DESTINO_TS.relative_to(RAIZ)}")
    print(f"  vista previa: {DESTINO_VISTA.relative_to(RAIZ)}  (ampliada x2)")


if __name__ == "__main__":
    main()
