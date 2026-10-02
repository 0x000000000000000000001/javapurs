-- | Consuming workers for first-order tree functions. Candidates recognizes
-- | definitions; Analysis proves uses; Cells snapshots and retires input paths;
-- | Workers emits declarations. This module owns their order and reachability.
module Javapurs.Ownership (prepare) where

import Prelude

import Control.Monad.State (State, modify_, runState)
import Data.Array as Array
import Data.Array.NonEmpty as NonEmptyArray
import Data.Foldable (all)
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Newtype (unwrap)
import Data.Set as Set
import Data.String as String
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..), fst, snd)
import Javapurs.JavaAst (JavaExpr, JavaParamType(..))
import Javapurs.Ownership.Analysis (callees, freshTree)
import Javapurs.Ownership.Candidates (argJavaTypes, candidate, localCandidates, qualify, reserveWorkers, spine, strip, treeSpecs)
import Javapurs.Ownership.Model (ArgType(..), Candidate, CandidateKey(..), Context)
import Javapurs.Ownership.Workers (workerDeclarations)
import PureScript.Backend.Optimizer.Convert (BackendModule)
import PureScript.Backend.Optimizer.CoreFn (DataDecl, ModuleName, Qualified(..))
import PureScript.Backend.Optimizer.Semantics (NeutralExpr(..))
import PureScript.Backend.Optimizer.Syntax (BackendSyntax(..))
import PureScript.Backend.Optimizer.Syntax as Syn

type Prepared =
  { module :: BackendModule
  , declarations :: Array JavaExpr
  , functions :: Map String { javaName :: String, params :: Array JavaParamType }
  , mutableClasses :: Array String
  , diagnostics :: Array String
  }

-- Cache declarations only after the candidate graph reaches a fixed point.
-- A caller rejected on the next round must not keep code for a rejected callee.
type Validated = Map CandidateKey { candidate :: Candidate, declarations :: Array JavaExpr }

prepare :: BackendModule -> Prepared
prepare mod =
  let
    specs = treeSpecs mod
    found = reserveWorkers mod
      (Array.mapMaybe (candidate mod specs) (Array.concatMap _.bindings mod.bindings) <> localCandidates mod specs)
    initial = Map.fromFoldable $ map (\fn -> Tuple fn.key fn) found
    validated = validateCandidates mod initial
    accepted = map _.candidate validated
    contextOf = contextFor mod.name mod.dataDecls accepted
    Tuple rewrittenGroups usedKeys = runState
      (traverse (\group -> do
          bindings <- traverse (\(Tuple name expr) -> do
            expr' <- rewrite mod.name mod.dataDecls accepted expr
            pure (Tuple name expr')) group.bindings
          pure group { bindings = bindings }) mod.bindings) Set.empty
    reachable = closeCallees Set.empty (Array.fromFoldable usedKeys)
      where
      closeCallees seen pending = case Array.index pending 0 of
        Nothing -> seen
        Just key -> case Map.lookup key accepted of
          Just fn | not (Set.member key seen) ->
            closeCallees (Set.insert key seen) (Array.drop 1 pending <> callees (contextOf fn) fn.body)
          _ -> closeCallees seen (Array.drop 1 pending)
    workers = Array.mapMaybe (\key -> Map.lookup key validated) (Array.fromFoldable reachable)
    declarations = Array.concatMap _.declarations workers
    functions = Map.fromFoldable $ map (\{ candidate: fn } -> Tuple (unwrap fn.worker)
      { javaName: fn.javaName
      , params: map (const ParamObject) fn.captures <> argJavaTypes fn.argTypes <> [ ParamObject ]
      }) workers
    mutableClasses = Array.nub $ map (\{ candidate: fn } -> fn.spec.nodeClass) workers
    diagnostics = Array.concat
      [ [ "ownership: " <> show (Array.length specs) <> " tree types, "
            <> show (Map.size initial) <> " candidates, " <> show (Map.size accepted) <> " accepted" ]
      , if Array.null workers then []
        else [ "ownership: consuming workers for " <> String.joinWith ", " (map (unwrap <<< _.original <<< _.candidate) workers) ]
      ]
  in { module: mod { bindings = rewrittenGroups }, declarations, functions, mutableClasses, diagnostics }

contextFor :: ModuleName -> Array DataDecl -> Map CandidateKey Candidate -> Candidate -> Context
contextFor moduleName dataDecls candidates candidate_ =
  { moduleName, dataDecls, candidates, candidate: candidate_, donorName: "__donor" }

validateCandidates :: BackendModule -> Map CandidateKey Candidate -> Validated
validateCandidates mod candidates =
  let
    checked = Map.mapMaybe (\fn -> map (\declarations -> { candidate: fn, declarations })
      (workerDeclarations (contextFor mod.name mod.dataDecls candidates fn) fn)) candidates
  in if Map.size checked == Map.size candidates then checked
     else validateCandidates mod (map _.candidate checked)

-- Rewrite only exactly saturated calls with fresh tree operands. Rejected
-- applications keep their original callable ABI and recursively visit children.
rewrite :: ModuleName -> Array DataDecl -> Map CandidateKey Candidate -> NeutralExpr -> State (Set.Set CandidateKey) NeutralExpr
rewrite moduleName dataDecls candidates original@(NeutralExpr syn) = do
  let
    call = spine original
    target = case strip call.head of
      Var qualified -> case qualify moduleName qualified of
        Qualified (Just mod) name | mod == moduleName -> Map.lookup (TopLevelKey name) candidates
        _ -> Nothing
      Local name level -> Map.lookup (LocalKey name level) candidates
      _ -> Nothing
    callToWorker = case strip call.head of
      Var qualified -> case qualify moduleName qualified of
        Qualified (Just mod) name | mod == moduleName ->
          case Map.lookup (TopLevelKey name) candidates of
            Just fn
              | unwrap fn.worker == unwrap name
              , Array.length call.args == Array.length fn.captures + Array.length fn.args -> Just fn.key
            _ -> Nothing
        _ -> Nothing
      _ -> Nothing
  case callToWorker of
    -- Retain reachability for an already recognized worker call.
    Just key -> do
      modify_ (Set.insert key)
      pure original
    Nothing -> case target of
      Just fn
        | Array.length call.args == Array.length fn.args
        , all (\(Tuple kind value) -> kind /= ArgTree || freshTree (contextFor moduleName dataDecls candidates fn) value)
            (Array.zip fn.argTypes call.args) -> do
            modify_ (Set.insert fn.key)
            args <- traverse (rewrite moduleName dataDecls candidates) call.args
            let captureArgs = map (\ref -> NeutralExpr (Syn.Local (fst ref) (snd ref))) fn.captures
            case NonEmptyArray.fromArray (captureArgs <> args) of
              Just combined -> pure $ NeutralExpr $ Syn.App (NeutralExpr $ Syn.Var (Qualified (Just moduleName) fn.worker)) combined
              Nothing -> pure original
      _ -> NeutralExpr <$> traverse (rewrite moduleName dataDecls candidates) syn
