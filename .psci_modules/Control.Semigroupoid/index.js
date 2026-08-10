var semigroupoidFn = {
    compose: function (f) {
        return function (g) {
            return function (x) {
                return f(g(x));
            };
        };
    }
};
var compose = function (dict) {
    return dict.compose;
};

// | Forwards composition, or `compose` with its arguments reversed.
var composeFlipped = function (dictSemigroupoid) {
    var compose1 = compose(dictSemigroupoid);
    return function (f) {
        return function (g) {
            return compose1(g)(f);
        };
    };
};
export {
    compose,
    composeFlipped,
    semigroupoidFn
};
