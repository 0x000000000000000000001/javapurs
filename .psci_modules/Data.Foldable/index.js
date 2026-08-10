import * as $foreign from "./foreign.js";
import * as Control_Alt from "../Control.Alt/index.js";
import * as Control_Applicative from "../Control.Applicative/index.js";
import * as Control_Apply from "../Control.Apply/index.js";
import * as Control_Bind from "../Control.Bind/index.js";
import * as Control_Category from "../Control.Category/index.js";
import * as Control_Plus from "../Control.Plus/index.js";
import * as Data_Either from "../Data.Either/index.js";
import * as Data_Eq from "../Data.Eq/index.js";
import * as Data_Function from "../Data.Function/index.js";
import * as Data_Functor_Coproduct from "../Data.Functor.Coproduct/index.js";
import * as Data_HeytingAlgebra from "../Data.HeytingAlgebra/index.js";
import * as Data_Maybe from "../Data.Maybe/index.js";
import * as Data_Maybe_First from "../Data.Maybe.First/index.js";
import * as Data_Monoid from "../Data.Monoid/index.js";
import * as Data_Monoid_Conj from "../Data.Monoid.Conj/index.js";
import * as Data_Monoid_Disj from "../Data.Monoid.Disj/index.js";
import * as Data_Monoid_Dual from "../Data.Monoid.Dual/index.js";
import * as Data_Monoid_Endo from "../Data.Monoid.Endo/index.js";
import * as Data_Newtype from "../Data.Newtype/index.js";
import * as Data_Ord from "../Data.Ord/index.js";
import * as Data_Ordering from "../Data.Ordering/index.js";
import * as Data_Semigroup from "../Data.Semigroup/index.js";
import * as Data_Semiring from "../Data.Semiring/index.js";
import * as Data_Unit from "../Data.Unit/index.js";
var identity = /* #__PURE__ */ Control_Category.identity(Control_Category.categoryFn);
var eq1 = /* #__PURE__ */ Data_Eq.eq(Data_Ordering.eqOrdering);
var unwrap = /* #__PURE__ */ Data_Newtype.unwrap();
var monoidEndo = /* #__PURE__ */ Data_Monoid_Endo.monoidEndo(Control_Category.categoryFn);
var monoidDual = /* #__PURE__ */ Data_Monoid_Dual.monoidDual(monoidEndo);
var unwrap1 = /* #__PURE__ */ Data_Newtype.unwrap();
var alaF = /* #__PURE__ */ Data_Newtype.alaF()()()();
var identity1 = /* #__PURE__ */ Control_Category.identity(Control_Category.categoryFn);
var foldr = function (dict) {
    return dict.foldr;
};

// | Try to get nth element from the right in a data structure
var indexr = function (dictFoldable) {
    var foldr2 = foldr(dictFoldable);
    return function (idx) {
        var go = function (a) {
            return function (cursor) {
                if (cursor.elem instanceof Data_Maybe.Just) {
                    return cursor;
                };
                var $294 = cursor.pos === idx;
                if ($294) {
                    return {
                        elem: new Data_Maybe.Just(a),
                        pos: cursor.pos
                    };
                };
                return {
                    pos: cursor.pos + 1 | 0,
                    elem: cursor.elem
                };
            };
        };
        var $453 = foldr2(go)({
            elem: Data_Maybe.Nothing.value,
            pos: 0
        });
        return function ($454) {
            return (function (v) {
                return v.elem;
            })($453($454));
        };
    };
};

// | Test whether the structure is empty.
// | Optimized for structures that are similar to cons-lists, because there
// | is no general way to do better.
var $$null = function (dictFoldable) {
    return foldr(dictFoldable)(function (v) {
        return function (v1) {
            return false;
        };
    })(true);
};

// | Combines a collection of elements using the `Alt` operation.
var oneOf = function (dictFoldable) {
    var foldr2 = foldr(dictFoldable);
    return function (dictPlus) {
        return foldr2(Control_Alt.alt(dictPlus.Alt0()))(Control_Plus.empty(dictPlus));
    };
};

