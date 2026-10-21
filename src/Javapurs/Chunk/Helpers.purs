-- | Pure planning and materialization for closed-array helper groups. Stateful
-- | helper numbering remains in Chunk; this module owns only the deterministic
-- | grouping and the statements that fill each group exactly once.
module Javapurs.Chunk.Helpers
  ( fillGroup
  , groupItems
  , largeClosedArray
  ) where

import Prelude

import Data.Array as Array
import Javapurs.Chunk.Captures (isClosed)
import Javapurs.Chunk.Extraction (ChunkedValue, arrayGroupSize, maxChunkCost, nodeCost)
import Javapurs.Chunk.Types (ArrayGroupCall)
import Javapurs.JavaAst (JavaExpr(..))

largeClosedArray :: Array ChunkedValue -> Boolean
largeClosedArray values = nodeCost (map _.cost values) > maxChunkCost && Array.all (isClosed <<< _.captures) values

groupItems :: Array ChunkedValue -> Array (Array JavaExpr)
groupItems values = splitGroups (arrayGroupSize (map _.cost values)) values
  where
  splitGroups size remaining = case Array.splitAt size remaining of
    { before, after: _ } | Array.null before -> []
    { before, after } -> Array.cons (map _.expr before) (splitGroups size after)

-- | Materialize each group exactly once before reading its elements. Duplicating
-- | the call would repeat all effects/allocations and destroy object sharing.
fillGroup :: String -> ArrayGroupCall -> Array JavaExpr
fillGroup arrayName group =
  let groupName = arrayName <> "$group" <> show group.offset
  in Array.cons (JavaLocalAssign groupName group.call) $ Array.mapWithIndex
    (\index _ ->
      JavaArraySet (JavaLocal arrayName) (JavaRaw (show (group.offset + index)))
        (JavaArrayIndex (JavaLocal groupName) (JavaRaw (show index))))
    (Array.range 0 (group.count - 1))
