    public static Object unsafeGet = (java.util.function.Function<Object, Object>) (s) ->
        (java.util.function.Function<Object, Object>) (o) -> ((java.util.Map<?, ?>) o).get((String) s);

    public static Object unsafeSet = (java.util.function.Function<Object, Object>) (s) ->
        (java.util.function.Function<Object, Object>) (a) ->
        (java.util.function.Function<Object, Object>) (o) -> {
            java.util.Map<String, Object> copy = new java.util.LinkedHashMap<>((java.util.Map<String, Object>) o);
            copy.put((String) s, a);
            return copy;
        };