// | Folds a structure into some `Plus`.
var oneOfMap = function (dictFoldable) {
    var foldr2 = foldr(dictFoldable);
    return function (dictPlus) {
        var alt = Control_Alt.alt(dictPlus.Alt0());
        var empty = Control_Plus.empty(dictPlus);
        return function (f) {
            return foldr2(function ($455) {
                return alt(f($455));
            })(empty);
        };
    };
};

// | Traverse a data structure, performing some effects encoded by an
// | `Applicative` functor at each value, ignoring the final result.
// |
// | For example:
// |
// | ```purescript
// | traverse_ print [1, 2, 3]
// | ```
var traverse_ = function (dictApplicative) {
    var applySecond = Control_Apply.applySecond(dictApplicative.Apply0());
    var pure = Control_Applicative.pure(dictApplicative);
    return function (dictFoldable) {
        var foldr2 = foldr(dictFoldable);
        return function (f) {
            return foldr2(function ($456) {
                return applySecond(f($456));
            })(pure(Data_Unit.unit));
        };
    };
};

// | A version of `traverse_` with its arguments flipped.
// |
// | This can be useful when running an action written using do notation
// | for every element in a data structure:
// |
// | For example:
// |
// | ```purescript
// | for_ [1, 2, 3] \n -> do
// |   print n
// |   trace "squared is"
// |   print (n * n)
// | ```
var for_ = function (dictApplicative) {
    var traverse_1 = traverse_(dictApplicative);
    return function (dictFoldable) {
        return Data_Function.flip(traverse_1(dictFoldable));
    };
};

// | Perform all of the effects in some data structure in the order
// | given by the `Foldable` instance, ignoring the final result.
// |
// | For example:
// |
// | ```purescript
// | sequence_ [ trace "Hello, ", trace " world!" ]
// | ```
var sequence_ = function (dictApplicative) {
    var traverse_1 = traverse_(dictApplicative);
    return function (dictFoldable) {
        return traverse_1(dictFoldable)(identity);
    };
};
var foldl = function (dict) {
    return dict.foldl;
};

// | Try to get nth element from the left in a data structure
var indexl = function (dictFoldable) {
    var foldl2 = foldl(dictFoldable);
    return function (idx) {
        var go = function (cursor) {
            return function (a) {
                if (cursor.elem instanceof Data_Maybe.Just) {
                    return cursor;
                };
                var $298 = cursor.pos === idx;
                if ($298) {
                    return {
                        elem: new Data_Maybe.Just(a),
                        pos: cursor.pos
                    };
                };
                return {
                    pos: cursor.pos + 1 | 0,
                    elem: cursor.elem
                };
            };
        };
        var $457 = foldl2(go)({
            elem: Data_Maybe.Nothing.value,
            pos: 0
        });
        return function ($458) {
            return (function (v) {
                return v.elem;
            })($457($458));
        };
    };
};

// | Fold a data structure, accumulating values in some `Monoid`,
// | combining adjacent elements using the specified separator.
// |
// | For example:
// |
// | ```purescript
// | > intercalate ", " ["Lorem", "ipsum", "dolor"]
// | = "Lorem, ipsum, dolor"
// |
// | > intercalate "*" ["a", "b", "c"]
// | = "a*b*c"
// |
// | > intercalate [1] [[2, 3], [4, 5], [6, 7]]
// | = [2, 3, 1, 4, 5, 1, 6, 7]
// | ```
var intercalate = function (dictFoldable) {
    var foldl2 = foldl(dictFoldable);
    return function (dictMonoid) {
        var append = Data_Semigroup.append(dictMonoid.Semigroup0());
        var mempty = Data_Monoid.mempty(dictMonoid);
        return function (sep) {
            return function (xs) {
                var go = function (v) {
                    return function (v1) {
                        if (v.init) {
                            return {
                                init: false,
                                acc: v1
                            };
                        };
                        return {
                            init: false,
                            acc: append(v.acc)(append(sep)(v1))
                        };
                    };
                };
                return (foldl2(go)({
                    init: true,
                    acc: mempty
                })(xs)).acc;
            };
        };
    };
};

