module Javapurs.IntFunctions (runtimeSource, abstractFunction, applyFunction) where

import Prelude

import Data.Array as Array
import Data.Foldable (foldl)
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))
import Javapurs.FunctionTypes (intFunction)
import Javapurs.JavaAst (JavaExpr(..), JavaParamType(..))
import Javapurs.Runtime as Runtime
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr(..))
import PureScript.Backend.Optimizer.CoreFn as C
import PureScript.Backend.Optimizer.Syntax (BackendSyntax(..))

-- Compatibility entry for existing fixture/benchmark callers. Runtime owns
-- the template; this module owns the specialized function representation.
runtimeSource :: String
runtimeSource = Runtime.intFunctionSource

resultType :: Maybe C.ExprType -> Maybe C.ExprType
resultType = case _ of
  Just (C.Func args result) -> case Array.uncons args of
    Just { tail } -> Just (if Array.null tail then result else C.Func tail result)
    Nothing -> Nothing
  _ -> Nothing

abstractFunction :: Maybe C.ExprType -> Array String -> JavaExpr -> JavaExpr
abstractFunction ty args body = case Array.uncons args of
  Just { head, tail } ->
    let rest = abstractFunction (resultType ty) tail body
    in case ty of
      Just functionType | intFunction functionType -> JavaIntAbs head rest
      -- A proven Int parameter stays primitive inside direct workers; the
      -- public curried lambda still declares Object and unboxes at use sites.
      Just (C.Func paramTypes _) | Just C.Int <- Array.head paramTypes -> JavaTypedAbs [ Tuple head ParamInt ] rest
      _ -> JavaAbs [head] rest
  Nothing -> body

applyFunction :: Int -> TcoExpr -> JavaExpr -> Array JavaExpr -> JavaExpr
applyFunction boxedArity source function args =
  (foldl step { value: function, ty: typeOf source, boxed: boxedArity } args).value
  where
  typeOf (TcoExpr _ syntax) = case syntax of
    Typed ty _ -> Just ty
    -- A TypeApp argument is not the instantiated function signature.
    _ -> Nothing
  step state arg =
    { value: case state.ty of
        Just ty | state.boxed <= 0 && intFunction ty -> JavaIntApply state.value arg
        _ -> JavaApply state.value arg
    , ty: resultType state.ty
    , boxed: state.boxed - 1
    }
