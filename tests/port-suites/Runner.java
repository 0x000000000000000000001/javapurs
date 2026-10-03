    // Test-only process boundary. The launcher independently requires the final
    // marker, so an early JVM exit cannot be mistaken for a completed suite.
    public static Object mode = (java.util.function.Supplier<Object>) () -> {
        String selected = System.getProperty("javapurs.test.mode", "suite");
        if (selected.equals("early-exit")) System.exit(0);
        return selected;
    };
    private static Object apply(Object fn, Object value) {
        return ((java.util.function.Function<Object, Object>) fn).apply(value);
    }
    private static Object force(Object effect) { return ((java.util.function.Supplier<?>) effect).get(); }
    private static void await(java.util.concurrent.CompletableFuture<Object> completed) {
        try {
            completed.get(Long.getLong("javapurs.test.timeout", 30000L), java.util.concurrent.TimeUnit.MILLISECONDS);
        } catch (java.util.concurrent.TimeoutException timeout) {
            throw new AssertionError("Port suite timed out", timeout);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt(); throw new AssertionError("Port suite interrupted", interrupted);
        } catch (java.util.concurrent.ExecutionException failed) {
            throw new AssertionError("Port suite failed", failed.getCause());
        }
        System.out.println("PORT SUITE COMPLETED");
    }
    private static void complete(java.util.concurrent.CompletableFuture<Object> future, Object failure) {
        future.completeExceptionally(failure instanceof Throwable ? (Throwable) failure : new AssertionError(String.valueOf(failure)));
    }
    public static Object awaitAff = (java.util.function.Function<Object, Object>) aff ->
        (java.util.function.Supplier<Object>) () -> {
            var completed = new java.util.concurrent.CompletableFuture<Object>();
            var fiber = (java.util.Map<String, Object>) force(apply(apply(__M$Effect_Aff._makeFiber, null), aff));
            java.util.function.Function<Object, Object> callback = either -> (java.util.function.Supplier<Object>) () -> {
                if (either instanceof __M$Data_Either.Left failure) complete(completed, failure.value0);
                else completed.complete(null);
                return null;
            };
            force(apply(fiber.get("join"), callback));
            await(completed);
            return null;
        };
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
