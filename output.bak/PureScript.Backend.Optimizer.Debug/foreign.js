/**
 * Profilage JS (Debug.js)
 * Implémente le binding bas niveau JavaScript pour la fonction 'time' de Debug.purs. Utilise l'API de performance de Node.js (console.time) pour mesurer précisément la durée d'exécution des différentes passes du compilateur.
 */

export const time_ = name => k => {
  console.time(name);
  const res = k();
  console.timeEnd(name);
  return res;
};

export const traceImpl = a => k => {
  console.dir(a, { depth: null });
  return k();
};
