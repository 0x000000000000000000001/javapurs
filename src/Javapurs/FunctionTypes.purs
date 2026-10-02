module Javapurs.FunctionTypes (annotateFunctionTypes, module Evidence) where

import Prelude

import Control.Alt ((<|>))
import Data.Array as Array
import Data.Array.NonEmpty as NonEmptyArray
import Data.Foldable (all, foldl)
import Data.Maybe (Maybe(..))
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..), fst, snd)
import Javapurs.TypeEvidence (LocalTypes, applyArguments, argumentType, bindArgumentTypes, bindLocalType, declaredType, lookupLocalType, recordProperty)
import Javapurs.TypeEvidence (intFunction) as Evidence
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr(..))
import PureScript.Backend.Optimizer.CoreFn as C
import PureScript.Backend.Optimizer.FreeVars (localId)
import PureScript.Backend.Optimizer.Syntax (BackendAccessor(..), BackendSyntax(..), Level, Pair(..))

type Context =
  { moduleName :: C.ModuleName
  , globals :: Array (Tuple C.Ident C.ExprType)
  , locals :: LocalTypes
  }

-- Recover types from lexical declarations and their residual application types.
-- A type application at a use site never changes a polymorphic definition's binders.
annotateFunctionTypes :: C.ModuleName -> Array (Tuple C.Ident TcoExpr) -> TcoExpr -> TcoExpr
annotateFunctionTypes moduleName bindings = annotate context Nothing
  where
  context =
    { moduleName
    , globals: Array.mapMaybe (\(Tuple ident value) -> Tuple ident <$> declaredType value) bindings
    , locals: []
    }

annotate :: Context -> Maybe C.ExprType -> TcoExpr -> TcoExpr
annotate context expected expression@(TcoExpr analysis syntax) = case syntax of
  Typed ty inner -> TcoExpr analysis (Typed ty (annotateBody context (Just ty) inner))
  _ ->
    let
      known = typeOf context expression <|> expected
      result = annotateBody context known expression
    in case known of
      Just ty@(C.Func _ _) -> TcoExpr analysis (Typed ty result)
      _ -> result

annotateBody :: Context -> Maybe C.ExprType -> TcoExpr -> TcoExpr
annotateBody context expected (TcoExpr analysis syntax) = TcoExpr analysis $ case syntax of
  Typed ty inner -> Typed ty (annotateBody context (Just ty) inner)
  Abs args body ->
    let scope = bindArguments context expected (Array.fromFoldable args)
    in Abs args (annotate scope.context scope.result body)
  UncurriedAbs args body ->
    let scope = bindArguments context expected args
    in UncurriedAbs args (annotate scope.context scope.result body)
  UncurriedEffectAbs args body ->
    let scope = bindArguments context expected args
    in UncurriedEffectAbs args (annotate scope.context scope.result body)
  Let ident level value body ->
    let
      value' = annotate context Nothing value
      context' = bindType context (localId ident level) (typeOf context value')
    in Let ident level value' (annotate context' expected body)
  LetRec level bindings body ->
    let
      context' = bindRecursive context level (Array.fromFoldable bindings)
      bindings' = map (\(Tuple ident value) -> Tuple ident (annotate context' Nothing value)) bindings
    in LetRec level bindings' (annotate context' expected body)
  Branch cases def ->
    Branch (map (\(Pair condition value) -> Pair (annotate context Nothing condition) (annotate context expected value)) cases)
      (annotate context expected def)
  App fn args ->
    let fn' = annotate context Nothing fn
    in App fn' (NonEmptyArray.mapWithIndex (\index -> annotate context (typeOf context fn' >>= argumentType index)) args)
  UncurriedApp fn args ->
    let fn' = annotate context Nothing fn
    in UncurriedApp fn' (Array.mapWithIndex (\index -> annotate context (typeOf context fn' >>= argumentType index)) args)
  -- Keep the instantiated use separate from the value's original binder types.
  TypeApp inner ty -> TypeApp (annotate context Nothing inner) ty
  EffectBind ident level value body ->
    let
      value' = annotate context Nothing value
      context' = bindType context (localId ident level) (typeOf context value' >>= effectResult)
    in EffectBind ident level value' (annotate context' expected body)
  EffectPure value -> EffectPure (annotate context (expected >>= effectResult) value)
  _ -> map (annotate context Nothing) syntax

bindType :: Context -> String -> Maybe C.ExprType -> Context
bindType context name ty = context { locals = bindLocalType context.locals name ty }

bindArguments :: Context -> Maybe C.ExprType -> Array (Tuple (Maybe C.Ident) Level) -> { context :: Context, result :: Maybe C.ExprType }
bindArguments context expected args =
  let scope = bindArgumentTypes context.locals expected args
  in { context: context { locals = scope.locals }, result: scope.result }

bindRecursive :: Context -> Level -> Array (Tuple C.Ident TcoExpr) -> Context
bindRecursive context level = foldl
  (\scope (Tuple ident value) -> bindType scope (localId (Just ident) level) (declaredType value))
  context

effectResult :: C.ExprType -> Maybe C.ExprType
effectResult = case _ of
  C.ADT "Effect.Effect" _ [ result ] -> Just result
  _ -> Nothing

typeOf :: Context -> TcoExpr -> Maybe C.ExprType
typeOf context (TcoExpr _ syntax) = case syntax of
  Typed ty _ -> Just ty
  Local ident level -> lookupLocalType context.locals (localId ident level)
  Var (C.Qualified qualifier ident)
    | qualifier == Nothing || qualifier == Just context.moduleName ->
        map snd (Array.find (\entry -> fst entry == ident) context.globals)
  App fn args -> typeOf context fn >>= applyArguments (NonEmptyArray.length args)
  UncurriedApp fn args -> typeOf context fn >>= applyArguments (Array.length args)
  Let ident level value body ->
    typeOf (bindType context (localId ident level) (typeOf context value)) body
  LetRec level bindings body -> typeOf (bindRecursive context level (Array.fromFoldable bindings)) body
  Branch cases def -> do
    ty <- typeOf context def
    alternatives <- traverse (\(Pair _ value) -> typeOf context value) cases
    if all (_ == ty) alternatives then Just ty else Nothing
  Accessor value (GetProp label) -> typeOf context value >>= recordProperty label
  -- ForAll, constraints and TypeApp require their own explicit instantiated
  -- annotation; stripping them would misalign dictionary or polymorphic binders.
  _ -> Nothing
