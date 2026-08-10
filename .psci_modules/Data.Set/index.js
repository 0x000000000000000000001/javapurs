// | This module defines a type of sets as height-balanced (AVL) binary trees.
// | Efficient set operations are implemented in terms of
// | <https://www.cs.cmu.edu/~guyb/papers/BFS16.pdf>
import * as Control_Category from "../Control.Category/index.js";
import * as Data_Eq from "../Data.Eq/index.js";
import * as Data_Foldable from "../Data.Foldable/index.js";
import * as Data_Functor from "../Data.Functor/index.js";
import * as Data_List from "../Data.List/index.js";
import * as Data_List_Types from "../Data.List.Types/index.js";
import * as Data_Map_Internal from "../Data.Map.Internal/index.js";
import * as Data_Maybe from "../Data.Maybe/index.js";
import * as Data_Ord from "../Data.Ord/index.js";
import * as Data_Show from "../Data.Show/index.js";
import * as Data_Unfoldable from "../Data.Unfoldable/index.js";
import * as Data_Unit from "../Data.Unit/index.js";
import * as Safe_Coerce from "../Safe.Coerce/index.js";
var coerce = /* #__PURE__ */ Safe_Coerce.coerce();
var foldMap = /* #__PURE__ */ Data_Foldable.foldMap(Data_List_Types.foldableList);
var foldl = /* #__PURE__ */ Data_Foldable.foldl(Data_List_Types.foldableList);
var foldr = /* #__PURE__ */ Data_Foldable.foldr(Data_List_Types.foldableList);
var map1 = /* #__PURE__ */ Data_Functor.map(Data_Maybe.functorMaybe);
var identity = /* #__PURE__ */ Control_Category.identity(Control_Category.categoryFn);

// | `Set a` represents a set of values of type `a`
var $$Set = function (x) {
    return x;
};

// | Form the union of two sets
// |
// | Running time: `O(n + m)`
var union = function (dictOrd) {
    return coerce(Data_Map_Internal.union(dictOrd));
};

// | Insert a value into a set if it is not already present, if it is present, delete it.
var toggle = function (dictOrd) {
    var alter = Data_Map_Internal.alter(dictOrd);
    return function (a) {
        return function (v) {
            return alter(Data_Maybe.maybe(new Data_Maybe.Just(Data_Unit.unit))(function (v1) {
                return Data_Maybe.Nothing.value;
            }))(a)(v);
        };
    };
};

// | A set is a map with no value attached to each key.
var toMap = function (v) {
    return v;
};
var toList = function (v) {
    return Data_Map_Internal.keys(v);
};

// | Convert a set to an unfoldable structure.
var toUnfoldable = function (dictUnfoldable) {
    var $96 = Data_List.toUnfoldable(dictUnfoldable);
    return function ($97) {
        return $96(toList($97));
    };
};
var toUnfoldable1 = /* #__PURE__ */ toUnfoldable(Data_Unfoldable.unfoldableArray);

// | Find the size of a set
var size = /* #__PURE__ */ coerce(Data_Map_Internal.size);

// | Create a set with one element
var singleton = function (a) {
    return Data_Map_Internal.singleton(a)(Data_Unit.unit);
};
var showSet = function (dictShow) {
    var show = Data_Show.show(Data_Show.showArray(dictShow));
    return {
        show: function (s) {
            return "(fromFoldable " + (show(toUnfoldable1(s)) + ")");
        }
    };
};
var semigroupSet = function (dictOrd) {
    return {
        append: union(dictOrd)
    };
};

// | Test if a value is a member of a set
var member = function (dictOrd) {
    return coerce(Data_Map_Internal.member(dictOrd));
};

// | Test if a set is empty
var isEmpty = /* #__PURE__ */ coerce(Data_Map_Internal.isEmpty);

// | The set of elements which are in both the first and second set
var intersection = function (dictOrd) {
    return coerce(Data_Map_Internal.intersection(dictOrd));
};

// | Insert a value into a set
var insert = function (dictOrd) {
    var insert1 = Data_Map_Internal.insert(dictOrd);
    return function (a) {
        return function (v) {
            return insert1(a)(Data_Unit.unit)(v);
        };
    };
};

// | A map with no value attached to each key is a set.
// | See also `Data.Map.keys`.
var fromMap = $$Set;
var foldableSet = {
    foldMap: function (dictMonoid) {
        var foldMap1 = foldMap(dictMonoid);
        return function (f) {
            var $98 = foldMap1(f);
            return function ($99) {
                return $98(toList($99));
            };
        };
    },
    foldl: function (f) {
        return function (x) {
            var $100 = foldl(f)(x);
            return function ($101) {
                return $100(toList($101));
            };
        };
    },
    foldr: function (f) {
        return function (x) {
            var $102 = foldr(f)(x);
            return function ($103) {
                return $102(toList($103));
            };
        };
    }
};
var foldl1 = /* #__PURE__ */ Data_Foldable.foldl(foldableSet);
var foldr1 = /* #__PURE__ */ Data_Foldable.foldr(foldableSet);
var findMin = function (v) {
    return map1(function (v1) {
        return v1.key;
    })(Data_Map_Internal.findMin(v));
};
var findMax = function (v) {
    return map1(function (v1) {
        return v1.key;
    })(Data_Map_Internal.findMax(v));
};

