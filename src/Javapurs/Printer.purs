module Javapurs.Printer where

import Data.Tuple (Tuple)
import Prelude
import Data.String as String
import Data.String.CodeUnits as StringCodeUnits
import Data.Maybe (Maybe(..))
import Data.Array as Array
import Data.Tuple (Tuple(..))
import Javapurs.JavaAst (JavaExpr(..), JavaFile)


escapeJavaString :: String -> String
escapeJavaString s =
  let
    escapeChar '\\' = "\\\\"
    escapeChar '\"' = "\\\""
    escapeChar '\n' = "\\n"
    escapeChar '\r' = "\\r"
    escapeChar '\t' = "\\t"
    escapeChar c = StringCodeUnits.singleton c
  in
    String.joinWith "" (map escapeChar (StringCodeUnits.toCharArray s))

printExpr :: JavaExpr -> String
printExpr = case _ of
  JavaString s -> "\"" <> escapeJavaString s <> "\""
  JavaCall fn args ->
    let
      fnStr = printExpr fn
      argsStr = String.joinWith ", " (map printExpr args)
    in
      fnStr <> "(" <> argsStr <> ")"
  JavaApply fn arg ->
    "((java.util.function.Function<Object, Object>) (" <> printExpr fn <> ")).apply(" <> printExpr arg <> ")"
  JavaFunction expr ->
    "(java.util.function.Supplier<Object>) () -> " <> printExpr expr
  JavaGlobalVar mbMod name ->
    case mbMod of
      Just "Effect_Console" -> if name == "log" then "(java.util.function.Function<Object, Object>) (arg) -> (java.util.function.Supplier<Object>) () -> { System.out.println(arg); return null; }" else "Effect_Console." <> name
      Just "Test_Assert" -> if name == "assertImpl" then "(java.util.function.Function<Object, Object>) (msg) -> (java.util.function.Function<Object, Object>) (b) -> (java.util.function.Supplier<Object>) () -> { if (!((Boolean) b)) { throw new RuntimeException((String) msg); } return null; }" else "Test_Assert." <> name
      Just "Effect" -> case name of
        "bindE" -> "(java.util.function.Function<Object, Object>) (a) -> (java.util.function.Function<Object, Object>) (f) -> (java.util.function.Supplier<Object>) () -> { return ((java.util.function.Supplier<Object>) ((java.util.function.Function<Object, Object>) f).apply(((java.util.function.Supplier<Object>) a).get())).get(); }"
        "pureE" -> "(java.util.function.Function<Object, Object>) (a) -> (java.util.function.Supplier<Object>) () -> a"
        _ -> "Effect." <> name
      Just "Data_Semigroup" -> if name == "concatString" then "(java.util.function.Function<Object, Object>) (a) -> (java.util.function.Function<Object, Object>) (b) -> a.toString() + b.toString()" else "Data_Semigroup." <> name
      Just m -> m <> "." <> name
      Nothing -> name
  JavaLocal name -> name
  JavaAbs args body ->
    if Array.length args == 0 then
      "(java.util.function.Supplier<Object>) () -> " <> printExpr body
    else
      Array.foldr (\arg acc -> "(java.util.function.Function<Object, Object>) (" <> arg <> ") -> " <> acc) (printExpr body) args
  JavaNew className args ->
    "new " <> className <> "(" <> String.joinWith ", " (map printExpr args) <> ")"
  JavaTernary cond a b ->
    "( ((Boolean) (" <> printExpr cond <> ")) ? " <> printExpr a <> " : " <> printExpr b <> ")"
  JavaThrow msg ->
    "((java.util.function.Supplier<Object>) () -> { throw new RuntimeException(\"" <> msg <> "\"); }).get()"
  JavaWhileTrue args expr ->
    "((java.util.function.Supplier<Object>) () -> { " <>
      String.joinWith "" (map (\arg -> "Object __tco_" <> arg <> " = " <> arg <> "; ") args) <>
      "while(true) { " <>
        String.joinWith "" (map (\arg -> "final Object __final_" <> arg <> " = __tco_" <> arg <> "; ") args) <>
        "try { " <>
          "return " <> printExpr expr <> "; " <>
        "} catch (TcoLoop __tco_ex) { " <>
          String.joinWith "" (Array.mapWithIndex (\i arg -> "__tco_" <> arg <> " = __tco_ex.args[" <> show i <> "]; ") args) <>
        "} " <>
      "} " <>
    "}).get()"
  JavaContinue loopId argsExprs ->
    "((java.util.function.Supplier<Object>) () -> { throw new TcoLoop(\"" <> loopId <> "\", new Object[]{" <> String.joinWith ", " (map printExpr argsExprs) <> "}); }).get()"
  JavaRecord fields ->
    let
      puts = map (\(Tuple k v) -> "put(\"" <> k <> "\", " <> printExpr v <> "); ") fields
    in
      "new java.util.LinkedHashMap<String, Object>() {{ " <> String.joinWith "" puts <> "}}"
  JavaMapGet expr prop ->
    "((java.util.LinkedHashMap<String, Object>) " <> printExpr expr <> ").get(\"" <> prop <> "\")"
  JavaMapUpdate expr updates ->
    let
      upds = map (\(Tuple prop val) -> "put(\"" <> prop <> "\", " <> printExpr val <> "); ") updates
    in
      "new java.util.LinkedHashMap<String, Object>((java.util.LinkedHashMap<String, Object>) " <> printExpr expr <> ") {{ " <> String.joinWith "" upds <> "}}"
  JavaInstanceOf expr className ->
    "(" <> printExpr expr <> " instanceof " <> className <> ")"
  JavaPropertyAccess expr className prop ->
    "(((" <> className <> ") " <> printExpr expr <> ")." <> prop <> ")"
  JavaLetRec binds body ->
    "((new java.util.function.Supplier<Object>() { " <>
      "class LetRecScope { " <>
        String.joinWith "" (map (\(Tuple name val) -> "Object " <> name <> "; ") binds) <>
        "LetRecScope() { " <>
          String.joinWith "" (map (\(Tuple name val) -> name <> " = " <> printExpr val <> "; ") binds) <>
        "} " <>
      "} " <>
      "LetRecScope _scope = new LetRecScope(); " <>
      String.joinWith "" (map (\(Tuple name val) -> "Object " <> name <> " = _scope." <> name <> "; ") binds) <>
      "public Object get() { return " <> printExpr body <> "; } " <>
    "})).get()"
  JavaLet name val body ->
    "((new java.util.function.Supplier<Object>() { Object " <> name <> " = " <> printExpr val <> "; public Object get() { return " <> printExpr body <> "; } })).get()"
  JavaClassDecl className args ->
    let
      fields = map (\arg -> "public final Object " <> arg <> ";") args
      assigns = map (\arg -> "this." <> arg <> " = " <> arg <> ";") args
      constructorArgs = map (\arg -> "Object " <> arg) args
      constructor =
        "public " <> className <> "(" <> String.joinWith ", " constructorArgs <> ") {\n" <>
        "                " <> String.joinWith "\n                " assigns <> "\n" <>
        "            }"
    in
      "public static final class " <> className <> " {\n" <>
      "            " <> String.joinWith "\n            " fields <> "\n" <>
      "            " <> constructor <> "\n" <>
      "        }"
  JavaRaw code -> code
  JavaBinaryOp op e1 e2 ->
    "(" <> printExpr e1 <> " " <> op <> " " <> printExpr e2 <> ")"
  JavaCast t e ->
    "((" <> t <> ") (" <> printExpr e <> "))"
  JavaAssign name expr ->
    if name == "main" then
      "public static final java.util.function.Supplier<Void> main = () -> {\n            ((java.util.function.Supplier<Object>)(" <> printExpr expr <> ")).get();\n            return null;\n        };"
    else
      "public static final Object " <> name <> " = " <> printExpr expr <> ";"

printFile :: String -> JavaFile -> String
printFile className file =
  "public class " <> className <> " {\n" <>
  "    " <> String.joinWith "\n    " (map printExpr file.decls) <> "\n" <>
  "}\n"
