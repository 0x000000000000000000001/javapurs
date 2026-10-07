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
