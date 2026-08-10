// | This module defines functions for working with grates.
// |
// | See <http://r6research.livejournal.com/28050.html>.
import * as Control_Category from "../Control.Category/index.js";
import * as Data_Distributive from "../Data.Distributive/index.js";
import * as Data_Function from "../Data.Function/index.js";
import * as Data_Functor from "../Data.Functor/index.js";
import * as Data_Lens_Types from "../Data.Lens.Types/index.js";
import * as Data_Newtype from "../Data.Newtype/index.js";
import * as Data_Profunctor from "../Data.Profunctor/index.js";
import * as Data_Profunctor_Closed from "../Data.Profunctor.Closed/index.js";
var unwrap = /* #__PURE__ */ Data_Newtype.unwrap();
var identity = /* #__PURE__ */ Control_Category.identity(Control_Category.categoryFn);
var identity1 = /* #__PURE__ */ Control_Category.identity(Control_Category.categoryFn);
var zipWithOf = function (g) {
    return function (f) {
        return unwrap(g(f));
    };
};
var zipFWithOf = function (g) {
    return function (f) {
        return unwrap(g(f));
    };
};
var withGrate = function (g) {
    return unwrap(g(function (f) {
        return f(identity);
    }));
};
var grate = function (f) {
    return function (dictClosed) {
        var dimap = Data_Profunctor.dimap(dictClosed.Profunctor0());
        var closed = Data_Profunctor_Closed.closed(dictClosed);
        return function (pab) {
            return dimap(Data_Function.applyFlipped)(f)(closed(pab));
        };
    };
};
var cotraversed = function (dictDistributive) {
    var cotraverse = Data_Distributive.cotraverse(dictDistributive)(Data_Functor.functorFn);
    return function (dictClosed) {
        return grate(function (f) {
            return cotraverse(f)(identity1);
        })(dictClosed);
    };
};
var collectOf = function (dictFunctor) {
    var map = Data_Functor.map(dictFunctor);
    return function (g) {
        return function (f) {
            var $15 = zipFWithOf(g)(identity1);
            var $16 = map(f);
            return function ($17) {
                return $15($16($17));
            };
        };
    };
};
var cloneGrate = function (g) {
    return function (dictClosed) {
        return grate(withGrate(g))(dictClosed);
    };
};
export {
    grate,
    withGrate,
    cloneGrate,
    cotraversed,
    zipWithOf,
    zipFWithOf,
    collectOf
};
