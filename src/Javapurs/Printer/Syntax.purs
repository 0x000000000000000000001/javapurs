module Javapurs.Printer.Syntax
  ( Render, escapeJavaString, quote, comma, statements
  , supplier, forceSupplier, paramType, assignField, unboxInt
  ) where

import Prelude

import Data.Array as Array
import Data.Char as Char
import Data.Int as Int
import Data.String as String
import Data.String.CodeUnits as CodeUnits
import Javapurs.JavaAst (JavaExpr, JavaParamType(..))

-- Recursive renderers are passed to the body/declaration/record printers, so
-- those modules never depend back on the expression dispatcher.
type Render = JavaExpr -> String

-- Escape UTF-16 code units, including unpaired surrogates. Escape backslashes
-- before Java's Unicode preprocessing can interpret a literal \u sequence.
escapeJavaString :: String -> String
escapeJavaString = String.joinWith "" <<< map escape <<< CodeUnits.toCharArray
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

quote :: String -> String
quote value = "\"" <> escapeJavaString value <> "\""

comma :: Array String -> String
comma = String.joinWith ", "

statements :: Render -> Array JavaExpr -> String
statements render = String.joinWith " " <<< map render

-- The argument is a complete Java method body, including its braces. Creating
-- this object defers the body; only forceSupplier executes it immediately.
supplier :: String -> String
supplier body = "(new java.util.function.Supplier<Object>() { public Object get() " <> body <> " })"

forceSupplier :: String -> String
forceSupplier body = supplier body <> ".get()"

paramType :: JavaParamType -> String
paramType = case _ of
  ParamInt -> "int"
  ParamObject -> "Object"

assignField :: JavaParamType -> String -> String
assignField ty value = case ty of
  ParamInt -> "((int) (" <> value <> "))"
  ParamObject -> value

-- For sources already bound as Object (record fields, Map reads, Object...
-- constructors). Null/wrong wrappers fail at this conversion; this is not a
-- Number.intValue coercion. assignField also accepts primitive expressions.
unboxInt :: String -> String
unboxInt value = "((Integer) (" <> value <> ")).intValue()"
