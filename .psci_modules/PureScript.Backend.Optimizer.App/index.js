import * as $foreign from "./foreign.js";
import * as Control_Applicative from "../Control.Applicative/index.js";
import * as Control_Bind from "../Control.Bind/index.js";
import * as Data_Argonaut_Decode_Error from "../Data.Argonaut.Decode.Error/index.js";
import * as Data_Argonaut_Parser from "../Data.Argonaut.Parser/index.js";
import * as Data_Array from "../Data.Array/index.js";
import * as Data_Bifunctor from "../Data.Bifunctor/index.js";
import * as Data_Either from "../Data.Either/index.js";
import * as Data_Eq from "../Data.Eq/index.js";
import * as Data_Foldable from "../Data.Foldable/index.js";
import * as Data_List from "../Data.List/index.js";
import * as Data_List_Types from "../Data.List.Types/index.js";
import * as Data_Maybe from "../Data.Maybe/index.js";
import * as Data_Ord from "../Data.Ord/index.js";
import * as Data_Show from "../Data.Show/index.js";
import * as Data_String_CodeUnits from "../Data.String.CodeUnits/index.js";
import * as Data_String_Common from "../Data.String.Common/index.js";
import * as Data_Time_Duration from "../Data.Time.Duration/index.js";
import * as Data_Traversable from "../Data.Traversable/index.js";
import * as Data_Unit from "../Data.Unit/index.js";
import * as Effect_Aff from "../Effect.Aff/index.js";
import * as Effect_Class from "../Effect.Class/index.js";
import * as Effect_Console from "../Effect.Console/index.js";
import * as Effect_Exception from "../Effect.Exception/index.js";
import * as Node_Encoding from "../Node.Encoding/index.js";
import * as Node_FS_Aff from "../Node.FS.Aff/index.js";
import * as Node_FS_Stats from "../Node.FS.Stats/index.js";
import * as PureScript_Backend_Optimizer_CoreFn_Json from "../PureScript.Backend.Optimizer.CoreFn.Json/index.js";
import * as PureScript_Backend_Optimizer_CoreFn_Sort from "../PureScript.Backend.Optimizer.CoreFn.Sort/index.js";
import * as PureScript_Backend_Optimizer_Directives from "../PureScript.Backend.Optimizer.Directives/index.js";
import * as PureScript_Backend_Optimizer_Directives_Defaults from "../PureScript.Backend.Optimizer.Directives.Defaults/index.js";
var bind = /* #__PURE__ */ Control_Bind.bind(Effect_Aff.bindAff);
var bind1 = /* #__PURE__ */ Control_Bind.bind(Data_Either.bindEither);
var lmap = /* #__PURE__ */ Data_Bifunctor.lmap(Data_Bifunctor.bifunctorEither);
var discard = /* #__PURE__ */ Control_Bind.discard(Control_Bind.discardUnit)(Effect_Aff.bindAff);
var liftEffect = /* #__PURE__ */ Effect_Class.liftEffect(Effect_Aff.monadEffectAff);
var pure = /* #__PURE__ */ Control_Applicative.pure(Effect_Aff.applicativeAff);
var show = /* #__PURE__ */ Data_Show.show(Effect_Exception.showError);
var elemIndex = /* #__PURE__ */ Data_Array.elemIndex(Data_Eq.eqString);
var filterA = /* #__PURE__ */ Data_Array.filterA(Effect_Aff.applicativeAff);
var traverse = /* #__PURE__ */ Data_Traversable.traverse(Data_Traversable.traversableArray)(Effect_Aff.applicativeAff);
var fromFoldable = /* #__PURE__ */ Data_List.fromFoldable(Data_Foldable.foldableArray);
var sortModules = /* #__PURE__ */ PureScript_Backend_Optimizer_CoreFn_Sort.sortModules(Data_List_Types.foldableList);
var greaterThanOrEq = /* #__PURE__ */ Data_Ord.greaterThanOrEq(Data_Time_Duration.ordMilliseconds);

