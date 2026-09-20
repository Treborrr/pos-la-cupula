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

const VERSION = "v1";
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

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ARMAZON)).then(() => self.skipWaiting()),
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
