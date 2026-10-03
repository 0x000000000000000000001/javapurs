module Javapurs.Emit (emitRuntime, emitModule) where

import Prelude

import Data.Foldable (for_)
import Data.Maybe (Maybe(..))
import Data.Newtype (unwrap)
import Data.String as String
import Effect.Aff (Aff)
import Effect.Class (liftEffect)
import Javapurs.Config (OutputOptions)
import Javapurs.Diagnostics (withContext)
import Javapurs.JavaAst (JavaFile)
import Javapurs.Naming (modulePrefix)
import Javapurs.Output (Output)
import Javapurs.Output as Output
import Javapurs.Printer (printExpr)
import Javapurs.RecordPrinter (printRecordShape)
import Javapurs.RecordShapes (recordClassName)
import Javapurs.Runtime as Runtime
import PureScript.Backend.Optimizer.CoreFn (ModuleName)

-- Shared sources are written once during preparation. Preserve the empty-input
-- inventory: __IntFn is unconditional; TcoLoop is only needed with modules.
emitRuntime :: Output -> Boolean -> Aff Unit
emitRuntime output hasModules = do
  writeJava output "__IntFn.java" Runtime.intFunctionSource
  when hasModules $ writeJava output "TcoLoop.java" Runtime.tcoLoopSource

-- Output owns the filesystem lifecycle. Emit assembles the same Java text and
-- records each staged file; the whole generation is published by the driver.
emitModule :: OutputOptions -> Output -> ModuleName -> String -> JavaFile -> Aff Unit
emitModule options output moduleName foreignMembers file = do
  let
    className = modulePrefix moduleName
    classSource =
      "public class " <> className <> " {\n" <>
      foreignMembers <>
      String.joinWith "\n" (map printExpr file.decls) <>
      "\n}\n"
  writeJava output (className <> ".java") classSource
  for_ file.recordShapes \shape ->
    writeJava output (recordClassName shape <> ".java") (printRecordShape shape)
  when (Just (unwrap moduleName) == options.mainModule) $
    writeJava output "MainRun.java" (Runtime.mainRunSource className)

writeJava :: Output -> String -> String -> Aff Unit
writeJava output fileName source =
  withContext ("stage Java " <> fileName) $ liftEffect $ Output.writeJava output fileName source
