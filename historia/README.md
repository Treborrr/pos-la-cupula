# Historia

Lo que sobrevive de versiones anteriores a que el proyecto tuviera control de
versiones. **No se compila ni se instala**: está acá para poder mirar atrás.

De la v0.2.0 en adelante esta carpeta deja de crecer — cada versión es una
etiqueta de git y se recupera con `git checkout v0.2.0`.

## v0.1.0

La primera versión completa, instalada en la barbería en septiembre de 2026.

### Qué hay

| | |
|---|---|
| `entrega/` | los scripts de instalación y la documentación tal como se entregaron |
| `pwa-fuente/` | el código de la interfaz, con sus `package.json`, `vite.config.ts` y `tsconfig.json` |

`INSTRUCCIONES-ROBERT.txt` es la guía técnica escrita a mano para la
instalación en sitio. No la generaba el empaquetador, así que esta es la única
copia.

### Qué NO hay, y por qué importa

**El código del servidor v0.1.0 se perdió.** No es que no se haya guardado acá:
ya no existía cuando el proyecto llegó a tener git. Lo que había era el
ejecutable, y de ahí se extrajo el bundle que se portó a TypeScript para armar
la v0.2.0.

**Los binarios (`pos-cupula.exe`, `nssm.exe`) tampoco.** Son artefactos de
compilación, pesan 60 MB y en git quedarían para siempre. El `.exe` de la v0.1.0
es irreproducible —su código fuente es justamente lo que falta— pero está
superado: la v0.2.0 lee los mismos datos sin migración, porque el formato de
los eventos no cambió.

### La lección

Esta carpeta existe porque el código no viajaba con la entrega. Por eso ahora:

- el repositorio tiene git y cada versión lleva su etiqueta;
- el USB incluye `_codigo-fuente/` con el proyecto completo;
- el `.exe` se regenera con `node herramientas/empaquetar-windows.mjs` en vez de
  parchearse poniéndole un `servidor.js` al lado.
