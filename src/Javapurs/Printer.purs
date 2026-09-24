module Javapurs.Printer where

import Prelude
import Data.String as String
import Data.String.CodeUnits as StringCodeUnits
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Array as Array
import Data.Tuple (Tuple(..), snd)
import Data.Char as Char
import Data.Int as Int
import Javapurs.CountedLoops (CountedLoop, countedLoop)
import Javapurs.RecordPrinter as RecordPrinter
import Javapurs.JavaAst (JavaExpr(..), JavaParamType(..), JavaFile)


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
  JavaIntApply fn arg ->
    "__IntFn.from((java.util.function.Function<Object, Object>) (" <> printExpr fn <> ")).applyAsInt(((int) (" <> printExpr arg <> ")))"
  JavaFunction expr ->
    "(java.util.function.Supplier<Object>) () -> " <> printExpr expr
  JavaGlobalVar mbMod name ->
    -- Module classes carry a generated prefix; the built-in translations match
    -- the source module name.
    let
      plainMod = map (\m -> String.replaceAll (String.Pattern "__M$") (String.Replacement "") m) mbMod
      qualified = (fromMaybe "" mbMod) <> "." <> name
    in case plainMod of
      Just "Effect_Console" -> if name == "log" then "(java.util.function.Function<Object, Object>) (arg) -> (java.util.function.Supplier<Object>) () -> { System.out.println(arg); return null; }" else qualified
      Just "Test_Assert" -> if name == "assertImpl" then "(java.util.function.Function<Object, Object>) (msg) -> (java.util.function.Function<Object, Object>) (b) -> (java.util.function.Supplier<Object>) () -> { if (!((Boolean) b)) { throw new RuntimeException((String) msg); } return null; }" else qualified
      Just "Effect" -> case name of
        "bindE" -> "(java.util.function.Function<Object, Object>) (a) -> (java.util.function.Function<Object, Object>) (f) -> (java.util.function.Supplier<Object>) () -> { return ((java.util.function.Supplier<Object>) ((java.util.function.Function<Object, Object>) f).apply(((java.util.function.Supplier<Object>) a).get())).get(); }"
        "pureE" -> "(java.util.function.Function<Object, Object>) (a) -> (java.util.function.Supplier<Object>) () -> a"
        _ -> qualified
      Just "Data_Semigroup" -> if name == "concatString" then "(java.util.function.Function<Object, Object>) (a) -> (java.util.function.Function<Object, Object>) (b) -> a.toString() + b.toString()" else qualified
      Just _ -> qualified
      Nothing -> name
  JavaLocal name -> name
  JavaAbs args body ->
    if Array.length args == 0 then
      let
        bodyStr = returnBody body
      in "(new java.util.function.Supplier<Object>() { public Object get() " <> bodyStr <> " })"
    else
      let
        bodyStr = methodBody body
      in Array.foldr (\arg acc -> "(java.util.function.Function<Object, Object>) (" <> arg <> ") -> " <> acc) bodyStr args
  JavaTypedAbs params body ->
    let
      bodyStr = methodBody body
    in Array.foldr (\(Tuple arg _) acc -> "(java.util.function.Function<Object, Object>) (" <> arg <> ") -> " <> acc) bodyStr params
  JavaIntAbs arg body ->
    let
      bodyStr = case body of
        JavaBlock stmts expr -> "{ " <> String.joinWith " " (map printExpr stmts) <> " return ((int) (" <> printExpr expr <> ")); }"
        _ -> "((int) (" <> printExpr body <> "))"
    in "(__IntFn) (" <> arg <> ") -> " <> bodyStr
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
  JavaMemoizedLoop args intParams invariants expr ->
    "(new java.util.function.Supplier<Object>() { public Object get() " <>
      printMemoizedLoopBody args intParams invariants expr <> " }).get()"
  JavaLoopInvariant name -> name <> ".getAsInt()"
  JavaContinue loopId argsExprs ->
    "(new java.util.function.Supplier<Object>() { public Object get() { throw new TcoLoop(\"" <> loopId <> "\", new Object[]{" <> String.joinWith ", " (map printExpr argsExprs) <> "}); } }).get()"
  JavaRecord fields ->
    let
      puts = map (\(Tuple k v) -> "__map.put(\"" <> escapeJavaString k <> "\", " <> printExpr v <> "); ") fields
    in
      "(new java.util.function.Supplier<Object>() { public Object get() { java.util.Map<String, Object> __map = new java.util.LinkedHashMap<>(); " <> String.joinWith "" puts <> " return __map; } }).get()"
  JavaTypedRecord shape fields -> RecordPrinter.printRecord printExpr shape fields
  JavaTypedRecordGet shape value prop -> RecordPrinter.printRecordGet printExpr shape value prop
  JavaTypedRecordUpdate shape value updates -> RecordPrinter.printRecordUpdate printExpr shape value updates
  JavaArray items ->
    "new Object[]{" <> String.joinWith ", " (map printExpr items) <> "}"
  JavaMapGet expr prop ->
    "((java.util.Map<String, Object>) " <> printExpr expr <> ").get(\"" <> escapeJavaString prop <> "\")"
  JavaMapUpdate expr updates ->
    let
      upds = map (\(Tuple prop val) -> "__map.put(\"" <> escapeJavaString prop <> "\", " <> printExpr val <> "); ") updates
    in
      "(new java.util.function.Supplier<Object>() { public Object get() { java.util.Map<String, Object> __map = new java.util.LinkedHashMap<>((java.util.Map<String, Object>) " <> printExpr expr <> "); " <> String.joinWith "" upds <> " return __map; } }).get()"
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
  JavaClassDecl className fields mutable ->
    let
      -- Ownership workers update the nodes of a tree in place, so those classes
      -- cannot keep the final modifier on their fields.
      fieldDecls = map (\(Tuple arg ty) -> "public " <> (if mutable then "" else "final ") <> paramType ty <> " " <> arg <> ";") fields
      typedArgs = map (\(Tuple arg ty) -> paramType ty <> " " <> arg) fields
      plainArgs = map (\(Tuple arg _) -> "Object " <> arg) fields
      assigns = map (\(Tuple arg ty) -> "this." <> arg <> " = " <> assignField ty arg <> ";") fields
      constructor argsList =
        "public " <> className <> "(" <> String.joinWith ", " argsList <> "){\n" <>
        "                " <> String.joinWith "\n                " assigns <> "\n" <>
        "            }"
      -- The variable-arity form reads its arguments from an array, where a
      -- proven Int is an Integer.
      hasInt = Array.any (\(Tuple _ ty) -> case ty of
        ParamInt -> true
        _ -> false) fields
      varargsCtor =
        "public " <> className <> "(Object... values) {\n" <>
        "                " <> String.joinWith "\n                " (Array.mapWithIndex (\i (Tuple arg ty) ->
            "this." <> arg <> " = " <> varargsAssign ty ("values[" <> show i <> "]") <> ";") fields) <> "\n" <>
        "            }"
      varargsAssign ty value = case ty of
        ParamInt -> "((Integer) (" <> value <> ")).intValue()"
        _ -> value
      -- A typed overload is chosen by exact argument types; the Object form is
      -- variable arity so Java only considers it after the typed one, which
      -- keeps calls whose arguments are primitive literals unambiguous.
      ctors = if hasInt then constructor typedArgs <> "\n            " <> varargsCtor else constructor plainArgs
    in
      "public static final class " <> className <> " {\n" <>
      "            " <> String.joinWith "\n            " fieldDecls <> "\n" <>
      "            " <> ctors <> "\n" <>
      "        }" <>
      if Array.null fields then
        -- Constructor fields come from dataDecls. A separate holder avoids
        -- reading an uninitialized module binding during cyclic initialization.
        "\npublic static final class " <> singletonHolderName className <> " {\n" <>
        "    public static final " <> className <> " value = new " <> className <> "();\n" <>
        "}"
      else ""
  JavaRaw code -> code
  JavaBinaryOp op e1 e2 ->
    "(" <> printExpr e1 <> " " <> op <> " " <> printExpr e2 <> ")"
  JavaUnaryOp op expr -> "(" <> op <> "(" <> printExpr expr <> "))"
  JavaArrayIndex array index -> "((Object[]) (" <> printExpr array <> "))[" <> printExpr (JavaCast "int" index) <> "]"
  JavaArraySet array index value ->
    "((Object[]) (" <> printExpr array <> "))[" <> printExpr (JavaCast "int" index) <> "] = " <> printExpr value <> ";"
  JavaCast t e ->
    "((" <> t <> ") (" <> printExpr e <> "))"
  JavaLocalAssign name expr ->
    "Object " <> name <> " = " <> printExpr expr <> ";"
  JavaIntLocalAssign name expr ->
    "int " <> name <> " = ((int) (" <> printExpr expr <> "));"
  JavaBlock stmts expr ->
    "(new java.util.function.Supplier<Object>() { public Object get() { " <>
      String.joinWith " " (map printExpr stmts) <>
      " return " <> printExpr expr <> "; " <>
    "} }).get()"
  JavaFieldSet target className fieldName fieldType value ->
    "((" <> className <> ") (Object)(" <> printExpr target <> "))." <> fieldName <> " = " <> assignField fieldType (printExpr value) <> ";"
  JavaLocalSet name value ->
    name <> " = " <> printExpr value <> ";"
  JavaIf condition thenStmts elseStmts ->
    "if ((Boolean) (" <> printExpr condition <> ")) { " <>
      String.joinWith " " (map printExpr thenStmts) <>
    "} else { " <>
      String.joinWith " " (map printExpr elseStmts) <>
    "} "
  JavaAssign name expr ->
    if name == "main" then
      "public static final java.util.function.Supplier<Void> main = () -> {\n            ((java.util.function.Supplier<Object>)(" <> printExpr expr <> ")).get();\n            return null;\n        };"
    else
      "public static final Object " <> name <> " = " <> printExpr expr <> ";"
  JavaStaticMethod name args body ->
    let
      -- Object parameters keep the JVM signature stable; proven Int parameters
      -- are primitives so direct worker calls do not box their arguments.
      parameterList = String.joinWith ", " (map (\(Tuple arg ty) -> paramType ty <> " " <> arg) args)
      bodyStr = methodBody body
    in "private static Object " <> name <> "(" <> parameterList <> ") " <> bodyStr
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

