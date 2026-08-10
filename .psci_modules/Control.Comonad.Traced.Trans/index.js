// | This module defines the cowriter comonad transformer, `TracedT`.
import * as Control_Comonad from "../Control.Comonad/index.js";
import * as Control_Extend from "../Control.Extend/index.js";
import * as Data_Functor from "../Data.Functor/index.js";
import * as Data_Monoid from "../Data.Monoid/index.js";
import * as Data_Semigroup from "../Data.Semigroup/index.js";

// | The cowriter comonad transformer.
// |
// | This comonad transformer extends the context of a value in the base comonad so that the value
// | depends on a monoidal position of type `t`.
// |
// | The `ComonadTraced` type class describes the operations supported by this comonad.
var TracedT = function (x) {
    return x;
};

// | Unwrap a value in the `TracedT` comonad.
var runTracedT = function (v) {
    return v;
};
var newtypeTracedT = {
    Coercible0: function () {
        return undefined;
    }
};
var functorTracedT = function (dictFunctor) {
    var map = Data_Functor.map(dictFunctor);
    return {
        map: function (f) {
            return function (v) {
                return map(function (g) {
                    return function (t) {
                        return f(g(t));
                    };
                })(v);
            };
        }
    };
};
var extendTracedT = function (dictExtend) {
    var extend = Control_Extend.extend(dictExtend);
    var Functor0 = dictExtend.Functor0();
    var map = Data_Functor.map(Functor0);
    var functorTracedT1 = functorTracedT(Functor0);
    return function (dictSemigroup) {
        var append = Data_Semigroup.append(dictSemigroup);
        return {
            extend: function (f) {
                return function (v) {
                    return extend(function (w$prime) {
                        return function (t) {
                            return f(map(function (h) {
                                return function (t$prime) {
                                    return h(append(t)(t$prime));
                                };
                            })(w$prime));
                        };
                    })(v);
                };
            },
            Functor0: function () {
                return functorTracedT1;
            }
        };
    };
};
var comonadTransTracedT = function (dictMonoid) {
    var mempty = Data_Monoid.mempty(dictMonoid);
    return {
        lower: function (dictComonad) {
            var map = Data_Functor.map((dictComonad.Extend0()).Functor0());
            return function (v) {
                return map(function (f) {
                    return f(mempty);
                })(v);
            };
        }
    };
};
var comonadTracedT = function (dictComonad) {
    var extract = Control_Comonad.extract(dictComonad);
    var extendTracedT1 = extendTracedT(dictComonad.Extend0());
    return function (dictMonoid) {
        var mempty = Data_Monoid.mempty(dictMonoid);
        var extendTracedT2 = extendTracedT1(dictMonoid.Semigroup0());
        return {
            extract: function (v) {
                return extract(v)(mempty);
            },
            Extend0: function () {
                return extendTracedT2;
            }
        };
    };
};
export {
    TracedT,
    runTracedT,
    newtypeTracedT,
    functorTracedT,
    extendTracedT,
    comonadTracedT,
    comonadTransTracedT
};
