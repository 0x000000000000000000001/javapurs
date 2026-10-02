module Javapurs.Config (Config, OutputOptions, PipelineOptions, CodegenOptions, parseArgs) where

import Prelude

import Data.Array as Array
import Data.Maybe (fromMaybe)

type CodegenOptions =
  { typedRecords :: Boolean
  , loopInvariants :: Boolean
  , directCalls :: Boolean
  , intFunctions :: Boolean
  , ownership :: Boolean
  }

type PipelineOptions =
  { codegen :: CodegenOptions
  , chunkEnabled :: Boolean
  }

type OutputOptions =
  { directory :: String
  , mainModule :: String
  }

type Config =
  { inputDirectory :: String
  , output :: OutputOptions
  , pipeline :: PipelineOptions
  , rewriteLimit :: Int
  }

-- Preserve the CLI's permissive contract: unknown arguments are ignored, the
-- first --main wins, and a missing trailing value falls back to Main. Paths are
-- relative to the caller; no generic PBO CLI options are interpreted here.
parseArgs :: Array String -> Config
parseArgs args =
  { inputDirectory: "output"
  , output:
      { directory: "java_output"
      , mainModule: fromMaybe "Main" do
          index <- Array.findIndex (_ == "--main") args
          Array.index args (index + 1)
      }
  , pipeline:
      { codegen:
          { typedRecords: enabled "--records=maps"
          , loopInvariants: enabled "--loop-invariants=off"
          , directCalls: enabled "--direct-calls=off"
          , intFunctions: enabled "--int-functions=off"
          , ownership: enabled "--ownership=off"
          }
      , chunkEnabled: enabled "--no-chunk"
      }
  , rewriteLimit: 10000
  }
  where
  enabled flag = not (Array.elem flag args)