paramType :: JavaParamType -> String
paramType = case _ of
  ParamInt -> "int"
  _ -> "Object"

assignField :: JavaParamType -> String -> String
assignField ty arg = case ty of
  ParamInt -> "((int) (" <> arg <> "))"
  _ -> arg

-- A loop directly inside a function can use the lambda's block body. Keep the
-- Supplier wrapper when the loop is needed as an expression elsewhere.
printLoopBody :: Array String -> Array String -> JavaExpr -> String
printLoopBody args intParams = printMemoizedLoopBody args intParams []

-- Allocate each cache per fully applied invocation. Its computation stays at
-- the original expression site, preserving guards, evaluation order and throws.
printMemoizedLoopBody :: Array String -> Array String -> Array (Tuple String JavaExpr) -> JavaExpr -> String
printMemoizedLoopBody args intParams invariants expr =
  "{ " <>
    String.joinWith "" (map (\arg -> loopParamType intParams arg <> " __tco_" <> arg <> " = " <> printLoopValue intParams arg (JavaLocal arg) <> "; ") args) <>
    String.joinWith "" (map printInvariant invariants) <>
    (case countedLoop args intParams expr of
      Just loop -> printCountedLoop args intParams loop
      Nothing -> ""
    ) <>
    "while(true) { " <>
      printLoopSnapshots args intParams <>
      "try { " <>
        printLoopTail args intParams expr <>
      "} catch (TcoLoop __tco_ex) { " <>
        String.joinWith "" (Array.mapWithIndex (\i arg -> "__tco_" <> arg <> " = " <> printLoopValue intParams arg (JavaRaw ("__tco_ex.args[" <> show i <> "]")) <> "; ") args) <>
      "} " <>
    "} " <>
  "}"

