module Javapurs.LoopInvariants (Invariant, prepareLoop) where

import Prelude

import Control.Monad.State (State, get, put, runState)
import Data.Array as Array
import Data.Maybe (Maybe(..))
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import Javapurs.PureInvariants (isPureIntInvariant)
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr(..))
import PureScript.Backend.Optimizer.CoreFn (Ident(..), ModuleName)
import PureScript.Backend.Optimizer.Syntax (BackendSyntax(..), Level(..), Pair(..))

type Invariant = { local :: Tuple (Maybe Ident) Level, name :: String, value :: TcoExpr }

-- Replace only closed scalar calls. Each occurrence keeps its own first-use
-- cache: there is no sharing across branches, closures or nested loop scopes.
prepareLoop :: ModuleName -> Array (Tuple Ident TcoExpr) -> String -> TcoExpr -> { body :: TcoExpr, invariants :: Array Invariant }
prepareLoop moduleName bindings loopName body =
  let Tuple result invariants = runState (visit true body) []
  in { body: result, invariants }
  where
  visit :: Boolean -> TcoExpr -> State (Array Invariant) TcoExpr
  visit isTail expr@(TcoExpr analysis syntax)
    | not isTail && isCall expr && isPureIntInvariant moduleName bindings expr = do
        invariants <- get
        -- '$' cannot occur in the source's sanitized local binding names.
        let
          name = "__invariant$" <> loopName <> "$" <> show (Array.length invariants)
          ident = Just (Ident name)
          level = Level 0
        put (Array.snoc invariants { name, local: Tuple ident level, value: expr })
        pure (TcoExpr analysis (Local ident level))
    | otherwise = case syntax of
        Abs _ _ -> pure expr
        UncurriedAbs _ _ -> pure expr
        UncurriedEffectAbs _ _ -> pure expr
        UncurriedEffectApp _ _ -> pure expr
        EffectPure _ -> pure expr
        EffectDefer _ -> pure expr
        EffectBind _ _ _ _ -> pure expr
        PrimEffect _ -> pure expr
        Typed ty inner -> map (TcoExpr analysis <<< Typed ty) (visit isTail inner)
        TypeApp inner ty -> map (\value -> TcoExpr analysis (TypeApp value ty)) (visit isTail inner)
        Let ident level value rest -> do
          value' <- visit false value
          rest' <- visit isTail rest
          pure (TcoExpr analysis (Let ident level value' rest'))
        Branch cases def -> do
          cases' <- traverse (\(Pair condition value) -> Pair <$> visit false condition <*> visit isTail value) cases
          def' <- visit isTail def
          pure (TcoExpr analysis (Branch cases' def'))
        -- Recursive bindings are translated with their own loop plan.
        LetRec level values rest -> map (TcoExpr analysis <<< LetRec level values) (visit isTail rest)
        _ -> map (TcoExpr analysis) (traverse (visit false) syntax)

isCall :: TcoExpr -> Boolean
isCall (TcoExpr _ syntax) = case syntax of
  Typed _ inner -> isCall inner
  TypeApp inner _ -> isCall inner
  App _ _ -> true
  UncurriedApp _ _ -> true
  _ -> false
