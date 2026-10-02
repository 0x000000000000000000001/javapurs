module Javapurs.Printer (printExpr, printFile, module Syntax) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..), fromMaybe)
import Data.String as String
import Data.Tuple (Tuple(..))
import Javapurs.JavaAst (JavaExpr(..), JavaFile)
import Javapurs.Naming (singletonHolderName)
import Javapurs.Printer.Body (BodyMode(..), printBody, printIntBody, printLetRecBindings, printLoopBody, printTcoThrow)
import Javapurs.Printer.Declarations (printAssignment, printClass, printLazyAssignment, printStaticMethod)
import Javapurs.Printer.Syntax (assignField, comma, forceSupplier, quote, statements, supplier)
import Javapurs.Printer.Syntax (escapeJavaString) as Syntax
import Javapurs.RecordPrinter as RecordPrinter
import Javapurs.Runtime (builtinGlobalSource)

-- JavaExpr is a mixed IR. This exhaustive dispatcher retains the compatibility
-- entry for all node families; statement/declaration nodes include their own
-- terminators. Body owns terminal layout, while recursive operands come here.
printExpr :: JavaExpr -> String
printExpr = case _ of
  JavaString value -> quote value
  JavaCall fn args -> printExpr fn <> "(" <> comma (map printExpr args) <> ")"
  JavaStaticMethodRef qualifier name -> maybeQualifier qualifier <> name
  JavaInstanceMethodRef value className method -> printExpr (JavaPropertyAccess value className method)
  JavaApply fn arg ->
    "((java.util.function.Function<Object, Object>) (" <> printExpr fn <> ")).apply(" <> printExpr arg <> ")"
  JavaIntApply fn arg ->
    "__IntFn.from((java.util.function.Function<Object, Object>) (" <> printExpr fn <> ")).applyAsInt(((int) (" <> printExpr arg <> ")))"
  JavaFunction value -> "(java.util.function.Supplier<Object>) () -> " <> printExpr value
  JavaGlobalVar qualifier name -> printGlobal qualifier name
  JavaLocal name -> name
  JavaAbs args body ->
    if Array.null args then supplier (printBody printExpr SupplierBody body)
    else printFunction args body
  -- Type evidence changes worker signatures, not the public Object ABI.
  JavaTypedAbs params body -> printFunction (map (\(Tuple name _) -> name) params) body
  JavaIntAbs arg body -> "(__IntFn) (" <> arg <> ") -> " <> printIntBody printExpr body
  JavaNew className args -> "new " <> className <> "(" <> comma (map printExpr args) <> ")"
  JavaCtorSingleton moduleName name -> moduleName <> "." <> singletonHolderName name <> ".value"
  JavaTernary condition yes no ->
    "( ((Boolean) (" <> printExpr condition <> ")) ? " <> printExpr yes <> " : " <> printExpr no <> ")"
  JavaThrow message -> forceSupplier ("{ throw new RuntimeException(" <> quote message <> "); }")
  JavaWhileTrue ident params intParams body -> forceSupplier $
    printLoopBody printExpr { ident, params, intParams, invariants: [], body }
  JavaMemoizedLoop ident params intParams invariants body -> forceSupplier $
    printLoopBody printExpr { ident, params, intParams, invariants, body }
  JavaLoopInvariant name -> name <> ".getAsInt()"
  JavaContinue ident values -> forceSupplier ("{ " <> printTcoThrow printExpr ident values <> " }")
  JavaRecord fields ->
    forceSupplier ("{ java.util.Map<String, Object> __map = new java.util.LinkedHashMap<>(); " <>
      printMapPuts fields <> " return __map; }")
  JavaTypedRecord shape fields -> RecordPrinter.printRecord printExpr shape fields
  JavaTypedRecordGet shape value property -> RecordPrinter.printRecordGet printExpr shape value property
  JavaTypedRecordUpdate shape value updates -> RecordPrinter.printRecordUpdate printExpr shape value updates
  JavaArray values -> "new Object[]{" <> comma (map printExpr values) <> "}"
  JavaMapGet value property -> "((java.util.Map<String, Object>) " <> printExpr value <> ").get(" <> quote property <> ")"
  JavaMapUpdate value updates ->
    forceSupplier ("{ java.util.Map<String, Object> __map = new java.util.LinkedHashMap<>((java.util.Map<String, Object>) " <>
      printExpr value <> "); " <> printMapPuts updates <> " return __map; }")
  JavaInstanceOf value className ->
    -- The static type can be a sibling final constructor: upcast to Object to
    -- keep the instanceof check legal without changing its meaning.
    "(((Object) (" <> printExpr value <> ")) instanceof " <> className <> ")"
  JavaPropertyAccess value className property ->
    "((" <> className <> ") (Object)(" <> printExpr value <> "))." <> property
  JavaLetRec bindings body -> forceSupplier $
    "{ " <> printLetRecBindings printExpr bindings <> "return " <> printExpr body <> "; }"
  JavaLet name value body -> printLetExpression name value body
  JavaRaw source -> source
  JavaBinaryOp operator left right -> "(" <> printExpr left <> " " <> operator <> " " <> printExpr right <> ")"
  JavaUnaryOp operator value -> "(" <> operator <> "(" <> printExpr value <> "))"
  JavaArrayIndex value index -> "((Object[]) (" <> printExpr value <> "))[" <> printExpr (JavaCast "int" index) <> "]"
  JavaCast ty value -> "((" <> ty <> ") (" <> printExpr value <> "))"
  JavaBlock prefix result -> forceSupplier $
    "{ " <> statements printExpr prefix <> " return " <> printExpr result <> "; }"

  -- Statements. Their subexpressions retain expression boundaries, including
  -- any Supplier needed for a nested block, loop or exception.
  JavaArraySet value index replacement ->
    "((Object[]) (" <> printExpr value <> "))[" <> printExpr (JavaCast "int" index) <> "] = " <> printExpr replacement <> ";"
  JavaLocalAssign name value -> "Object " <> name <> " = " <> printExpr value <> ";"
  JavaIntLocalAssign name value -> "int " <> name <> " = ((int) (" <> printExpr value <> "));"
  JavaFieldSet target className fieldName fieldType value ->
    "((" <> className <> ") (Object)(" <> printExpr target <> "))." <> fieldName <> " = " <> assignField fieldType (printExpr value) <> ";"
  JavaLocalSet name value -> name <> " = " <> printExpr value <> ";"
  JavaIf condition yes no ->
    "if ((Boolean) (" <> printExpr condition <> ")) { " <> statements printExpr yes <>
    "} else { " <> statements printExpr no <> "} "

  -- Declarations have a separate renderer and body contract.
  JavaAssign name value -> printAssignment printExpr name value
  JavaLazyAssign name value -> printLazyAssignment printExpr name value
  JavaStaticMethod name parameters body -> printStaticMethod printExpr name parameters body
  JavaClassDecl name fields mutable -> printClass name fields mutable

