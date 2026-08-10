// | Utilities for working with partial functions.
// | See the README for more documentation.
import * as $foreign from "./foreign.js";
import * as Partial from "../Partial/index.js";
var crashWith = /* #__PURE__ */ Partial.crashWith();

// | Discharge a partiality constraint, unsafely.
var unsafePartial = $foreign["_unsafePartial"];

// | A function which crashes with the specified error message.
var unsafeCrashWith = function (msg) {
    return unsafePartial(function () {
        return crashWith(msg);
    });
};
export {
    unsafePartial,
    unsafeCrashWith
};