// | Returns the size/length of a finite structure.
// | Optimized for structures that are similar to cons-lists, because there
// | is no general way to do better.
var length = function (dictFoldable) {
    var foldl2 = foldl(dictFoldable);
    return function (dictSemiring) {
        var add1 = Data_Semiring.add(dictSemiring);
        var one = Data_Semiring.one(dictSemiring);
        return foldl2(function (c) {
            return function (v) {
                return add1(one)(c);
            };
        })(Data_Semiring.zero(dictSemiring));
    };
};

// | Find the largest element of a structure, according to a given comparison
// | function. The comparison function should represent a total ordering (see
// | the `Ord` type class laws); if it does not, the behaviour is undefined.
var maximumBy = function (dictFoldable) {
    var foldl2 = foldl(dictFoldable);
    return function (cmp) {
        var max$prime = function (v) {
            return function (v1) {
                if (v instanceof Data_Maybe.Nothing) {
                    return new Data_Maybe.Just(v1);
                };
                if (v instanceof Data_Maybe.Just) {
                    return new Data_Maybe.Just((function () {
                        var $305 = eq1(cmp(v.value0)(v1))(Data_Ordering.GT.value);
                        if ($305) {
                            return v.value0;
                        };
                        return v1;
                    })());
                };
                throw new Error("Failed pattern match at Data.Foldable (line 441, column 3 - line 441, column 27): " + [ v.constructor.name, v1.constructor.name ]);
            };
        };
        return foldl2(max$prime)(Data_Maybe.Nothing.value);
    };
};

// | Find the largest element of a structure, according to its `Ord` instance.
var maximum = function (dictOrd) {
    var compare = Data_Ord.compare(dictOrd);
    return function (dictFoldable) {
        return maximumBy(dictFoldable)(compare);
    };
};

// | Find the smallest element of a structure, according to a given comparison
// | function. The comparison function should represent a total ordering (see
// | the `Ord` type class laws); if it does not, the behaviour is undefined.
var minimumBy = function (dictFoldable) {
    var foldl2 = foldl(dictFoldable);
    return function (cmp) {
        var min$prime = function (v) {
            return function (v1) {
                if (v instanceof Data_Maybe.Nothing) {
                    return new Data_Maybe.Just(v1);
                };
                if (v instanceof Data_Maybe.Just) {
                    return new Data_Maybe.Just((function () {
                        var $309 = eq1(cmp(v.value0)(v1))(Data_Ordering.LT.value);
                        if ($309) {
                            return v.value0;
                        };
                        return v1;
                    })());
                };
                throw new Error("Failed pattern match at Data.Foldable (line 454, column 3 - line 454, column 27): " + [ v.constructor.name, v1.constructor.name ]);
            };
        };
        return foldl2(min$prime)(Data_Maybe.Nothing.value);
    };
};

// | Find the smallest element of a structure, according to its `Ord` instance.
var minimum = function (dictOrd) {
    var compare = Data_Ord.compare(dictOrd);
    return function (dictFoldable) {
        return minimumBy(dictFoldable)(compare);
    };
};

// | Find the product of the numeric values in a data structure.
var product = function (dictFoldable) {
    var foldl2 = foldl(dictFoldable);
    return function (dictSemiring) {
        return foldl2(Data_Semiring.mul(dictSemiring))(Data_Semiring.one(dictSemiring));
    };
};