// | Writes a BackendModule to the cache file.
var writeCache = function (version) {
    return function (cachePath) {
        return function (backendMod) {
            return Node_FS_Aff.writeTextFile(Node_Encoding.UTF8.value)(cachePath)($foreign.stringify(version)(backendMod));
        };
    };
};
var readCoreFnModule = function (filePath) {
    return bind(Effect_Aff.attempt(Node_FS_Aff.stat(filePath)))(function (statRes) {
        if (statRes instanceof Data_Either.Right) {
            var $23 = Node_FS_Stats.isFile(statRes.value0);
            if ($23) {
                return bind(Node_FS_Aff.readTextFile(Node_Encoding.UTF8.value)(filePath))(function (contents) {
                    var v = bind1(Data_Argonaut_Parser.jsonParser(contents))((function () {
                        var $36 = lmap(Data_Argonaut_Decode_Error.printJsonDecodeError);
                        return function ($37) {
                            return $36(PureScript_Backend_Optimizer_CoreFn_Json.decodeModule($37));
                        };
                    })());
                    if (v instanceof Data_Either.Left) {
                        return discard(liftEffect(Effect_Console.error("Failed to decode " + (filePath + (": " + v.value0)))))(function () {
                            return pure(Data_Maybe.Nothing.value);
                        });
                    };
                    if (v instanceof Data_Either.Right) {
                        return pure(new Data_Maybe.Just(v.value0));
                    };
                    throw new Error("Failed pattern match at PureScript.Backend.Optimizer.App (line 46, column 9 - line 50, column 39): " + [ v.constructor.name ]);
                });
            };
            return pure(Data_Maybe.Nothing.value);
        };
        if (statRes instanceof Data_Either.Left) {
            var errStr = show(statRes.value0);
            return discard((function () {
                var $28 = Data_String_CodeUnits.contains("ENOENT")(errStr);
                if ($28) {
                    return pure(Data_Unit.unit);
                };
                return liftEffect(Effect_Console.error("Failed to stat " + (filePath + (": " + errStr))));
            })())(function () {
                return pure(Data_Maybe.Nothing.value);
            });
        };
        throw new Error("Failed pattern match at PureScript.Backend.Optimizer.App (line 42, column 3 - line 57, column 19): " + [ statRes.constructor.name ]);
    });
};
var parseCLIArgs = function (argsRaw) {
    var args = Data_Array.concatMap(function (s) {
        return Data_String_Common.split(" ")(s);
    })(argsRaw);
    var getArg = function (key) {
        var v = elemIndex(key)(args);
        if (v instanceof Data_Maybe.Just) {
            return Data_Array.index(args)(v.value0 + 1 | 0);
        };
        if (v instanceof Data_Maybe.Nothing) {
            return Data_Maybe.Nothing.value;
        };
        throw new Error("Failed pattern match at PureScript.Backend.Optimizer.App (line 87, column 18 - line 89, column 25): " + [ v.constructor.name ]);
    };
    return {
        mbMainModule: getArg("--main"),
        mbAutoloadPath: getArg("--autoload-path"),
        mbFfiDir: getArg("--ffi"),
        mbOutputDir: getArg("--output"),
        bundle: Data_Maybe.isJust(elemIndex("--bundle")(args))
    };
};
var parse = function (version) {
    return $foreign.parseImpl(Data_Maybe.Just.create)(Data_Maybe.Nothing.value)(version);
};

// | Loads and parses default directives, printing any errors to the console
var loadDirectives = /* #__PURE__ */ (function () {
    var parsedDirectives = PureScript_Backend_Optimizer_Directives.parseDirectiveFile(PureScript_Backend_Optimizer_Directives_Defaults.defaultDirectives);
    return discard(Control_Applicative.when(Effect_Aff.applicativeAff)(!Data_Array["null"](parsedDirectives.errors))(liftEffect(Effect_Console.log("DIRECTIVE PARSE ERRORS"))))(function () {
        return pure(parsedDirectives.directives);
    });
})();

// | Reads and sorts all CoreFn modules from an output directory (e.g. "output")
var coreFnModulesFromOutput = function (outputDir) {
    return bind(Node_FS_Aff.readdir(outputDir))(function (files) {
        return bind(filterA(function (f) {
            return bind(Node_FS_Aff.stat(outputDir + ("/" + f)))(function (stat) {
                return pure(Node_FS_Stats.isDirectory(stat));
            });
        })(files))(function (validDirs) {
            return bind(traverse(function (dir) {
                return readCoreFnModule(outputDir + ("/" + (dir + "/corefn.json")));
            })(validDirs))(function (mbModules) {
                var modulesArray = Data_Array.catMaybes(mbModules);
                var modulesList = fromFoldable(modulesArray);
                return pure(sortModules(modulesList));
            });
        });
    });
};

// | Checks if the corefn file hasn't been modified since the cache was written.
// | Returns Just BackendModule if cache is hit, Nothing otherwise.
var checkCache = function (version) {
    return function (corefnPath) {
        return function (cachePath) {
            return bind(Effect_Aff.attempt(Node_FS_Aff.stat(corefnPath)))(function (corefnStatRes) {
                return bind(Effect_Aff.attempt(Node_FS_Aff.stat(cachePath)))(function (cacheStatRes) {
                    if (corefnStatRes instanceof Data_Either.Right && (cacheStatRes instanceof Data_Either.Right && greaterThanOrEq(Node_FS_Stats.modifiedTimeMs(cacheStatRes.value0))(Node_FS_Stats.modifiedTimeMs(corefnStatRes.value0)))) {
                        return bind(Node_FS_Aff.readTextFile(Node_Encoding.UTF8.value)(cachePath))(function (cacheContent) {
                            return pure(parse(version)(cacheContent));
                        });
                    };
                    return pure(Data_Maybe.Nothing.value);
                });
            });
        };
    };
};
export {
    coreFnModulesFromOutput,
    readCoreFnModule,
    parseCLIArgs,
    checkCache,
    writeCache,
    loadDirectives
};
