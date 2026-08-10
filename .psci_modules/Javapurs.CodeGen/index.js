import * as Data_Array from "../Data.Array/index.js";
import * as Data_Array_NonEmpty from "../Data.Array.NonEmpty/index.js";
import * as Data_Array_NonEmpty_Internal from "../Data.Array.NonEmpty.Internal/index.js";
import * as Data_Foldable from "../Data.Foldable/index.js";
import * as Data_Functor from "../Data.Functor/index.js";
import * as Data_Maybe from "../Data.Maybe/index.js";
import * as Data_Semigroup from "../Data.Semigroup/index.js";
import * as Data_Show from "../Data.Show/index.js";
import * as Data_String_Common from "../Data.String.Common/index.js";
import * as Data_Tuple from "../Data.Tuple/index.js";
import * as Javapurs_JavaAst from "../Javapurs.JavaAst/index.js";
import * as PureScript_Backend_Optimizer_Codegen_Tco from "../PureScript.Backend.Optimizer.Codegen.Tco/index.js";
import * as PureScript_Backend_Optimizer_CoreFn from "../PureScript.Backend.Optimizer.CoreFn/index.js";
import * as PureScript_Backend_Optimizer_FreeVars from "../PureScript.Backend.Optimizer.FreeVars/index.js";
import * as PureScript_Backend_Optimizer_Syntax from "../PureScript.Backend.Optimizer.Syntax/index.js";
var foldl = /* #__PURE__ */ Data_Foldable.foldl(Data_Foldable.foldableArray);
var fromFoldable = /* #__PURE__ */ Data_Array.fromFoldable(Data_Array_NonEmpty_Internal.foldableNonEmptyArray);
var fromFoldable1 = /* #__PURE__ */ Data_Array.fromFoldable(Data_Foldable.foldableArray);
var map = /* #__PURE__ */ Data_Functor.map(Data_Functor.functorArray);
var foldr = /* #__PURE__ */ Data_Foldable.foldr(Data_Foldable.foldableArray);
var show = /* #__PURE__ */ Data_Show.show(Data_Show.showInt);
var append1 = /* #__PURE__ */ Data_Semigroup.append(Data_Semigroup.semigroupArray);
var translateOperator2 = function (v) {
    return function (op) {
        return function (e1) {
            return function (e2) {
                if (op instanceof PureScript_Backend_Optimizer_Syntax.OpBooleanOrd && op.value0 instanceof PureScript_Backend_Optimizer_Syntax.OpEq) {
                    return new Javapurs_JavaAst.JavaCall(new Javapurs_JavaAst.JavaRaw("java.util.Objects.equals"), [ e1, e2 ]);
                };
                return new Javapurs_JavaAst.JavaRaw("null /* TODO: Op2 */");
            };
        };
    };
};
var translateOperator1 = function (modName) {
    return function (op) {
        return function (e) {
            if (op instanceof PureScript_Backend_Optimizer_Syntax.OpIsTag) {
                var safeTag = Data_String_Common.replaceAll("'")("_prime_")(op.value0.value1);
                var modPart = (function () {
                    if (op.value0.value0 instanceof Data_Maybe.Just) {
                        return Data_String_Common.replaceAll(".")("_")(op.value0.value0.value0);
                    };
                    if (op.value0.value0 instanceof Data_Maybe.Nothing) {
                        return modName;
                    };
                    throw new Error("Failed pattern match at Javapurs.CodeGen (line 187, column 17 - line 189, column 27): " + [ op.value0.value0.constructor.name ]);
                })();
                var javaClass = modPart + ("." + safeTag);
                return new Javapurs_JavaAst.JavaInstanceOf(e, javaClass);
            };
            return new Javapurs_JavaAst.JavaRaw("null /* TODO: Op1 */");
        };
    };
};
var syntaxTag = function (v) {
    if (v instanceof PureScript_Backend_Optimizer_Syntax.Var) {
        return "Var";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.Local) {
        return "Local";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.Lit) {
        return "Lit";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.App) {
        return "App";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.Abs) {
        return "Abs";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.UncurriedApp) {
        return "UncurriedApp";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.UncurriedAbs) {
        return "UncurriedAbs";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.UncurriedEffectApp) {
        return "UncurriedEffectApp";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.UncurriedEffectAbs) {
        return "UncurriedEffectAbs";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.Accessor) {
        return "Accessor";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.Update) {
        return "Update";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.CtorSaturated) {
        return "CtorSaturated";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.CtorDef) {
        return "CtorDef";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.LetRec) {
        return "LetRec";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.Let) {
        return "Let";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.EffectBind) {
        return "EffectBind";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.EffectPure) {
        return "EffectPure";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.EffectDefer) {
        return "EffectDefer";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.Branch) {
        return "Branch";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.PrimOp) {
        return "PrimOp";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.PrimEffect) {
        return "PrimEffect";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.PrimUndefined) {
        return "PrimUndefined";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.Fail) {
        return "Fail";
    };
    if (v instanceof PureScript_Backend_Optimizer_Syntax.Typed) {
        return "Typed";
    };
    throw new Error("Failed pattern match at Javapurs.CodeGen (line 113, column 13 - line 137, column 23): " + [ v.constructor.name ]);
};
var translateExpr = function (modName) {
    return function (v) {
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.Lit) {
            if (v.value1.value0 instanceof PureScript_Backend_Optimizer_CoreFn.LitString) {
                return new Javapurs_JavaAst.JavaString(v.value1.value0.value0);
            };
            return new Javapurs_JavaAst.JavaRaw("null /* TODO: other literals */");
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.App) {
            return foldl(function (acc) {
                return function (arg) {
                    return new Javapurs_JavaAst.JavaApply(acc, translateExpr(modName)(arg));
                };
            })(translateExpr(modName)(v.value1.value0))(fromFoldable(v.value1.value1));
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.UncurriedApp) {
            return new Javapurs_JavaAst.JavaCall(translateExpr(modName)(v.value1.value0), fromFoldable1(map(translateExpr(modName))(v.value1.value1)));
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.UncurriedEffectApp) {
            return new Javapurs_JavaAst.JavaCall(translateExpr(modName)(v.value1.value0), fromFoldable1(map(translateExpr(modName))(v.value1.value1)));
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.UncurriedEffectAbs) {
            var argsArray = map(function (v1) {
                return PureScript_Backend_Optimizer_FreeVars.localId(v1.value0)(v1.value1);
            })(fromFoldable1(v.value1.value0));
            return new Javapurs_JavaAst.JavaAbs(argsArray, translateExpr(modName)(v.value1.value1));
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.Local) {
            return new Javapurs_JavaAst.JavaLocal(PureScript_Backend_Optimizer_FreeVars.localId(v.value1.value0)(v.value1.value1));
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.Abs) {
            return foldr(function (v1) {
                return function (acc) {
                    return new Javapurs_JavaAst.JavaAbs([ PureScript_Backend_Optimizer_FreeVars.localId(v1.value0)(v1.value1) ], acc);
                };
            })(translateExpr(modName)(v.value1.value1))(fromFoldable(v.value1.value0));
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.UncurriedAbs) {
            var argsArray = map(function (v1) {
                return PureScript_Backend_Optimizer_FreeVars.localId(v1.value0)(v1.value1);
            })(v.value1.value0);
            return new Javapurs_JavaAst.JavaAbs(argsArray, translateExpr(modName)(v.value1.value1));
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.Let) {
            return new Javapurs_JavaAst.JavaLet(PureScript_Backend_Optimizer_FreeVars.localId(v.value1.value0)(v.value1.value1), translateExpr(modName)(v.value1.value2), translateExpr(modName)(v.value1.value3));
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.LetRec) {
            return foldl(function (acc) {
                return function (v1) {
                    return new Javapurs_JavaAst.JavaLet(PureScript_Backend_Optimizer_FreeVars.localId(new Data_Maybe.Just(v1.value0))(v.value1.value0), translateExpr(modName)(v1.value1), acc);
                };
            })(translateExpr(modName)(v.value1.value2))(fromFoldable(v.value1.value1));
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.EffectBind) {
            return new Javapurs_JavaAst.JavaLet(PureScript_Backend_Optimizer_FreeVars.localId(v.value1.value0)(v.value1.value1), translateExpr(modName)(v.value1.value2), translateExpr(modName)(v.value1.value3));
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.EffectPure) {
            return translateExpr(modName)(v.value1.value0);
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.EffectDefer) {
            return translateExpr(modName)(v.value1.value0);
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.Typed) {
            return translateExpr(modName)(v.value1.value1);
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.CtorSaturated) {
            var safeCtorName = Data_String_Common.replaceAll("'")("_prime_")(v.value1.value3);
            var modPart = (function () {
                if (v.value1.value0.value0 instanceof Data_Maybe.Just) {
                    return Data_String_Common.replaceAll(".")("_")(v.value1.value0.value0.value0);
                };
                if (v.value1.value0.value0 instanceof Data_Maybe.Nothing) {
                    return modName;
                };
                throw new Error("Failed pattern match at Javapurs.CodeGen (line 61, column 17 - line 63, column 27): " + [ v.value1.value0.value0.constructor.name ]);
            })();
            var mappedArgs = fromFoldable1(map(function (v1) {
                return translateExpr(modName)(v1.value1);
            })(v.value1.value4));
            var javaClass = modPart + ("." + safeCtorName);
            return new Javapurs_JavaAst.JavaNew(javaClass, mappedArgs);
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.CtorDef) {
            var safeCtorName = Data_String_Common.replaceAll("'")("_prime_")(v.value1.value2);
            var numFields = Data_Array.length(v.value1.value3);
            var mappedFields = Data_Array.mapWithIndex(function (i) {
                return function (v1) {
                    return "value" + show(i);
                };
            })(v.value1.value3);
            var javaClass = modName + ("." + safeCtorName);
            var body = new Javapurs_JavaAst.JavaNew(javaClass, map(Javapurs_JavaAst.JavaLocal.create)(mappedFields));
            var $141 = numFields === 0;
            if ($141) {
                return body;
            };
            return new Javapurs_JavaAst.JavaAbs(mappedFields, body);
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.Branch) {
            return Data_Array.foldr(function (v1) {
                return function (acc) {
                    return new Javapurs_JavaAst.JavaTernary(translateExpr(modName)(v1.value0), translateExpr(modName)(v1.value1), acc);
                };
            })(translateExpr(modName)(v.value1.value1))(Data_Array_NonEmpty.toArray(v.value1.value0));
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.Fail) {
            return new Javapurs_JavaAst.JavaThrow(v.value1.value0);
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.Accessor) {
            if (v.value1.value1 instanceof PureScript_Backend_Optimizer_Syntax.GetCtorField) {
                var safeCtorName = Data_String_Common.replaceAll("'")("_prime_")(v.value1.value1.value3);
                var modPart = (function () {
                    if (v.value1.value1.value0.value0 instanceof Data_Maybe.Just) {
                        return Data_String_Common.replaceAll(".")("_")(v.value1.value1.value0.value0.value0);
                    };
                    if (v.value1.value1.value0.value0 instanceof Data_Maybe.Nothing) {
                        return modName;
                    };
                    throw new Error("Failed pattern match at Javapurs.CodeGen (line 93, column 19 - line 95, column 29): " + [ v.value1.value1.value0.value0.constructor.name ]);
                })();
                var javaClass = modPart + ("." + safeCtorName);
                return new Javapurs_JavaAst.JavaPropertyAccess(translateExpr(modName)(v.value1.value0), javaClass, "value" + show(v.value1.value1.value5));
            };
            return new Javapurs_JavaAst.JavaRaw("null /* TODO: Accessor */");
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.PrimOp) {
            if (v.value1.value0 instanceof PureScript_Backend_Optimizer_Syntax.Op1) {
                return translateOperator1(modName)(v.value1.value0.value0)(translateExpr(modName)(v.value1.value0.value1));
            };
            if (v.value1.value0 instanceof PureScript_Backend_Optimizer_Syntax.Op2) {
                return translateOperator2(modName)(v.value1.value0.value0)(translateExpr(modName)(v.value1.value0.value1))(translateExpr(modName)(v.value1.value0.value2));
            };
            throw new Error("Failed pattern match at Javapurs.CodeGen (line 100, column 16 - line 102, column 106): " + [ v.value1.value0.constructor.name ]);
        };
        if (v.value1 instanceof PureScript_Backend_Optimizer_Syntax.Var) {
            var qModName = (function () {
                if (v.value1.value0.value0 instanceof Data_Maybe.Just) {
                    return new Data_Maybe.Just(Data_String_Common.replaceAll(".")("_")(v.value1.value0.value0.value0));
                };
                if (v.value1.value0.value0 instanceof Data_Maybe.Nothing) {
                    return Data_Maybe.Nothing.value;
                };
                throw new Error("Failed pattern match at Javapurs.CodeGen (line 106, column 20 - line 108, column 29): " + [ v.value1.value0.value0.constructor.name ]);
            })();
            return new Javapurs_JavaAst.JavaGlobalVar(qModName, v.value1.value0.value1);
        };
        return new Javapurs_JavaAst.JavaRaw("null /* TODO: " + (syntaxTag(v.value1) + " */"));
    };
};
var translate = function (mod) {
    var v = foldl(function (v1) {
        return function (group) {
            var tcoBinds = map(function (v2) {
                return new Data_Tuple.Tuple(v2.value0, PureScript_Backend_Optimizer_Codegen_Tco.analyze(v1.value0)(v2.value1));
            })(group.bindings);
            return new Data_Tuple.Tuple(v1.value0, Data_Array.snoc(v1.value1)({
                recursive: group.recursive,
                bindings: tcoBinds
            }));
        };
    })(new Data_Tuple.Tuple([  ], [  ]))(mod.bindings);
    var sanitize = function (n) {
        return Data_String_Common.replaceAll("$")("")(Data_String_Common.replaceAll("'")("_")(n));
    };
    var modNameStr = Data_String_Common.replaceAll(".")("_")(mod.name);
    var mainDecls = Data_Array.concatMap(function (group) {
        return map(function (v1) {
            return new Javapurs_JavaAst.JavaAssign(sanitize(v1.value0), translateExpr(modNameStr)(v1.value1));
        })(group.bindings);
    })(v.value1);
    var dataClasses = Data_Array.concatMap(function (decl) {
        return map(function (ctor) {
            var safeCtorName = Data_String_Common.replaceAll("'")("_prime_")(ctor.constructorName);
            var args = Data_Array.mapWithIndex(function (i) {
                return function (v1) {
                    return "value" + show(i);
                };
            })(ctor.fieldTypes);
            return new Javapurs_JavaAst.JavaClassDecl(safeCtorName, args);
        })(decl.constructors);
    })(mod.dataDecls);
    var decls = append1(dataClasses)(mainDecls);
    return {
        decls: decls
    };
};
export {
    translateExpr,
    syntaxTag,
    translate,
    translateOperator1,
    translateOperator2
};
