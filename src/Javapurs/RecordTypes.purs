module Javapurs.RecordTypes (annotateRecordTypes) where

import Prelude

import Data.Array as Array
import Data.Foldable (foldl)
import Data.Maybe (Maybe(..))
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..), fst, snd)
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr(..))
import PureScript.Backend.Optimizer.CoreFn as C
import PureScript.Backend.Optimizer.FreeVars (localId)
import PureScript.Backend.Optimizer.Syntax (BackendSyntax(..), BackendAccessor(..), BackendOperator(..), BackendOperator1(..), BackendOperator2(..), Level)

type Types = Array (Tuple String C.ExprType)

-- Optimization retains function types but can leave their local uses bare.
-- Recover record annotations before codegen flattens the function binders.
-- This is lexical propagation from definitions, never specialization from calls.
annotateRecordTypes :: TcoExpr -> TcoExpr
annotateRecordTypes = annotate [] Nothing

annotate :: Types -> Maybe C.ExprType -> TcoExpr -> TcoExpr
annotate env expected (TcoExpr analysis syntax) = case syntax of
  Typed ty inner -> TcoExpr analysis (Typed ty (annotate env (Just ty) inner))
  Abs args body ->
    let scope = bindArguments env expected (Array.fromFoldable args)
    in TcoExpr analysis (Abs args (annotate scope.env scope.result body))
  UncurriedAbs args body ->
    let scope = bindArguments env expected args
    in TcoExpr analysis (UncurriedAbs args (annotate scope.env scope.result body))
  Let ident level value body ->
    let
      value' = annotate env Nothing value
      env' = bindType env (localId ident level) (typeOf env value')
    in TcoExpr analysis (Let ident level value' (annotate env' Nothing body))
  LetRec level bindings body ->
    let
      env' = foldl (\acc (Tuple ident value) -> bindType acc (localId (Just ident) level) (typeOf env value)) env (Array.fromFoldable bindings)
      bindings' = map (\(Tuple ident value) -> Tuple ident (annotate env' Nothing value)) bindings
    in TcoExpr analysis (LetRec level bindings' (annotate env' Nothing body))
  -- An instantiation belongs to the use of a polymorphic value, not its binders.
  TypeApp inner ty -> TcoExpr analysis (TypeApp (annotate env Nothing inner) ty)
  _ ->
    let
      result = TcoExpr analysis (map (annotate env Nothing) syntax)
    in case typeOf env result of
      Just ty@(C.Record _) -> TcoExpr analysis (Typed ty result)
      _ -> result

bindType :: Types -> String -> Maybe C.ExprType -> Types
bindType env name ty =
  let rest = Array.filter (\entry -> fst entry /= name) env
  in case ty of
    Just value -> Array.cons (Tuple name value) rest
    Nothing -> rest

bindArguments :: Types -> Maybe C.ExprType -> Array (Tuple (Maybe C.Ident) Level) -> { env :: Types, result :: Maybe C.ExprType }
bindArguments env expected args =
  foldl step { env, result: expected } args
  where
  step state (Tuple ident level) = case state.result of
    Just (C.Func types result) -> case Array.uncons types of
      Just { head, tail } ->
        { env: bindType state.env (localId ident level) (Just head)
        , result: Just (if Array.null tail then result else C.Func tail result)
        }
      Nothing -> { env: bindType state.env (localId ident level) Nothing, result: Nothing }
    -- Constrained functions can have extra dictionary binders. Stay conservative.
    _ -> { env: bindType state.env (localId ident level) Nothing, result: Nothing }

typeOf :: Types -> TcoExpr -> Maybe C.ExprType
typeOf env (TcoExpr _ syntax) = case syntax of
  Typed ty _ -> Just ty
  Local ident level -> map snd (Array.find (\entry -> fst entry == localId ident level) env)
  Accessor value (GetProp label) -> case typeOf env value of
    Just (C.Record (C.Row fields _)) -> map snd (Array.find (\field -> fst field == label) fields)
    _ -> Nothing
  Update value updates -> case typeOf env value of
    Just (C.Record (C.Row fields tail)) -> do
      replacements <- traverse (\(C.Prop label field) -> do
        _ <- Array.find (\entry -> fst entry == label) fields
        ty <- typeOf env field
        pure (Tuple label ty)) updates
      -- Updates may change field types. Never copy the base's annotation unchanged.
      pure $ C.Record $ C.Row (map (\field -> case Array.find (\entry -> fst entry == fst field) (Array.reverse replacements) of
        Just replacement -> replacement
        Nothing -> field) fields) tail
    _ -> Nothing
  Lit literal -> case literal of
    C.LitInt _ -> Just C.Int
    C.LitNumber _ -> Just C.Number
    C.LitString _ -> Just C.String
    C.LitChar _ -> Just C.Char
    C.LitBoolean _ -> Just C.Boolean
    _ -> Nothing
  PrimOp (Op1 op _) -> case op of
    OpIntNegate -> Just C.Int
    OpIntBitNot -> Just C.Int
    OpArrayLength -> Just C.Int
    _ -> Nothing
  PrimOp (Op2 op _ _) -> case op of
    OpIntNum _ -> Just C.Int
    OpIntBitAnd -> Just C.Int
    OpIntBitOr -> Just C.Int
    OpIntBitShiftLeft -> Just C.Int
    OpIntBitShiftRight -> Just C.Int
    OpIntBitZeroFillShiftRight -> Just C.Int
    OpIntBitXor -> Just C.Int
    _ -> Nothing
  _ -> Nothing