// | Filter out those values of a set for which a predicate on the value fails
// | to hold.
var filter = function (dictOrd) {
    return coerce(Data_Map_Internal.filterKeys(dictOrd));
};
var eqSet = function (dictEq) {
    var eq = Data_Eq.eq(Data_Map_Internal.eqMap(dictEq)(Data_Eq.eqUnit));
    return {
        eq: function (v) {
            return function (v1) {
                return eq(v)(v1);
            };
        }
    };
};
var ordSet = function (dictOrd) {
    var compare = Data_Ord.compare(Data_List_Types.ordList(dictOrd));
    var eqSet1 = eqSet(dictOrd.Eq0());
    return {
        compare: function (s1) {
            return function (s2) {
                return compare(toList(s1))(toList(s2));
            };
        },
        Eq0: function () {
            return eqSet1;
        }
    };
};
var eq1Set = {
    eq1: function (dictEq) {
        return Data_Eq.eq(eqSet(dictEq));
    }
};
var ord1Set = {
    compare1: function (dictOrd) {
        return Data_Ord.compare(ordSet(dictOrd));
    },
    Eq10: function () {
        return eq1Set;
    }
};

// | An empty set
var empty = Data_Map_Internal.empty;

// | Create a set from a foldable structure.
var fromFoldable = function (dictFoldable) {
    var foldl2 = Data_Foldable.foldl(dictFoldable);
    return function (dictOrd) {
        var insert1 = insert(dictOrd);
        return foldl2(function (m) {
            return function (a) {
                return insert1(a)(m);
            };
        })(empty);
    };
};

// | Maps over the values in a set.
// |
// | This operation is not structure-preserving for sets, so is not a valid
// | `Functor`. An example case: mapping `const x` over a set with `n > 0`
// | elements will result in a set with one element.
var map = function (dictOrd) {
    var insert1 = insert(dictOrd);
    return function (f) {
        return foldl1(function (m) {
            return function (a) {
                return insert1(f(a))(m);
            };
        })(empty);
    };
};

// | Applies a function to each value in a set, discarding entries where the
// | function returns `Nothing`.
var mapMaybe = function (dictOrd) {
    var insert1 = insert(dictOrd);
    return function (f) {
        return foldr1(function (a) {
            return function (acc) {
                return Data_Maybe.maybe(acc)(function (b) {
                    return insert1(b)(acc);
                })(f(a));
            };
        })(empty);
    };
};
var monoidSet = function (dictOrd) {
    var semigroupSet1 = semigroupSet(dictOrd);
    return {
        mempty: empty,
        Semigroup0: function () {
            return semigroupSet1;
        }
    };
};

// | Form the union of a collection of sets
var unions = function (dictFoldable) {
    var foldl2 = Data_Foldable.foldl(dictFoldable);
    return function (dictOrd) {
        return foldl2(union(dictOrd))(empty);
    };
};

// | Form the set difference
var difference = function (dictOrd) {
    return coerce(Data_Map_Internal.difference(dictOrd));
};

// | True if and only if every element in the first set
// | is an element of the second set
var subset = function (dictOrd) {
    var difference1 = difference(dictOrd);
    return function (s1) {
        return function (s2) {
            return isEmpty(difference1(s1)(s2));
        };
    };
};

// | True if and only if the first set is a subset of the second set
// | and the sets are not equal
var properSubset = function (dictOrd) {
    var subset1 = subset(dictOrd);
    return function (s1) {
        return function (s2) {
            return size(s1) !== size(s2) && subset1(s1)(s2);
        };
    };
};

// | Delete a value from a set
var $$delete = function (dictOrd) {
    return coerce(Data_Map_Internal["delete"](dictOrd));
};

// | Check whether the underlying tree satisfies the height, size, and ordering invariants.
// |
// | This function is provided for internal use.
var checkValid = function (dictOrd) {
    return coerce(Data_Map_Internal.checkValid(dictOrd));
};

// | Filter a set of optional values, discarding values that contain `Nothing`
var catMaybes = function (dictOrd) {
    return mapMaybe(dictOrd)(identity);
};
export {
    fromFoldable,
    toUnfoldable,
    empty,
    isEmpty,
    singleton,
    map,
    checkValid,
    insert,
    member,
    $$delete as delete,
    toggle,
    size,
    findMin,
    findMax,
    union,
    unions,
    difference,
    subset,
    properSubset,
    intersection,
    filter,
    mapMaybe,
    catMaybes,
    toMap,
    fromMap,
    eqSet,
    eq1Set,
    showSet,
    ordSet,
    ord1Set,
    monoidSet,
    semigroupSet,
    foldableSet
};
