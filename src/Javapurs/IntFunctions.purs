module Javapurs.IntFunctions (runtimeSource, abstractFunction, applyFunction) where

import Prelude

import Data.Array as Array
import Data.Foldable (foldl)
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))
import Javapurs.JavaAst (JavaExpr(..), JavaParamType(..))
import Javapurs.Runtime as Runtime
import Javapurs.TypeEvidence (applyArguments, declaredType, intFunction)
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr)
import PureScript.Backend.Optimizer.CoreFn as C

-- Compatibility entry for existing fixture/benchmark callers. Runtime owns
-- the template; this module owns the specialized function representation.
runtimeSource :: String
runtimeSource = Runtime.intFunctionSource

-- Each lambda consumes one proven arrow, including a nested Func result.
-- Only the exact remaining Int -> Int arrow selects the __IntFn ABI.
abstractFunction :: Maybe C.ExprType -> Array String -> JavaExpr -> JavaExpr
abstractFunction ty args body = case Array.uncons args of
  Just { head, tail } ->
    let rest = abstractFunction (ty >>= applyArguments 1) tail body
    in case ty of
      Just functionType | intFunction functionType -> JavaIntAbs head rest
      -- A proven Int parameter stays primitive inside direct workers; the
      -- public curried lambda still declares Object and unboxes at use sites.
      Just (C.Func paramTypes _) | Just C.Int <- Array.head paramTypes -> JavaTypedAbs [ Tuple head ParamInt ] rest
      _ -> JavaAbs [head] rest
  Nothing -> body

applyFunction :: Int -> TcoExpr -> JavaExpr -> Array JavaExpr -> JavaExpr
applyFunction boxedArity source function args =
  (foldl step { value: function, ty: declaredType source, boxed: boxedArity } args).value
  where
  -- A recursive global's saturated prefix keeps the boxed loop ABI. Evidence
  -- about a returned closure can select Int dispatch only after that prefix.
  -- JavaIntApply adapts an ordinary foreign Function at invocation, not capture.
  step state arg =
    { value: case state.ty of
        Just ty | state.boxed <= 0 && intFunction ty -> JavaIntApply state.value arg
        _ -> JavaApply state.value arg
    , ty: state.ty >>= applyArguments 1
    , boxed: state.boxed - 1
    }
