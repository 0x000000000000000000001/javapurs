// | This module defines the `Cont`inuation monad.
import * as Control_Monad_Cont_Class from "../Control.Monad.Cont.Class/index.js";
import * as Control_Monad_Cont_Trans from "../Control.Monad.Cont.Trans/index.js";
import * as Control_Semigroupoid from "../Control.Semigroupoid/index.js";
import * as Data_Identity from "../Data.Identity/index.js";
import * as Data_Newtype from "../Data.Newtype/index.js";
var compose = /* #__PURE__ */ Control_Semigroupoid.compose(Control_Semigroupoid.semigroupoidFn);
var unwrap = /* #__PURE__ */ Data_Newtype.unwrap();
var unwrap1 = /* #__PURE__ */ Data_Newtype.unwrap();

// | Transform the continuation passed into the continuation-passing function.
var withCont = function (f) {
    return Control_Monad_Cont_Trans.withContT((function () {
        var $3 = compose(Data_Identity.Identity);
        var $4 = compose(unwrap);
        return function ($5) {
            return $3(f($4($5)));
        };
    })());
};

// | Runs a computation in the `Cont` monad.
var runCont = function (cc) {
    return function (k) {
        return unwrap1(Control_Monad_Cont_Trans.runContT(cc)(function ($6) {
            return Data_Identity.Identity(k($6));
        }));
    };
};

// | Transform the result of a continuation-passing function.
var mapCont = function (f) {
    return Control_Monad_Cont_Trans.mapContT(function ($7) {
        return Data_Identity.Identity(f(unwrap($7)));
    });
};

// | Creates a computation in the `Cont` monad.
var cont = function (f) {
    return function (c) {
        return f(function ($8) {
            return unwrap(c($8));
        });
    };
};
export {
    cont,
    runCont,
    mapCont,
    withCont
};
export {
    callCC
} from "../Control.Monad.Cont.Class/index.js";
export {
    ContT,
    lift,
    mapContT,
    runContT,
    withContT
} from "../Control.Monad.Cont.Trans/index.js";