// | Find the sum of the numeric values in a data structure.
var sum = function (dictFoldable) {
    var foldl2 = foldl(dictFoldable);
    return function (dictSemiring) {
        return foldl2(Data_Semiring.add(dictSemiring))(Data_Semiring.zero(dictSemiring));
    };
};
var foldableTuple = {
    foldr: function (f) {
        return function (z) {
            return function (v) {
                return f(v.value1)(z);
            };
        };
    },
    foldl: function (f) {
        return function (z) {
            return function (v) {
                return f(z)(v.value1);
            };
        };
    },
    foldMap: function (dictMonoid) {
        return function (f) {
            return function (v) {
                return f(v.value1);
            };
        };
    }
};
var foldableMultiplicative = {
    foldr: function (f) {
        return function (z) {
            return function (v) {
                return f(v)(z);
            };
        };
    },
    foldl: function (f) {
        return function (z) {
            return function (v) {
                return f(z)(v);
            };
        };
    },
    foldMap: function (dictMonoid) {
        return function (f) {
            return function (v) {
                return f(v);
            };
        };
    }
};
var foldableMaybe = {
    foldr: function (v) {
        return function (v1) {
            return function (v2) {
                if (v2 instanceof Data_Maybe.Nothing) {
                    return v1;
                };
                if (v2 instanceof Data_Maybe.Just) {
                    return v(v2.value0)(v1);
                };
                throw new Error("Failed pattern match at Data.Foldable (line 138, column 1 - line 144, column 27): " + [ v.constructor.name, v1.constructor.name, v2.constructor.name ]);
            };
        };
    },
    foldl: function (v) {
        return function (v1) {
            return function (v2) {
                if (v2 instanceof Data_Maybe.Nothing) {
                    return v1;
                };
                if (v2 instanceof Data_Maybe.Just) {
                    return v(v1)(v2.value0);
                };
                throw new Error("Failed pattern match at Data.Foldable (line 138, column 1 - line 144, column 27): " + [ v.constructor.name, v1.constructor.name, v2.constructor.name ]);
            };
        };
    },
    foldMap: function (dictMonoid) {
        var mempty = Data_Monoid.mempty(dictMonoid);
        return function (v) {
            return function (v1) {
                if (v1 instanceof Data_Maybe.Nothing) {
                    return mempty;
                };
                if (v1 instanceof Data_Maybe.Just) {
                    return v(v1.value0);
                };
                throw new Error("Failed pattern match at Data.Foldable (line 138, column 1 - line 144, column 27): " + [ v.constructor.name, v1.constructor.name ]);
            };
        };
    }
};
var foldr1 = /* #__PURE__ */ foldr(foldableMaybe);
var foldl1 = /* #__PURE__ */ foldl(foldableMaybe);
var foldableIdentity = {
    foldr: function (f) {
        return function (z) {
            return function (v) {
                return f(v)(z);
            };
        };
    },
    foldl: function (f) {
        return function (z) {
            return function (v) {
                return f(z)(v);
            };
        };
    },
    foldMap: function (dictMonoid) {
        return function (f) {
            return function (v) {
                return f(v);
            };
        };
    }
};
var foldableEither = {
    foldr: function (v) {
        return function (v1) {
            return function (v2) {
                if (v2 instanceof Data_Either.Left) {
                    return v1;
                };
                if (v2 instanceof Data_Either.Right) {
                    return v(v2.value0)(v1);
                };
                throw new Error("Failed pattern match at Data.Foldable (line 181, column 1 - line 187, column 28): " + [ v.constructor.name, v1.constructor.name, v2.constructor.name ]);
            };
        };
    },
    foldl: function (v) {
        return function (v1) {
            return function (v2) {
                if (v2 instanceof Data_Either.Left) {
                    return v1;
                };
                if (v2 instanceof Data_Either.Right) {
                    return v(v1)(v2.value0);
                };
                throw new Error("Failed pattern match at Data.Foldable (line 181, column 1 - line 187, column 28): " + [ v.constructor.name, v1.constructor.name, v2.constructor.name ]);
            };
        };
    },
    foldMap: function (dictMonoid) {
        var mempty = Data_Monoid.mempty(dictMonoid);
        return function (v) {
            return function (v1) {
                if (v1 instanceof Data_Either.Left) {
                    return mempty;
                };
                if (v1 instanceof Data_Either.Right) {
                    return v(v1.value0);
                };
                throw new Error("Failed pattern match at Data.Foldable (line 181, column 1 - line 187, column 28): " + [ v.constructor.name, v1.constructor.name ]);
            };
        };
    }
};
var foldableDual = {
    foldr: function (f) {
        return function (z) {
            return function (v) {
                return f(v)(z);
            };
        };
    },
    foldl: function (f) {
        return function (z) {
            return function (v) {
                return f(z)(v);
            };
        };
    },
    foldMap: function (dictMonoid) {
        return function (f) {
            return function (v) {
                return f(v);
            };
        };
    }
};
var foldableDisj = {
    foldr: function (f) {
        return function (z) {
            return function (v) {
                return f(v)(z);
            };
        };
    },
    foldl: function (f) {
        return function (z) {
            return function (v) {
                return f(z)(v);
            };
        };
    },
    foldMap: function (dictMonoid) {
        return function (f) {
            return function (v) {
                return f(v);
            };
        };
    }
};
var foldableConst = {
    foldr: function (v) {
        return function (z) {
            return function (v1) {
                return z;
            };
        };
    },
    foldl: function (v) {
        return function (z) {
            return function (v1) {
                return z;
            };
        };
    },
    foldMap: function (dictMonoid) {
        var mempty = Data_Monoid.mempty(dictMonoid);
        return function (v) {
            return function (v1) {
                return mempty;
            };
        };
    }
};
var foldableConj = {
    foldr: function (f) {
        return function (z) {
            return function (v) {
                return f(v)(z);
            };
        };
    },
    foldl: function (f) {
        return function (z) {
            return function (v) {
                return f(z)(v);
            };
        };
    },
    foldMap: function (dictMonoid) {
        return function (f) {
            return function (v) {
                return f(v);
            };
        };
    }
};
var foldableAdditive = {
    foldr: function (f) {
        return function (z) {
            return function (v) {
                return f(v)(z);
            };
        };
    },
    foldl: function (f) {
        return function (z) {
            return function (v) {
                return f(z)(v);
            };
        };
    },
    foldMap: function (dictMonoid) {
        return function (f) {
            return function (v) {
                return f(v);
            };
        };
    }
};

