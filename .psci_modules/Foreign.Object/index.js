// | This module defines a type of native homogeneous Javascript Objects.
// |
// | To maximize performance, Javascript objects are not wrapped,
// | and some native code is used even when it's not necessary.
import * as $foreign from "./foreign.js";
import * as Control_Applicative from "../Control.Applicative/index.js";
import * as Control_Apply from "../Control.Apply/index.js";
import * as Control_Bind from "../Control.Bind/index.js";
import * as Control_Category from "../Control.Category/index.js";
import * as Control_Monad_ST_Internal from "../Control.Monad.ST.Internal/index.js";
import * as Data_Array from "../Data.Array/index.js";
import * as Data_Eq from "../Data.Eq/index.js";
import * as Data_Foldable from "../Data.Foldable/index.js";
import * as Data_FoldableWithIndex from "../Data.FoldableWithIndex/index.js";
import * as Data_Function from "../Data.Function/index.js";
import * as Data_Function_Uncurried from "../Data.Function.Uncurried/index.js";
import * as Data_Functor from "../Data.Functor/index.js";
import * as Data_Maybe from "../Data.Maybe/index.js";
import * as Data_Monoid from "../Data.Monoid/index.js";
import * as Data_Ord from "../Data.Ord/index.js";
import * as Data_Semigroup from "../Data.Semigroup/index.js";
import * as Data_Show from "../Data.Show/index.js";
import * as Data_Traversable from "../Data.Traversable/index.js";
import * as Data_TraversableWithIndex from "../Data.TraversableWithIndex/index.js";
import * as Data_Tuple from "../Data.Tuple/index.js";
import * as Data_Unfoldable from "../Data.Unfoldable/index.js";
import * as Foreign_Object_ST from "../Foreign.Object.ST/index.js";
import * as Unsafe_Coerce from "../Unsafe.Coerce/index.js";
var sortWith = /* #__PURE__ */ Data_Array.sortWith(Data_Ord.ordString);
var bindFlipped = /* #__PURE__ */ Control_Bind.bindFlipped(Control_Monad_ST_Internal.bindST);
var showTuple = /* #__PURE__ */ Data_Tuple.showTuple(Data_Show.showString);
var pure = /* #__PURE__ */ Control_Applicative.pure(Control_Monad_ST_Internal.applicativeST);
var forWithIndex_ = /* #__PURE__ */ Data_FoldableWithIndex.forWithIndex_(Control_Monad_ST_Internal.applicativeST);
var for_ = /* #__PURE__ */ Data_Foldable.for_(Control_Monad_ST_Internal.applicativeST);
var $$void = /* #__PURE__ */ Data_Functor["void"](Control_Monad_ST_Internal.functorST);
var foldr = /* #__PURE__ */ Data_Foldable.foldr(Data_Foldable.foldableArray);
var identity = /* #__PURE__ */ Control_Category.identity(Control_Category.categoryFn);
var ordTuple = /* #__PURE__ */ Data_Tuple.ordTuple(Data_Ord.ordString);
var mapFlipped = /* #__PURE__ */ Data_Functor.mapFlipped(Data_Maybe.functorMaybe);

// | Get a list of the values in a map
var values = /* #__PURE__ */ $foreign.toArrayWithKey(function (v) {
    return function (v1) {
        return v1;
    };
});

// | Unfolds a map into a list of key/value pairs
var toUnfoldable = function (dictUnfoldable) {
    var $89 = Data_Array.toUnfoldable(dictUnfoldable);
    var $90 = $foreign.toArrayWithKey(Data_Tuple.Tuple.create);
    return function ($91) {
        return $89($90($91));
    };
};

// | Unfolds a map into a list of key/value pairs which is guaranteed to be
// | sorted by key
var toAscUnfoldable = function (dictUnfoldable) {
    var $92 = Data_Array.toUnfoldable(dictUnfoldable);
    var $93 = sortWith(Data_Tuple.fst);
    var $94 = $foreign.toArrayWithKey(Data_Tuple.Tuple.create);
    return function ($95) {
        return $92($93($94($95)));
    };
};

// Internal use
var toAscArray = /* #__PURE__ */ toAscUnfoldable(Data_Unfoldable.unfoldableArray);

// Internal
var toArray = /* #__PURE__ */ (function () {
    return $foreign.toArrayWithKey(Data_Tuple.Tuple.create);
})();

// | Convert an immutable Object into a mutable Object
var thawST = $foreign["_copyST"];

