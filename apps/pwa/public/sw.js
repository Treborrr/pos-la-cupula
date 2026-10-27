/*
 * Service worker del POS.
 *
 * Escrito a mano y a propósito corto: hace falta que se entienda de una
 * lectura, porque un service worker mal hecho sirve una versión vieja de la
 * aplicación durante días y nadie sabe por qué.
 *
 * LO QUE NO HACE, Y ES DELIBERADO: no guarda datos. Nada de ventas en
 * IndexedDB, nada de cola de cobros pendientes. El servidor vive en la MISMA
 * máquina; si no responde, no es que "no hay internet", es que el POS está
 * apagado, y en ese caso la respuesta correcta es decirlo con todas las letras
 * en vez de aceptar cobros que después no van a estar. Un POS que miente sobre
 * si guardó es peor que uno que no arranca.
 *
 * Lo único que cachea es el armazón de la interfaz, para que abra al instante.
 */

/**
 * Subir este número BORRA el caché viejo de todos los navegadores: `activate`
 * elimina cualquier caché cuyo nombre no sea el actual.
 *
 * Se sube a v2 a propósito. Mientras los íconos faltaban en el despliegue, el
 * servidor respondía el `index.html` para esas rutas (200, no 404), así que el
 * caché guardó una página HTML bajo la URL del logo y la servía para siempre.
 * Sin cambiar el nombre, esa entrada envenenada sobreviviría en el navegador
 * de cada persona aunque el servidor ya responda bien.
 */
const VERSION = "v2";
const CACHE = `cupula-${VERSION}`;

// Lo mínimo para que la aplicación pinte algo. Los bundles con hash se cachean
// solos en tiempo de ejecución, así que no hay que mantener esta lista.
const ARMAZON = [
  "/",
  "/manifest.webmanifest",
  "/iconos/icono-192.png",
  "/iconos/icono-512.png",
  "/iconos/emblema-blanco.png",
];

/**
 * Las rutas que NO se pueden cachear para siempre.
 *
 * El caché permanente es correcto para los bundles de Vite porque llevan un
 * hash en el nombre: contenido nuevo, nombre nuevo. Las fotos de catálogo no:
 * se llaman `<id-del-ítem>.jpg` y ese nombre no cambia nunca. Al cambiarle la
 * foto a un producto, el servidor la pisa pero la URL sigue igual, así que el
 * caché seguía devolviendo la anterior para siempre. Subir la primera foto
 * funcionaba; cambiarla parecía roto.
 */
function llevaHashEnElNombre(url) {
  return !url.pathname.startsWith("/fotos/");
}

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        /**
         * Uno por uno, y sin que un fallo tumbe la instalación entera.
         *
         * Era `addAll`, que es todo-o-nada: mientras `emblema-blanco.png`
         * faltaba en el despliegue, la instalación del service worker fallaba
         * ENTERA y la aplicación se quedaba sin caché de arranque, en silencio
         * y por un archivo que no es crítico. Lo único que de verdad hace falta
         * es `/`, y si eso falla no hay nada que cachear igual.
         */
        Promise.all(
          ARMAZON.map((ruta) =>
            c.add(ruta).catch((e) => {
              if (ruta === "/") throw e;
              return undefined;
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evento) => {
  const peticion = evento.request;
  if (peticion.method !== "GET") return;

  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;

  // El API NUNCA se cachea. Ni con "stale-while-revalidate", ni por un
  // segundo: mostrar un stock o un arqueo viejos como si fueran actuales es
  // peor que mostrar un error.
  if (url.pathname.startsWith("/api/")) return;

  // Navegación: red primero para tomar la versión nueva apenas se despliega,
  // con el caché como red de contención si el servidor está apagado.
  if (peticion.mode === "navigate") {
    evento.respondWith(
      fetch(peticion)
        .then((respuesta) => {
          const copia = respuesta.clone();
          caches.open(CACHE).then((c) => c.put("/", copia));
          return respuesta;
        })
        .catch(() => caches.match("/").then((r) => r ?? Response.error())),
    );
    return;
  }

  /**
   * Lo que no lleva hash en el nombre va a la RED primero, con el caché solo
   * como red de contención si el servidor no responde. Es la misma regla que
   * ya se aplica a la navegación, y por el mismo motivo: servir una versión
   * vieja de algo que cambió es peor que no servir nada.
   */
  if (!llevaHashEnElNombre(url)) {
    evento.respondWith(
      fetch(peticion)
        .then((respuesta) => {
          if (respuesta.ok && respuesta.type === "basic") {
            const copia = respuesta.clone();
            caches.open(CACHE).then((c) => c.put(peticion, copia));
          }
          return respuesta;
        })
        .catch(() => caches.match(peticion).then((r) => r ?? Response.error())),
    );
    return;
  }

  // Assets con hash en el nombre: el caché es siempre válido.
  evento.respondWith(
    caches.match(peticion).then(
      (guardada) =>
        guardada ??
        fetch(peticion).then((respuesta) => {
          if (respuesta.ok && respuesta.type === "basic") {
            const copia = respuesta.clone();
            caches.open(CACHE).then((c) => c.put(peticion, copia));
          }
          return respuesta;
        }),
    ),
  );
});
