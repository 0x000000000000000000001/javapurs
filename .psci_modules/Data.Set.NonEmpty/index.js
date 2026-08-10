import * as Data_Array_NonEmpty_Internal from "../Data.Array.NonEmpty.Internal/index.js";
import * as Data_Functor from "../Data.Functor/index.js";
import * as Data_List_Types from "../Data.List.Types/index.js";
import * as Data_Map_Internal from "../Data.Map.Internal/index.js";
import * as Data_Maybe from "../Data.Maybe/index.js";
import * as Data_Semigroup from "../Data.Semigroup/index.js";
import * as Data_Semigroup_Foldable from "../Data.Semigroup.Foldable/index.js";
import * as Data_Set from "../Data.Set/index.js";
import * as Data_Show from "../Data.Show/index.js";
import * as Data_Tuple from "../Data.Tuple/index.js";
import * as Data_Unfoldable1 from "../Data.Unfoldable1/index.js";
import * as Partial_Unsafe from "../Partial.Unsafe/index.js";
import * as Safe_Coerce from "../Safe.Coerce/index.js";
var coerce = /* #__PURE__ */ Safe_Coerce.coerce();
var map1 = /* #__PURE__ */ Data_Functor.map(Data_Tuple.functorTuple);
var coerce1 = /* #__PURE__ */ Safe_Coerce.coerce();
var fromJust = /* #__PURE__ */ Data_Maybe.fromJust();
var foldMap1 = /* #__PURE__ */ Data_Semigroup_Foldable.foldMap1(Data_List_Types.foldable1NonEmptyList);
var foldr1 = /* #__PURE__ */ Data_Semigroup_Foldable.foldr1(Data_List_Types.foldable1NonEmptyList);
var foldl1 = /* #__PURE__ */ Data_Semigroup_Foldable.foldl1(Data_List_Types.foldable1NonEmptyList);

// | `NonEmptySet a` represents a non-empty set of values of type `a`
var NonEmptySet = function (x) {
    return x;
};

// | Form the union of a set and the non-empty set.
var unionSet = function (dictOrd) {
    return coerce(Data_Semigroup.append(Data_Set.semigroupSet(dictOrd)));
};

// | Convert a set to a non-empty unfoldable structure.
var toUnfoldable1 = function (dictUnfoldable1) {
    var stepNext = Data_Map_Internal.stepAscCps(function (k, v, next) {
        return new Data_Maybe.Just(new Data_Tuple.Tuple(k, next));
    })(function (v) {
        return Data_Maybe.Nothing.value;
    });
    var stepHead = Data_Map_Internal.stepAscCps(function (k, v, next) {
        return new Data_Tuple.Tuple(k, next);
    })(function (v) {
        return Partial_Unsafe.unsafeCrashWith("toUnfoldable1: impossible");
    });
    var $83 = Data_Unfoldable1.unfoldr1(dictUnfoldable1)(function (v) {
        return map1(stepNext)(v);
    });
    return function ($84) {
        return $83(stepHead(Data_Map_Internal.toMapIter(Data_Set.toMap(coerce1($84)))));
    };
};
var toUnfoldable11 = /* #__PURE__ */ toUnfoldable1(Data_Array_NonEmpty_Internal.unfoldable1NonEmptyArray);
var toUnfoldable12 = /* #__PURE__ */ toUnfoldable1(Data_List_Types.unfoldable1NonEmptyList);

// | Convert a set to an unfoldable structure.
var toUnfoldable = function (dictUnfoldable) {
    return coerce(Data_Set.toUnfoldable(dictUnfoldable));
};

// | Forgets the non-empty property of a set, giving a normal possibly-empty
// | set.
var toSet = function (v) {
    return v;
};

// | True if and only if every element in the first set is an element of the
// | second set.
var subset = function (dictOrd) {
    return coerce(Data_Set.subset(dictOrd));
};

// | Find the size of a set.
var size = /* #__PURE__ */ coerce(Data_Set.size);

// | Create a set with one element.
var singleton = /* #__PURE__ */ coerce(Data_Set.singleton);
var showNonEmptySet = function (dictShow) {
    var show = Data_Show.show(Data_Array_NonEmpty_Internal.showNonEmptyArray(dictShow));
    return {
        show: function (s) {
            return "(fromFoldable1 " + (show(toUnfoldable11(s)) + ")");
        }
    };
};
var semigroupNonEmptySet = function (dictOrd) {
    return Data_Set.semigroupSet(dictOrd);
};

// | True if and only if the first set is a subset of the second set and the
// | sets are not equal.
var properSubset = function (dictOrd) {
    return coerce(Data_Set.properSubset(dictOrd));
};
var ordNonEmptySet = function (dictOrd) {
    return Data_Set.ordSet(dictOrd);
};
var ord1NonEmptySet = Data_Set.ord1Set;