// | A default implementation of `foldMap` using `foldr`.
// |
// | Note: when defining a `Foldable` instance, this function is unsafe to use
// | in combination with `foldrDefault`.
var foldMapDefaultR = function (dictFoldable) {
    var foldr2 = foldr(dictFoldable);
    return function (dictMonoid) {
        var append = Data_Semigroup.append(dictMonoid.Semigroup0());
        var mempty = Data_Monoid.mempty(dictMonoid);
        return function (f) {
            return foldr2(function (x) {
                return function (acc) {
                    return append(f(x))(acc);
                };
            })(mempty);
        };
    };
};
var foldableArray = {
    foldr: $foreign.foldrArray,
    foldl: $foreign.foldlArray,
    foldMap: function (dictMonoid) {
        return foldMapDefaultR(foldableArray)(dictMonoid);
    }
};

// | A default implementation of `foldMap` using `foldl`.
// |
// | Note: when defining a `Foldable` instance, this function is unsafe to use
// | in combination with `foldlDefault`.
var foldMapDefaultL = function (dictFoldable) {
    var foldl2 = foldl(dictFoldable);
    return function (dictMonoid) {
        var append = Data_Semigroup.append(dictMonoid.Semigroup0());
        var mempty = Data_Monoid.mempty(dictMonoid);
        return function (f) {
            return foldl2(function (acc) {
                return function (x) {
                    return append(acc)(f(x));
                };
            })(mempty);
        };
    };
};
var foldMap = function (dict) {
    return dict.foldMap;
};
var foldMap1 = /* #__PURE__ */ foldMap(foldableMaybe);
var foldableApp = function (dictFoldable) {
    var foldr2 = foldr(dictFoldable);
    var foldl2 = foldl(dictFoldable);
    var foldMap2 = foldMap(dictFoldable);
    return {
        foldr: function (f) {
            return function (i) {
                return function (v) {
                    return foldr2(f)(i)(v);
                };
            };
        },
        foldl: function (f) {
            return function (i) {
                return function (v) {
                    return foldl2(f)(i)(v);
                };
            };
        },
        foldMap: function (dictMonoid) {
            var foldMap3 = foldMap2(dictMonoid);
            return function (f) {
                return function (v) {
                    return foldMap3(f)(v);
                };
            };
        }
    };
};
var foldableCompose = function (dictFoldable) {
    var foldr2 = foldr(dictFoldable);
    var foldl2 = foldl(dictFoldable);
    var foldMap2 = foldMap(dictFoldable);
    return function (dictFoldable1) {
        var foldr3 = foldr(dictFoldable1);
        var foldl3 = foldl(dictFoldable1);
        var foldMap3 = foldMap(dictFoldable1);
        return {
            foldr: function (f) {
                return function (i) {
                    return function (v) {
                        return foldr2(Data_Function.flip(foldr3(f)))(i)(v);
                    };
                };
            },
            foldl: function (f) {
                return function (i) {
                    return function (v) {
                        return foldl2(foldl3(f))(i)(v);
                    };
                };
            },
            foldMap: function (dictMonoid) {
                var foldMap4 = foldMap2(dictMonoid);
                var foldMap5 = foldMap3(dictMonoid);
                return function (f) {
                    return function (v) {
                        return foldMap4(foldMap5(f))(v);
                    };
                };
            }
        };
    };
};
var foldableCoproduct = function (dictFoldable) {
    var foldr2 = foldr(dictFoldable);
    var foldl2 = foldl(dictFoldable);
    var foldMap2 = foldMap(dictFoldable);
    return function (dictFoldable1) {
        var foldr3 = foldr(dictFoldable1);
        var foldl3 = foldl(dictFoldable1);
        var foldMap3 = foldMap(dictFoldable1);
        return {
            foldr: function (f) {
                return function (z) {
                    return Data_Functor_Coproduct.coproduct(foldr2(f)(z))(foldr3(f)(z));
                };
            },
            foldl: function (f) {
                return function (z) {
                    return Data_Functor_Coproduct.coproduct(foldl2(f)(z))(foldl3(f)(z));
                };
            },
            foldMap: function (dictMonoid) {
                var foldMap4 = foldMap2(dictMonoid);
                var foldMap5 = foldMap3(dictMonoid);
                return function (f) {
                    return Data_Functor_Coproduct.coproduct(foldMap4(f))(foldMap5(f));
                };
            }
        };
    };
};
var foldableFirst = {
    foldr: function (f) {
        return function (z) {
            return function (v) {
                return foldr1(f)(z)(v);
            };
        };
    },
    foldl: function (f) {
        return function (z) {
            return function (v) {
                return foldl1(f)(z)(v);
            };
        };
    },
    foldMap: function (dictMonoid) {
        var foldMap2 = foldMap1(dictMonoid);
        return function (f) {
            return function (v) {
                return foldMap2(f)(v);
            };
        };
    }
};
var foldableLast = {
    foldr: function (f) {
        return function (z) {
            return function (v) {
                return foldr1(f)(z)(v);
            };
        };
    },
    foldl: function (f) {
        return function (z) {
            return function (v) {
                return foldl1(f)(z)(v);
            };
        };
    },
    foldMap: function (dictMonoid) {
        var foldMap2 = foldMap1(dictMonoid);
        return function (f) {
            return function (v) {
                return foldMap2(f)(v);
            };
        };
    }
};
var foldableProduct = function (dictFoldable) {
    var foldr2 = foldr(dictFoldable);
    var foldl2 = foldl(dictFoldable);
    var foldMap2 = foldMap(dictFoldable);
    return function (dictFoldable1) {
        var foldr3 = foldr(dictFoldable1);
        var foldl3 = foldl(dictFoldable1);
        var foldMap3 = foldMap(dictFoldable1);
        return {
            foldr: function (f) {
                return function (z) {
                    return function (v) {
                        return foldr2(f)(foldr3(f)(z)(v.value1))(v.value0);
                    };
                };
            },
            foldl: function (f) {
                return function (z) {
                    return function (v) {
                        return foldl3(f)(foldl2(f)(z)(v.value0))(v.value1);
                    };
                };
            },
            foldMap: function (dictMonoid) {
                var append = Data_Semigroup.append(dictMonoid.Semigroup0());
                var foldMap4 = foldMap2(dictMonoid);
                var foldMap5 = foldMap3(dictMonoid);
                return function (f) {
                    return function (v) {
                        return append(foldMap4(f)(v.value0))(foldMap5(f)(v.value1));
                    };
                };
            }
        };
    };
};

