#!/usr/bin/env python3
"""
Reduce el logo a un tamaño servible por correo, y lo escribe como módulo
TypeScript con el PNG embebido en base64.

El problema: `marca/logo-cupula-negro.png` pesa 2 MB a 8152 px. Meterlo así en
un correo HTML infla el mensaje, hace lento el render en el teléfono y es la
clase de cosa que un filtro de spam penaliza. Un logo de cabecera de correo no
necesita más resolución que la que se ve en pantalla.

Qué hace este script:

  1. Reduce con LANCZOS al ancho pedido (por defecto 480 px: se ve nítido en
     retina mostrado a ~240 px de ancho en el correo, sin pesar de más).
  2. Conserva el canal alfa (el logo es transparente) para que se vea bien
     tanto en fondo blanco como en cualquier otro.
  3. Lo escribe como módulo TypeScript, igual que `logoTermico.ts`: embebido
     en el bundle, no como archivo aparte que se pueda perder al empaquetar o
     desplegar.

Uso:  python3 herramientas/generar-logo-correo.py [ancho]
"""

import base64
import sys
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "marca" / "logo-cupula-negro.png"
DESTINO = RAIZ / "apps" / "servidor" / "src" / "adaptadores" / "correo" / "logoCupula.ts"

ANCHO = int(sys.argv[1]) if len(sys.argv) > 1 else 480


def main() -> None:
    imagen = Image.open(ORIGEN).convert("RGBA")
    alto = round(imagen.height * ANCHO / imagen.width)
    reducida = imagen.resize((ANCHO, alto), Image.LANCZOS)

    buffer_png = RAIZ / "_logo_correo_tmp.png"
    reducida.save(buffer_png, format="PNG", optimize=True)
    datos_b64 = base64.b64encode(buffer_png.read_bytes()).decode("ascii")
    buffer_png.unlink()

    DESTINO.write_text(
        f'''/**
 * Logo de La Cúpula para el correo. GENERADO — no editar a mano.
 *
 * Regenerar con:  python3 herramientas/generar-logo-correo.py [ancho]
 *
 * {ANCHO} x {alto} px, PNG con transparencia, reducido del original de
 * {imagen.width} px (`marca/logo-cupula-negro.png`).
 *
 * Va embebido en el bundle y no como archivo aparte por la misma razón que
 * `logoTermico.ts`: en producción no hay una carpeta de recursos que se
 * pueda perder al copiar la instalación a otra máquina o desplegar en la nube.
 */

export const LOGO_CORREO_PNG_BASE64 =
  "{datos_b64}";

export const LOGO_CORREO_ANCHO = {ANCHO};
export const LOGO_CORREO_ALTO = {alto};
''',
        encoding="utf8",
    )
    print(f"Escrito {DESTINO} ({ANCHO}x{alto}, {len(datos_b64)} caracteres base64)")


if __name__ == "__main__":
    main()
