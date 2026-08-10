import * as $foreign from "./foreign.js";
import * as Control_Applicative from "../Control.Applicative/index.js";
import * as Control_Apply from "../Control.Apply/index.js";
import * as Control_Bind from "../Control.Bind/index.js";
import * as Control_Monad from "../Control.Monad/index.js";
import * as Control_Monad_Error_Class from "../Control.Monad.Error.Class/index.js";
import * as Control_Monad_Rec_Class from "../Control.Monad.Rec.Class/index.js";
import * as Control_Monad_ST_Class from "../Control.Monad.ST.Class/index.js";
import * as Control_Parallel from "../Control.Parallel/index.js";
import * as Control_Parallel_Class from "../Control.Parallel.Class/index.js";
import * as Control_Plus from "../Control.Plus/index.js";
import * as Data_Either from "../Data.Either/index.js";
import * as Data_Foldable from "../Data.Foldable/index.js";
import * as Data_Function from "../Data.Function/index.js";
import * as Data_Functor from "../Data.Functor/index.js";
import * as Data_Monoid from "../Data.Monoid/index.js";
import * as Data_Semigroup from "../Data.Semigroup/index.js";
import * as Data_Time_Duration from "../Data.Time.Duration/index.js";
import * as Data_Unit from "../Data.Unit/index.js";
import * as Effect from "../Effect/index.js";
import * as Effect_Class from "../Effect.Class/index.js";
import * as Effect_Exception from "../Effect.Exception/index.js";
import * as Effect_Unsafe from "../Effect.Unsafe/index.js";
import * as Partial_Unsafe from "../Partial.Unsafe/index.js";
import * as Unsafe_Coerce from "../Unsafe.Coerce/index.js";
var $runtime_lazy = function (name, moduleName, init) {
    var state = 0;
    var val;
    return function (lineNumber) {
        if (state === 2) return val;
        if (state === 1) throw new ReferenceError(name + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
        state = 1;
        val = init();
        state = 2;
        return val;
    };
};
var pure = /* #__PURE__ */ Control_Applicative.pure(Effect.applicativeEffect);
var $$void = /* #__PURE__ */ Data_Functor["void"](Effect.functorEffect);
var map = /* #__PURE__ */ Data_Functor.map(Effect.functorEffect);
var void1 = /* #__PURE__ */ Data_Functor["void"](Effect.functorEffect);
var pure1 = /* #__PURE__ */ Control_Applicative.pure(Data_Either.applicativeEither);

// | Represents a forked computation by way of `forkAff`. `Fiber`s are
// | memoized, so their results are only computed once.
var Fiber = function (x) {
    return x;
};
var FFIUtil = function (x) {
    return x;
};

// | A cancellation effect for actions run via `makeAff`. If a `Fiber` is
// | killed, and an async action is pending, the canceler will be called to
// | clean it up.
var Canceler = function (x) {
    return x;
};

// | Suspends an `Aff` from within a parent `Aff` context, returning the `Fiber`.
// | A suspended `Aff` is not executed until a consumer observes the result
// | with `joinFiber`.
var suspendAff = /* #__PURE__ */ $foreign["_fork"](false);
var newtypeCanceler = {
    Coercible0: function () {
        return undefined;
    }
};
var functorParAff = {
    map: $foreign["_parAffMap"]
};
var functorAff = {
    map: $foreign["_map"]
};
var map1 = /* #__PURE__ */ Data_Functor.map(functorAff);

// | Forks an `Aff` from within a parent `Aff` context, returning the `Fiber`.
var forkAff = /* #__PURE__ */ $foreign["_fork"](true);
var ffiUtil = /* #__PURE__ */ (function () {
    var unsafeFromRight = function (v) {
        if (v instanceof Data_Either.Right) {
            return v.value0;
        };
        if (v instanceof Data_Either.Left) {
            return Partial_Unsafe.unsafeCrashWith("unsafeFromRight: Left");
        };
        throw new Error("Failed pattern match at Effect.Aff (line 412, column 21 - line 414, column 54): " + [ v.constructor.name ]);
    };
    var unsafeFromLeft = function (v) {
        if (v instanceof Data_Either.Left) {
            return v.value0;
        };
        if (v instanceof Data_Either.Right) {
            return Partial_Unsafe.unsafeCrashWith("unsafeFromLeft: Right");
        };
        throw new Error("Failed pattern match at Effect.Aff (line 407, column 20 - line 409, column 55): " + [ v.constructor.name ]);
    };
    var isLeft = function (v) {
        if (v instanceof Data_Either.Left) {
            return true;
        };
        if (v instanceof Data_Either.Right) {
            return false;
        };
        throw new Error("Failed pattern match at Effect.Aff (line 402, column 12 - line 404, column 21): " + [ v.constructor.name ]);
    };
    return {
        isLeft: isLeft,
        fromLeft: unsafeFromLeft,
        fromRight: unsafeFromRight,
        left: Data_Either.Left.create,
        right: Data_Either.Right.create
    };
})();
var makeFiber = function (aff) {
    return $foreign["_makeFiber"](ffiUtil, aff);
};

// | Forks an `Aff` from an `Effect` context, returning the `Fiber`.
var launchAff = function (aff) {
    return function __do() {
        var fiber = makeFiber(aff)();
        fiber.run();
        return fiber;
    };
};

// | Forks an `Aff` from an `Effect` context, discarding the `Fiber`.
var launchAff_ = function ($83) {
    return $$void(launchAff($83));
};

// | Suspends an `Aff` from an `Effect` context, returning the `Fiber`.
var launchSuspendedAff = makeFiber;

// | Pauses the running fiber.
var delay = function (v) {
    return $foreign["_delay"](Data_Either.Right.create, v);
};

// | Guarantees resource acquisition and cleanup. The first effect may acquire
// | some resource, while the second will dispose of it. The third effect makes
// | use of the resource. Disposal is always run last, regardless. Neither
// | acquisition nor disposal may be cancelled and are guaranteed to run until
// | they complete.
var bracket = function (acquire) {
    return function (completed) {
        return $foreign.generalBracket(acquire)({
            killed: Data_Function["const"](completed),
            failed: Data_Function["const"](completed),
            completed: Data_Function["const"](completed)
        });
    };
};

// | Runs effects in parallel, combining their results.
var applyParAff = {
    apply: $foreign["_parAffApply"],
    Functor0: function () {
        return functorParAff;
    }
};
var lift2 = /* #__PURE__ */ Control_Apply.lift2(applyParAff);
var semigroupParAff = function (dictSemigroup) {
    return {
        append: lift2(Data_Semigroup.append(dictSemigroup))
    };
};
var monadAff = {
    Applicative0: function () {
        return applicativeAff;
    },
    Bind1: function () {
        return bindAff;
    }
};
var bindAff = {
    bind: $foreign["_bind"],
    Apply0: function () {
        return $lazy_applyAff(0);
    }
};
var applicativeAff = {
    pure: $foreign["_pure"],
    Apply0: function () {
        return $lazy_applyAff(0);
    }
};
var $lazy_applyAff = /* #__PURE__ */ $runtime_lazy("applyAff", "Effect.Aff", function () {
    return {
        apply: Control_Monad.ap(monadAff),
        Functor0: function () {
            return functorAff;
        }
    };
});
var applyAff = /* #__PURE__ */ $lazy_applyAff(73);
var pure2 = /* #__PURE__ */ Control_Applicative.pure(applicativeAff);
var pure3 = /* #__PURE__ */ Control_Applicative.pure(applicativeAff);
var pure4 = /* #__PURE__ */ Control_Applicative.pure(applicativeAff);
var bind1 = /* #__PURE__ */ Control_Bind.bind(bindAff);
var lift21 = /* #__PURE__ */ Control_Apply.lift2(applyAff);
var apply = /* #__PURE__ */ Control_Apply.apply(applyAff);
var bindFlipped = /* #__PURE__ */ Control_Bind.bindFlipped(bindAff);

// | Attaches a custom `Canceler` to an action. If the computation is canceled,
// | then the custom `Canceler` will be run afterwards.
var cancelWith = function (aff) {
    return function (v) {
        return $foreign.generalBracket(pure2(Data_Unit.unit))({
            killed: function (e) {
                return function (v1) {
                    return v(e);
                };
            },
            failed: Data_Function["const"](pure3),
            completed: Data_Function["const"](pure3)
        })(Data_Function["const"](aff));
    };
};

// | Runs the first effect after the second, regardless of whether it completed
// | successfully or the fiber was cancelled.
var $$finally = function (fin) {
    return function (a) {
        return bracket(pure2(Data_Unit.unit))(Data_Function["const"](fin))(Data_Function["const"](a));
    };
};

// | Runs an effect such that it cannot be killed.
var invincible = function (a) {
    return bracket(a)(Data_Function["const"](pure2(Data_Unit.unit)))(pure4);
};
var lazyAff = {
    defer: function (f) {
        return bind1(pure2(Data_Unit.unit))(f);
    }
};
var parallelAff = {
    parallel: Unsafe_Coerce.unsafeCoerce,
    sequential: $foreign["_sequential"],
    Apply0: function () {
        return applyAff;
    },
    Apply1: function () {
        return applyParAff;
    }
};
var applicativeParAff = {
    pure: /* #__PURE__ */ (function () {
        var $84 = Control_Parallel_Class.parallel(parallelAff);
        var $85 = Control_Applicative.pure(applicativeAff);
        return function ($86) {
            return $84($85($86));
        };
    })(),
    Apply0: function () {
        return applyParAff;
    }
};
var pure5 = /* #__PURE__ */ Control_Applicative.pure(applicativeParAff);
var parSequence_ = /* #__PURE__ */ Control_Parallel.parSequence_(parallelAff)(applicativeParAff)(Data_Foldable.foldableArray);
var monoidParAff = function (dictMonoid) {
    var semigroupParAff1 = semigroupParAff(dictMonoid.Semigroup0());
    return {
        mempty: pure5(Data_Monoid.mempty(dictMonoid)),
        Semigroup0: function () {
            return semigroupParAff1;
        }
    };
};
var semigroupCanceler = {
    append: function (v) {
        return function (v1) {
            return function (err) {
                return parSequence_([ v(err), v1(err) ]);
            };
        };
    }
};
var semigroupAff = function (dictSemigroup) {
    return {
        append: lift21(Data_Semigroup.append(dictSemigroup))
    };
};
var monadEffectAff = {
    liftEffect: $foreign["_liftEffect"],
    Monad0: function () {
        return monadAff;
    }
};
var liftEffect = /* #__PURE__ */ Effect_Class.liftEffect(monadEffectAff);
var liftEffect1 = /* #__PURE__ */ Effect_Class.liftEffect(monadEffectAff);

// | A canceler from an Effect action.
var effectCanceler = function ($87) {
    return Canceler(Data_Function["const"](liftEffect($87)));
};

// | Blocks until the fiber completes, yielding the result. If the fiber
// | throws an exception, it is rethrown in the current fiber.
var joinFiber = function (v) {
    return $foreign.makeAff(function (k) {
        return map(effectCanceler)(v.join(k));
    });
};
var functorFiber = {
    map: function (f) {
        return function (t) {
            return Effect_Unsafe.unsafePerformEffect(makeFiber(map1(f)(joinFiber(t))));
        };
    }
};
var applyFiber = {
    apply: function (t1) {
        return function (t2) {
            return Effect_Unsafe.unsafePerformEffect(makeFiber(apply(joinFiber(t1))(joinFiber(t2))));
        };
    },
    Functor0: function () {
        return functorFiber;
    }
};
var applicativeFiber = {
    pure: function (a) {
        return Effect_Unsafe.unsafePerformEffect(makeFiber(pure2(a)));
    },
    Apply0: function () {
        return applyFiber;
    }
};

// | Invokes pending cancelers in a fiber and runs cleanup effects. Blocks
// | until the fiber has fully exited.
var killFiber = function (e) {
    return function (v) {
        return bind1(liftEffect1(v.isSuspended))(function (suspended) {
            if (suspended) {
                return liftEffect(void1(v.kill(e, Data_Function["const"](pure(Data_Unit.unit)))));
            };
            return $foreign.makeAff(function (k) {
                return map(effectCanceler)(v.kill(e, k));
            });
        });
    };
};

// | A canceler from a Fiber.
var fiberCanceler = /* #__PURE__ */ (function () {
    var $88 = Data_Function.flip(killFiber);
    return function ($89) {
        return Canceler($88($89));
    };
})();

// | Creates a new supervision context for some `Aff`, guaranteeing fiber
// | cleanup when the parent completes. Any pending fibers forked within
// | the context will be killed and have their cancelers run.
var supervise = function (aff) {
    var killError = Effect_Exception.error("[Aff] Child fiber outlived parent");
    var killAll = function (err) {
        return function (sup) {
            return $foreign.makeAff(function (k) {
                return $foreign["_killAll"](err, sup.supervisor, k(pure1(Data_Unit.unit)));
            });
        };
    };
    var acquire = function __do() {
        var sup = $foreign["_makeSupervisedFiber"](ffiUtil, aff)();
        sup.fiber.run();
        return sup;
    };
    return $foreign.generalBracket(liftEffect1(acquire))({
        killed: function (err) {
            return function (sup) {
                return parSequence_([ killFiber(err)(sup.fiber), killAll(err)(sup) ]);
            };
        },
        failed: Data_Function["const"](killAll(killError)),
        completed: Data_Function["const"](killAll(killError))
    })(function ($90) {
        return joinFiber((function (v) {
            return v.fiber;
        })($90));
    });
};
var monadSTAff = {
    liftST: /* #__PURE__ */ (function () {
        var $91 = Effect_Class.liftEffect(monadEffectAff);
        var $92 = Control_Monad_ST_Class.liftST(Control_Monad_ST_Class.monadSTEffect);
        return function ($93) {
            return $91($92($93));
        };
    })(),
    Monad0: function () {
        return monadAff;
    }
};
var monadThrowAff = {
    throwError: $foreign["_throwError"],
    Monad0: function () {
        return monadAff;
    }
};
var monadErrorAff = {
    catchError: $foreign["_catchError"],
    MonadThrow0: function () {
        return monadThrowAff;
    }
};
var $$try = /* #__PURE__ */ Control_Monad_Error_Class["try"](monadErrorAff);
var catchError = /* #__PURE__ */ Control_Monad_Error_Class.catchError(monadErrorAff);

// | A monomorphic version of `try`. Catches thrown errors and lifts them
// | into an `Either`.
var attempt = /* #__PURE__ */ Control_Monad_Error_Class["try"](monadErrorAff);

// | Forks an `Aff` from an `Effect` context and also takes a callback to run when
// | it completes. Returns the pending `Fiber`.
var runAff = function (k) {
    return function (aff) {
        return launchAff(bindFlipped(function ($94) {
            return liftEffect(k($94));
        })($$try(aff)));
    };
};

// | Forks an `Aff` from an `Effect` context and also takes a callback to run when
// | it completes, discarding the `Fiber`.
var runAff_ = function (k) {
    return function (aff) {
        return $$void(runAff(k)(aff));
    };
};

// | Suspends an `Aff` from an `Effect` context and also takes a callback to run
// | when it completes. Returns the suspended `Fiber`.
var runSuspendedAff = function (k) {
    return function (aff) {
        return launchSuspendedAff(bindFlipped(function ($95) {
            return liftEffect(k($95));
        })($$try(aff)));
    };
};

// | This instance is provided for compatibility. `Aff` is always stack-safe
// | within a given fiber. This instance will just result in unnecessary
// | bind overhead.
var monadRecAff = {
    tailRecM: function (k) {
        var go = function (a) {
            return bind1(k(a))(function (res) {
                if (res instanceof Control_Monad_Rec_Class.Done) {
                    return pure2(res.value0);
                };
                if (res instanceof Control_Monad_Rec_Class.Loop) {
                    return go(res.value0);
                };
                throw new Error("Failed pattern match at Effect.Aff (line 104, column 7 - line 106, column 23): " + [ res.constructor.name ]);
            });
        };
        return go;
    },
    Monad0: function () {
        return monadAff;
    }
};
var monoidAff = function (dictMonoid) {
    var semigroupAff1 = semigroupAff(dictMonoid.Semigroup0());
    return {
        mempty: pure2(Data_Monoid.mempty(dictMonoid)),
        Semigroup0: function () {
            return semigroupAff1;
        }
    };
};

// | A canceler which does not cancel anything.
var nonCanceler = /* #__PURE__ */ Data_Function["const"](/* #__PURE__ */ pure2(Data_Unit.unit));

// | A no-op `Canceler` can be constructed with `mempty`.
var monoidCanceler = {
    mempty: nonCanceler,
    Semigroup0: function () {
        return semigroupCanceler;
    }
};
var mempty = /* #__PURE__ */ Data_Monoid.mempty(monoidCanceler);

// | An async computation which does not resolve.
var never = /* #__PURE__ */ $foreign.makeAff(function (v) {
    return pure(mempty);
});

// | Ignores any errors.
var apathize = /* #__PURE__ */ (function () {
    var $96 = map1(Data_Function["const"](Data_Unit.unit));
    return function ($97) {
        return $96(attempt($97));
    };
})();

// | Races effects in parallel. Returns the first successful result or the
// | first error if all fail with an exception. Losing branches will be
// | cancelled.
var altParAff = {
    alt: $foreign["_parAffAlt"],
    Functor0: function () {
        return functorParAff;
    }
};
var altAff = {
    alt: function (a1) {
        return function (a2) {
            return catchError(a1)(Data_Function["const"](a2));
        };
    },
    Functor0: function () {
        return functorAff;
    }
};
var plusAff = {
    empty: /* #__PURE__ */ Control_Monad_Error_Class.throwError(monadThrowAff)(/* #__PURE__ */ Effect_Exception.error("Always fails")),
    Alt0: function () {
        return altAff;
    }
};
var plusParAff = {
    empty: /* #__PURE__ */ Control_Parallel_Class.parallel(parallelAff)(/* #__PURE__ */ Control_Plus.empty(plusAff)),
    Alt0: function () {
        return altParAff;
    }
};
var alternativeParAff = {
    Applicative0: function () {
        return applicativeParAff;
    },
    Plus1: function () {
        return plusParAff;
    }
};
export {
    makeAff,
    generalBracket
} from "./foreign.js";
export {
    Canceler,
    launchAff,
    launchAff_,
    launchSuspendedAff,
    runAff,
    runAff_,
    runSuspendedAff,
    forkAff,
    suspendAff,
    supervise,
    attempt,
    apathize,
    delay,
    never,
    $$finally as finally,
    invincible,
    killFiber,
    joinFiber,
    cancelWith,
    bracket,
    nonCanceler,
    effectCanceler,
    fiberCanceler,
    functorAff,
    applyAff,
    applicativeAff,
    bindAff,
    monadAff,
    semigroupAff,
    monoidAff,
    altAff,
    plusAff,
    monadRecAff,
    monadThrowAff,
    monadErrorAff,
    monadEffectAff,
    lazyAff,
    monadSTAff,
    functorParAff,
    applyParAff,
    applicativeParAff,
    semigroupParAff,
    monoidParAff,
    altParAff,
    plusParAff,
    alternativeParAff,
    parallelAff,
    functorFiber,
    applyFiber,
    applicativeFiber,
    newtypeCanceler,
    semigroupCanceler,
    monoidCanceler
};
export {
    catchError,
    throwError,
    try
} from "../Control.Monad.Error.Class/index.js";
export {
    parallel,
    sequential
} from "../Control.Parallel.Class/index.js";
export {
    Milliseconds
} from "../Data.Time.Duration/index.js";
export {
    error,
    message
} from "../Effect.Exception/index.js";
