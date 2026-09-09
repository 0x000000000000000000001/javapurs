module Javapurs.RecordPrinter
  ( printRecordShape
  , printRecord
  , printRecordGet
  , printRecordUpdate
  ) where

import Prelude

import Data.Array as Array
import Data.Char as Char
import Data.Int as Int
import Data.Maybe (Maybe(..))
import Data.String as String
import Data.String.CodeUnits as CodeUnits
import Data.Tuple (Tuple(..))
import Javapurs.JavaAst (JavaExpr, JavaRecordFieldType(..), JavaRecordShape(..))
import Javapurs.RecordShapes (recordClassName)

quote :: String -> String
quote value = "\"" <> String.joinWith "" (map escape (CodeUnits.toCharArray value)) <> "\""
  where
  escape '\\' = "\\\\"
  escape '"' = "\\\""
  escape '\n' = "\\n"
  escape '\r' = "\\r"
  escape '\t' = "\\t"
  escape char =
    let code = Char.toCharCode char
    in if code >= 32 && code <= 126 then CodeUnits.singleton char
       else
         let hex = Int.toStringAs Int.hexadecimal code
         in "\\u" <> String.joinWith "" (Array.replicate (4 - String.length hex) "0") <> hex

fieldType :: JavaRecordFieldType -> String
fieldType = case _ of
  RecordInt -> "int"
  RecordObject -> "Object"
  RecordNested -> "java.util.Map<String, Object>"

castField :: JavaRecordFieldType -> String -> String
castField ty value = case ty of
  RecordInt -> "((Integer) (" <> value <> ")).intValue()"
  RecordObject -> value
  RecordNested -> "((java.util.Map<String, Object>) (" <> value <> "))"

compatibleField :: JavaRecordFieldType -> String -> String
compatibleField ty value = case ty of
  RecordInt -> "(" <> value <> " instanceof Integer)"
  RecordObject -> "true"
  RecordNested -> "(" <> value <> " == null || " <> value <> " instanceof java.util.Map)"

fieldName :: Int -> String
fieldName index = "field" <> show index

comma :: Array String -> String
comma = String.joinWith ", "

supplier :: String -> String
supplier body = "(new java.util.function.Supplier<Object>() { public Object get() { " <> body <> " } }).get()"

printRecordShape :: JavaRecordShape -> String
printRecordShape shape@(JavaRecordShape fields) =
  let
    className = recordClassName shape
    names = Array.mapWithIndex (\index _ -> fieldName index) fields
    parameters = Array.mapWithIndex (\index (Tuple _ ty) -> fieldType ty <> " " <> fieldName index) fields
    declarations = Array.mapWithIndex (\index (Tuple _ ty) -> "    public final " <> fieldType ty <> " " <> fieldName index <> ";\n") fields
    assignments = map (\name -> "        this." <> name <> " = " <> name <> ";\n") names
    reads = Array.mapWithIndex
      (\index (Tuple label ty) ->
        "    public static " <> fieldType ty <> " read" <> show index <> "(Object value) {\n" <>
        "        if (value instanceof " <> className <> ") return ((" <> className <> ") value)." <> fieldName index <> ";\n" <>
        "        return " <> castField ty ("((java.util.Map<?, ?>) value).get(" <> quote label <> ")") <> ";\n" <>
        "    }\n") fields
    gets = Array.mapWithIndex (\index (Tuple label _) -> "        if (" <> quote label <> ".equals(key)) return " <> fieldName index <> ";\n") fields
    contains = case fields of
      [] -> "false"
      _ -> String.joinWith " || " (map (\(Tuple label _) -> quote label <> ".equals(key)") fields)
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
    String.joinWith "" reads <>
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
    "    }\n" <>
    "}\n"

printRecord :: (JavaExpr -> String) -> JavaRecordShape -> Array (Tuple String JavaExpr) -> String
printRecord printExpr shape@(JavaRecordShape shapeFields) fields =
  let
    local index = "__field" <> show index
    bindings = Array.mapWithIndex (\index (Tuple _ value) -> "final Object " <> local index <> " = " <> printExpr value <> "; ") fields
    arguments = map
      (\(Tuple label ty) -> case Array.findIndex (\(Tuple key _) -> key == label) fields of
        Just index -> castField ty (local index)
        Nothing -> "null") shapeFields
    exactFields = Array.length fields == Array.length shapeFields &&
      Array.all (\(Tuple label _) -> Array.any (\(Tuple key _) -> key == label) fields) shapeFields
    result = if exactFields then
      "return new " <> recordClassName shape <> "(" <>
      comma (["new String[]{" <> comma (map (\(Tuple key _) -> quote key) fields) <> "}"] <> arguments) <> ");"
      else printMapResult "" fields local
  in supplier (String.joinWith "" bindings <> result)

printRecordGet :: (JavaExpr -> String) -> JavaRecordShape -> JavaExpr -> String -> String
printRecordGet printExpr shape@(JavaRecordShape fields) value label =
  case Array.findIndex (\(Tuple key _) -> key == label) fields of
    Just index -> recordClassName shape <> ".read" <> show index <> "(" <> printExpr value <> ")"
    Nothing -> "((java.util.Map<?, ?>) (" <> printExpr value <> ")).get(" <> quote label <> ")"

printRecordUpdate :: (JavaExpr -> String) -> JavaRecordShape -> JavaExpr -> Array (Tuple String JavaExpr) -> String
printRecordUpdate printExpr shape@(JavaRecordShape fields) value updates =
  let
    className = recordClassName shape
    local index = "__update" <> show index
    bindings = Array.mapWithIndex (\index (Tuple _ update) -> "final Object " <> local index <> " = " <> printExpr update <> "; ") updates
    checks = Array.mapWithIndex
      (\index (Tuple label _) -> case Array.find (\(Tuple key _) -> key == label) fields of
        Just (Tuple _ ty) -> compatibleField ty (local index)
        Nothing -> "false") updates
    arguments = Array.mapWithIndex
      (\index (Tuple label ty) -> case Array.findLastIndex (\(Tuple key _) -> key == label) updates of
        Just updateIndex -> castField ty (local updateIndex)
        Nothing -> "__typed." <> fieldName index) fields
    fastPath =
      "if (" <> String.joinWith " && " (["__record instanceof " <> className] <> checks) <> ") { " <>
      "final " <> className <> " __typed = (" <> className <> ") __record; " <>
      "return " <> className <> ".copy(" <> comma (["__typed"] <> arguments) <> "); } "
  in supplier
    ("final Object __record = " <> printExpr value <> "; " <>
     -- Match the generic update's snapshot timing even for a Map supplied by FFI.
     "final java.util.Map<String, Object> __snapshot = __record instanceof " <> className <>
     " ? null : new java.util.LinkedHashMap<>((java.util.Map<String, Object>) __record); " <>
     String.joinWith "" bindings <>
     fastPath <>
     "java.util.Map<String, Object> __map = __snapshot != null ? __snapshot : new java.util.LinkedHashMap<>((java.util.Map<String, Object>) __record); " <>
     String.joinWith "" (Array.mapWithIndex (\index (Tuple key _) -> "__map.put(" <> quote key <> ", " <> local index <> "); ") updates) <>
     "return __map;")

printMapResult :: String -> Array (Tuple String JavaExpr) -> (Int -> String) -> String
printMapResult source fields local =
  "java.util.Map<String, Object> __map = new java.util.LinkedHashMap<>(" <> source <> "); " <>
  String.joinWith "" (Array.mapWithIndex (\index (Tuple key _) -> "__map.put(" <> quote key <> ", " <> local index <> "); ") fields) <>
  "return __map;"
