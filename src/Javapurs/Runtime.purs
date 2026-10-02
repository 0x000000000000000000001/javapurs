module Javapurs.Runtime (intFunctionSource, tcoLoopSource, mainRunSource, builtinGlobalSource) where

import Prelude

import Data.Maybe (Maybe(..))

-- Pure templates. Emit owns filenames and when each source is written.
-- One object supports both function ABIs, including generic FFI callers.
intFunctionSource :: String
intFunctionSource = """
@FunctionalInterface
public interface __IntFn extends java.util.function.Function<Object, Object>, java.util.function.IntUnaryOperator {
    @Override
    default Object apply(Object value) {
        return applyAsInt((int) value);
    }

    static java.util.function.IntUnaryOperator from(java.util.function.Function<Object, Object> function) {
        if (function == null) return null;
        if (function instanceof __IntFn specialized) return specialized;
        return value -> (int) function.apply(value);
    }
}
"""

tcoLoopSource :: String
tcoLoopSource =
  "public class TcoLoop extends RuntimeException {\n" <>
  "    public String loopId;\n" <>
  "    public Object[] args;\n" <>
  "    public TcoLoop(String loopId, Object[] args) {\n" <>
  "        this.loopId = loopId;\n" <>
  "        this.args = args;\n" <>
  "    }\n" <>
  "    @Override\n" <>
  "    public synchronized Throwable fillInStackTrace() { return this; }\n" <>
  "}\n"

-- Inline compatibility implementations for these exact global reads. Printer
-- supplies the module name without the generated __M$ prefix. Other globals
-- retain their field read and the ordinary FFI resolution performed by Ffi.
builtinGlobalSource :: String -> String -> Maybe String
builtinGlobalSource moduleName name = case moduleName, name of
  "Effect_Console", "log" -> Just
    "(java.util.function.Function<Object, Object>) (arg) -> (java.util.function.Supplier<Object>) () -> { System.out.println(arg); return null; }"
  "Test_Assert", "assertImpl" -> Just
    "(java.util.function.Function<Object, Object>) (msg) -> (java.util.function.Function<Object, Object>) (b) -> (java.util.function.Supplier<Object>) () -> { if (!((Boolean) b)) { throw new RuntimeException((String) msg); } return null; }"
  "Effect", "bindE" -> Just
    "(java.util.function.Function<Object, Object>) (a) -> (java.util.function.Function<Object, Object>) (f) -> (java.util.function.Supplier<Object>) () -> { return ((java.util.function.Supplier<Object>) ((java.util.function.Function<Object, Object>) f).apply(((java.util.function.Supplier<Object>) a).get())).get(); }"
  "Effect", "pureE" -> Just
    "(java.util.function.Function<Object, Object>) (a) -> (java.util.function.Supplier<Object>) () -> a"
  "Data_Semigroup", "concatString" -> Just
    "(java.util.function.Function<Object, Object>) (a) -> (java.util.function.Function<Object, Object>) (b) -> a.toString() + b.toString()"
  _, _ -> Nothing

-- The argument is the already-escaped Java module class name, not a source
-- module name. Both entrypoint ABIs are accepted by the existing launcher.
mainRunSource :: String -> String
mainRunSource moduleClass =
  "public class MainRun {\n" <>
  "    @SuppressWarnings(\"unchecked\")\n" <>
  "    public static void main(String[] args) {\n" <>
  "        Object main = " <> moduleClass <> ".main;\n" <>
  "        if (main instanceof java.util.function.Supplier<?>) {\n" <>
  "            ((java.util.function.Supplier<Object>) main).get();\n" <>
  "        } else if (main instanceof java.util.function.Function<?, ?>) {\n" <>
  "            ((java.util.function.Function<Object, Object>) main).apply(null);\n" <>
  "        }\n" <>
  "    }\n" <>
  "}\n"
