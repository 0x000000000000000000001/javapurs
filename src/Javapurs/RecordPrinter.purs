module Javapurs.RecordPrinter
  ( printRecordShape
  , printRecord
  , printRecordGet
  , printRecordUpdate
  ) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..))
import Data.String as String
import Data.Tuple (Tuple(..))
import Javapurs.JavaAst (JavaExpr, JavaRecordFieldType(..), JavaRecordShape(..))
import Javapurs.Printer.Syntax (Render, comma, forceSupplier, quote, unboxInt)
import Javapurs.RecordShapes (recordClassName)

type FieldStorage =
  { javaType :: String
  , fromObject :: String -> String
  , accepts :: String -> String
  }

-- Keep declaration, Object conversion and update admission together. Literal
-- construction/typed reads trust type evidence and may throw on invalid FFI
-- values; updates check compatibility first and retain Map.put as the fallback.
fieldStorage :: JavaRecordFieldType -> FieldStorage
fieldStorage = case _ of
  RecordInt ->
    { javaType: "int"
    , fromObject: unboxInt
    , accepts: \value -> "(" <> value <> " instanceof Integer)"
    }
  RecordObject ->
    { javaType: "Object", fromObject: identity, accepts: const "true" }
  RecordNested ->
    { javaType: "java.util.Map<String, Object>"
    , fromObject: \value -> "((java.util.Map<String, Object>) (" <> value <> "))"
    , accepts: \value -> "(" <> value <> " == null || " <> value <> " instanceof java.util.Map)"
    }

fieldName :: Int -> String
fieldName index = "field" <> show index

-- Shape declarations own storage, fast readers and the immutable Map view.
-- Expression construction/update below owns evaluation order and fallbacks.
printRecordShape :: JavaRecordShape -> String
printRecordShape shape@(JavaRecordShape fields) =
  let
    className = recordClassName shape
    names = Array.mapWithIndex (\index _ -> fieldName index) fields
    parameters = Array.mapWithIndex (\index (Tuple _ ty) -> (fieldStorage ty).javaType <> " " <> fieldName index) fields
    declarations = Array.mapWithIndex (\index (Tuple _ ty) -> "    public final " <> (fieldStorage ty).javaType <> " " <> fieldName index <> ";\n") fields
    assignments = map (\name -> "        this." <> name <> " = " <> name <> ";\n") names
  in
    "public final class " <> className <> " extends java.util.AbstractMap<String, Object> {\n" <>
    "    private final String[] __order;\n" <>
    String.joinWith "" declarations <>
    "    " <> className <> "(" <> comma (["String[] order"] <> parameters) <> ") {\n" <>
    "        this.__order = order;\n" <>
    String.joinWith "" assignments <>
    "    }\n" <>
    "    public static " <> className <> " copy(" <> comma ([className <> " original"] <> parameters) <> ") {\n" <>
    "        return new " <> className <> "(" <> comma (["original.__order"] <> names) <> ");\n" <>
    "    }\n" <>
    String.joinWith "" (Array.mapWithIndex (printFieldReader className) fields) <>
    printMapMembers fields <>
    "}\n"

printFieldReader :: String -> Int -> Tuple String JavaRecordFieldType -> String
printFieldReader className index (Tuple label ty) =
  "    public static " <> (fieldStorage ty).javaType <> " read" <> show index <> "(Object value) {\n" <>
  "        if (value instanceof " <> className <> ") return ((" <> className <> ") value)." <> fieldName index <> ";\n" <>
  "        return " <> (fieldStorage ty).fromObject ("((java.util.Map<?, ?>) value).get(" <> quote label <> ")") <> ";\n" <>
  "    }\n"

printMapMembers :: Array (Tuple String JavaRecordFieldType) -> String
printMapMembers fields =
  let
    gets = Array.mapWithIndex (\index (Tuple label _) -> "        if (" <> quote label <> ".equals(key)) return " <> fieldName index <> ";\n") fields
    contains = case fields of
      [] -> "false"
      _ -> String.joinWith " || " (map (\(Tuple label _) -> quote label <> ".equals(key)") fields)
  in
    "    @Override public Object get(Object key) {\n" <>
    String.joinWith "" gets <>
    "        return null;\n" <>
    "    }\n" <>
    "    @Override public boolean containsKey(Object key) { return " <> contains <> "; }\n" <>
    "    @Override public int size() { return " <> show (Array.length fields) <> "; }\n" <>
    "    @Override public java.util.Set<java.util.Map.Entry<String, Object>> entrySet() {\n" <>
    "        java.util.LinkedHashSet<java.util.Map.Entry<String, Object>> entries = new java.util.LinkedHashSet<>();\n" <>
    "        for (String key : __order) entries.add(new java.util.AbstractMap.SimpleImmutableEntry<>(key, get(key)));\n" <>
    "        return java.util.Collections.unmodifiableSet(entries);\n" <>
    "    }\n"

