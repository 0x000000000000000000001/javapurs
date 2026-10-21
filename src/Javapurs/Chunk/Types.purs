-- | Shared state and result shapes for the chunking pass. Keeping these types
-- | separate lets value construction and pure helper planning depend on the
-- | state contract without depending on the recursive rebuild module.
module Javapurs.Chunk.Types
  ( ArrayGroupCall
  , Chunk
  , ChunkState
  , ChunkedStatement
  ) where

import Control.Monad.State (State)
import Javapurs.Chunk.Extraction (LocalTypes)
import Javapurs.JavaAst (JavaExpr)

type ChunkedStatement = { expr :: JavaExpr, cost :: Int }
type ArrayGroupCall = { offset :: Int, count :: Int, call :: JavaExpr }

type ChunkState =
  { counter :: Int
  , localCounter :: Int
  , helpers :: Array JavaExpr
  , locals :: LocalTypes
  }

type Chunk = State ChunkState
