#!/usr/bin/env python3
"""
Genera los íconos de la PWA a partir del logo original.

El logo (`marca/logo-cupula-negro.png`) es un emblema negro sobre transparente
de 8152x7631. Para íconos de aplicación se hacen dos cosas:

  1. Se recorta el margen transparente, que es enorme y desperdicia el área
     visible del ícono en la pantalla de inicio.
  2. Se invierte: el trazo va en BLANCO sobre fondo NEGRO. Un logo negro sobre
     fondo claro desaparece contra el tema oscuro del sistema, y al revés. Un
     fondo propio y opaco se ve igual en los dos.

El ícono `maskable` lleva más aire alrededor porque Android le recorta las
esquinas —hasta un 20% del borde— y sin ese margen el emblema sale mutilado.

Uso:  python3 herramientas/generar-iconos.py
"""

from pathlib import Path
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "marca" / "logo-cupula-negro.png"
DESTINO = RAIZ / "apps" / "pwa" / "public" / "iconos"

NEGRO = (11, 11, 11)          # la tinta de la identidad
HUESO = (245, 241, 232)       # el fondo claro


def marca_blanca(logo: Image.Image) -> Image.Image:
    """El trazo del logo en blanco, conservando la transparencia original."""
    alfa = logo.getchannel("A")
    blanco = Image.new("RGBA", logo.size, (255, 255, 255, 0))
    blanco.putalpha(alfa)
    return blanco


def recortar(img: Image.Image) -> Image.Image:
    caja = img.getchannel("A").getbbox()
    return img.crop(caja) if caja else img


def componer(marca: Image.Image, lado: int, fondo, margen: float) -> Image.Image:
    """Centra la marca sobre un cuadrado opaco dejando `margen` de aire."""
    lienzo = Image.new("RGBA", (lado, lado), (*fondo, 255))
    util = int(lado * (1 - 2 * margen))

    escala = min(util / marca.width, util / marca.height)
    tamano = (max(1, round(marca.width * escala)), max(1, round(marca.height * escala)))
    ajustada = marca.resize(tamano, Image.LANCZOS)

    lienzo.paste(
        ajustada,
        ((lado - tamano[0]) // 2, (lado - tamano[1]) // 2),
        ajustada,
    )
    return lienzo


def main() -> None:
    if not ORIGEN.exists():
        raise SystemExit(f"No está el logo en {ORIGEN}")

    DESTINO.mkdir(parents=True, exist_ok=True)
    marca = recortar(marca_blanca(Image.open(ORIGEN).convert("RGBA")))
    negra = recortar(Image.open(ORIGEN).convert("RGBA"))

    salidas = [
        # (archivo, lado, fondo, margen)
        ("icono-192.png", 192, NEGRO, 0.08),
        ("icono-512.png", 512, NEGRO, 0.08),
        # Android recorta hasta el 20% del borde: más aire o pierde el emblema.
        ("icono-maskable-512.png", 512, NEGRO, 0.22),
        ("apple-touch-icon.png", 180, NEGRO, 0.08),
        ("favicon-32.png", 32, NEGRO, 0.04),
    ]

    for archivo, lado, fondo, margen in salidas:
        componer(marca, lado, fondo, margen).convert("RGB").save(DESTINO / archivo, optimize=True)
        print(f"  {archivo}  {lado}x{lado}")

    # El emblema completo para la pantalla de la app (encabezado, portada del
    # arqueo). En blanco y en negro: según sobre qué fondo se lo ponga.
    ancho = 1024
    for nombre, fuente in (("emblema-blanco.png", marca), ("emblema-negro.png", negra)):
        escala = ancho / fuente.width
        fuente.resize((ancho, round(fuente.height * escala)), Image.LANCZOS).save(
            DESTINO / nombre, optimize=True
        )
        print(f"  {nombre}  {ancho}px de ancho")

    print(f"\nGenerados en {DESTINO}")


if __name__ == "__main__":
    main()
