    private static Object[] __fvectConcat(Object[] left, Object[] right) {
        Object[] out = new Object[left.length + right.length];
        System.arraycopy(left, 0, out, 0, left.length);
        System.arraycopy(right, 0, out, left.length, right.length);
        return out;
    }

    public static Object fnil = new Object[0];

    public static Object fcons = (java.util.function.Function<Object, Object>) (hd) ->
        (java.util.function.Function<Object, Object>) (tl) ->
        __fvectConcat(new Object[]{hd}, (Object[]) tl);

    public static Object fappendImpl = (java.util.function.Function<Object, Object>) (left) ->
        (java.util.function.Function<Object, Object>) (right) ->
        __fvectConcat((Object[]) left, (Object[]) right);

    public static Object fflattenImpl = (java.util.function.Function<Object, Object>) (v) -> {
        Object[] out = new Object[0];
        for (Object inner : (Object[]) v) out = __fvectConcat(out, (Object[]) inner);
        return out;
    };

    public static Object ftoArray = (java.util.function.Function<Object, Object>) (vect) -> vect;
