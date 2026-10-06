import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.*;

// No sleep-based ordering: gates force the completion/registration/cancellation
// boundaries under test. Timeouts bound a broken protocol, not successful timing.
public final class FfiRuntimeChecks {
    static int checks, failures;
    interface Checked { void run() throws Exception; }
    static void test(String label, Checked body) {
        try { body.run(); checks++; }
        catch (Throwable error) { failures++; System.err.println(label + ": " + error); }
    }
    static void equal(Object expected, Object actual) {
        if (!Objects.equals(expected, actual)) throw new AssertionError(expected + " != " + actual);
    }
    static Object call(Object fn, Object... args) {
        for (Object arg : args) fn = ((Function<Object, Object>) fn).apply(arg);
        return fn;
    }
    static Object effect(Object value) { return ((Supplier<?>) value).get(); }
    static void await(CountDownLatch gate) throws Exception {
        if (!gate.await(2, TimeUnit.SECONDS)) throw new AssertionError("gate timed out");
    }
    static Thread daemon(Runnable body) { Thread t = new Thread(body); t.setDaemon(true); t.start(); return t; }
    static void join(Thread thread) throws Exception {
        thread.join(3000); if (thread.isAlive()) throw new AssertionError("thread did not finish");
    }
    static Object right(Object value) { return new __M$Data_Either.Right(value); }
    static Object pure(Object value) { return call(__M$Effect_Aff._pure, value); }
    static Object run(Object aff) { return run(aff, new __M$Effect_Aff.RunContext(null)); }
    static Object run(Object aff, __M$Effect_Aff.RunContext ctx) { return __M$Effect_Aff.testRun(aff, ctx); }
    static Map<String, Object> fiber(Object aff) { return (Map<String, Object>) effect(call(__M$Effect_Aff._makeFiber, null, aff)); }
    static Object nonCanceler() { return (Function<Object, Object>) ignored -> pure(null); }
    static Object lifted(Supplier<Object> action) { return call(__M$Effect_Aff._liftEffect, action); }
    static Object bind(Object aff, Function<Object, Object> k) { return call(__M$Effect_Aff._bind, aff, k); }
    static FutureTask<Object> background(Supplier<Object> body) {
        FutureTask<Object> task = new FutureTask<>(body::get); daemon(task); return task;
    }
    static Object result(FutureTask<Object> task) throws Exception { return task.get(3, TimeUnit.SECONDS); }