// | Create an `Object a` with one key/value pair
var singleton = function (k) {
    return function (v) {
        return $foreign.runST(bindFlipped(Foreign_Object_ST.poke(k)(v))(Foreign_Object_ST["new"]));
    };
};
var showObject = function (dictShow) {
    var show = Data_Show.show(Data_Show.showArray(showTuple(dictShow)));
    return {
        show: function (m) {
            return "(fromFoldable " + (show(toArray(m)) + ")");
        }
    };
};
var mutate = function (f) {
    return function (m) {
        return $foreign.runST(function __do() {
            var s = thawST(m)();
            f(s)();
            return s;
        });
    };
};

// | Test whether a `String` appears as a key in a map
var member = /* #__PURE__ */ Data_Function_Uncurried.runFn4($foreign["_lookup"])(false)(/* #__PURE__ */ Data_Function["const"](true));

// | Apply a function of two arguments to each key/value pair, producing a new map
var mapWithKey = function (f) {
    return function (m) {
        return $foreign["_mapWithKey"](m, f);
    };
};

// | Lookup the value for a key in a map
var lookup = /* #__PURE__ */ (function () {
    return Data_Function_Uncurried.runFn4($foreign["_lookup"])(Data_Maybe.Nothing.value)(Data_Maybe.Just.create);
})();

// | Test whether one map contains all of the keys and values contained in another map
var isSubmap = function (dictEq) {
    var eq = Data_Eq.eq(dictEq);
    return function (m1) {
        return function (m2) {
            var f = function (k) {
                return function (v) {
                    return $foreign["_lookup"](false, eq(v), k, m2);
                };
            };
            return $foreign.all(f)(m1);
        };
    };
};

// | Test whether a map is empty
var isEmpty = /* #__PURE__ */ $foreign.all(function (v) {
    return function (v1) {
        return false;
    };
});

// | Insert or replace a key/value pair in a map
var insert = function (k) {
    return function (v) {
        return mutate(Foreign_Object_ST.poke(k)(v));
    };
};
var functorObject = {
    map: function (f) {
        return function (m) {
            return $foreign["_fmapObject"](m, f);
        };
    }
};
var functorWithIndexObject = {
    mapWithIndex: mapWithKey,
    Functor0: function () {
        return functorObject;
    }
};

// | Create an `Object a` from a homogeneous record, i.e. all of the record
// | fields are of the same type.
var fromHomogeneous = function () {
    return Unsafe_Coerce.unsafeCoerce;
};

// | Create an `Object a` from a `String`-indexed foldable collection
var fromFoldableWithIndex = function (dictFoldableWithIndex) {
    var forWithIndex_1 = forWithIndex_(dictFoldableWithIndex);
    return function (l) {
        return $foreign.runST(function __do() {
            var s = Foreign_Object_ST["new"]();
            forWithIndex_1(l)(function (k) {
                return function (v) {
                    return Foreign_Object_ST.poke(k)(v)(s);
                };
            })();
            return s;
        });
    };
};

// | Create an `Object a` from a foldable collection of key/value pairs, using the
// | specified function to combine values for duplicate keys.
var fromFoldableWith = function (dictFoldable) {
    var for_1 = for_(dictFoldable);
    return function (f) {
        return function (l) {
            return $foreign.runST(function __do() {
                var s = Foreign_Object_ST["new"]();
                for_1(l)(function (v) {
                    return function __do() {
                        var v$prime = $foreign["_lookupST"](v.value1, f(v.value1), v.value0, s)();
                        return Foreign_Object_ST.poke(v.value0)(v$prime)(s)();
                    };
                })();
                return s;
            });
        };
    };
};

// | Create an `Object a` from a foldable collection of key/value pairs
var fromFoldable = function (dictFoldable) {
    var fromFoldable1 = Data_Array.fromFoldable(dictFoldable);
    return function (l) {
        return $foreign.runST(function __do() {
            var s = Foreign_Object_ST["new"]();
            Control_Monad_ST_Internal.foreach(fromFoldable1(l))(function (v) {
                return $$void(Foreign_Object_ST.poke(v.value0)(v.value1)(s));
            })();
            return s;
        });
    };
};

// | Convert a mutable Object into an immutable Object
var freezeST = $foreign["_copyST"];

// | Fold the keys and values of a map.
// |
// | This function allows the folding function to terminate the fold early,
// | using `Maybe`.
var foldMaybe = function (f) {
    return function (z) {
        return function (m) {
            return $foreign["_foldSCObject"](m, z, f, Data_Maybe.fromMaybe);
        };
    };
};

