module Javapurs.PureInvariants (isPureIntInvariant) where

import Prelude

import Data.Array as Array
import Data.Foldable (foldl)
import Data.Maybe (Maybe(..), isJust)
import Data.Set (Set)
import Data.Set as Set
import Data.Tuple (Tuple(..), fst, snd)
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr(..))
import PureScript.Backend.Optimizer.CoreFn as C
import PureScript.Backend.Optimizer.FreeVars (freeVars)
import PureScript.Backend.Optimizer.Syntax (BackendSyntax(..), BackendOperator(..), BackendOperator1(..), BackendOperator2(..), Level, Pair(..))

type LocalRef = Tuple (Maybe C.Ident) Level

type Context =
  { moduleName :: C.ModuleName
  , definitions :: Array (Tuple C.Ident TcoExpr)
  }

-- This proves repeatability, not termination. Callers must evaluate on the first
-- original use and cache only a successful Int result, within one invocation.
-- Function parameters are conditionally deeply pure: every application also
-- checks its arguments, and every closure's body is checked before acceptance.
isPureIntInvariant :: C.ModuleName -> Array (Tuple C.Ident TcoExpr) -> TcoExpr -> Boolean
isPureIntInvariant moduleName definitions expr =
  let context = { moduleName, definitions }
  in Set.isEmpty (freeVars expr) &&
    resultType context Set.empty expr == Just C.Int &&
    isJust (deepPure context Set.empty Set.empty Set.empty expr 2048)

definition :: Context -> C.Qualified C.Ident -> Maybe (Tuple C.Ident TcoExpr)
definition context (C.Qualified qualifier ident)
  | qualifier == Nothing || qualifier == Just context.moduleName =
      Array.find (\entry -> fst entry == ident) context.definitions
definition _ _ = Nothing

strip :: TcoExpr -> BackendSyntax TcoExpr
strip (TcoExpr _ syntax) = case syntax of
  Typed _ inner -> strip inner
  TypeApp inner _ -> strip inner
  _ -> syntax

isFunction :: TcoExpr -> Boolean
isFunction expr = case strip expr of
  Abs _ _ -> true
  UncurriedAbs _ _ -> true
  _ -> false

-- Data.Unit.unit is the single trusted runtime value here. A Unit annotation
-- alone never approves another global or foreign call.
isUnitConstant :: TcoExpr -> Boolean
isUnitConstant expr = case strip expr of
  Var (C.Qualified (Just (C.ModuleName "Data.Unit")) (C.Ident "unit")) -> true
  _ -> false

deepPure :: Context -> Set C.Ident -> Set C.Ident -> Set LocalRef -> TcoExpr -> Int -> Maybe Int
deepPure context functions values locals (TcoExpr _ syntax) fuel
  | fuel <= 0 = Nothing
  | otherwise =
      let
        remaining = fuel - 1
        check = deepPure context functions values locals
        checks expressions = foldl (\budget expr -> budget >>= check expr) (Just remaining) expressions
        checkBody args body = deepPure context functions values
          (foldl (flip Set.insert) locals args)
          body remaining
      in case syntax of
        Typed C.Unit inner | isUnitConstant inner -> Just remaining
        Typed _ inner -> check inner remaining
        TypeApp inner _ -> check inner remaining
        Lit literal -> case literal of
          C.LitInt _ -> Just remaining
          C.LitNumber _ -> Just remaining
          C.LitString _ -> Just remaining
          C.LitChar _ -> Just remaining
          C.LitBoolean _ -> Just remaining
          _ -> Nothing
        Local ident level
          | Set.member (Tuple ident level) locals -> Just remaining
          | otherwise -> Nothing
        Var qualified -> do
          Tuple ident body <- definition context qualified
          if isFunction body then
            if Set.member ident functions then
              -- A recursive assumption cannot justify a cycle through an
              -- eagerly evaluated global value.
              if Set.isEmpty values then Just remaining else Nothing
            else deepPure context (Set.insert ident functions) values Set.empty body remaining
          else if Set.member ident values then Nothing
          else deepPure context functions (Set.insert ident values) Set.empty body remaining
        Abs args body -> checkBody (Array.fromFoldable args) body
        UncurriedAbs args body -> checkBody args body
        App fn args -> checks (Array.cons fn (Array.fromFoldable args))
        UncurriedApp fn args -> checks (Array.cons fn args)
        Let ident level value body -> do
          budget <- check value remaining
          deepPure context functions values (Set.insert (Tuple ident level) locals) body budget
        LetRec level bindings body
          | Array.all (isFunction <<< snd) (Array.fromFoldable bindings) ->
              let
                scope = foldl (\bound (Tuple ident _) -> Set.insert (Tuple (Just ident) level) bound)
                  locals (Array.fromFoldable bindings)
                verify = deepPure context functions values scope
              in do
                budget <- foldl (\rest (Tuple _ value) -> rest >>= verify value)
                  (Just remaining) (Array.fromFoldable bindings)
                verify body budget
          | otherwise -> Nothing
        Branch branches fallback -> checks $
          Array.concatMap (\(Pair condition body) -> [condition, body]) (Array.fromFoldable branches) <> [fallback]
        PrimOp (Op1 op value) -> case op of
          OpBooleanNot -> check value remaining
          OpIntBitNot -> check value remaining
          OpIntNegate -> check value remaining
          OpNumberNegate -> check value remaining
          _ -> Nothing
        PrimOp (Op2 OpArrayIndex _ _) -> Nothing
        PrimOp (Op2 _ left right) -> checks [left, right]
        -- Effects, FFI/unknown globals, mutable aggregate reads, constructors,
        -- explicit failures and updates require stronger evidence than this pass.
        _ -> Nothing

resultType :: Context -> Set C.Ident -> TcoExpr -> Maybe C.ExprType
resultType context visited (TcoExpr _ syntax) = case syntax of
  Typed ty _ -> Just ty
  TypeApp inner _ -> resultType context visited inner
  Var qualified -> do
    Tuple ident body <- definition context qualified
    if Set.member ident visited then Nothing
    else resultType context (Set.insert ident visited) body
  App fn args -> do
    ty <- resultType context visited fn
    applyArguments (Array.length (Array.fromFoldable args)) ty
  UncurriedApp fn args -> do
    ty <- resultType context visited fn
    applyArguments (Array.length args) ty
  Lit (C.LitInt _) -> Just C.Int
  _ -> Nothing

-- Func can describe more arguments than the explicit lambdas: a function may
-- return another closure. Consume the complete application before accepting Int.
applyArguments :: Int -> C.ExprType -> Maybe C.ExprType
applyArguments count ty
  | count == 0 = Just ty
  | otherwise = case ty of
      C.Func args result -> case Array.uncons args of
        Just { tail } -> applyArguments (count - 1)
          (if Array.null tail then result else C.Func tail result)
        Nothing -> Nothing
      _ -> Nothing