    static Object caught(Object action) {
        return effect(call(__M$Effect_Exception.catchException,
            (Function<Object, Object>) error -> (Supplier<Object>) () -> error, action));
    }
    static Throwable thrownBy(Supplier<Object> action) {
        try { action.get(); } catch (Throwable error) { return error; }
        throw new AssertionError("action did not throw");
    }
    static String header(Throwable error) { return error.toString(); }
    static void exceptions() {
        test("Exception ordinary Error properties", () -> {
            var error = (Throwable) call(__M$Effect_Exception.error, "message");
            equal("Error", call(__M$Effect_Exception.name, error));
            equal("message", call(__M$Effect_Exception.message, error));
            equal("Error: message", header(error));
        });
        test("Exception cause name and identity", () -> {
            var cause = (Throwable) call(__M$Effect_Exception.error, "inner");
            var error = (Throwable) call(__M$Effect_Exception.errorWithCause, "outer", cause);
            equal("Error", call(__M$Effect_Exception.name, error));
            equal("outer", call(__M$Effect_Exception.message, error));
            equal(true, error.getCause() == cause);
            equal("Error: outer", header(error));
            equal(true, ((String) call(__M$Effect_Exception.showErrorImpl, error)).contains("Caused by: Error: inner"));
        });
        test("Exception named Error header", () -> {
            var error = (Throwable) call(__M$Effect_Exception.errorWithName, "échec", "CustomError");
            equal("CustomError", call(__M$Effect_Exception.name, error));
            equal("échec", call(__M$Effect_Exception.message, error));
            equal("CustomError: échec", header(error));
        });
        test("Exception empty names and messages", () -> {
            for (String[] value : new String[][]{{"message", "", "message"}, {"", "CustomError", "CustomError"}, {"", "", ""}}) {
                var error = (Throwable) call(__M$Effect_Exception.errorWithName, value[0], value[1]);
                equal(value[1].isEmpty() ? "Error" : value[1], call(__M$Effect_Exception.name, error));
                equal(value[2], header(error));
            }
            equal("Error", header((Throwable) call(__M$Effect_Exception.error, "")));
        });
        test("Exception native properties stay usable", () -> {
            equal("IOException", call(__M$Effect_Exception.name, new java.io.IOException()));
            equal("", call(__M$Effect_Exception.message, new java.io.IOException()));
            equal("Error", call(__M$Effect_Exception.name, new RuntimeException() {}));
        });
        test("Exception show and stack retain native details", () -> {
            var error = (Throwable) call(__M$Effect_Exception.errorWithName, "trace", "TraceError");
            error.addSuppressed(new IllegalStateException("suppressed"));
            Object stack = call(__M$Effect_Exception.stackImpl, (Function<Object, Object>) value -> value, null, error);
            equal(stack, call(__M$Effect_Exception.showErrorImpl, error));
            equal("TraceError: trace", ((String) stack).lines().findFirst().orElseThrow());
            equal(true, ((String) stack).contains("Suppressed: java.lang.IllegalStateException: suppressed"));
        });
        test("Exception throwing is deferred, repeatable and identity preserving", () -> {
            for (Throwable error : new Throwable[]{(Throwable) call(__M$Effect_Exception.error, "error"),
                new IllegalArgumentException("runtime"), new java.io.IOException("checked"), new AssertionError("fatal")}) {
                Object action = call(__M$Effect_Exception.throwException, error);
                equal(true, thrownBy(() -> effect(action)) == error);
                equal(true, thrownBy(() -> effect(action)) == error);
                equal(true, caught(action) == error);
            }
        });
        test("Exception catch is deferred and leaves success untouched", () -> {
            AtomicInteger actions = new AtomicInteger(), handlers = new AtomicInteger();
            Object action = call(__M$Effect_Exception.catchException,
                (Function<Object, Object>) error -> { handlers.incrementAndGet(); throw new AssertionError("unexpected handler"); },
                (Supplier<Object>) () -> { actions.incrementAndGet(); return null; });
            equal(0, actions.get()); equal(0, handlers.get());
            equal(null, effect(action)); equal(null, effect(action));
            equal(2, actions.get()); equal(0, handlers.get());
            Object result = new Object(); equal(true, caught((Supplier<Object>) () -> result) == result);
        });
        test("Exception handler applies and forces once", () -> {
            RuntimeException error = new RuntimeException("body");
            AtomicInteger actions = new AtomicInteger(), handlers = new AtomicInteger(), effects = new AtomicInteger();
            Object action = call(__M$Effect_Exception.catchException,
                (Function<Object, Object>) value -> { equal(true, value == error); handlers.incrementAndGet();
                    return (Supplier<Object>) () -> { effects.incrementAndGet(); return 42; }; },
                (Supplier<Object>) () -> { actions.incrementAndGet(); throw error; });
            equal(0, actions.get()); equal(0, handlers.get()); equal(0, effects.get());
            equal(42, effect(action)); equal(1, actions.get()); equal(1, handlers.get()); equal(1, effects.get());
        });
        test("Exception catch accepts native Error without wrapping", () -> {
            AssertionError error = new AssertionError("native");
            equal(true, caught((Supplier<Object>) () -> { throw error; }) == error);
        });
        test("Exception handler application failure escapes once", () -> {
            RuntimeException error = new RuntimeException("handler application"); AtomicInteger handlers = new AtomicInteger();
            Object action = call(__M$Effect_Exception.catchException,
                (Function<Object, Object>) value -> { handlers.incrementAndGet(); throw error; },
                call(__M$Effect_Exception.throwException, new RuntimeException("body")));
            equal(true, thrownBy(() -> effect(action)) == error); equal(1, handlers.get());
        });
        test("Exception handler effect failure escapes once", () -> {
            java.io.IOException error = new java.io.IOException("handler effect"); AtomicInteger handlers = new AtomicInteger();
            Object action = call(__M$Effect_Exception.catchException,
                (Function<Object, Object>) value -> { handlers.incrementAndGet(); return call(__M$Effect_Exception.throwException, error); },
                call(__M$Effect_Exception.throwException, new RuntimeException("body")));
            equal(true, thrownBy(() -> effect(action)) == error); equal(1, handlers.get());
        });
        test("Exception identity crosses lifted Aff and Promise handlers", () -> {
            for (Throwable error : new Throwable[]{new java.io.IOException("checked"), new AssertionError("fatal")}) {
                Object action = call(__M$Effect_Exception.throwException, error);
                equal(true, run(call(__M$Effect_Aff._catchError, lifted((Supplier<Object>) action),
                    (Function<Object, Object>) value -> pure(value))) == error);
                var promise = then(resolved(1), ignored -> action);
                equal(true, promise.failed); equal(true, promise.rejection == error);
            }
        });
    }

