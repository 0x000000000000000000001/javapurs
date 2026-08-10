import * as Control_Category from "../Control.Category/index.js";
import * as Data_Newtype from "../Data.Newtype/index.js";
var identity = /* #__PURE__ */ Control_Category.identity(Control_Category.categoryFn);
var identity1 = /* #__PURE__ */ Control_Category.identity(Control_Category.categoryFn);
var wrap = /* #__PURE__ */ Data_Newtype.wrap();
var unwrap = /* #__PURE__ */ Data_Newtype.unwrap();
var profunctorFn = {
    dimap: function (a2b) {
        return function (c2d) {
            return function (b2c) {
                return function ($19) {
                    return c2d(b2c(a2b($19)));
                };
            };
        };
    }
};
var dimap = function (dict) {
    return dict.dimap;
};

// | Map a function over the (contravariant) first type argument only.
var lcmap = function (dictProfunctor) {
    var dimap1 = dimap(dictProfunctor);
    return function (a2b) {
        return dimap1(a2b)(identity);
    };
};

// | Map a function over the (covariant) second type argument only.
var rmap = function (dictProfunctor) {
    var dimap1 = dimap(dictProfunctor);
    return function (b2c) {
        return dimap1(identity1)(b2c);
    };
};
var unwrapIso = function (dictProfunctor) {
    var dimap1 = dimap(dictProfunctor);
    return function () {
        return dimap1(wrap)(unwrap);
    };
};
var wrapIso = function (dictProfunctor) {
    var dimap1 = dimap(dictProfunctor);
    return function () {
        return function (v) {
            return dimap1(unwrap)(wrap);
        };
    };
};

// | Lift a pure function into any `Profunctor` which is also a `Category`.
var arr = function (dictCategory) {
    var identity2 = Control_Category.identity(dictCategory);
    return function (dictProfunctor) {
        var rmap1 = rmap(dictProfunctor);
        return function (f) {
            return rmap1(f)(identity2);
        };
    };
};
export {
    dimap,
    lcmap,
    rmap,
    arr,
    unwrapIso,
    wrapIso,
    profunctorFn
};
