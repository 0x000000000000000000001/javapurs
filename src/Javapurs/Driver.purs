module Javapurs.Driver (compile) where

import Prelude

import Data.Array as Array
import Data.List as List
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Newtype (unwrap)
import Data.Set as Set
import Effect.Aff (Aff, throwError)
import Effect.Class (liftEffect)
import Effect.Console (log)
import Effect.Exception (error)
import Javapurs.Config (Config)
import Javapurs.Diagnostics (withContext)
import Javapurs.Emit (emitModule, emitRuntime)
import Javapurs.Ffi (describeForeign, loadForeign, renderForeign)
import Javapurs.Metrics as Metrics
import Javapurs.Output (Output)
import Javapurs.Output as Output
import Javapurs.Pipeline (lowerModule)
import PureScript.Backend.Optimizer.App (coreFnModulesFromOutput, loadDirectives)
import PureScript.Backend.Optimizer.Builder (buildModules)
import PureScript.Backend.Optimizer.Convert (BackendModule)
import PureScript.Backend.Optimizer.CoreFn (Ann, Bind(..), Binding(..), Ident(..), Module(..))
import PureScript.Backend.Optimizer.Semantics.Foreign (coreForeignSemantics)

-- Orchestration from an explicit configuration. The process arguments and the
-- outer timing/error exit boundary belong to Main and its Node launcher.
compile :: Config -> Aff Unit
compile config = do
  liftEffect $ Output.validatePaths config.inputDirectory config.output.directory
  liftEffect $ log "Loading corefn.json files..."
  modules <- Metrics.measure "load TAST + sort" \_ ->
    withContext ("load TAST from " <> config.inputDirectory) $
      coreFnModulesFromOutput config.inputDirectory
  liftEffect $ log $ "Successfully loaded " <> show (List.length modules) <> " modules."

  validateMain config (List.toUnfoldable modules)

  Output.withOutput config.output.directory \output -> do
    directives <- Metrics.measure "prepare" \_ -> do
      loaded <- loadDirectives
      emitRuntime output (not (List.null modules))
      pure loaded

    Metrics.measure "optimize + emit" \_ -> buildModules
      { directives
      , rewriteLimit: config.rewriteLimit
      , analyzeCustom: \_ _ -> Nothing
      , foreignSemantics: coreForeignSemantics
      , traceIdents: Set.empty
      , onPrepareModule: \_ module_ -> pure module_
      , onSkipModule: \_ _ -> pure Nothing
      , onCodegenModule: \_ source optimized _ -> compileModule config output source optimized
      } (List.toUnfoldable modules)

-- Re-exports alone do not emit a local field. Validate before creating output
-- so a typo cannot be confused with a successful library generation.
validateMain :: Config -> Array (Module Ann) -> Aff Unit
validateMain config modules = case config.output.mainModule of
  Nothing -> pure unit
  Just name -> case Array.find (\(Module source) -> unwrap source.name == name) modules of
    Nothing -> throwError $ error ("Entrypoint module " <> name <> " not found in " <> config.inputDirectory <> "; use --no-main for a library")
    Just (Module source) -> unless
      (Array.elem (Ident "main") source.exports &&
        (Map.member (Ident "main") source.foreign || Array.any hasMain source.decls)) $
      throwError $ error ("Entrypoint " <> name <> " must define and export a local main; use --no-main for a library")
  where
  hasMain (NonRec binding) = mainBinding binding
  hasMain (Rec bindings) = Array.any mainBinding bindings
  mainBinding (Binding _ ident _) = ident == Ident "main"

compileModule :: Config -> Output -> Module Ann -> BackendModule -> Aff Unit
compileModule config output (Module source) optimized =
  withContext ("compile module " <> unwrap source.name) do
    liftEffect $ log $ "Building module " <> unwrap source.name
    foreignSource <- loadForeign source.name source.path
    let emitted = Array.fromFoldable (Map.keys optimized.foreign)
    report <- describeForeign source.name source.path (Array.fromFoldable (Map.keys source.foreign)) emitted foreignSource
    liftEffect $ Output.recordForeign output report
    let
      javaFile = lowerModule config.pipeline optimized
      foreignMembers = renderForeign source.name emitted foreignSource
    emitModule config.output output source.name foreignMembers javaFile
