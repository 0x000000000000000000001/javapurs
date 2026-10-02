module Javapurs.Runtime (intFunctionSource, tcoLoopSource, mainRunSource) where

import Prelude

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