printFunction :: Array String -> JavaExpr -> String
printFunction args body = Array.foldr
  (\arg rest -> "(java.util.function.Function<Object, Object>) (" <> arg <> ") -> " <> rest)
  (printBody printExpr MethodBody body) args

printMapPuts :: Array (Tuple String JavaExpr) -> String
printMapPuts = String.joinWith "" <<< map (\(Tuple key value) -> "__map.put(" <> quote key <> ", " <> printExpr value <> "); ")

printLetExpression :: String -> JavaExpr -> JavaExpr -> String
printLetExpression name value body =
  let
    flat = flattenLets [] (JavaLet name value body)
    bindings = String.joinWith " " (map (\(Tuple ident initializer) -> "Object " <> ident <> " = " <> printExpr initializer <> ";") flat.bindings)
  in forceSupplier ("{ " <> bindings <> " return " <> printExpr flat.body <> "; }")
  where
  flattenLets bindings (JavaLet ident initializer rest) = flattenLets (Array.snoc bindings (Tuple ident initializer)) rest
  flattenLets bindings result = { bindings, body: result }

printGlobal :: Maybe String -> String -> String
printGlobal qualifier name = case qualifier of
  Just moduleName ->
    let plainModule = String.replaceAll (String.Pattern "__M$") (String.Replacement "") moduleName
    in fromMaybe (moduleName <> "." <> name) (builtinGlobalSource plainModule name)
  Nothing -> name

maybeQualifier :: Maybe String -> String
maybeQualifier = case _ of
  Just name -> name <> "."
  Nothing -> ""

-- Compatibility formatter for AST suites/benchmarks. Emit assembles production
-- modules with their foreign members before writing the file.
printFile :: String -> JavaFile -> String
printFile className file =
  "public class " <> className <> " {\n" <>
  "    " <> String.joinWith "\n    " (map printExpr file.decls) <> "\n" <>
  "}\n"
