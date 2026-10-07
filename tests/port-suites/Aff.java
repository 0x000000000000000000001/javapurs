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
