module Javapurs.CodeGen.Syntax
  ( Application, Abstraction, flattenApp, extractUncurriedAbs, unwrapTcoExpr
  , isEffectNode, stripEffectDefer, stripEffectAbs, paramKinds
  ) where

import Prelude

import Data.Array as Array
import Data.Array.NonEmpty as NEA
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))
import Javapurs.JavaAst (JavaParamType(..))
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr(..))
import PureScript.Backend.Optimizer.CoreFn (Ident(..))
import PureScript.Backend.Optimizer.CoreFn as CoreFn
import PureScript.Backend.Optimizer.FreeVars (localId)
import PureScript.Backend.Optimizer.Syntax (BackendSyntax(..))

type Application = { fn :: TcoExpr, args :: Array TcoExpr }
type Abstraction = { args :: Array String, body :: TcoExpr }

-- Flatten only ordinary calls, preserving left-to-right argument order.
-- Keep the head's type evidence; wrappers around an applied prefix are not
-- evidence about the head. UncurriedEffectApp has a separate execution path.
flattenApp :: TcoExpr -> Application
flattenApp expr@(TcoExpr _ syntax) = case syntax of
  App fn args ->
    let inner = flattenApp fn
    in { fn: inner.fn, args: inner.args <> NEA.toArray args }
  UncurriedApp fn args ->
    let inner = flattenApp fn
    in { fn: inner.fn, args: inner.args <> args }
  Typed _ inner -> throughWrapper inner
  TypeApp inner _ -> throughWrapper inner
  _ -> { fn: expr, args: [] }
  where
  throughWrapper inner =
    let flat = flattenApp inner
    in if Array.null flat.args then { fn: expr, args: [] } else flat

extractUncurriedAbs :: TcoExpr -> Maybe Abstraction
extractUncurriedAbs (TcoExpr _ syntax) = case syntax of
  Abs args body ->
    let thisArgs = map (\(Tuple ident level) -> localId ident level) (NEA.toArray args)
    in case extractUncurriedAbs body of
      Just inner -> Just { args: thisArgs <> inner.args, body: inner.body }
      Nothing -> Just { args: thisArgs, body }
  UncurriedAbs args body -> Just { args: map (\(Tuple ident level) -> localId ident level) args, body }
  UncurriedEffectAbs args body -> Just { args: map (\(Tuple ident level) -> localId ident level) args, body }
  Typed _ inner -> extractUncurriedAbs inner
  TypeApp inner _ -> extractUncurriedAbs inner
  _ -> Nothing

unwrapTcoExpr :: TcoExpr -> BackendSyntax TcoExpr
unwrapTcoExpr (TcoExpr _ syntax) = case syntax of
  Typed _ inner -> unwrapTcoExpr inner
  TypeApp inner _ -> unwrapTcoExpr inner
  _ -> syntax

-- Syntactic execution protocol, not a type-based purity analysis. In particular
-- a Branch or foreign call may return a Supplier, and EffectDefer is stripped
-- explicitly by the execution site before this predicate is consulted.
isEffectNode :: TcoExpr -> Boolean
isEffectNode expr = case unwrapTcoExpr expr of
  EffectBind _ _ _ _ -> true
  EffectPure _ -> true
  PrimEffect _ -> true
  Let _ _ _ body -> isEffectNode body
  LetRec _ _ body -> isEffectNode body
  _ -> false

stripEffectDefer :: TcoExpr -> TcoExpr
stripEffectDefer expr@(TcoExpr analysis syntax) = case syntax of
  Typed ty inner -> TcoExpr analysis (Typed ty (stripEffectDefer inner))
  TypeApp inner ty -> TcoExpr analysis (TypeApp (stripEffectDefer inner) ty)
  EffectDefer inner -> stripEffectDefer inner
  Abs _ inner -> stripEffectDefer inner
  Let ident level value body -> TcoExpr analysis (Let ident level value (stripEffectDefer body))
  LetRec level bindings body -> TcoExpr analysis (LetRec level bindings (stripEffectDefer body))
  _ -> expr

stripEffectAbs :: TcoExpr -> TcoExpr
stripEffectAbs expr@(TcoExpr analysis syntax) = case syntax of
  Typed ty inner -> TcoExpr analysis (Typed ty (stripEffectAbs inner))
  TypeApp inner ty -> TcoExpr analysis (TypeApp (stripEffectAbs inner) ty)
  UncurriedEffectAbs [] body -> stripEffectAbs body
  UncurriedAbs [] body -> stripEffectAbs body
  Abs args body -> case NEA.toArray args of
    [ Tuple Nothing _ ] -> stripEffectAbs body
    [ Tuple (Just (Ident "$__unused")) _ ] -> stripEffectAbs body
    _ -> expr
  EffectDefer body -> stripEffectAbs body
  Let ident level value body -> TcoExpr analysis (Let ident level value (stripEffectAbs body))
  LetRec level bindings body -> TcoExpr analysis (LetRec level bindings (stripEffectAbs body))
  _ -> expr

-- Definition types contribute only when they cover the extracted Abs arity.
paramKinds :: TcoExpr -> Array String -> Array JavaParamType
paramKinds (TcoExpr _ syntax) args = case syntax of
  Typed (CoreFn.Func paramTypes _) _ | Array.length paramTypes == Array.length args ->
    map (\paramType -> case paramType of
      CoreFn.Int -> ParamInt
      _ -> ParamObject) paramTypes
  _ -> Array.replicate (Array.length args) ParamObject