// | A default implementation of `foldl` using `foldMap`.
// |
// | Note: when defining a `Foldable` instance, this function is unsafe to use
// | in combination with `foldMapDefaultL`.
var foldlDefault = function (dictFoldable) {
    var foldMap2 = foldMap(dictFoldable)(monoidDual);
    return function (c) {
        return function (u) {
            return function (xs) {
                return unwrap(unwrap(foldMap2((function () {
                    var $459 = Data_Function.flip(c);
                    return function ($460) {
                        return Data_Monoid_Dual.Dual(Data_Monoid_Endo.Endo($459($460)));
                    };
                })())(xs)))(u);
            };
        };
    };
};

// | A default implementation of `foldr` using `foldMap`.
// |
// | Note: when defining a `Foldable` instance, this function is unsafe to use
// | in combination with `foldMapDefaultR`.
var foldrDefault = function (dictFoldable) {
    var foldMap2 = foldMap(dictFoldable)(monoidEndo);
    return function (c) {
        return function (u) {
            return function (xs) {
                return unwrap(foldMap2(function ($461) {
                    return Data_Monoid_Endo.Endo(c($461));
                })(xs))(u);
            };
        };
    };
};

// | Lookup a value in a data structure of `Tuple`s, generalizing association lists.
var lookup = function (dictFoldable) {
    var foldMap2 = foldMap(dictFoldable)(Data_Maybe_First.monoidFirst);
    return function (dictEq) {
        var eq2 = Data_Eq.eq(dictEq);
        return function (a) {
            var $462 = foldMap2(function (v) {
                var $446 = eq2(a)(v.value0);
                if ($446) {
                    return new Data_Maybe.Just(v.value1);
                };
                return Data_Maybe.Nothing.value;
            });
            return function ($463) {
                return unwrap1($462($463));
            };
        };
    };
};

