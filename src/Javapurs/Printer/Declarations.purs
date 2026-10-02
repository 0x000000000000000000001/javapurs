module Javapurs.Printer.Declarations
  ( printAssignment, printLazyAssignment, printStaticMethod, printClass
  ) where

import Prelude

import Data.Array as Array
import Data.String as String
import Data.Tuple (Tuple(..))
import Javapurs.JavaAst (JavaExpr, JavaParamType(..))
import Javapurs.Naming (lazyGetterName, singletonHolderName)
import Javapurs.Printer.Body (BodyMode(..), printBody)
import Javapurs.Printer.Syntax (Render, assignField, comma, paramType, quote, unboxInt)

-- Every eager initializer has its own method to keep module <clinit> bounded.
-- The field remains Object: MainRun chooses the Function/Supplier entry ABI.
printAssignment :: Render -> String -> JavaExpr -> String
printAssignment render name value = printInitializer name (render value)

printInitializer :: String -> String -> String
printInitializer name value =
  let initName = "__init$" <> name
  in
    "public static final Object " <> name <> " = " <> initName <> "();\n" <>
    "    private static Object " <> initName <> "() { return " <> value <> "; }"

printLazyAssignment :: Render -> String -> JavaExpr -> String
printLazyAssignment render name value =
  let
    valueName = "__lazy_value_" <> name
    stateName = "__lazy_state_" <> name
    getterName = lazyGetterName name
  in
    -- Do not initialize cache fields explicitly: a preceding getter can have
    -- filled them during reentrant module initialization. States are 0/1/2.
    "private static Object " <> valueName <> ";\n" <>
    "private static int " <> stateName <> ";\n" <>
    "private static Object " <> getterName <> "() { " <>
      "if (" <> stateName <> " == 2) return " <> valueName <> "; " <>
      "if (" <> stateName <> " == 1) throw new IllegalStateException(" <> quote ("Recursive initialization of " <> name) <> "); " <>
      stateName <> " = 1; " <>
      valueName <> " = " <> render value <> "; " <>
      stateName <> " = 2; " <>
      "return " <> valueName <> "; " <>
    "}\n" <>
    printInitializer name (getterName <> "()")

printStaticMethod :: Render -> String -> Array (Tuple String JavaParamType) -> JavaExpr -> String
printStaticMethod render name parameters body =
  "private static Object " <> name <> "(" <>
    comma (map (\(Tuple param ty) -> paramType ty <> " " <> param) parameters) <> ") " <>
    printBody render MethodBody body

printClass :: String -> Array (Tuple String JavaParamType) -> Boolean -> String
printClass name fields mutable =
  let
    -- Ownership workers require mutable fields; ordinary ADTs keep final ones.
    declarations = map (\(Tuple field ty) -> "public " <> (if mutable then "" else "final ") <>
      paramType ty <> " " <> field <> ";") fields
    typedArgs = map (\(Tuple field ty) -> paramType ty <> " " <> field) fields
    plainArgs = map (\(Tuple field _) -> "Object " <> field) fields
    assignments = map (\(Tuple field ty) -> "this." <> field <> " = " <> assignField ty field <> ";") fields
    constructor args =
      "public " <> name <> "(" <> comma args <> "){\n" <>
      "                " <> String.joinWith "\n                " assignments <> "\n" <>
      "            }"
    hasInt = Array.any (\(Tuple _ ty) -> ty == ParamInt) fields
    -- A varargs Object overload is considered only after the exact typed one;
    -- this avoids ambiguity for primitive literals while retaining the ABI.
    constructors = if hasInt then constructor typedArgs <> "\n            " <> printVarargsConstructor name fields
      else constructor plainArgs
  in
    "public static final class " <> name <> " {\n" <>
    "            " <> String.joinWith "\n            " declarations <> "\n" <>
    "            " <> constructors <> "\n" <>
    "        }" <>
    if Array.null fields then printSingletonHolder name else ""

printVarargsConstructor :: String -> Array (Tuple String JavaParamType) -> String
printVarargsConstructor name fields =
  "public " <> name <> "(Object... values) {\n" <>
  "                " <> String.joinWith "\n                " (Array.mapWithIndex (\index (Tuple field ty) ->
    "this." <> field <> " = " <> varargsValue ty ("values[" <> show index <> "]") <> ";") fields) <> "\n" <>
  "            }"
  where
  varargsValue ParamInt value = unboxInt value
  varargsValue ParamObject value = value

printSingletonHolder :: String -> String
printSingletonHolder name =
  -- A separate holder is independent of module field initialization order.
  "\npublic static final class " <> singletonHolderName name <> " {\n" <>
  "    public static final " <> name <> " value = new " <> name <> "();\n" <>
  "}"
