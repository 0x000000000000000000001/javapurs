import * as Data_Function from "../Data.Function/index.js";
import * as Data_Lens_Lens from "../Data.Lens.Lens/index.js";
import * as Record from "../Record/index.js";

// | Construct a (type-changing) lens for a record property, by providing a
// | proxy for the `Symbol` which corresponds to the property label.
// |
// | The lens is polymorphic in the rest of the row of property labels.
// |
// | For example:
// |
// | ```purescript
// | prop (Proxy :: Proxy "foo")
// |   :: forall a b r. Lens { foo :: a | r } { foo :: b | r } a b
// | ```
var prop = function (dictIsSymbol) {
    var get = Record.get(dictIsSymbol)();
    var set = Record.set(dictIsSymbol)()();
    return function () {
        return function () {
            return function (l) {
                return function (dictStrong) {
                    return Data_Lens_Lens.lens(get(l))(Data_Function.flip(set(l)))(dictStrong);
                };
            };
        };
    };
};
export {
    prop
};
