-- | Pure constructors for chunk values. The recursive traversal in Chunk picks
-- | the form and costs; this module only assembles the result record.
module Javapurs.Chunk.Value
  ( analyzedValue
  , bindingValue
  , closedValue
  , loopSnapshots
  , opaqueValue
  , valueResult
  , valueWithChild
  , valueWithChildren
  ) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.Map as Map
import Data.Tuple (Tuple(..))
import Javapurs.Chunk.Captures (CaptureBarrier, Captures, analyzeCaptures, combineCaptures, noCaptures, withoutBindings)
import Javapurs.Chunk.Extraction (ChunkedValue, LocalTypes, ResultForm(..), nodeCost)
import Javapurs.Chunk.Types (Chunk, ChunkedStatement)
import Javapurs.JavaAst (JavaExpr, JavaParamType(..))
import Javapurs.Naming (loopSnapshotName)

valueResult :: JavaExpr -> Int -> Captures -> ChunkedValue
valueResult expr cost captures = { expr, cost, captures, form: ObjectResult }

-- Statement containers need lexical analysis of the rebuilt sequence rather
-- than the union of individual statements (which would lose their binders).
analyzedValue :: ChunkedStatement -> ChunkedValue
analyzedValue value = valueResult value.expr value.cost (analyzeCaptures value.expr)

closedValue :: JavaExpr -> Int -> Chunk ChunkedValue
closedValue expr cost = pure (valueResult expr cost noCaptures)

opaqueValue :: CaptureBarrier -> JavaExpr -> Chunk ChunkedValue
opaqueValue barrier expr = pure { expr, cost: 1, captures: Left barrier, form: OpaqueRoot }

valueWithChild :: JavaExpr -> ChunkedValue -> Chunk ChunkedValue
valueWithChild expr value = pure (valueResult expr (nodeCost [ value.cost ]) value.captures)

valueWithChildren :: JavaExpr -> Array ChunkedValue -> Chunk ChunkedValue
valueWithChildren expr values = pure (valueResult expr (nodeCost (map _.cost values)) (combineCaptures (map _.captures values)))

bindingValue :: JavaExpr -> Array String -> ChunkedValue -> Chunk ChunkedValue
bindingValue expr names value = pure (valueResult expr (nodeCost [ value.cost ]) (withoutBindings names value.captures))

-- | Only final per-iteration snapshots are available as helper parameters.
-- | The mutable loop storage and memoized IntSuppliers never enter LocalTypes.
loopSnapshots :: Array String -> Array String -> LocalTypes
loopSnapshots params intParams = Map.fromFoldable $ map
  (\name -> Tuple (loopSnapshotName name) (if Array.elem name intParams then ParamInt else ParamObject)) params