    static void refs() {
        test("Ref allocation/evaluation/identity", () -> {
            Object action = call(__M$Effect_Ref._new, 1);
            Object a = effect(action), b = effect(action);
            equal(false, a == b);
            Object write = call(__M$Effect_Ref.write, 2, a);
            equal(1, effect(call(__M$Effect_Ref.read, a)));
            equal(null, effect(write)); equal(2, effect(call(__M$Effect_Ref.read, a)));
            equal(1, effect(call(__M$Effect_Ref.read, b)));
        });
        test("Ref atomic modify and visible result", () -> {
            Object ref = effect(call(__M$Effect_Ref._new, 0));
            Function<Object, Object> update = value -> Map.of("state", (int) value + 1, "value", value);
            List<Thread> threads = new ArrayList<>();
            CountDownLatch start = new CountDownLatch(1);
            Set<Integer> observed = ConcurrentHashMap.newKeySet();
            for (int t = 0; t < 4; t++) threads.add(daemon(() -> {
                try { await(start); for (int i = 0; i < 500; i++) observed.add((int) effect(call(__M$Effect_Ref.modifyImpl, update, ref))); }
                catch (Exception e) { throw new RuntimeException(e); }
            }));
            start.countDown(); for (Thread thread : threads) join(thread);
            equal(2000, effect(call(__M$Effect_Ref.read, ref))); equal(2000, observed.size());
        });
        test("Ref callback failure leaves state", () -> {
            Object ref = effect(call(__M$Effect_Ref._new, 10));
            RuntimeException failure = new RuntimeException("update");
            try { effect(call(__M$Effect_Ref.modifyImpl, (Function<Object, Object>) x -> { throw failure; }, ref)); throw new AssertionError(); }
            catch (RuntimeException error) { equal(failure, error); }
            equal(10, effect(call(__M$Effect_Ref.read, ref)));
        });
        test("Ref newWithSelf publishes same cell", () -> {
            Object ref = effect(call(__M$Effect_Ref.newWithSelf, (Function<Object, Object>) x -> x));
            equal(ref, effect(call(__M$Effect_Ref.read, ref)));
        });
    }