// | `foldMap` but with each element surrounded by some fixed value.
// |
// | For example:
// |
// | ```purescript
// | > surroundMap "*" show []
// | = "*"
// |
// | > surroundMap "*" show [1]
// | = "*1*"
// |
// | > surroundMap "*" show [1, 2]
// | = "*1*2*"
// |
// | > surroundMap "*" show [1, 2, 3]
// | = "*1*2*3*"
// | ```
var surroundMap = function (dictFoldable) {
    var foldMap2 = foldMap(dictFoldable)(monoidEndo);
    return function (dictSemigroup) {
        var append = Data_Semigroup.append(dictSemigroup);
        return function (d) {
            return function (t) {
                return function (f) {
                    var joined = function (a) {
                        return function (m) {
                            return append(d)(append(t(a))(m));
                        };
                    };
                    return unwrap(foldMap2(joined)(f))(d);
                };
            };
        };
    };
};

// | `fold` but with each element surrounded by some fixed value.
// |
// | For example:
// |
// | ```purescript
// | > surround "*" []
// | = "*"
// |
// | > surround "*" ["1"]
// | = "*1*"
// |
// | > surround "*" ["1", "2"]
// | = "*1*2*"
// |
// | > surround "*" ["1", "2", "3"]
// | = "*1*2*3*"
// | ```
var surround = function (dictFoldable) {
    var surroundMap1 = surroundMap(dictFoldable);
    return function (dictSemigroup) {
        var surroundMap2 = surroundMap1(dictSemigroup);
        return function (d) {
            return surroundMap2(d)(identity);
        };
    };
};

// | Similar to 'foldl', but the result is encapsulated in a monad.
// |
// | Note: this function is not generally stack-safe, e.g., for monads which
// | build up thunks a la `Eff`.
var foldM = function (dictFoldable) {
    var foldl2 = foldl(dictFoldable);
    return function (dictMonad) {
        var bind = Control_Bind.bind(dictMonad.Bind1());
        var pure = Control_Applicative.pure(dictMonad.Applicative0());
        return function (f) {
            return function (b0) {
                return foldl2(function (b) {
                    return function (a) {
                        return bind(b)(Data_Function.flip(f)(a));
                    };
                })(pure(b0));
            };
        };
    };
};

// | Fold a data structure, accumulating values in some `Monoid`.
var fold = function (dictFoldable) {
    var foldMap2 = foldMap(dictFoldable);
    return function (dictMonoid) {
        return foldMap2(dictMonoid)(identity);
    };
};

