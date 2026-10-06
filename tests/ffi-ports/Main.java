    public static Object nativeError = new java.io.IOException("native checked exception");
    public static Object sameError = (java.util.function.Function<Object, Object>) first ->
        (java.util.function.Function<Object, Object>) second -> first == second;
    public static Object causeIs = (java.util.function.Function<Object, Object>) error ->
        (java.util.function.Function<Object, Object>) cause -> ((Throwable) error).getCause() == cause;

    // Test-only lifecycle boundary: failure and missing completion are process
    // failures, even though the production Aff fibers are daemon threads.
    public static Object awaitAff = (java.util.function.Function<Object, Object>) aff ->
        (java.util.function.Supplier<Object>) () -> {
            java.util.Map<String, Object> fiber = (java.util.Map<String, Object>) ((java.util.function.Supplier<Object>)
                ((java.util.function.Function<Object, Object>) ((java.util.function.Function<Object, Object>)
                    __M$Effect_Aff._makeFiber).apply(null)).apply(aff)).get();
            java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
            java.util.concurrent.atomic.AtomicReference<Object> result = new java.util.concurrent.atomic.AtomicReference<>();
            java.util.function.Function<Object, Object> callback = either -> (java.util.function.Supplier<Object>) () -> {
                result.set(either); done.countDown(); return null;
            };
            ((java.util.function.Supplier<Object>) ((java.util.function.Function<Object, Object>) fiber.get("join")).apply(callback)).get();
            try {
                if (!done.await(15, java.util.concurrent.TimeUnit.SECONDS)) throw new AssertionError("Aff integration did not complete");
            } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new RuntimeException(interrupted); }
            if (result.get() instanceof __M$Data_Either.Left failure) throw new AssertionError("Aff integration failed", (Throwable) failure.value0);
            return null;
        };
    public static Object newGate = (java.util.function.Supplier<Object>) () -> new java.util.concurrent.CountDownLatch(1);
    public static Object signal = (java.util.function.Function<Object, Object>) gate -> (java.util.function.Supplier<Object>) () -> {
        ((java.util.concurrent.CountDownLatch) gate).countDown(); return null;
    };
    public static Object wait = (java.util.function.Function<Object, Object>) gate -> (java.util.function.Supplier<Object>) () -> {
        try {
            if (!((java.util.concurrent.CountDownLatch) gate).await(5, java.util.concurrent.TimeUnit.SECONDS)) throw new AssertionError("Gate timed out");
        } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new RuntimeException(interrupted); }
        return null;
    };
