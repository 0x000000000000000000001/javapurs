module Javapurs.Printer where

import Prelude
import Data.String as String
import Data.String.CodeUnits as StringCodeUnits
import Data.Maybe (Maybe(..))
import Data.Array as Array
import Data.Tuple (Tuple(..))
import Data.Char as Char
import Data.Int as Int
import Javapurs.JavaAst (JavaExpr(..), JavaFile)


escapeJavaString :: String -> String
escapeJavaString s =
  let
    escapeChar '\\' = "\\\\"
    escapeChar '\"' = "\\\""
    escapeChar '\n' = "\\n"
    escapeChar '\r' = "\\r"
    escapeChar '\t' = "\\t"
    escapeChar c =
      let code = Char.toCharCode c
      in if code >= 32 && code <= 126 then StringCodeUnits.singleton c
         else
           let hex = Int.toStringAs Int.hexadecimal code
               pad = if String.length hex == 1 then "000"
                     else if String.length hex == 2 then "00"
                     else if String.length hex == 3 then "0"
                     else ""
           in "\\u" <> pad <> hex
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
      let
        bodyStr = case body of
          JavaBlock stmts expr -> "{ " <> String.joinWith " " (map printExpr stmts) <> " return " <> printExpr expr <> "; }"
          _ -> "{ return " <> printExpr body <> "; }"
      in "(new java.util.function.Supplier<Object>() { public Object get() " <> bodyStr <> " })"
    else
      let
        bodyStr = case body of
          JavaBlock stmts expr -> "{ " <> String.joinWith " " (map printExpr stmts) <> " return " <> printExpr expr <> "; }"
          JavaWhileTrue params intParams expr -> printLoopBody params intParams expr
          _ -> printExpr body
      in Array.foldr (\arg acc -> "(java.util.function.Function<Object, Object>) (" <> arg <> ") -> " <> acc) bodyStr args
  JavaNew className args ->
    "new " <> className <> "(" <> String.joinWith ", " (map printExpr args) <> ")"
  JavaCtorSingleton modName ctorName ->
    modName <> "." <> singletonHolderName ctorName <> ".value"
  JavaTernary cond a b ->
    "( ((Boolean) (" <> printExpr cond <> ")) ? " <> printExpr a <> " : " <> printExpr b <> ")"
  JavaThrow msg ->
    "(new java.util.function.Supplier<Object>() { public Object get() { throw new RuntimeException(\"" <> msg <> "\"); } }).get()"
  JavaWhileTrue args intParams expr ->
    "(new java.util.function.Supplier<Object>() { public Object get() " <>
      printLoopBody args intParams expr <> " }).get()"
  JavaContinue loopId argsExprs ->
    "(new java.util.function.Supplier<Object>() { public Object get() { throw new TcoLoop(\"" <> loopId <> "\", new Object[]{" <> String.joinWith ", " (map printExpr argsExprs) <> "}); } }).get()"
  JavaRecord fields ->
    let
      puts = map (\(Tuple k v) -> "__map.put(\"" <> k <> "\", " <> printExpr v <> "); ") fields
    in
      "(new java.util.function.Supplier<Object>() { public Object get() { java.util.Map<String, Object> __map = new java.util.LinkedHashMap<>(); " <> String.joinWith "" puts <> " return __map; } }).get()"
  JavaArray items ->
    "new Object[]{" <> String.joinWith ", " (map printExpr items) <> "}"
  JavaMapGet expr prop ->
    "((java.util.LinkedHashMap<String, Object>) " <> printExpr expr <> ").get(\"" <> prop <> "\")"
  JavaMapUpdate expr updates ->
    let
      upds = map (\(Tuple prop val) -> "__map.put(\"" <> prop <> "\", " <> printExpr val <> "); ") updates
    in
      "(new java.util.function.Supplier<Object>() { public Object get() { java.util.Map<String, Object> __map = new java.util.LinkedHashMap<>((java.util.LinkedHashMap<String, Object>) " <> printExpr expr <> "); " <> String.joinWith "" upds <> " return __map; } }).get()"
  JavaInstanceOf expr className ->
    "(" <> printExpr expr <> " instanceof " <> className <> ")"
  JavaPropertyAccess expr className prop ->
    "((" <> className <> ") (Object)(" <> printExpr expr <> "))." <> prop
  JavaLetRec binds body ->
    "(new java.util.function.Supplier<Object>() { public Object get() { " <>
      printLetRecBindings binds <>
      "return " <> printExpr body <> "; " <>
    "} }).get()"
  JavaLet name val body ->
    let
      flattenLets :: JavaExpr -> { bindings :: Array (Tuple String JavaExpr), body :: JavaExpr }
      flattenLets = go []
        where
        go acc (JavaLet n v b) = go (Array.snoc acc (Tuple n v)) b
        go acc expr = { bindings: acc, body: expr }
      
      flat = flattenLets (JavaLet name val body)
      bindingsStr = String.joinWith " " (map (\(Tuple n v) -> "Object " <> n <> " = " <> printExpr v <> ";") flat.bindings)
    in
      "(new java.util.function.Supplier<Object>() { public Object get() { " <> bindingsStr <> " return " <> printExpr flat.body <> "; } }).get()"
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
      "        }" <>
      if Array.null args then
        -- Constructor fields come from dataDecls. A separate holder avoids
        -- reading an uninitialized module binding during cyclic initialization.
        "\npublic static final class " <> singletonHolderName className <> " {\n" <>
        "    public static final " <> className <> " value = new " <> className <> "();\n" <>
        "}"
      else ""
  JavaRaw code -> code
  JavaBinaryOp op e1 e2 ->
    "(" <> printExpr e1 <> " " <> op <> " " <> printExpr e2 <> ")"
  JavaCast t e ->
    "((" <> t <> ") (" <> printExpr e <> "))"
  JavaLocalAssign name expr ->
    "Object " <> name <> " = " <> printExpr expr <> ";"
  JavaBlock stmts expr ->
    "(new java.util.function.Supplier<Object>() { public Object get() { " <>
      String.joinWith " " (map printExpr stmts) <>
      " return " <> printExpr expr <> "; " <>
    "} }).get()"
  JavaAssign name expr ->
    if name == "main" then
      "public static final java.util.function.Supplier<Void> main = () -> {\n            ((java.util.function.Supplier<Object>)(" <> printExpr expr <> ")).get();\n            return null;\n        };"
    else
      "public static final Object " <> name <> " = " <> printExpr expr <> ";"
  JavaLazyAssign name expr ->
    let
      valueName = "__lazy_value_" <> name
      stateName = "__lazy_state_" <> name
      getterName = "__lazy_get_" <> name
    in
      -- No explicit cache initializers: another getter may fill this cache earlier.
      "private static Object " <> valueName <> ";\n" <>
      "private static int " <> stateName <> ";\n" <>
      "private static Object " <> getterName <> "() { " <>
        "if (" <> stateName <> " == 2) return " <> valueName <> "; " <>
        "if (" <> stateName <> " == 1) throw new IllegalStateException(\"Recursive initialization of " <> escapeJavaString name <> "\"); " <>
        stateName <> " = 1; " <>
        valueName <> " = " <> printExpr expr <> "; " <>
        stateName <> " = 2; " <>
        "return " <> valueName <> "; " <>
      "}\n" <>
      printExpr (JavaAssign name (JavaCall (JavaRaw getterName) []))

