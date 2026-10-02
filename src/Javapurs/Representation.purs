-- | Storage and worker-argument choices after type evidence has been recovered.
-- | Public fields, generic closures and worker results still use Object.
module Javapurs.Representation (parameterType, paramKinds, recordFieldType, coerceArgument) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..))
import Javapurs.JavaAst (JavaExpr(..), JavaParamType(..), JavaRecordFieldType(..))
import Javapurs.TypeEvidence (declaredType)
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr)
import PureScript.Backend.Optimizer.CoreFn as C

-- Only an exact Int is storage evidence. In particular an ADT's type arguments
-- do not specialize its declaration's TypeVar fields; FFI shares that layout.
parameterType :: C.ExprType -> JavaParamType
parameterType = case _ of
  C.Int -> ParamInt
  _ -> ParamObject

-- A flattened recursive definition must have an exactly matching outer Func
-- arity. Do not flatten nested result types here: the extracted syntax can have
-- crossed annotation boundaries. Mismatched/missing evidence stays boxed.
paramKinds :: TcoExpr -> Array String -> Array JavaParamType
paramKinds expression args = case declaredType expression of
  Just (C.Func types _) | Array.length types == Array.length args -> map parameterType types
  _ -> Array.replicate (Array.length args) ParamObject

-- Closed outer layouts may contain open/polymorphic nested records. Store a Map
-- reference, never a particular generated shape or an eagerly converted copy.
recordFieldType :: C.ExprType -> JavaRecordFieldType
recordFieldType = case _ of
  C.Int -> RecordInt
  C.Record _ -> RecordNested
  _ -> RecordObject

-- Both direct and ownership workers consume this declaration ABI. Java's cast
-- accepts an int expression or unboxes an Object/Integer at the argument site.
coerceArgument :: JavaParamType -> JavaExpr -> JavaExpr
coerceArgument = case _ of
  ParamInt -> JavaCast "int"
  ParamObject -> identity
