-- | Projections of explicit PBO types, not an inference/instantiation engine.
-- | Annotation passes choose where evidence may flow; representation consumers
-- | use these same projections without looking through ForAll or constraints.
module Javapurs.TypeEvidence
  ( LocalTypes, declaredType, bindLocalType, lookupLocalType, bindArgumentTypes
  , applyArguments, argumentType, recordProperty, intFunction
  ) where

import Prelude

import Data.Array as Array
import Data.Foldable (foldl)
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..), fst, snd)
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr(..))
import PureScript.Backend.Optimizer.CoreFn as C
import PureScript.Backend.Optimizer.FreeVars (localId)
import PureScript.Backend.Optimizer.Syntax (BackendSyntax(..), Level)

type LocalTypes = Array (Tuple String C.ExprType)

-- Only the outer Typed describes this expression's result. A TypeApp argument
-- is a type supplied to a polymorphic value, not its instantiated signature.
declaredType :: TcoExpr -> Maybe C.ExprType
declaredType (TcoExpr _ syntax) = case syntax of
  Typed ty _ -> Just ty
  _ -> Nothing

bindLocalType :: LocalTypes -> String -> Maybe C.ExprType -> LocalTypes
bindLocalType locals name ty = case ty of
  Just value -> Array.cons (Tuple name value) rest
  Nothing -> rest
  where
  -- Unknown binders shadow known ones too; never retain stale evidence.
  rest = Array.filter (\entry -> fst entry /= name) locals

lookupLocalType :: LocalTypes -> String -> Maybe C.ExprType
lookupLocalType locals name = map snd (Array.find (\entry -> fst entry == name) locals)

-- One value binder consumes one arrow. Func's array may describe a curried
-- prefix, and its result may be another Func. Empty Func and wrapped types do
-- not prove a binder: constraints can introduce extra dictionary arguments.
unconsFunction :: C.ExprType -> Maybe { argument :: C.ExprType, result :: C.ExprType }
unconsFunction = case _ of
  C.Func args result -> do
    { head, tail } <- Array.uncons args
    pure { argument: head, result: if Array.null tail then result else C.Func tail result }
  _ -> Nothing

applyArguments :: Int -> C.ExprType -> Maybe C.ExprType
applyArguments count ty
  | count == 0 = Just ty
  | count > 0 = unconsFunction ty >>= applyArguments (count - 1) <<< _.result
  | otherwise = Nothing

argumentType :: Int -> C.ExprType -> Maybe C.ExprType
argumentType index ty = applyArguments index ty >>= map _.argument <<< unconsFunction

bindArgumentTypes :: LocalTypes -> Maybe C.ExprType -> Array (Tuple (Maybe C.Ident) Level) -> { locals :: LocalTypes, result :: Maybe C.ExprType }
bindArgumentTypes locals expected = foldl step { locals, result: expected }
  where
  step state (Tuple ident level) =
    { locals: bindLocalType state.locals (localId ident level) (state.result >>= argumentType 0)
    , result: state.result >>= applyArguments 1
    }

-- Reading a known property also works on an open row. This proves the property
-- type only; RecordShapes separately requires a closed row for a Java layout.
recordProperty :: String -> C.ExprType -> Maybe C.ExprType
recordProperty label = case _ of
  C.Record (C.Row fields _) -> map snd (Array.find (\field -> fst field == label) fields)
  _ -> Nothing

intFunction :: C.ExprType -> Boolean
intFunction = case _ of
  C.Func [ C.Int ] C.Int -> true
  _ -> false
