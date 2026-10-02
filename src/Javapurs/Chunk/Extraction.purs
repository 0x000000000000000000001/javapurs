-- | Pure cost model and extraction decision. The transformer supplies a rebuilt
-- | value and the effective Java types available at its current lexical site.
module Javapurs.Chunk.Extraction
  ( ChunkedValue
  , LocalTypes
  , HelperParams
  , ResultForm(..)
  , ExtractionPlan(..)
  , KeepReason(..)
  , planExtraction
  , maxChunkCost
  , maxChunkParams
  , nodeCost
  , textCost
  , scopeCost
  , filledArrayCost
  , arrayGroupSize
  ) where

import Prelude

import Data.Either (Either(..))
import Data.Foldable (foldl, sum)
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Set as Set
import Data.String as String
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import Javapurs.Chunk.Captures (Captures, CaptureBarrier)
import Javapurs.JavaAst (JavaExpr, JavaParamType)

type LocalTypes = Map String JavaParamType
type HelperParams = Array (Tuple String JavaParamType)

-- | Cost and captures describe the replacement tree, including helper calls
-- | already introduced below it. Result form is independent of capture safety.
type ChunkedValue =
  { expr :: JavaExpr
  , cost :: Int
  , captures :: Captures
  , form :: ResultForm
  }

data ResultForm
  = ObjectResult
  | PreserveCast
  | MethodSelector
  | RawFragment
  | StatementOnly
  | OpaqueRoot

data ExtractionPlan = ExtractWith HelperParams | KeepOriginal KeepReason

data KeepReason
  = RequiredAtSite ResultForm
  | WithinBudget
  | CaptureBlocked CaptureBarrier
  | TooManyParameters Int
  | MissingLocalType String

-- | The first failed condition explains keeping the root. Children have already
-- | been processed and can contain helpers of their own. Set ordering gives a
-- | stable parameter order, used identically by the declaration and its call.
planExtraction :: LocalTypes -> ChunkedValue -> ExtractionPlan
planExtraction locals value = case value.form of
  ObjectResult
    | value.cost <= maxChunkCost -> KeepOriginal WithinBudget
    | otherwise -> case value.captures of
        Left reason -> KeepOriginal (CaptureBlocked reason)
        Right names
          | Set.size names > maxChunkParams -> KeepOriginal (TooManyParameters (Set.size names))
          | otherwise -> case traverse resolve (Set.toUnfoldable names :: Array String) of
              Left name -> KeepOriginal (MissingLocalType name)
              Right params -> ExtractWith params
  form -> KeepOriginal (RequiredAtSite form)
  where
  resolve name = case Map.lookup name locals of
    Nothing -> Left name
    Just ty -> Right (Tuple name ty)

-- | Heuristic expression budget, not a bytecode-size proof. Flat operations
-- | count roughly once. A candidate must exceed this bound, not merely reach it.
maxChunkCost :: Int
maxChunkCost = 256

-- | Independent signature bound: Object/int each use one JVM parameter slot.
-- | Keep generated helpers well below the JVM's 255-slot method limit.
maxChunkParams :: Int
maxChunkParams = 64

nodeCost :: Array Int -> Int
nodeCost costs = 1 + sum costs

textCost :: String -> Int
textCost text = 1 + String.length text / 16

-- | Supplier-backed scopes cause javac to copy enclosing scopes repeatedly.
-- | Saturation avoids exponential costs/Int overflow; it does not cap tree size.
-- | A loop's own statement block uses nodeCost instead of this weight.
scopeCost :: Int -> Int
scopeCost cost = 4 * min (maxChunkCost + 1) cost

-- | Estimate the allocation and indexed copies introduced by closed-array groups.
filledArrayCost :: Int -> Int
filledArrayCost size = 1 + size * 8

-- | Fixed-width groups based on the most expensive item. A single oversized item
-- | forms a group of one; no element is reordered and no new captures are added.
arrayGroupSize :: Array Int -> Int
arrayGroupSize costs = max 1 (maxChunkCost / foldl max 1 costs)
