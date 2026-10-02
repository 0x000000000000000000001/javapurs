module Javapurs.Driver (compile) where

import Prelude

import Data.Array as Array
import Data.List as List
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Newtype (unwrap)
import Data.Set as Set
import Effect.Aff (Aff)
import Effect.Class (liftEffect)
import Effect.Console (log)
import Javapurs.Config (Config)
import Javapurs.Diagnostics (withContext)
import Javapurs.Emit (emitModule, emitRuntime)
import Javapurs.Ffi (loadForeign, renderForeign)
import Javapurs.Metrics as Metrics
import Javapurs.Pipeline (lowerModule)
import PureScript.Backend.Optimizer.App (coreFnModulesFromOutput, loadDirectives)
import PureScript.Backend.Optimizer.Builder (buildModules)
import PureScript.Backend.Optimizer.Convert (BackendModule)
import PureScript.Backend.Optimizer.CoreFn (Ann, Module(..))
import PureScript.Backend.Optimizer.Semantics.Foreign (coreForeignSemantics)

-- Orchestration from an explicit configuration. The process arguments and the
-- outer timing/error exit boundary belong to Main and its Node launcher.
compile :: Config -> Aff Unit
compile config = do
  liftEffect $ log "Loading corefn.json files..."
  modules <- Metrics.measure "load TAST + sort" \_ ->
    withContext ("load TAST from " <> config.inputDirectory) $
      coreFnModulesFromOutput config.inputDirectory
  liftEffect $ log $ "Successfully loaded " <> show (List.length modules) <> " modules."

  directives <- Metrics.measure "prepare" \_ -> do
    loaded <- loadDirectives
    emitRuntime config.output.directory (not (List.null modules))
    pure loaded

  Metrics.measure "optimize + emit" \_ -> buildModules
    { directives
    , rewriteLimit: config.rewriteLimit
    , analyzeCustom: \_ _ -> Nothing
    , foreignSemantics: coreForeignSemantics
    , traceIdents: Set.empty
    , onPrepareModule: \_ module_ -> pure module_
    , onSkipModule: \_ _ -> pure Nothing
    , onCodegenModule: \_ source optimized _ -> compileModule config source optimized
    } (List.toUnfoldable modules)

compileModule :: Config -> Module Ann -> BackendModule -> Aff Unit
compileModule config (Module source) optimized =
  withContext ("compile module " <> unwrap source.name) do
    liftEffect $ log $ "Building module " <> unwrap source.name
    foreignSource <- loadForeign source.name source.path
    let
      javaFile = lowerModule config.pipeline optimized
      foreignMembers = renderForeign source.name (Array.fromFoldable (Map.keys optimized.foreign)) foreignSource
    emitModule config.output source.name foreignMembers javaFile
