/**
 * Normalización de texto. Vive en contratos porque el servidor y la PWA tienen
 * que normalizar EXACTAMENTE igual: si el índice de clientes se arma con una
 * regla y la búsqueda con otra, el cliente existe y no aparece.
 *
 * El caso que obliga a esto: el QR de la tarjeta de fidelidad de La Cúpula
 * lleva el NOMBRE del cliente en texto plano, y la pistola lo teclea. Si la
 * pistola está configurada con layout US y la PC en español, los acentos
 * llegan rotos. "José Ramírez", "JOSE RAMIREZ" y "Jose  Ramirez" tienen que
 * ser el mismo cliente.
 */

/**
 * Minúsculas, sin acentos, sin signos, espacios colapsados.
 * Es la clave con la que se indexa y se busca. No sirve para mostrar.
 */
export function normalizar(s: string): string {
  return (
    s
      .normalize("NFD") // "é" → "e" + U+0301 (tilde suelta)
      .replace(/[\u0300-\u036f]/g, "") // borra las marcas combinantes
      .toLowerCase()
      // La "ñ" también se descompone y termina como "n". Es intencional:
      // quien escribe "Munoz" buscando a "Muñoz" tiene que encontrarlo.
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * ¿`termino` aparece en `texto`? Compara normalizado y por palabras sueltas,
 * de modo que "deg" encuentre "CORTE DEGRADADO" y "cor deg" también.
 */
export function coincide(texto: string, termino: string): boolean {
  const t = normalizar(texto);
  const palabras = normalizar(termino).split(" ").filter(Boolean);
  if (palabras.length === 0) return false;
  return palabras.every((p) => t.includes(p));
}
