import * as Data_Array from "../Data.Array/index.js";
import * as Data_Functor from "../Data.Functor/index.js";
import * as Data_Maybe from "../Data.Maybe/index.js";
import * as Data_String_Common from "../Data.String.Common/index.js";
import * as Javapurs_JavaAst from "../Javapurs.JavaAst/index.js";
var map = /* #__PURE__ */ Data_Functor.map(Data_Functor.functorArray);
var printExpr = function (v) {
    if (v instanceof Javapurs_JavaAst.JavaString) {
        return "\"" + (v.value0 + "\"");
    };
    if (v instanceof Javapurs_JavaAst.JavaCall) {
        var fnStr = printExpr(v.value0);
        var argsStr = Data_String_Common.joinWith(", ")(map(printExpr)(v.value1));
        return fnStr + ("(" + (argsStr + ")"));
    };
    if (v instanceof Javapurs_JavaAst.JavaApply) {
        return "((java.util.function.Function<Object, Object>) (" + (printExpr(v.value0) + (")).apply(" + (printExpr(v.value1) + ")")));
    };
    if (v instanceof Javapurs_JavaAst.JavaFunction) {
        return "(java.util.function.Supplier<Object>) () -> " + printExpr(v.value0);
    };
    if (v instanceof Javapurs_JavaAst.JavaGlobalVar) {
        if (v.value0 instanceof Data_Maybe.Just && v.value0.value0 === "Effect_Console") {
            var $13 = v.value1 === "log";
            if ($13) {
                return "System.out.println";
            };
            return "System.out.print";
        };
        if (v.value0 instanceof Data_Maybe.Just) {
            return v.value0.value0 + ("." + v.value1);
        };
        if (v.value0 instanceof Data_Maybe.Nothing) {
            return v.value1;
        };
        throw new Error("Failed pattern match at Javapurs.Printer (line 23, column 5 - line 26, column 22): " + [ v.value0.constructor.name ]);
    };
    if (v instanceof Javapurs_JavaAst.JavaLocal) {
        return v.value0;
    };
    if (v instanceof Javapurs_JavaAst.JavaAbs) {
        var $19 = Data_Array.length(v.value0) === 1;
        if ($19) {
            return "(java.util.function.Function<Object, Object>) (" + (Data_String_Common.joinWith(", ")(v.value0) + (") -> " + printExpr(v.value1)));
        };
        return "(" + (Data_String_Common.joinWith(", ")(v.value0) + (") -> " + printExpr(v.value1)));
    };
    if (v instanceof Javapurs_JavaAst.JavaNew) {
        return "new " + (v.value0 + ("(" + (Data_String_Common.joinWith(", ")(map(printExpr)(v.value1)) + ")")));
    };
    if (v instanceof Javapurs_JavaAst.JavaTernary) {
        return "(" + (printExpr(v.value0) + (" ? " + (printExpr(v.value1) + (" : " + (printExpr(v.value2) + ")")))));
    };
    if (v instanceof Javapurs_JavaAst.JavaThrow) {
        return "((java.util.function.Supplier<Object>) () -> { throw new RuntimeException(\"" + (v.value0 + "\"); }).get()");
    };
    if (v instanceof Javapurs_JavaAst.JavaInstanceOf) {
        return "(" + (printExpr(v.value0) + (" instanceof " + (v.value1 + ")")));
    };
    if (v instanceof Javapurs_JavaAst.JavaPropertyAccess) {
        return "(((" + (v.value1 + (") " + (printExpr(v.value0) + (")." + (v.value2 + ")")))));
    };
    if (v instanceof Javapurs_JavaAst.JavaLet) {
        return "((java.util.function.Supplier<Object>) () -> { Object " + (v.value0 + (" = " + (printExpr(v.value1) + ("; return " + (printExpr(v.value2) + "; }).get()")))));
    };
    if (v instanceof Javapurs_JavaAst.JavaClassDecl) {
        var fields = map(function (arg) {
            return "public final Object " + (arg + ";");
        })(v.value1);
        var constructorArgs = map(function (arg) {
            return "Object " + arg;
        })(v.value1);
        var assigns = map(function (arg) {
            return "this." + (arg + (" = " + (arg + ";")));
        })(v.value1);
        var constructor = "public " + (v.value0 + ("(" + (Data_String_Common.joinWith(", ")(constructorArgs) + (") {\x0a" + ("                " + (Data_String_Common.joinWith("\x0a                ")(assigns) + ("\x0a" + "            }")))))));
        return "public static final class " + (v.value0 + (" {\x0a" + ("            " + (Data_String_Common.joinWith("\x0a            ")(fields) + ("\x0a" + ("            " + (constructor + ("\x0a" + "        }"))))))));
    };
    if (v instanceof Javapurs_JavaAst.JavaRaw) {
        return v.value0;
    };
    if (v instanceof Javapurs_JavaAst.JavaAssign) {
        var $39 = v.value0 === "main";
        if ($39) {
            return "public static final java.util.function.Supplier<Void> main = () -> {\x0a            " + (printExpr(v.value1) + ";\x0a            return null;\x0a        };");
        };
        return "public static final Object " + (v.value0 + (" = " + (printExpr(v.value1) + ";")));
    };
    throw new Error("Failed pattern match at Javapurs.Printer (line 10, column 13 - line 64, column 78): " + [ v.constructor.name ]);
};
var printFile = function (className) {
    return function (file) {
        return "public class " + (className + (" {\x0a" + ("    " + (Data_String_Common.joinWith("\x0a    ")(map(printExpr)(file.decls)) + ("\x0a" + "}\x0a")))));
    };
};
export {
    printExpr,
    printFile
};
