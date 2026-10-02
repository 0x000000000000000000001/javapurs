-- | Snapshot reads before any write, then choose cells that no retained/future
-- | path can observe. Workers emits the writes using only this prepared pool.
module Javapurs.Ownership.Cells (freshName, plan, takeCell) where

import Prelude

import Control.Alternative (guard)
import Control.Monad.State (get, put)
import Control.Monad.Trans.Class (lift)
import Data.Array as Array
import Data.Foldable (any, foldMap)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Traversable (traverse)
import Javapurs.JavaAst (JavaExpr(..))
import Javapurs.Ownership.Analysis (disjoint, leaves, snapshotScalar, snapshotScalarValue)
import Javapurs.Ownership.Model (Argument(..), CellPool, Context, Env, Gen, Path(..), TakenCell, TreeSpec, TreeTerm(..), Value(..), overlap, pathExpr, prefix, prefixes)

freshName :: String -> Gen String
freshName prefix_ = do
  next <- get
  put (next + 1)
  pure (prefix_ <> show next)

snapshot :: TreeSpec -> TreeTerm -> Gen { stmts :: Array JavaExpr, term :: TreeTerm }
snapshot spec = case _ of
  Keep path -> do
    name <- freshName "__read_"
    pure { stmts: [ JavaLocalAssign name (pathExpr spec path) ], term: Existing (JavaLocal name) }
  Construct args -> do
    result <- traverse (snapshotArgument spec) args
    pure { stmts: foldMap _.stmts result, term: Construct (map _.arg result) }
  Call name args -> do
    result <- traverse (snapshotArgument spec) args
    pure { stmts: foldMap _.stmts result, term: Call name (map _.arg result) }
  term -> pure { stmts: [], term }

snapshotArgument :: TreeSpec -> Argument -> Gen { stmts :: Array JavaExpr, arg :: Argument }
snapshotArgument spec = case _ of
  TreeArg value -> do
    result <- snapshot spec value
    pure { stmts: result.stmts, arg: TreeArg result.term }
  ScalarArg value -> do
    name <- freshName "__scalar_"
    pure { stmts: [ snapshotScalar name value ], arg: ScalarArg (snapshotScalarValue name value) }

takeCell :: Context -> CellPool -> Gen TakenCell
takeCell context pool = case Array.uncons pool.known of
  Just { head, tail } -> pure
    { stmts: [], expr: JavaLocal head, pool: pool { known = tail }, nonNull: true }
  Nothing -> do
    name <- freshName "__cell_"
    let
      -- A dead local may hold the shared leaf, which is never a reusable node.
      takeOne slot rest =
        [ JavaIf (JavaBinaryOp "&&"
              (JavaInstanceOf (JavaLocal slot) context.candidate.spec.nodeClass)
              (JavaBinaryOp "!=" (JavaLocal slot) (JavaRaw "null")))
            [ JavaLocalSet name (JavaLocal slot), JavaLocalSet slot (JavaRaw "null") ]
            rest ]
    pure
      { stmts: [ JavaLocalAssign name (JavaRaw "null") ] <> Array.foldr takeOne [] pool.nullable
      , expr: JavaLocal name
      , pool
      , nonNull: false
      }

plan :: Context -> Env -> Array Path -> TreeTerm -> Gen
  { stmts :: Array JavaExpr, term :: TreeTerm, pool :: CellPool, retired :: Array Path }
plan context env future term = do
  lift $ guard (disjoint $ leaves term)
  captured <- snapshot context.candidate.spec term
  let
    retained = leaves term
    roots = Array.mapMaybe (case _ of
      Tree (Path root _) -> Just (Path root [])
      _ -> Nothing) (Array.fromFoldable $ Map.values env)
    nonNull = Array.nub $ foldMap prefixes retained
    candidates = Array.nub $ roots <> nonNull
    dead = Array.filter (\path -> not (any (\kept -> prefix kept path) retained)
      && not (any (overlap path) future)) candidates
  slots <- traverse (\path -> do
    name <- freshName "__dead_"
    pure { name, nonNull: Array.elem path nonNull, stmt: JavaLocalAssign name (pathExpr context.candidate.spec path) }) dead
  donor <- freshName "__donor_slot_"
  pure
    { stmts: captured.stmts <> [ JavaLocalAssign donor (JavaLocal context.donorName) ] <> map _.stmt slots
    , term: captured.term
    , pool: { known: map _.name (Array.filter _.nonNull slots)
            , nullable: [ donor ] <> map _.name (Array.filter (not <<< _.nonNull) slots) }
    , retired: retained <> dead
    }
