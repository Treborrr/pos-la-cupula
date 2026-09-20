#!/usr/bin/env python3
"""
Extrae el catálogo del Excel viejo y lo deja listo para cargar en el POS.

Hace tres cosas que no son obvias:

  1. SEPARA lo que es de la barbería de lo que no. El archivo traía la carta
     completa de una cevichería (ceviches, tacu tacu, makis, chilcanos) que no
     corresponde a este negocio: el ticket dice "LA CÚPULA TATTOO BARBER SHOP"
     y el registro de ventas real solo tiene cortes y barba.

  2. DETECTA los códigos repetidos. En el Excel había tres (`LANG`, `CEVC`,
     `MENU`) y eso volvía invendibles a tres productos, porque la búsqueda
     devolvía siempre el primero. Nadie se había dado cuenta.

  3. Convierte los precios a CÉNTIMOS ENTEROS, que es como los maneja el POS.

Uso:  python3 herramientas/extraer-catalogo-excel.py
Sale: datos-ejemplo/catalogo-del-excel.json
"""

import json
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
EXCEL = RAIZ / "NOTA DE VENTA CUPULA.xlsm"
SALIDA = RAIZ / "datos-ejemplo" / "catalogo-del-excel.json"

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# Lo que de verdad es de una barbería / estudio de tatuajes. El resto de la
# lista es carta de restaurante y no se migra.
PALABRAS_DE_BARBERIA = (
    "corte",
    "barba",
    "ceja",
    "afeitado",
    "tatuaje",
    "tattoo",
    "piercing",
    "perforacion",
    "mascarilla",
    "lavado",
    "peinado",
    "tinte",
    "decoloracion",
)


def sin_acentos(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn"
    )


def leer_hoja_de_control(z: zipfile.ZipFile):
    """La tabla `Item` vive en B3:D82 de la hoja 'Datos de control' (sheet1)."""
    compartidas = [
        "".join(t.text or "" for t in si.iter(NS + "t"))
        for si in ET.fromstring(z.read("xl/sharedStrings.xml"))
    ]

    filas = {}
    for fila in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).find(NS + "sheetData"):
        n = int(fila.get("r"))
        celdas = {}
        for c in fila:
            col = re.sub(r"\d", "", c.get("r"))
            v = c.find(NS + "v")
            if v is None:
                continue
            celdas[col] = compartidas[int(v.text)] if c.get("t") == "s" else v.text
        filas[n] = celdas

    items = []
    for n in sorted(filas):
        if n < 3:
            continue  # 1 y 2 son títulos y encabezados
        celdas = filas[n]
        codigo, nombre, precio = celdas.get("B"), celdas.get("C"), celdas.get("D")
        if not (codigo and nombre and precio):
            continue
        limpio = codigo.strip().upper()
        items.append(
            {
                "fila": n,
                "codigoOriginal": limpio,
                # Los espacios pasan a guion: "COR D" → "COR-D". Un código con
                # espacio se teclea mal, se escanea peor y en el registro del
                # Excel ya convivían "COR D" y "cor d" como si fueran cosas
                # distintas. El POS exige códigos sin espacios por eso.
                "codigo": re.sub(r"\s+", "-", limpio),
                "nombre": nombre.strip(),
                # A céntimos enteros: el POS no maneja decimales en dinero.
                "precio": round(float(precio) * 100),
            }
        )
    return items


def main() -> None:
    if not EXCEL.exists():
        raise SystemExit(f"No está el Excel en {EXCEL}")

    with zipfile.ZipFile(EXCEL) as z:
        todos = leer_hoja_de_control(z)

    de_barberia, descartados = [], []
    for item in todos:
        nombre = sin_acentos(item["nombre"])
        (de_barberia if any(p in nombre for p in PALABRAS_DE_BARBERIA) else descartados).append(item)

    # Códigos repetidos, mirados sobre la lista COMPLETA: es donde estaba el daño.
    vistos, repetidos = {}, {}
    for item in todos:
        vistos.setdefault(item["codigo"], []).append(item)
    for codigo, lista in vistos.items():
        if len(lista) > 1:
            repetidos[codigo] = [{"fila": i["fila"], "nombre": i["nombre"], "precio": i["precio"]} for i in lista]

    salida = {
        "origen": EXCEL.name,
        "resumen": {
            "itemsEnElExcel": len(todos),
            "deBarberia": len(de_barberia),
            "descartados": len(descartados),
            "codigosRepetidos": len(repetidos),
        },
        "codigosRepetidos": repetidos,
        "items": [
            {
                "codigo": i["codigo"],
                "nombre": i["nombre"],
                "tipo": "SERVICIO",
                "categoria": "Barbería",
                "precio": i["precio"],
                "orden": n * 10,
            }
            for n, i in enumerate(de_barberia)
        ],
        "descartados": [{"codigo": i["codigo"], "nombre": i["nombre"]} for i in descartados],
    }

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(json.dumps(salida, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Ítems en el Excel:      {len(todos)}")
    print(f"De barbería (se migran): {len(de_barberia)}")
    for i in de_barberia:
        renombrado = "" if i["codigo"] == i["codigoOriginal"] else f"  (era «{i['codigoOriginal']}»)"
        print(f"    {i['codigo']:10} {i['nombre']:22} S/ {i['precio'] / 100:>6.2f}{renombrado}")
    print(f"Descartados (carta de cevichería ajena al negocio): {len(descartados)}")

    if repetidos:
        print(f"\nCódigos REPETIDOS en el Excel ({len(repetidos)}):")
        for codigo, lista in repetidos.items():
            print(f"    {codigo}:")
            for i in lista:
                print(f"        fila {i['fila']:3}  {i['nombre']}")
        print("    → El segundo de cada par era invendible: la búsqueda devolvía siempre el primero.")

    print(f"\nEscrito en {SALIDA.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