// | Try to find an element in a data structure which satisfies a predicate mapping.
var findMap = function (dictFoldable) {
    var foldl2 = foldl(dictFoldable);
    return function (p) {
        var go = function (v) {
            return function (v1) {
                if (v instanceof Data_Maybe.Nothing) {
                    return p(v1);
                };
                return v;
            };
        };
        return foldl2(go)(Data_Maybe.Nothing.value);
    };
};

// | Try to find an element in a data structure which satisfies a predicate.
var find = function (dictFoldable) {
    var foldl2 = foldl(dictFoldable);
    return function (p) {
        var go = function (v) {
            return function (v1) {
                if (v instanceof Data_Maybe.Nothing && p(v1)) {
                    return new Data_Maybe.Just(v1);
                };
                return v;
            };
        };
        return foldl2(go)(Data_Maybe.Nothing.value);
    };
};

// | `any f` is the same as `or <<< map f`; map a function over the structure,
// | and then get the disjunction of the results.
var any = function (dictFoldable) {
    var foldMap2 = foldMap(dictFoldable);
    return function (dictHeytingAlgebra) {
        return alaF(Data_Monoid_Disj.Disj)(foldMap2(Data_Monoid_Disj.monoidDisj(dictHeytingAlgebra)));
    };
};

// | Test whether a value is an element of a data structure.
var elem = function (dictFoldable) {
    var any1 = any(dictFoldable)(Data_HeytingAlgebra.heytingAlgebraBoolean);
    return function (dictEq) {
        var $464 = Data_Eq.eq(dictEq);
        return function ($465) {
            return any1($464($465));
        };
    };
};

// | Test whether a value is not an element of a data structure.
var notElem = function (dictFoldable) {
    var elem1 = elem(dictFoldable);
    return function (dictEq) {
        var elem2 = elem1(dictEq);
        return function (x) {
            var $466 = elem2(x);
            return function ($467) {
                return !$466($467);
            };
        };
    };
};

// | The disjunction of all the values in a data structure. When specialized
// | to `Boolean`, this function will test whether any of the values in a data
// | structure is `true`.
var or = function (dictFoldable) {
    var any1 = any(dictFoldable);
    return function (dictHeytingAlgebra) {
        return any1(dictHeytingAlgebra)(identity1);
    };
};

// | `all f` is the same as `and <<< map f`; map a function over the structure,
// | and then get the conjunction of the results.
var all = function (dictFoldable) {
    var foldMap2 = foldMap(dictFoldable);
    return function (dictHeytingAlgebra) {
        return alaF(Data_Monoid_Conj.Conj)(foldMap2(Data_Monoid_Conj.monoidConj(dictHeytingAlgebra)));
    };
};

// | The conjunction of all the values in a data structure. When specialized
// | to `Boolean`, this function will test whether all of the values in a data
// | structure are `true`.
var and = function (dictFoldable) {
    var all1 = all(dictFoldable);
    return function (dictHeytingAlgebra) {
        return all1(dictHeytingAlgebra)(identity1);
    };
};
export {
    foldr,
    foldl,
    foldMap,
    foldrDefault,
    foldlDefault,
    foldMapDefaultL,
    foldMapDefaultR,
    fold,
    foldM,
    traverse_,
    for_,
    sequence_,
    oneOf,
    oneOfMap,
    intercalate,
    surroundMap,
    surround,
    and,
    or,
    all,
    any,
    sum,
    product,
    elem,
    notElem,
    indexl,
    indexr,
    find,
    findMap,
    maximum,
    maximumBy,
    minimum,
    minimumBy,
    $$null as null,
    length,
    lookup,
    foldableArray,
    foldableMaybe,
    foldableFirst,
    foldableLast,
    foldableAdditive,
    foldableDual,
    foldableDisj,
    foldableConj,
    foldableMultiplicative,
    foldableEither,
    foldableTuple,
    foldableIdentity,
    foldableConst,
    foldableProduct,
    foldableCoproduct,
    foldableCompose,
    foldableApp
};
