/**
 * @cupula/contratos — el vocabulario compartido entre el servidor y la PWA.
 *
 * Todo lo que cruce la red o se escriba en disco está definido aquí, una sola
 * vez. Si el front y el servidor tuvieran cada uno su propia copia de los
 * tipos, la primera divergencia aparecería en producción, no en el editor.
 */

export * from "./dinero";
export * from "./eventos";
export * from "./texto";
export * from "./upcasters";
