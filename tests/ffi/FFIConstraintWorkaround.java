    public static Object showImpl = (java.util.function.Function<Object, Object>) (showFn) ->
        (java.util.function.Function<Object, Object>) (val) ->
        ((java.util.function.Function<Object, Object>) showFn).apply(val);
