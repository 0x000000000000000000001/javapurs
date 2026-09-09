module Javapurs.IntFunctions (runtimeSource, abstractFunction, applyFunction) where

import Prelude

import Data.Array as Array
import Data.Foldable (foldl)
import Data.Maybe (Maybe(..))
import Javapurs.FunctionTypes (intFunction)
import Javapurs.JavaAst (JavaExpr(..))
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr(..))
import PureScript.Backend.Optimizer.CoreFn as C
import PureScript.Backend.Optimizer.Syntax (BackendSyntax(..))

-- One object supports both ABIs. Generic callers and FFI values need no eager
-- adapter; the primitive call site falls back to the existing Function ABI.
runtimeSource :: String
runtimeSource = """
@FunctionalInterface
public interface __IntFn extends java.util.function.Function<Object, Object>, java.util.function.IntUnaryOperator {
    @Override
    default Object apply(Object value) {
        return applyAsInt((int) value);
    }

    static java.util.function.IntUnaryOperator from(java.util.function.Function<Object, Object> function) {
        if (function == null) return null;
        if (function instanceof __IntFn specialized) return specialized;
        return value -> (int) function.apply(value);
    }
}
"""

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