printInvariant :: Tuple String JavaExpr -> String
printInvariant (Tuple name value) =
  "final java.util.function.IntSupplier " <> name <> " = new java.util.function.IntSupplier() { " <>
    "private boolean ready; private int value; " <>
    "public int getAsInt() { if (!ready) { value = ((int) (" <> printExpr value <> ")); ready = true; } return value; } " <>
  "}; "

printLoopSnapshots :: Array String -> Array String -> String
printLoopSnapshots args intParams =
  String.joinWith "" (map (\arg -> "final " <> loopParamType intParams arg <> " __final_" <> arg <> " = __tco_" <> arg <> "; ") args)

printCountedLoop :: Array String -> Array String -> CountedLoop -> String
printCountedLoop args intParams loop =
  -- A negative countdown reaches zero only after Int wraparound. Preserve that
  -- behavior in the original loop below; the counted path never overflows its
  -- index, even when the captured limit is Int.MAX_VALUE.
  "if (__tco_" <> loop.counter <> " >= 0) { " <>
    "for (int __counted$index = 0, __counted$limit = __tco_" <> loop.counter <> "; __counted$index < __counted$limit; __counted$index++) { " <>
      printLoopSnapshots args intParams <>
      printLoopTail args intParams loop.step <>
    "} " <>
    printLoopSnapshots args intParams <>
    "return " <> printExpr loop.result <> "; " <>
  "} "

