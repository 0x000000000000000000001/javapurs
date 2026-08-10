import * as Control_Applicative from "../Control.Applicative/index.js";
import * as Control_Apply from "../Control.Apply/index.js";
import * as Control_Category from "../Control.Category/index.js";
import * as Control_Monad_State from "../Control.Monad.State/index.js";
import * as Control_Monad_State_Class from "../Control.Monad.State.Class/index.js";
import * as Control_Monad_State_Trans from "../Control.Monad.State.Trans/index.js";
import * as Data_Function from "../Data.Function/index.js";
import * as Data_Functor from "../Data.Functor/index.js";
import * as Data_Functor_Compose from "../Data.Functor.Compose/index.js";
import * as Data_Identity from "../Data.Identity/index.js";
import * as Data_Lens_Internal_Indexed from "../Data.Lens.Internal.Indexed/index.js";
import * as Data_Lens_Internal_Wander from "../Data.Lens.Internal.Wander/index.js";
import * as Data_Lens_Iso_Newtype from "../Data.Lens.Iso.Newtype/index.js";
import * as Data_Lens_Setter from "../Data.Lens.Setter/index.js";
import * as Data_Newtype from "../Data.Newtype/index.js";
import * as Data_Profunctor from "../Data.Profunctor/index.js";
import * as Data_Profunctor_Strong from "../Data.Profunctor.Strong/index.js";
import * as Data_TraversableWithIndex from "../Data.TraversableWithIndex/index.js";
import * as Data_Tuple from "../Data.Tuple/index.js";
var identity = /* #__PURE__ */ Control_Category.identity(Control_Category.categoryFn);
var _Newtype = /* #__PURE__ */ Data_Lens_Iso_Newtype["_Newtype"]()()(Data_Profunctor.profunctorFn);
var first = /* #__PURE__ */ Data_Profunctor_Strong.first(Data_Profunctor_Strong.strongFn);
var unwrap = /* #__PURE__ */ Data_Newtype.unwrap();
var unwrap1 = /* #__PURE__ */ Data_Newtype.unwrap();
var unwrap2 = /* #__PURE__ */ Data_Newtype.unwrap();
var applicativeStateT = /* #__PURE__ */ Control_Monad_State_Trans.applicativeStateT(Data_Identity.monadIdentity);
var applicativeCompose = /* #__PURE__ */ Data_Functor_Compose.applicativeCompose(applicativeStateT);
var applyStateT = /* #__PURE__ */ Control_Monad_State_Trans.applyStateT(Data_Identity.monadIdentity);
var applyFirst = /* #__PURE__ */ Control_Apply.applyFirst(applyStateT);
var apply = /* #__PURE__ */ Control_Apply.apply(applyStateT);
var map = /* #__PURE__ */ Data_Functor.map(/* #__PURE__ */ Control_Monad_State_Trans.functorStateT(Data_Identity.functorIdentity));
var monadStateStateT = /* #__PURE__ */ Control_Monad_State_Trans.monadStateStateT(Data_Identity.monadIdentity);
var get = /* #__PURE__ */ Control_Monad_State_Class.get(monadStateStateT);
var pure = /* #__PURE__ */ Control_Applicative.pure(applicativeStateT);
var modify = /* #__PURE__ */ Control_Monad_State_Class.modify(monadStateStateT);

// | Converts an `IndexedOptic` to an `Optic` by forgetting indices.
var unIndex = function (dictProfunctor) {
    var dimap = Data_Profunctor.dimap(dictProfunctor);
    return function (l) {
        var $43 = dimap(Data_Tuple.snd)(identity);
        return function ($44) {
            return l(Data_Lens_Internal_Indexed.Indexed($43($44)));
        };
    };
};

// | Remap the index.
var reindexed = function (dictProfunctor) {
    var lcmap = Data_Profunctor.lcmap(dictProfunctor);
    return function (ij) {
        return function (v) {
            var $45 = Data_Lens_Setter.over(_Newtype)(lcmap(first(ij)));
            return function ($46) {
                return v($45($46));
            };
        };
    };
};

// | Converts a `lens`-like indexed traversal to an `IndexedTraversal`.
var iwander = function (itr) {
    return function (dictWander) {
        var $47 = Data_Lens_Internal_Wander.wander(dictWander)(function (dictApplicative) {
            var itr1 = itr(dictApplicative);
            return function (f) {
                return function (s) {
                    return itr1(Data_Tuple.curry(f))(s);
                };
            };
        });
        return function ($48) {
            return $47(unwrap($48));
        };
    };
};

// | Converts a `Traversal` to an `IndexedTraversal` by using the integer
// | positions as indices.
var positions = function (tr) {
    return function (dictWander) {
        return iwander(function (dictApplicative) {
            var tr1 = tr(Data_Lens_Internal_Wander.wanderStar(applicativeCompose(dictApplicative)));
            return function (f) {
                return function (s) {
                    return Data_Function.flip(Control_Monad_State.evalState)(0)(unwrap1(Data_Function.flip(unwrap2)(s)(tr1(function (a) {
                        return applyFirst(apply(map(f)(get))(pure(a)))(modify(function (v) {
                            return v + 1 | 0;
                        }));
                    }))));
                };
            };
        })(dictWander);
    };
};

// | Traverses over a `TraversableWithIndex` container.
var itraversed = function (dictTraversableWithIndex) {
    var traverseWithIndex = Data_TraversableWithIndex.traverseWithIndex(dictTraversableWithIndex);
    return function (dictWander) {
        return iwander(function (dictApplicative) {
            return traverseWithIndex(dictApplicative);
        })(dictWander);
    };
};
var asIndex = function (dictProfunctor) {
    var dimap = Data_Profunctor.dimap(dictProfunctor);
    return function (l) {
        var $49 = dimap(Data_Tuple.fst)(identity);
        return function ($50) {
            return l(Data_Lens_Internal_Indexed.Indexed($49($50)));
        };
    };
};
export {
    unIndex,
    asIndex,
    reindexed,
    iwander,
    itraversed,
    positions
};