-- This prefix cannot be produced by source-binding or constructor sanitization.
singletonHolderName :: String -> String
singletonHolderName ctorName = "__singleton$" <> ctorName

-- A loop directly inside a function can use the lambda's block body. Keep the
-- Supplier wrapper when the loop is needed as an expression elsewhere.
printLoopBody :: Array String -> Array String -> JavaExpr -> String
printLoopBody args intParams expr =
  "{ " <>
    String.joinWith "" (map (\arg -> loopParamType intParams arg <> " __tco_" <> arg <> " = " <> printLoopValue intParams arg (JavaLocal arg) <> "; ") args) <>
    "while(true) { " <>
      String.joinWith "" (map (\arg -> "final " <> loopParamType intParams arg <> " __final_" <> arg <> " = __tco_" <> arg <> "; ") args) <>
      "try { " <>
        printLoopTail args intParams expr <>
      "} catch (TcoLoop __tco_ex) { " <>
        String.joinWith "" (Array.mapWithIndex (\i arg -> "__tco_" <> arg <> " = " <> printLoopValue intParams arg (JavaRaw ("__tco_ex.args[" <> show i <> "]")) <> "; ") args) <>
      "} " <>
    "} " <>
  "}"

-- Tail branches are statements in the loop's method, so they can continue it
-- directly. Expression forms that introduce a method boundary retain the
-- exception fallback; in particular, do not move a continue through a closure.
printLoopTail :: Array String -> Array String -> JavaExpr -> String
printLoopTail params intParams expr
  | not (hasDirectContinue expr) = "return " <> printExpr expr <> "; "
  | otherwise = case expr of
  JavaContinue _ values ->
    "{ " <>
      String.joinWith "" (map (\(Tuple param value) ->
        "final " <> loopParamType intParams param <> " __next_" <> param <> " = " <> printLoopValue intParams param value <> "; "
      ) (Array.zip params values)) <>
      String.joinWith "" (map (\param ->
        "__tco_" <> param <> " = __next_" <> param <> "; "
      ) params) <>
      "continue; } "
  JavaTernary cond yes no ->
    "if ((Boolean) (" <> printExpr cond <> ")) { " <>
      printLoopTail params intParams yes <>
    "} else { " <>
      printLoopTail params intParams no <>
    "} "
  JavaBlock stmts body ->
    "{ " <> String.joinWith " " (map printExpr stmts) <> " " <>
      printLoopTail params intParams body <> "} "
  JavaLet name value body ->
    "{ Object " <> name <> " = " <> printExpr value <> "; " <>
      printLoopTail params intParams body <> "} "
  JavaLetRec binds body ->
    "{ " <> printLetRecBindings binds <> printLoopTail params intParams body <> "} "
  other -> "return " <> printExpr other <> "; "