-- Tail branches are statements in the loop's method, so they can continue it
-- directly. Expression forms that introduce a method boundary retain the
-- exception fallback; in particular, do not move a continue through a closure.
printLoopTail :: Array String -> Array String -> JavaExpr -> String
printLoopTail params intParams expr
  | not (hasDirectContinue expr) && not (branchNeedsStatements expr) = "return " <> printExpr expr <> "; "
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

-- A continue that lands in a statement or operand position is printed as a
-- `TcoLoop` throw and must keep a catch entry for its target. This searches
-- those positions too, so a recursive definition without any continue can be
-- emitted without a loop at all. Lambda and loop boundaries are skipped: their
-- bodies are separate methods and hold only their own continues.
hasAnyContinue :: JavaExpr -> Boolean
hasAnyContinue = case _ of
  JavaContinue _ _ -> true
  JavaTernary _ yes no -> hasAnyContinue yes || hasAnyContinue no
  JavaBlock stmts body -> Array.any hasAnyContinue stmts || hasAnyContinue body
  JavaLet _ value body -> hasAnyContinue value || hasAnyContinue body
  JavaLetRec binds body -> Array.any (hasAnyContinue <<< snd) binds || hasAnyContinue body
  JavaAssign _ value -> hasAnyContinue value
  JavaLocalAssign _ value -> hasAnyContinue value
  JavaIntLocalAssign _ value -> hasAnyContinue value
  JavaBinaryOp _ left right -> hasAnyContinue left || hasAnyContinue right
  JavaUnaryOp _ expr -> hasAnyContinue expr
  JavaCast _ expr -> hasAnyContinue expr
  JavaCall fn args -> hasAnyContinue fn || Array.any hasAnyContinue args
  JavaApply fn arg -> hasAnyContinue fn || hasAnyContinue arg
  JavaIntApply fn arg -> hasAnyContinue fn || hasAnyContinue arg
  JavaFieldSet target _ _ _ value -> hasAnyContinue target || hasAnyContinue value
  JavaLocalSet _ value -> hasAnyContinue value
  JavaIf condition thenStmts elseStmts ->
    hasAnyContinue condition || Array.any hasAnyContinue thenStmts || Array.any hasAnyContinue elseStmts
  JavaNew _ args -> Array.any hasAnyContinue args
  JavaArray items -> Array.any hasAnyContinue items
  JavaArraySet array index value -> hasAnyContinue array || hasAnyContinue index || hasAnyContinue value
  JavaRecord fields -> Array.any (hasAnyContinue <<< snd) fields
  JavaTypedRecord _ fields -> Array.any (hasAnyContinue <<< snd) fields
  JavaTypedRecordGet _ value _ -> hasAnyContinue value
  JavaTypedRecordUpdate _ value updates ->
    hasAnyContinue value || Array.any (hasAnyContinue <<< snd) updates
  JavaMapGet expr _ -> hasAnyContinue expr
  JavaMapUpdate expr updates -> hasAnyContinue expr || Array.any (hasAnyContinue <<< snd) updates
  JavaInstanceOf expr _ -> hasAnyContinue expr
  JavaPropertyAccess expr _ _ -> hasAnyContinue expr
  JavaAbs _ _ -> false
  JavaIntAbs _ _ -> false
  JavaTypedAbs _ _ -> false
  JavaWhileTrue _ _ _ -> false
  JavaMemoizedLoop _ _ _ _ -> false
  JavaStaticMethod _ _ _ -> false
  JavaClassDecl _ _ _ -> false
  _ -> false

