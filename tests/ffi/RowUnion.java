    public static Object mergeImpl = (java.util.function.Function<Object, Object>) (l) ->
        (java.util.function.Function<Object, Object>) (r) -> {
            java.util.Map<String, Object> out = new java.util.LinkedHashMap<>((java.util.Map<String, Object>) r);
            out.putAll((java.util.Map<String, Object>) l);
            return out;
        };