loopParamType :: Array String -> String -> String
loopParamType intParams name = if Array.elem name intParams then "int" else "Object"

-- Generic function arguments and the expression fallback still carry Objects.
-- A cast to int accepts those boxed values as well as primitive expressions.
printLoopValue :: Array String -> String -> JavaExpr -> String
printLoopValue intParams name expr =
  printExpr (if Array.elem name intParams then JavaCast "int" expr else expr)

hasDirectContinue :: JavaExpr -> Boolean
hasDirectContinue = case _ of
  JavaContinue _ _ -> true
  JavaTernary _ yes no -> hasDirectContinue yes || hasDirectContinue no
  JavaBlock _ body -> hasDirectContinue body
  JavaLet _ _ body -> hasDirectContinue body
  JavaLetRec _ body -> hasDirectContinue body
  _ -> false

printLetRecBindings :: Array (Tuple String JavaExpr) -> String
printLetRecBindings binds = case Array.head binds of
  Nothing -> ""
  Just (Tuple firstName _) ->
    let
      -- Binding identifiers are unique within the generated function. Tail
      -- emission can put nested recursive scopes in the same Java method.
      scopeClass = "LetRecScope_" <> firstName
      scopeVar = "__letrec_" <> firstName
    in
    "class " <> scopeClass <> " { " <>
      String.joinWith "" (map (\(Tuple name _) -> "Object " <> name <> "; ") binds) <>
      scopeClass <> "() { " <>
        String.joinWith "" (map (\(Tuple name value) -> name <> " = " <> printExpr value <> "; ") binds) <>
      "} " <>
    "} " <>
    scopeClass <> " " <> scopeVar <> " = new " <> scopeClass <> "(); " <>
    String.joinWith "" (map (\(Tuple name _) -> "Object " <> name <> " = " <> scopeVar <> "." <> name <> "; ") binds)

printFile :: String -> JavaFile -> String
printFile className file =
  "public class " <> className <> " {\n" <>
  "    " <> String.joinWith "\n    " (map printExpr file.decls) <> "\n" <>
  "}\n"