// | The minimum value in the set.
var min = function (v) {
    return fromJust(Data_Set.findMin(v));
};

// | Test if a value is a member of a set.
var member = function (dictOrd) {
    return coerce(Data_Set.member(dictOrd));
};

// | The maximum value in the set.
var max = function (v) {
    return fromJust(Data_Set.findMax(v));
};

// | Applies a function to each value in a set, discarding entries where the
// | function returns `Nothing`.
var mapMaybe = function (dictOrd) {
    return coerce(Data_Set.mapMaybe(dictOrd));
};

// | Maps over the values in a set.
// |
// | This operation is not structure-preserving for sets, so is not a valid
// | `Functor`. An example case: mapping `const x` over a set with `n > 0`
// | elements will result in a set with one element.
var map = function (dictOrd) {
    return coerce(Data_Set.map(dictOrd));
};

// | Insert a value into a set.
var insert = function (dictOrd) {
    return coerce(Data_Set.insert(dictOrd));
};

// | Attempts to create a non-empty set from a possibly-empty set.
var fromSet = function (s) {
    var $76 = Data_Set.isEmpty(s);
    if ($76) {
        return Data_Maybe.Nothing.value;
    };
    return new Data_Maybe.Just(s);
};

// | The set of elements which are in both the first and second set. `Nothing`
// | if the sets are disjoint.
var intersection = function (dictOrd) {
    var intersection1 = Data_Set.intersection(dictOrd);
    return function (v) {
        return function (v1) {
            return fromSet(intersection1(v)(v1));
        };
    };
};

// | Create a set from a non-empty foldable structure.
var fromFoldable1 = function (dictFoldable1) {
    var foldMap11 = Data_Semigroup_Foldable.foldMap1(dictFoldable1);
    return function (dictOrd) {
        return foldMap11(semigroupNonEmptySet(dictOrd))(singleton);
    };
};

// | Create a set from a foldable structure.
var fromFoldable = function (dictFoldable) {
    var fromFoldable2 = Data_Set.fromFoldable(dictFoldable);
    return function (dictOrd) {
        var $85 = fromFoldable2(dictOrd);
        return function ($86) {
            return fromSet($85($86));
        };
    };
};
var foldableNonEmptySet = Data_Set.foldableSet;
var foldable1NonEmptySet = {
    foldMap1: function (dictSemigroup) {
        var foldMap11 = foldMap1(dictSemigroup);
        return function (f) {
            var $87 = foldMap11(f);
            return function ($88) {
                return $87(toUnfoldable12($88));
            };
        };
    },
    foldr1: function (f) {
        var $89 = foldr1(f);
        return function ($90) {
            return $89(toUnfoldable12($90));
        };
    },
    foldl1: function (f) {
        var $91 = foldl1(f);
        return function ($92) {
            return $91(toUnfoldable12($92));
        };
    },
    Foldable0: function () {
        return foldableNonEmptySet;
    }
};

// | Filter out those values of a set for which a predicate on the value fails
// | to hold.
var filter = function (dictOrd) {
    return coerce(Data_Set.filter(dictOrd));
};
var eqNonEmptySet = function (dictEq) {
    return Data_Set.eqSet(dictEq);
};
var eq1NonEmptySet = Data_Set.eq1Set;

// | Form the set difference. `Nothing` if the first is a subset of the second.
var difference = function (dictOrd) {
    var difference1 = Data_Set.difference(dictOrd);
    return function (v) {
        return function (v1) {
            return fromSet(difference1(v)(v1));
        };
    };
};

// | Delete a value from a non-empty set. If this would empty the set, the
// | result is `Nothing`.
var $$delete = function (dictOrd) {
    var delete1 = Data_Set["delete"](dictOrd);
    return function (a) {
        return function (v) {
            return fromSet(delete1(a)(v));
        };
    };
};

// | Creates a `NonEmptySet` from an item and a `Set`.
var cons = function (dictOrd) {
    return coerce(Data_Set.insert(dictOrd));
};
export {
    singleton,
    cons,
    fromSet,
    fromFoldable,
    fromFoldable1,
    toSet,
    toUnfoldable,
    toUnfoldable1,
    map,
    member,
    insert,
    $$delete as delete,
    size,
    min,
    max,
    unionSet,
    difference,
    subset,
    properSubset,
    intersection,
    filter,
    mapMaybe,
    eqNonEmptySet,
    eq1NonEmptySet,
    ordNonEmptySet,
    ord1NonEmptySet,
    semigroupNonEmptySet,
    foldableNonEmptySet,
    foldable1NonEmptySet,
    showNonEmptySet
};
