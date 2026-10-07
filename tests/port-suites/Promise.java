    public static Object awaitPromise = (java.util.function.Function<Object, Object>) promise ->
        (java.util.function.Supplier<Object>) () -> {
            var completed = new java.util.concurrent.CompletableFuture<Object>();
            java.util.function.Function<Object, Object> success = value -> (java.util.function.Supplier<Object>) () -> {
                completed.complete(null); return null;
            };
            java.util.function.Function<Object, Object> failure = error -> (java.util.function.Supplier<Object>) () -> {
                complete(completed, error); return null;
            };
            force(apply(apply(apply(__M$Promise_Internal.thenOrCatch, success), failure), promise));
            await(completed);
            return null;
        };