// | Fold the keys and values of an object, accumulating values and effects in
// | some `Monad`.
var foldM = function (dictMonad) {
    var bind1 = Control_Bind.bind(dictMonad.Bind1());
    var pure1 = Control_Applicative.pure(dictMonad.Applicative0());
    return function (f) {
        return function (z) {
            return $foreign["_foldM"](bind1)(f)(pure1(z));
        };
    };
};
var foldM1 = /* #__PURE__ */ foldM(Control_Monad_ST_Internal.monadST);

// | Compute the union of two maps, preferring the first map in the case of
// | duplicate keys.
var union = function (m) {
    return mutate(function (s) {
        return foldM1(function (s$prime) {
            return function (k) {
                return function (v) {
                    return Foreign_Object_ST.poke(k)(v)(s$prime);
                };
            };
        })(s)(m);
    });
};

// | Compute the union of a collection of maps
var unions = function (dictFoldable) {
    return Data_Foldable.foldl(dictFoldable)(union)($foreign.empty);
};

// | Compute the union of two maps, using the specified function
// | to combine values for duplicate keys.
var unionWith = function (f) {
    return function (m1) {
        return function (m2) {
            return mutate(function (s1) {
                return foldM1(function (s2) {
                    return function (k) {
                        return function (v1) {
                            return Foreign_Object_ST.poke(k)($foreign["_lookup"](v1, function (v2) {
                                return f(v1)(v2);
                            }, k, m2))(s2);
                        };
                    };
                })(s1)(m1);
            })(m2);
        };
    };
};
var semigroupObject = function (dictSemigroup) {
    return {
        append: unionWith(Data_Semigroup.append(dictSemigroup))
    };
};
var monoidObject = function (dictSemigroup) {
    var semigroupObject1 = semigroupObject(dictSemigroup);
    return {
        mempty: $foreign.empty,
        Semigroup0: function () {
            return semigroupObject1;
        }
    };
};

// | Fold the keys and values of an object
var fold = /* #__PURE__ */ $foreign["_foldM"](Data_Function.applyFlipped);

// | Fold the keys and values of an object, accumulating values using some
// | `Monoid`.
var foldMap = function (dictMonoid) {
    var append1 = Data_Semigroup.append(dictMonoid.Semigroup0());
    var mempty = Data_Monoid.mempty(dictMonoid);
    return function (f) {
        return fold(function (acc) {
            return function (k) {
                return function (v) {
                    return append1(acc)(f(k)(v));
                };
            };
        })(mempty);
    };
};
var foldableObject = {
    foldl: function (f) {
        return fold(function (z) {
            return function (v) {
                return f(z);
            };
        });
    },
    foldr: function (f) {
        return function (z) {
            return function (m) {
                return foldr(f)(z)(values(m));
            };
        };
    },
    foldMap: function (dictMonoid) {
        var foldMap1 = foldMap(dictMonoid);
        return function (f) {
            return foldMap1(Data_Function["const"](f));
        };
    }
};
var foldableWithIndexObject = {
    foldlWithIndex: function (f) {
        return fold(Data_Function.flip(f));
    },
    foldrWithIndex: function (f) {
        return function (z) {
            return function (m) {
                return foldr(Data_Tuple.uncurry(f))(z)($foreign.toArrayWithKey(Data_Tuple.Tuple.create)(m));
            };
        };
    },
    foldMapWithIndex: function (dictMonoid) {
        return foldMap(dictMonoid);
    },
    Foldable0: function () {
        return foldableObject;
    }
};
var traversableWithIndexObject = {
    traverseWithIndex: function (dictApplicative) {
        var Apply0 = dictApplicative.Apply0();
        var apply = Control_Apply.apply(Apply0);
        var map = Data_Functor.map(Apply0.Functor0());
        var pure1 = Control_Applicative.pure(dictApplicative);
        return function (f) {
            return function (ms) {
                return fold(function (acc) {
                    return function (k) {
                        return function (v) {
                            return apply(map(Data_Function.flip(insert(k)))(acc))(f(k)(v));
                        };
                    };
                })(pure1($foreign.empty))(ms);
            };
        };
    },
    FunctorWithIndex0: function () {
        return functorWithIndexObject;
    },
    FoldableWithIndex1: function () {
        return foldableWithIndexObject;
    },
    Traversable2: function () {
        return traversableObject;
    }
};
var traversableObject = {
    traverse: function (dictApplicative) {
        var $96 = Data_TraversableWithIndex.traverseWithIndex(traversableWithIndexObject)(dictApplicative);
        return function ($97) {
            return $96(Data_Function["const"]($97));
        };
    },
    sequence: function (dictApplicative) {
        return Data_Traversable.traverse(traversableObject)(dictApplicative)(identity);
    },
    Functor0: function () {
        return functorObject;
    },
    Foldable1: function () {
        return foldableObject;
    }
};

