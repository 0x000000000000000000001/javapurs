import * as Control_Bind from "../Control.Bind/index.js";
import * as Control_Monad_Gen from "../Control.Monad.Gen/index.js";
import * as Control_Monad_Gen_Class from "../Control.Monad.Gen.Class/index.js";
import * as Data_Char_Gen from "../Data.Char.Gen/index.js";
import * as Data_Function from "../Data.Function/index.js";
import * as Data_Functor from "../Data.Functor/index.js";
import * as Data_Ord from "../Data.Ord/index.js";
import * as Data_String_CodeUnits from "../Data.String.CodeUnits/index.js";
import * as Data_Unfoldable from "../Data.Unfoldable/index.js";
var max = /* #__PURE__ */ Data_Ord.max(Data_Ord.ordInt);

// | Generates a string using the specified character generator.
var genString = function (dictMonadRec) {
    var unfoldable = Control_Monad_Gen.unfoldable(dictMonadRec);
    return function (dictMonadGen) {
        var sized = Control_Monad_Gen_Class.sized(dictMonadGen);
        var Bind1 = (dictMonadGen.Monad0()).Bind1();
        var bind = Control_Bind.bind(Bind1);
        var chooseInt = Control_Monad_Gen_Class.chooseInt(dictMonadGen);
        var resize = Control_Monad_Gen_Class.resize(dictMonadGen);
        var map = Data_Functor.map((Bind1.Apply0()).Functor0());
        var unfoldable1 = unfoldable(dictMonadGen)(Data_Unfoldable.unfoldableArray);
        return function (genChar) {
            return sized(function (size) {
                return bind(chooseInt(1)(max(1)(size)))(function (newSize) {
                    return resize(Data_Function["const"](newSize))(map(Data_String_CodeUnits.fromCharArray)(unfoldable1(genChar)));
                });
            });
        };
    };
};

// | Generates a string using characters from the Unicode basic multilingual
// | plain.
var genUnicodeString = function (dictMonadRec) {
    var genString1 = genString(dictMonadRec);
    return function (dictMonadGen) {
        return genString1(dictMonadGen)(Data_Char_Gen.genUnicodeChar(dictMonadGen));
    };
};

// | Generates a string made up of numeric digits.
var genDigitString = function (dictMonadRec) {
    var genString1 = genString(dictMonadRec);
    return function (dictMonadGen) {
        return genString1(dictMonadGen)(Data_Char_Gen.genDigitChar(dictMonadGen));
    };
};

// | Generates a string using the ASCII character set.
var genAsciiString$prime = function (dictMonadRec) {
    var genString1 = genString(dictMonadRec);
    return function (dictMonadGen) {
        return genString1(dictMonadGen)(Data_Char_Gen["genAsciiChar$prime"](dictMonadGen));
    };
};

// | Generates a string using the ASCII character set, excluding control codes.
var genAsciiString = function (dictMonadRec) {
    var genString1 = genString(dictMonadRec);
    return function (dictMonadGen) {
        return genString1(dictMonadGen)(Data_Char_Gen.genAsciiChar(dictMonadGen));
    };
};

// | Generates a string using uppercase characters from the basic Latin alphabet.
var genAlphaUppercaseString = function (dictMonadRec) {
    var genString1 = genString(dictMonadRec);
    return function (dictMonadGen) {
        return genString1(dictMonadGen)(Data_Char_Gen.genAlphaUppercase(dictMonadGen));
    };
};

// | Generates a string using characters from the basic Latin alphabet.
var genAlphaString = function (dictMonadRec) {
    var genString1 = genString(dictMonadRec);
    return function (dictMonadGen) {
        return genString1(dictMonadGen)(Data_Char_Gen.genAlpha(dictMonadGen));
    };
};

// | Generates a string using lowercase characters from the basic Latin alphabet.
var genAlphaLowercaseString = function (dictMonadRec) {
    var genString1 = genString(dictMonadRec);
    return function (dictMonadGen) {
        return genString1(dictMonadGen)(Data_Char_Gen.genAlphaLowercase(dictMonadGen));
    };
};
export {
    genString,
    genUnicodeString,
    genAsciiString,
    genAsciiString$prime,
    genDigitString,
    genAlphaString,
    genAlphaLowercaseString,
    genAlphaUppercaseString
};