    static final class Deferred {
        Object resolve, reject;
        final __M$Promise_Internal.PromiseValue promise;
        Deferred() {
            promise = (__M$Promise_Internal.PromiseValue) effect(call(__M$Promise_Internal.$new,
                (Function<Object, Object>) yes -> (Function<Object, Object>) no -> (Supplier<Object>) () -> {
                    resolve = yes; reject = no; return null;
                }));
        }
        void resolve(Object value) { effect(call(resolve, value)); }
        void reject(Object error) { effect(call(reject, error)); }
    }
    static Object resolved(Object value) { return call(__M$Promise_Internal.resolve, value); }
    static __M$Promise_Internal.PromiseValue then(Object promise, Function<Object, Object> k) {
        return (__M$Promise_Internal.PromiseValue) effect(call(__M$Promise_Internal.then_, k, promise));
    }
    static void promise() {
        test("Promise pending subscriptions are deferred", () -> {
            Deferred source = new Deferred(); AtomicInteger calls = new AtomicInteger();
            var next = then(source.promise, x -> (Supplier<Object>) () -> { calls.incrementAndGet(); return resolved(x); });
            equal(0, calls.get()); equal(false, next.settled);
            source.resolve(42); equal(1, calls.get()); equal(true, next.settled); equal(42, next.value);
        });
        test("Promise first resolution claims adoption", () -> {
            Deferred source = new Deferred(), inner = new Deferred();
            source.resolve(inner.promise); source.reject("late");
            equal(false, source.promise.settled); inner.resolve(null);
            equal(true, source.promise.settled); equal(false, source.promise.failed); equal(null, source.promise.value);
        });
        test("Promise racing resolvers publish one outcome", () -> {
            Deferred source = new Deferred(); AtomicInteger calls = new AtomicInteger(); CountDownLatch gate = new CountDownLatch(1);
            then(source.promise, x -> (Supplier<Object>) () -> { calls.incrementAndGet(); return resolved(x); });
            List<Thread> threads = new ArrayList<>();
            for (int i = 0; i < 8; i++) { final int value = i; threads.add(daemon(() -> { try { await(gate); source.resolve(value); } catch (Exception e) { throw new RuntimeException(e); } })); }
            gate.countDown(); for (Thread thread : threads) join(thread);
            equal(1, calls.get()); equal(true, source.promise.settled);
        });
        test("Promise handler exception rejects child", () -> {
            RuntimeException failure = new RuntimeException("handler");
            var next = then(resolved(1), x -> (Supplier<Object>) () -> { throw failure; });
            equal(true, next.failed); equal(failure, next.rejection);
        });
        test("Promise executor failure is rejection", () -> {
            RuntimeException failure = new RuntimeException("executor");
            var next = (__M$Promise_Internal.PromiseValue) effect(call(__M$Promise_Internal.$new,
                (Function<Object, Object>) yes -> (Function<Object, Object>) no -> (Supplier<Object>) () -> { throw failure; }));
            equal(true, next.failed); equal(failure, next.rejection);
        });
        test("Promise all retains input order and null", () -> {
            Deferred a = new Deferred(), b = new Deferred();
            var all = (__M$Promise_Internal.PromiseValue) effect(call(__M$Promise_Internal.all, (Object) new Object[]{a.promise, b.promise}));
            b.resolve(null); equal(false, all.settled); a.resolve(1);
            equal(Arrays.asList(1, null), Arrays.asList((Object[]) all.value));
        });
        test("Promise race keeps first rejection", () -> {
            var race = (__M$Promise_Internal.PromiseValue) effect(call(__M$Promise_Internal.race,
                (Object) new Object[]{call(__M$Promise_Internal.reject, "first"), resolved(2)}));
            equal(true, race.failed); equal("first", race.rejection);
        });
        test("Promise empty race stays pending", () -> {
            var race = (__M$Promise_Internal.PromiseValue) effect(call(__M$Promise_Internal.race, (Object) new Object[]{}));
            equal(false, race.settled);
        });
        test("Promise finally awaits cleanup and preserves failure", () -> {
            Deferred cleanup = new Deferred(); Object failure = new Object();
            var next = (__M$Promise_Internal.PromiseValue) effect(call(__M$Promise_Internal.$finally,
                (Supplier<Object>) () -> cleanup.promise, call(__M$Promise_Internal.reject, failure)));
            equal(false, next.settled); cleanup.resolve(null);
            equal(true, next.failed); equal(failure, next.rejection);
        });
        test("Promise finally cleanup failure takes precedence", () -> {
            var next = (__M$Promise_Internal.PromiseValue) effect(call(__M$Promise_Internal.$finally,
                (Supplier<Object>) () -> call(__M$Promise_Internal.reject, "cleanup"), resolved(10)));
            equal(true, next.failed); equal("cleanup", next.rejection);
        });
        test("Promise long pending chain uses bounded stack", () -> {
            Deferred source = new Deferred(); Object last = source.promise;
            for (int i = 0; i < 20000; i++) last = then(last, x -> (Supplier<Object>) () -> resolved((int) x + 1));
            source.resolve(0); equal(20000, ((__M$Promise_Internal.PromiseValue) last).value);
        });
        test("Promise self resolution rejects instead of publishing itself", () -> {
            Deferred source = new Deferred(); source.resolve(source.promise);
            equal(true, source.promise.failed); equal(true, source.promise.rejection instanceof IllegalStateException);
        });
        test("Promise observers remain independent after a handler fails", () -> {
            Deferred source = new Deferred(); AtomicInteger observed = new AtomicInteger();
            var failed = then(source.promise, x -> (Supplier<Object>) () -> { throw new IllegalStateException("one observer"); });
            var successful = then(source.promise, x -> (Supplier<Object>) () -> { observed.incrementAndGet(); return resolved(x); });
            source.resolve(42); equal(true, failed.failed); equal(42, successful.value); equal(1, observed.get());
        });
        test("Promise subscriptions racing settlement deliver exactly once outside locks", () -> {
            Deferred source = new Deferred(); CountDownLatch gate = new CountDownLatch(1); AtomicInteger calls = new AtomicInteger();
            Function<Object, Object> handler = value -> (Supplier<Object>) () -> {
                var reader = background(() -> { synchronized (source.promise) { equal(true, source.promise.settled); return source.promise.value; } });
                try { equal(42, result(reader)); } catch (Exception e) { throw new RuntimeException(e); }
                calls.incrementAndGet(); return resolved(value);
            };
            List<FutureTask<Object>> subscribers = new ArrayList<>();
            for (int i = 0; i < 8; i++) subscribers.add(background(() -> {
                try { await(gate); } catch (Exception e) { throw new RuntimeException(e); }
                return then(source.promise, handler);
            }));
            gate.countDown(); source.resolve(42);
            for (var subscriber : subscribers) {
                var child = (__M$Promise_Internal.PromiseValue) result(subscriber);
                equal(true, child.settled); equal(false, child.failed); equal(42, child.value);
            }
            equal(8, calls.get());
        });
    }

