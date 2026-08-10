import * as Control_Applicative from "../Control.Applicative/index.js";
import * as Control_Apply from "../Control.Apply/index.js";
import * as Control_Bind from "../Control.Bind/index.js";
import * as Control_Monad_Gen from "../Control.Monad.Gen/index.js";
import * as Control_Monad_Gen_Class from "../Control.Monad.Gen.Class/index.js";
import * as Data_Either from "../Data.Either/index.js";
import * as Data_Functor from "../Data.Functor/index.js";
import * as Data_Identity from "../Data.Identity/index.js";
import * as Data_Maybe from "../Data.Maybe/index.js";
import * as Data_NonEmpty from "../Data.NonEmpty/index.js";
import * as Data_Ord from "../Data.Ord/index.js";
import * as Data_Tuple from "../Data.Tuple/index.js";
var max = /* #__PURE__ */ Data_Ord.max(Data_Ord.ordInt);

// | Creates a generator that outputs `Tuple` values, choosing values from a
// | pair of generators for each slot in the tuple.
var genTuple = function (dictApply) {
    return Control_Apply.lift2(dictApply)(Data_Tuple.Tuple.create);
};

// | Creates a generator that outputs `NonEmpty` values, choosing values from a
// | generator for each of the items.
// |
// | The size of the value will be determined by the current size state
// | for the generator. To generate a value of a particular size, use the
// | `resize` function from the `MonadGen` class first.
var genNonEmpty = function (dictMonadRec) {
    var unfoldable = Control_Monad_Gen.unfoldable(dictMonadRec);
    return function (dictMonadGen) {
        var Apply0 = ((dictMonadGen.Monad0()).Bind1()).Apply0();
        var apply = Control_Apply.apply(Apply0);
        var map = Data_Functor.map(Apply0.Functor0());
        var resize = Control_Monad_Gen_Class.resize(dictMonadGen);
        var unfoldable1 = unfoldable(dictMonadGen);
        return function (dictUnfoldable) {
            var unfoldable2 = unfoldable1(dictUnfoldable);
            return function (gen) {
                return apply(map(Data_NonEmpty.NonEmpty.create)(gen))(resize((function () {
                    var $46 = max(0);
                    return function ($47) {
                        return $46((function (v) {
                            return v - 1 | 0;
                        })($47));
                    };
                })())(unfoldable2(gen)));
            };
        };
    };
};

// | Creates a generator that outputs `Maybe` values, choosing a value from
// | another generator for the inner value, with an adjustable bias for how
// | often `Just` is returned vs `Nothing`. A bias ≤ 0.0 will always
// | return `Nothing`, a bias ≥ 1.0 will always return `Just`.
var genMaybe$prime = function (dictMonadGen) {
    var Monad0 = dictMonadGen.Monad0();
    var Bind1 = Monad0.Bind1();
    var bind = Control_Bind.bind(Bind1);
    var chooseFloat = Control_Monad_Gen_Class.chooseFloat(dictMonadGen);
    var map = Data_Functor.map((Bind1.Apply0()).Functor0());
    var pure = Control_Applicative.pure(Monad0.Applicative0());
    return function (bias) {
        return function (gen) {
            return bind(chooseFloat(0.0)(1.0))(function (n) {
                var $44 = n < bias;
                if ($44) {
                    return map(Data_Maybe.Just.create)(gen);
                };
                return pure(Data_Maybe.Nothing.value);
            });
        };
    };
};

// | Creates a generator that outputs `Maybe` values, choosing a value from
// | another generator for the inner value. The generator has a 75% chance of
// | returning a `Just` over a `Nothing`.
var genMaybe = function (dictMonadGen) {
    return genMaybe$prime(dictMonadGen)(0.75);
};

// | Creates a generator that outputs `Identity` values, choosing a value from
// | another generator for the inner value.
var genIdentity = function (dictFunctor) {
    return Data_Functor.map(dictFunctor)(Data_Identity.Identity);
};

// | Creates a generator that outputs `Either` values, choosing a value from a
// | `Left` or the `Right` with adjustable bias. As the bias value increases,
// | the chance of returning a `Left` value rises. A bias ≤ 0.0 will always
// | return `Right`, a bias ≥ 1.0 will always return `Left`.
var genEither$prime = function (dictMonadGen) {
    var Bind1 = (dictMonadGen.Monad0()).Bind1();
    var bind = Control_Bind.bind(Bind1);
    var chooseFloat = Control_Monad_Gen_Class.chooseFloat(dictMonadGen);
    var map = Data_Functor.map((Bind1.Apply0()).Functor0());
    return function (bias) {
        return function (genA) {
            return function (genB) {
                return bind(chooseFloat(0.0)(1.0))(function (n) {
                    var $45 = n < bias;
                    if ($45) {
                        return map(Data_Either.Left.create)(genA);
                    };
                    return map(Data_Either.Right.create)(genB);
                });
            };
        };
    };
};

// | Creates a generator that outputs `Either` values, choosing a value from a
// | `Left` or the `Right` with even probability.
var genEither = function (dictMonadGen) {
    return genEither$prime(dictMonadGen)(0.5);
};
export {
    genEither,
    genEither$prime,
    genIdentity,
    genMaybe,
    genMaybe$prime,
    genTuple,
    genNonEmpty
};