printRecord :: Render -> JavaRecordShape -> Array (Tuple String JavaExpr) -> String
printRecord printExpr shape@(JavaRecordShape shapeFields) fields =
  let
    local index = "__field" <> show index
    arguments = map
      (\(Tuple label ty) -> case Array.findIndex (\(Tuple key _) -> key == label) fields of
        Just index -> (fieldStorage ty).fromObject (local index)
        Nothing -> "null") shapeFields
    exactFields = Array.length fields == Array.length shapeFields &&
      Array.all (\(Tuple label _) -> Array.any (\(Tuple key _) -> key == label) fields) shapeFields
    result = if exactFields then
      "return new " <> recordClassName shape <> "(" <>
      comma (["new String[]{" <> comma (map (\(Tuple key _) -> quote key) fields) <> "}"] <> arguments) <> ");"
      else printMapResult fields local
  -- Values are evaluated in source order before constructor casts/reordering.
  in forceSupplier ("{ " <> printFieldBindings printExpr local fields <> result <> " }")

printRecordGet :: Render -> JavaRecordShape -> JavaExpr -> String -> String
printRecordGet printExpr shape@(JavaRecordShape fields) value label =
  case Array.findIndex (\(Tuple key _) -> key == label) fields of
    Just index -> recordClassName shape <> ".read" <> show index <> "(" <> printExpr value <> ")"
    Nothing -> "((java.util.Map<?, ?>) (" <> printExpr value <> ")).get(" <> quote label <> ")"

printRecordUpdate :: Render -> JavaRecordShape -> JavaExpr -> Array (Tuple String JavaExpr) -> String
printRecordUpdate printExpr shape@(JavaRecordShape fields) value updates =
  let
    className = recordClassName shape
    local index = "__update" <> show index
    checks = Array.mapWithIndex
      (\index (Tuple label _) -> case Array.find (\(Tuple key _) -> key == label) fields of
        Just (Tuple _ ty) -> (fieldStorage ty).accepts (local index)
        Nothing -> "false") updates
    arguments = Array.mapWithIndex
      (\index (Tuple label ty) -> case Array.findLastIndex (\(Tuple key _) -> key == label) updates of
        Just updateIndex -> (fieldStorage ty).fromObject (local updateIndex)
        Nothing -> "__typed." <> fieldName index) fields
    fastPath =
      "if (" <> String.joinWith " && " (["__record instanceof " <> className] <> checks) <> ") { " <>
      "final " <> className <> " __typed = (" <> className <> ") __record; " <>
      "return " <> className <> ".copy(" <> comma (["__typed"] <> arguments) <> "); } "
  in forceSupplier
    ("{ final Object __record = " <> printExpr value <> "; " <>
     -- Match the generic update's snapshot timing even for a Map supplied by FFI.
     "final java.util.Map<String, Object> __snapshot = __record instanceof " <> className <>
     " ? null : new java.util.LinkedHashMap<>((java.util.Map<String, Object>) __record); " <>
      printFieldBindings printExpr local updates <>
     fastPath <>
     "java.util.Map<String, Object> __map = __snapshot != null ? __snapshot : new java.util.LinkedHashMap<>((java.util.Map<String, Object>) __record); " <>
     String.joinWith "" (Array.mapWithIndex (\index (Tuple key _) -> "__map.put(" <> quote key <> ", " <> local index <> "); ") updates) <>
      "return __map; }")

printFieldBindings :: Render -> (Int -> String) -> Array (Tuple String JavaExpr) -> String
printFieldBindings render local = String.joinWith "" <<< Array.mapWithIndex
  (\index (Tuple _ value) -> "final Object " <> local index <> " = " <> render value <> "; ")

printMapResult :: Array (Tuple String JavaExpr) -> (Int -> String) -> String
printMapResult fields local =
  "java.util.Map<String, Object> __map = new java.util.LinkedHashMap<>(); " <>
  String.joinWith "" (Array.mapWithIndex (\index (Tuple key _) -> "__map.put(" <> quote key <> ", " <> local index <> "); ") fields) <>
  "return __map;"
