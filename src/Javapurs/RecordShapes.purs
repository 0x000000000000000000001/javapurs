module Javapurs.RecordShapes (recordShape, recordShapeOf, recordClassName, collectRecordShapes) where

import Prelude

import Data.Array as Array
import Data.Char as Char
import Data.Foldable (foldMap)
import Data.Int as Int
import Data.Maybe (Maybe(..))
import Data.String as String
import Data.String.CodeUnits as CodeUnits
import Data.Tuple (Tuple(..), fst)
import Javapurs.JavaAst (JavaRecordFieldType(..), JavaRecordShape(..))
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr(..))
import PureScript.Backend.Optimizer.CoreFn as CoreFn
import PureScript.Backend.Optimizer.Syntax (BackendSyntax(..))

-- Unknown or polymorphic tails are never evidence of a closed shape. Nested
-- records retain a Map reference so shapes from other modules and FFI values
-- remain usable without eager conversions or copies.
recordShape :: CoreFn.ExprType -> Maybe JavaRecordShape
recordShape = case _ of
  CoreFn.Record (CoreFn.Row fields Nothing)
    | Array.length (Array.nub (map fst fields)) == Array.length fields ->
        let
          shape = JavaRecordShape $ map (\(Tuple label ty) -> Tuple label (fieldType ty)) $
            Array.sortBy (\a b -> compare (fst a) (fst b)) fields
        -- Shape names are collision-free encodings, rather than hashes. Leave
        -- very wide shapes on the Map path to respect filesystem name limits.
        in if String.length (recordClassName shape) <= 180 then Just shape else Nothing
  _ -> Nothing

fieldType :: CoreFn.ExprType -> JavaRecordFieldType
fieldType = case _ of
  CoreFn.Int -> RecordInt
  CoreFn.Record _ -> RecordNested
  _ -> RecordObject

recordShapeOf :: TcoExpr -> Maybe JavaRecordShape
recordShapeOf (TcoExpr _ syntax) = case syntax of
  Typed ty _ -> recordShape ty
  -- TypeApp instantiates a value; its argument is not that value's result type.
  _ -> Nothing

recordClassName :: JavaRecordShape -> String
recordClassName (JavaRecordShape fields) =
  "__Record$" <> String.joinWith "$" (map encode fields)
  where
  encode (Tuple label ty) =
    String.joinWith "_" (map (Int.toStringAs Int.hexadecimal <<< Char.toCharCode) (CodeUnits.toCharArray label)) <>
    "_" <> case ty of
      RecordInt -> "I"
      RecordObject -> "O"
      RecordNested -> "R"

collectRecordShapes :: TcoExpr -> Array JavaRecordShape
collectRecordShapes (TcoExpr _ syntax) =
  (case syntax of
    Typed ty _ -> case recordShape ty of
      Just shape -> [shape]
      Nothing -> []
    _ -> []
  ) <> foldMap collectRecordShapes syntax
