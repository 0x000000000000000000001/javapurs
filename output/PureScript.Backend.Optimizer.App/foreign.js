/**
 * Point d'Entrée JS (App.js)
 * FFI JavaScript pour le CLI de l'optimiseur. Il gère l'interface avec le système d'exploitation (lecture asynchrone des fichiers du système, etc.) pour alimenter App.purs.
 */

// Ours
export const stringify = function(version) {
  return function(obj) {
    return JSON.stringify({ v: version, d: obj });
  };
};

export const parseImpl = function(just) {
  return function(nothing) {
    return function(expectedVersion) {
      return function(str) {
        try {
          const parsed = JSON.parse(str);
          if (parsed && parsed.v === expectedVersion) {
            return just(parsed.d);
          }
          return nothing;
        } catch (e) {
          return nothing;
        }
      };
    };
  };
};