    static void aff() {
        test("Aff bind/map trampoline and effect timing", () -> {
            AtomicInteger evaluations = new AtomicInteger(); Object action = lifted(() -> evaluations.incrementAndGet());
            for (int i = 0; i < 20000; i++) action = call(__M$Effect_Aff._map, (Function<Object, Object>) x -> x, action);
            equal(0, evaluations.get()); equal(1, run(action)); equal(2, run(action));
        });
        test("Aff late join and repeat join", () -> {
            var fiber = fiber(pure(42)); effect(fiber.get("run"));
            ((__M$Effect_Aff.NativeFiber) fiber.get("__fiber")).await();
            for (int i = 0; i < 3; i++) {
                AtomicReference<Object> value = new AtomicReference<>();
                effect(call(fiber.get("join"), (Function<Object, Object>) result -> (Supplier<Object>) () -> {
                    value.set(((__M$Data_Either.Right) result).value0); return null;
                }));
                equal(42, value.get());
            }
        });
        test("Aff onComplete observes without starting and can detach", () -> {
            var fiber = fiber(pure(42)); AtomicInteger callbacks = new AtomicInteger();
            Object detach = effect(call(fiber.get("onComplete"), Map.of("rethrow", false,
                "handler", (Function<Object, Object>) result -> (Supplier<Object>) () -> callbacks.incrementAndGet())));
            equal(true, effect(fiber.get("isSuspended"))); effect(detach);
            effect(fiber.get("run")); ((__M$Effect_Aff.NativeFiber) fiber.get("__fiber")).await(); equal(0, callbacks.get());
        });
        test("Aff running is not suspended", () -> {
            CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
            var fiber = fiber(lifted(() -> { entered.countDown(); try { await(release); } catch (Exception e) { throw new RuntimeException(e); } return null; }));
            effect(fiber.get("run")); await(entered);
            try { equal(false, effect(fiber.get("isSuspended"))); } finally { release.countDown(); }
            ((__M$Effect_Aff.NativeFiber) fiber.get("__fiber")).await();
        });
        test("Aff late cancellation registration uses first cause once", () -> {
            var ctx = new __M$Effect_Aff.RunContext(null); Object first = new Object(); AtomicInteger calls = new AtomicInteger();
            ctx.cancel(first); ctx.cancel(new Object());
            ctx.registerCanceler((Function<Object, Object>) cause -> (__M$Effect_Aff.AffRun) ignored -> {
                equal(first, cause); calls.incrementAndGet(); return null;
            });
            equal(1, calls.get());
        });
        test("Aff suspended fiber publishes its retained cancellation cause", () -> {
            var fiber = fiber(lifted(() -> { throw new AssertionError("suspended body ran"); }));
            var nativeFiber = (__M$Effect_Aff.NativeFiber) fiber.get("__fiber");
            Object first = new Object(); nativeFiber.ctx.cancel(first);
            AtomicReference<Object> outcome = new AtomicReference<>();
            effect(call(fiber.get("onComplete"), Map.of("rethrow", false,
                "handler", (Function<Object, Object>) value -> (Supplier<Object>) () -> { outcome.set(value); return null; })));
            nativeFiber.kill(new Object(), null); nativeFiber.await();
            equal(first, ((__M$Data_Either.Left) outcome.get()).value0);
            equal(false, effect(fiber.get("isSuspended")));
        });
        test("Aff concurrent fiber kills wait for cleanup and notify once", () -> {
            CountDownLatch started = new CountDownLatch(1), cleaning = new CountDownLatch(1), release = new CountDownLatch(1);
            AtomicInteger cleaned = new AtomicInteger(), notified = new AtomicInteger(); AtomicReference<Object> outcome = new AtomicReference<>();
            Object cause = new Object();
            var fiber = fiber(call(__M$Effect_Aff.makeAff, (Function<Object, Object>) cb -> (Supplier<Object>) () -> {
                started.countDown(); return (Function<Object, Object>) error -> lifted(() -> {
                    equal(cause, error); cleaning.countDown();
                    try { await(release); } catch (Exception e) { throw new RuntimeException(e); }
                    cleaned.incrementAndGet(); return null;
                });
            }));
            var nativeFiber = (__M$Effect_Aff.NativeFiber) fiber.get("__fiber");
            effect(call(fiber.get("join"), (Function<Object, Object>) value -> (Supplier<Object>) () -> { outcome.set(value); return null; }));
            Function<Object, Object> callback = value -> (Supplier<Object>) () -> { notified.incrementAndGet(); return null; };
            await(started); var first = background(() -> nativeFiber.kill(cause, callback)); await(cleaning);
            nativeFiber.kill(new Object(), callback); equal(0, notified.get()); equal(null, outcome.get());
            release.countDown(); result(first); nativeFiber.await();
            equal(1, cleaned.get()); equal(2, notified.get()); equal(cause, ((__M$Data_Either.Left) outcome.get()).value0);
        });
        test("Aff completed async action removes canceler", () -> {
            var ctx = new __M$Effect_Aff.RunContext(null); AtomicInteger calls = new AtomicInteger();
            Object action = call(__M$Effect_Aff.makeAff,
                (Function<Object, Object>) callback -> (Supplier<Object>) () -> {
                    effect(call(callback, right(42)));
                    return (Function<Object, Object>) cause -> (__M$Effect_Aff.AffRun) ignored -> { calls.incrementAndGet(); return null; };
                });
            equal(42, run(action, ctx)); ctx.cancel(new Object()); equal(0, calls.get());
        });
        test("Aff catches exceptions from lifted Effect", () -> {
            RuntimeException failure = new RuntimeException("effect");
            equal(failure, run(call(__M$Effect_Aff._catchError, lifted(() -> { throw failure; }), (Function<Object, Object>) error -> pure(error))));
        });
        test("Aff bracket completes cleanup once when cleanup fails", () -> {
            AtomicInteger completed = new AtomicInteger(), failed = new AtomicInteger(); RuntimeException failure = new RuntimeException("cleanup");
            Map<String, Object> handlers = Map.of(
                "completed", (Function<Object, Object>) value -> (Function<Object, Object>) resource -> lifted(() -> { completed.incrementAndGet(); throw new __M$Effect_Aff.AffError(failure); }),
                "failed", (Function<Object, Object>) error -> (Function<Object, Object>) resource -> lifted(() -> failed.incrementAndGet()),
                "killed", (Function<Object, Object>) error -> (Function<Object, Object>) resource -> pure(null));
            try { run(call(__M$Effect_Aff.generalBracket, pure("resource"), handlers, (Function<Object, Object>) r -> pure(1))); throw new AssertionError(); }
            catch (__M$Effect_Aff.AffError error) { equal(failure, error.error); }
            equal(1, completed.get()); equal(0, failed.get());
        });
        test("Aff race can win with Unit/null", () -> {
            equal(null, run(call(__M$Effect_Aff._parAffAlt, pure(null), call(__M$Effect_Aff._throwError, new RuntimeException("loser")))));
        });
        test("Aff parallel preserves original error over sibling cancellation", () -> {
            Object failure = new RuntimeException("original"); CountDownLatch started = new CountDownLatch(1);
            Object waiting = call(__M$Effect_Aff.makeAff, (Function<Object, Object>) cb -> (Supplier<Object>) () -> { started.countDown(); return nonCanceler(); });
            Object failing = lifted(() -> { try { await(started); } catch (Exception e) { throw new RuntimeException(e); } throw new __M$Effect_Aff.AffError(failure); });
            try { run(call(__M$Effect_Aff._parAffApply, waiting, failing)); throw new AssertionError(); }
            catch (__M$Effect_Aff.AffError error) { equal(failure, error.error); }
        });
        test("Aff cancellation during async builder invokes late canceler", () -> {
            var context = new __M$Effect_Aff.RunContext(null); Object cause = new Object();
            CountDownLatch building = new CountDownLatch(1), release = new CountDownLatch(1); AtomicInteger calls = new AtomicInteger();
            Object action = call(__M$Effect_Aff.makeAff, (Function<Object, Object>) cb -> (Supplier<Object>) () -> {
                building.countDown(); try { await(release); } catch (Exception e) { throw new RuntimeException(e); }
                return (Function<Object, Object>) error -> (__M$Effect_Aff.AffRun) ignored -> { equal(cause, error); calls.incrementAndGet(); return null; };
            });
            var task = background(() -> { try { run(action, context); throw new AssertionError(); } catch (__M$Effect_Aff.AffCancelled e) { return e.error; } });
            await(building); context.cancel(cause); release.countDown(); equal(cause, result(task)); equal(1, calls.get());
        });
        test("Aff racing cancellations retain first cause and complete once", () -> {
            var context = new __M$Effect_Aff.RunContext(null); Object cause = new Object(); AtomicInteger calls = new AtomicInteger();
            CountDownLatch canceling = new CountDownLatch(1), release = new CountDownLatch(1);
            context.registerCanceler((Function<Object, Object>) error -> (__M$Effect_Aff.AffRun) ignored -> {
                equal(cause, error); calls.incrementAndGet(); canceling.countDown();
                try { await(release); } catch (Exception e) { throw new RuntimeException(e); } return null;
            });
            var first = background(() -> { context.cancel(cause); return null; }); await(canceling);
            context.cancel(new Object()); release.countDown(); result(first); equal(1, calls.get());
            try { context.check(); throw new AssertionError(); } catch (__M$Effect_Aff.AffCancelled error) { equal(cause, error.error); }
        });
        test("Aff bracket masks acquisition and releases before completion", () -> {
            var context = new __M$Effect_Aff.RunContext(null); CountDownLatch acquiring = new CountDownLatch(1), release = new CountDownLatch(1);
            List<String> trace = new CopyOnWriteArrayList<>(); Object cause = new Object();
            Object acquire = lifted(() -> { acquiring.countDown(); try { await(release); } catch (Exception e) { throw new RuntimeException(e); } trace.add("acquire"); return 7; });
            Function<Object, Object> cleanup = value -> (Function<Object, Object>) resource -> lifted(() -> { equal(7, resource); trace.add("cleanup"); return null; });
            Object action = call(__M$Effect_Aff.generalBracket, acquire, Map.of("killed", cleanup, "failed", cleanup, "completed", cleanup),
                (Function<Object, Object>) resource -> lifted(() -> { trace.add("use"); return resource; }));
            var task = background(() -> { try { run(action, context); throw new AssertionError(); } catch (__M$Effect_Aff.AffCancelled error) { return error.error; } });
            await(acquiring); context.cancel(cause); release.countDown(); equal(cause, result(task)); equal(List.of("acquire", "cleanup"), trace);
        });
        test("Aff parent cancellation reaches both parallel branches", () -> {
            var context = new __M$Effect_Aff.RunContext(null); CountDownLatch started = new CountDownLatch(2); AtomicInteger cleanups = new AtomicInteger();
            Object waiting = call(__M$Effect_Aff.makeAff, (Function<Object, Object>) cb -> (Supplier<Object>) () -> {
                started.countDown(); return (Function<Object, Object>) cause -> lifted(() -> cleanups.incrementAndGet());
            });
            Object cause = new Object();
            var task = background(() -> { try { run(call(__M$Effect_Aff._parAffApply, waiting, waiting), context); throw new AssertionError(); }
                catch (__M$Effect_Aff.AffCancelled error) { return error.error; } });
            await(started); context.cancel(cause); equal(cause, result(task)); equal(2, cleanups.get());
        });
        test("Aff race waits for losing branch cleanup", () -> {
            CountDownLatch pending = new CountDownLatch(1), cleaning = new CountDownLatch(1), release = new CountDownLatch(1);
            Object loser = call(__M$Effect_Aff.makeAff, (Function<Object, Object>) cb -> (Supplier<Object>) () -> {
                pending.countDown(); return (Function<Object, Object>) cause -> lifted(() -> {
                    cleaning.countDown(); try { await(release); } catch (Exception e) { throw new RuntimeException(e); } return null;
                });
            });
            Object winner = lifted(() -> { try { await(pending); } catch (Exception e) { throw new RuntimeException(e); } return null; });
            var task = background(() -> run(call(__M$Effect_Aff._parAffAlt, loser, winner)));
            await(cleaning); equal(false, task.isDone()); release.countDown(); equal(null, result(task));
        });
        test("Aff supervision includes grandchildren and forks during shutdown", () -> {
            var supervisor = new __M$Effect_Aff.Supervisor(); var context = new __M$Effect_Aff.RunContext(supervisor);
            CountDownLatch started = new CountDownLatch(1), cleaning = new CountDownLatch(1), release = new CountDownLatch(1);
            AtomicInteger cleaned = new AtomicInteger(), lateBodies = new AtomicInteger();
            Object child = call(__M$Effect_Aff.makeAff, (Function<Object, Object>) cb -> (Supplier<Object>) () -> {
                started.countDown(); return (Function<Object, Object>) cause -> lifted(() -> {
                    cleaning.countDown(); try { await(release); } catch (Exception e) { throw new RuntimeException(e); }
                    cleaned.incrementAndGet(); return null;
                });
            });
            Object parent = call(__M$Effect_Aff._fork, true, child);
            var outer = (Map<String, Object>) run(call(__M$Effect_Aff._fork, true, parent), context);
            ((__M$Effect_Aff.NativeFiber) outer.get("__fiber")).await(); await(started);
            var shutdown = background(() -> { supervisor.killAll(new Object()); return null; }); await(cleaning);
            var late = (Map<String, Object>) run(call(__M$Effect_Aff._fork, true, lifted(() -> lateBodies.incrementAndGet())), context);
            ((__M$Effect_Aff.NativeFiber) late.get("__fiber")).await(); equal(0, lateBodies.get()); equal(false, shutdown.isDone());
            release.countDown(); result(shutdown); equal(1, cleaned.get());
        });
    }

    public static void main(String[] args) {
        switch (args[0]) { case "exceptions": exceptions(); break; case "refs": refs(); break; case "promise": promise(); break; case "aff": aff(); break; default: throw new AssertionError(args[0]); }
        if (failures != 0) throw new AssertionError(args[0] + ": " + failures + " failures, " + checks + " passed");
        System.out.println(args[0] + ": " + checks + " runtime protocol checks passed");
    }
}
