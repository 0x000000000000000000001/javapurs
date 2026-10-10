module Javapurs.Config (Command(..), Config, OutputOptions, PipelineOptions, CodegenOptions, parseArgs, help) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import Data.String as String
import Data.String.CodeUnits as CU
import Data.String.Pattern (Pattern(..))

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
  , mainModule :: Maybe String
  }

type Config =
  { inputDirectory :: String
  , output :: OutputOptions
  , pipeline :: PipelineOptions
  , rewriteLimit :: Int
  }

data Command = Help | Compile Config

defaultConfig :: Config
defaultConfig =
  { inputDirectory: "output"
  , output:
      { directory: "output/java"
      , mainModule: Just "Main"
      }
  , pipeline:
      { codegen:
          { typedRecords: true
          , loopInvariants: true
          , directCalls: true
          , intFunctions: true
          , ownership: true
          }
      , chunkEnabled: true
      }
  , rewriteLimit: 10000
  }

type ParseState = { config :: Config, seen :: Array String, help :: Boolean }

-- argv here contains only application arguments. Spago 1.x appends --output
-- for the CoreFn directory; Java destinations have their own --java-output.
parseArgs :: Array String -> Either String Command
parseArgs args = do
  result <- go { config: defaultConfig, seen: [], help: false } args
  let config = if Array.elem "--java-output" result.seen then result.config
        else result.config { output = result.config.output { directory = result.config.inputDirectory <> "/java" } }
  pure if result.help then Help else Compile config
  where
  go :: ParseState -> Array String -> Either String ParseState
  go state remaining = case Array.uncons remaining of
    Nothing -> Right state
    Just { head: arg, tail } -> case arg of
      "--help" -> switch arg state tail (state { help = true })
      "--no-main" -> switch "--main" state tail (state { config = state.config { output = state.config.output { mainModule = Nothing } } })
      "--no-chunk" -> switch arg state tail (state { config = state.config { pipeline = state.config.pipeline { chunkEnabled = false } } })
      "--records=maps" -> codegen arg state tail (state.config.pipeline.codegen { typedRecords = false })
      "--loop-invariants=off" -> codegen arg state tail (state.config.pipeline.codegen { loopInvariants = false })
      "--direct-calls=off" -> codegen arg state tail (state.config.pipeline.codegen { directCalls = false })
      "--int-functions=off" -> codegen arg state tail (state.config.pipeline.codegen { intFunctions = false })
      "--ownership=off" -> codegen arg state tail (state.config.pipeline.codegen { ownership = false })
      _ -> do
        let
          separator = String.indexOf (Pattern "=") arg
          name = case separator of
            Nothing -> arg
            Just index -> CU.take index arg
        if not (Array.elem name [ "--main", "--input", "--output", "--java-output" ]) then
          Left ("Unknown argument: " <> arg)
        else case separator of
          Just index -> value name (CU.drop (index + 1) arg) state tail
          Nothing -> case Array.uncons tail of
            Nothing -> Left ("Missing value for " <> name)
            Just next -> value name next.head state next.tail

  switch key before remaining after =
    if Array.elem key before.seen then Left ("Repeated or conflicting option: " <> key)
    else go (after { seen = Array.snoc before.seen key }) remaining

  codegen key state remaining options =
    switch key state remaining (state { config = state.config { pipeline = state.config.pipeline { codegen = options } } })

  value name text state remaining =
    if text == "" || String.indexOf (Pattern "-") text == Just 0 then Left ("Missing or invalid value for " <> name)
    else case name of
      "--main" -> switch name state remaining (state { config = state.config { output = state.config.output { mainModule = Just text } } })
      "--java-output" -> switch name state remaining (state { config = state.config { output = state.config.output { directory = text } } })
      _ -> switch "--input" state remaining (state { config = state.config { inputDirectory = text } })

help :: String
help = """
Usage: javapurs [options]

  --help                   Show this help without reading inputs or writing files.
  --input DIR              Read enriched CoreFn/TAST from DIR (default: output).
  --output DIR             Alias of --input, supplied by Spago's output option.
  --java-output DIR        Write Java and its manifest to DIR (default: <input>/java).
  --main MODULE            Select a module with a local exported main (default: Main).
  --no-main                Generate a library without MainRun.java; permits empty input.
  --records=maps           Use Map records instead of typed records.
  --loop-invariants=off    Disable loop-invariant caching.
  --direct-calls=off       Disable direct static calls.
  --int-functions=off      Disable specialized Int functions.
  --ownership=off          Disable consuming workers.
  --no-chunk               Disable extraction into chunk helpers.

Value options accept --name VALUE or --name=VALUE. Paths are relative to the
caller. Options may be supplied once; --main and --no-main are exclusive.
Exit codes: 0 success/help, 2 argument errors, 1 compilation or I/O failure.
"""