-- A branch value that requires statements normally becomes a Supplier in
-- expression form. Method, lambda and thunk bodies can print the branches as
-- real blocks instead, which removes that Supplier.
branchNeedsStatements :: JavaExpr -> Boolean
branchNeedsStatements = case _ of
  JavaBlock _ _ -> true
  JavaLet _ _ _ -> true
  JavaLetRec _ _ -> true
  JavaTernary _ yes no -> branchNeedsStatements yes || branchNeedsStatements no
  _ -> false

bodyNeedsTail :: JavaExpr -> Boolean
bodyNeedsTail = case _ of
  JavaTernary _ yes no ->
    branchNeedsStatements yes || branchNeedsStatements no || bodyNeedsTail yes || bodyNeedsTail no
  JavaBlock _ body -> bodyNeedsTail body
  JavaLet _ _ body -> bodyNeedsTail body
  JavaLetRec _ body -> bodyNeedsTail body
  _ -> false

-- The body of a method with a return value: loops print themselves, a
-- branch-heavy expression uses real statements so its blocks stay blocks.
methodBody :: JavaExpr -> String
methodBody body = case body of
  JavaWhileTrue params intParams expr -> printLoopBody params intParams expr
  JavaMemoizedLoop params intParams invariants expr -> printMemoizedLoopBody params intParams invariants expr
  _ | bodyNeedsTail body -> "{ " <> printTailStatements body <> " }"
  JavaBlock stmts expr -> "{ " <> String.joinWith " " (map printExpr stmts) <> " return " <> printExpr expr <> "; }"
  _ -> "{ return " <> printExpr body <> "; }"

-- The body of a zero-argument supplier; loops keep their expression form.
returnBody :: JavaExpr -> String
returnBody body = case body of
  _ | bodyNeedsTail body -> "{ " <> printTailStatements body <> " }"
  JavaBlock stmts expr -> "{ " <> String.joinWith " " (map printExpr stmts) <> " return " <> printExpr expr <> "; }"
  _ -> "{ return " <> printExpr body <> "; }"

printTailStatements :: JavaExpr -> String
printTailStatements = case _ of
  JavaTernary cond yes no ->
    "if ((Boolean) (" <> printExpr cond <> ")) { " <> printTailStatements yes <> "} else { " <> printTailStatements no <> "} "
  JavaBlock stmts body ->
    "{ " <> String.joinWith " " (map printExpr stmts) <> " " <> printTailStatements body <> "} "
  JavaLet name value body ->
    "{ Object " <> name <> " = " <> printExpr value <> "; " <> printTailStatements body <> "} "
  JavaLetRec binds body ->
    "{ " <> printLetRecBindings binds <> printTailStatements body <> "} "
  other -> "return " <> printExpr other <> "; "

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