// | Filter out those key/value pairs of a map for which a predicate
// | fails to hold.
var filterWithKey = function (predicate) {
    return function (m) {
        var go = (function () {
            var step = function (acc) {
                return function (k) {
                    return function (v) {
                        var $86 = predicate(k)(v);
                        if ($86) {
                            return Foreign_Object_ST.poke(k)(v)(acc);
                        };
                        return pure(acc);
                    };
                };
            };
            return function __do() {
                var m$prime = Foreign_Object_ST["new"]();
                return foldM1(step)(m$prime)(m)();
            };
        })();
        return $foreign.runST(go);
    };
};

// | Filter out those key/value pairs of a map for which a predicate
// | on the key fails to hold.
var filterKeys = function (predicate) {
    return filterWithKey(function ($98) {
        return Data_Function["const"](predicate($98));
    });
};

// | Filter out those key/value pairs of a map for which a predicate
// | on the value fails to hold.
var filter = function (predicate) {
    return filterWithKey(Data_Function["const"](predicate));
};
var eqObject = function (dictEq) {
    var isSubmap1 = isSubmap(dictEq);
    return {
        eq: function (m1) {
            return function (m2) {
                return isSubmap1(m1)(m2) && isSubmap1(m2)(m1);
            };
        }
    };
};
var ordObject = function (dictOrd) {
    var compare = Data_Ord.compare(Data_Ord.ordArray(ordTuple(dictOrd)));
    var eqObject1 = eqObject(dictOrd.Eq0());
    return {
        compare: function (m1) {
            return function (m2) {
                return compare(toAscArray(m1))(toAscArray(m2));
            };
        },
        Eq0: function () {
            return eqObject1;
        }
    };
};
var eq1Object = {
    eq1: function (dictEq) {
        return Data_Eq.eq(eqObject(dictEq));
    }
};

// | Delete a key and value from a map
var $$delete = function (k) {
    return mutate(Foreign_Object_ST["delete"](k));
};

// | Delete a key and value from a map, returning the value
// | as well as the subsequent map
var pop = function (k) {
    return function (m) {
        return mapFlipped(lookup(k)(m))(function (a) {
            return new Data_Tuple.Tuple(a, $$delete(k)(m));
        });
    };
};

// | Insert, remove or update a value for a key in a map
var alter = function (f) {
    return function (k) {
        return function (m) {
            var v = f(lookup(k)(m));
            if (v instanceof Data_Maybe.Nothing) {
                return $$delete(k)(m);
            };
            if (v instanceof Data_Maybe.Just) {
                return insert(k)(v.value0)(m);
            };
            throw new Error("Failed pattern match at Foreign.Object (line 210, column 15 - line 212, column 25): " + [ v.constructor.name ]);
        };
    };
};

// | Remove or update a value for a key in a map
var update = function (f) {
    return function (k) {
        return function (m) {
            return alter(Data_Maybe.maybe(Data_Maybe.Nothing.value)(f))(k)(m);
        };
    };
};
export {
    empty,
    size,
    keys,
    all,
    runST,
    toArrayWithKey
} from "./foreign.js";
export {
    isEmpty,
    singleton,
    insert,
    lookup,
    toUnfoldable,
    toAscUnfoldable,
    fromFoldable,
    fromFoldableWith,
    fromFoldableWithIndex,
    fromHomogeneous,
    $$delete as delete,
    pop,
    member,
    alter,
    update,
    mapWithKey,
    filterWithKey,
    filterKeys,
    filter,
    values,
    union,
    unionWith,
    unions,
    isSubmap,
    fold,
    foldMap,
    foldM,
    foldMaybe,
    thawST,
    freezeST,
    functorObject,
    functorWithIndexObject,
    foldableObject,
    foldableWithIndexObject,
    traversableObject,
    traversableWithIndexObject,
    eqObject,
    eq1Object,
    ordObject,
    showObject,
    semigroupObject,
    monoidObject
};
