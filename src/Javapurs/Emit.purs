module Javapurs.Emit (emitRuntime, emitModule) where

import Prelude

import Data.Foldable (for_)
import Data.Newtype (unwrap)
import Data.String as String
import Effect.Aff (Aff)
import Javapurs.Config (OutputOptions)
import Javapurs.Diagnostics (withContext)
import Javapurs.JavaAst (JavaFile)
import Javapurs.Naming (modulePrefix)
import Javapurs.Printer (printExpr)
import Javapurs.RecordPrinter (printRecordShape)
import Javapurs.RecordShapes (recordClassName)
import Javapurs.Runtime as Runtime
import Node.Encoding (Encoding(..))
import Node.FS.Aff as FS
import PureScript.Backend.Optimizer.CoreFn (ModuleName)

-- Shared sources are written once during preparation. Preserve the empty-input
-- inventory: __IntFn is unconditional; TcoLoop is only needed with modules.
emitRuntime :: String -> Boolean -> Aff Unit
emitRuntime directory hasModules = do
  writeJava directory "__IntFn.java" Runtime.intFunctionSource
  when hasModules $ writeJava directory "TcoLoop.java" Runtime.tcoLoopSource

-- The caller owns the directory lifecycle. This emitter neither creates it nor
-- removes stale files. Selecting --main only controls the launcher emission.
emitModule :: OutputOptions -> ModuleName -> String -> JavaFile -> Aff Unit
emitModule options moduleName foreignMembers file = do
  let
    className = modulePrefix moduleName
    classSource =
      "public class " <> className <> " {\n" <>
      foreignMembers <>
      String.joinWith "\n" (map printExpr file.decls) <>
      "\n}\n"
  writeJava options.directory (className <> ".java") classSource
  for_ file.recordShapes \shape ->
    writeJava options.directory (recordClassName shape <> ".java") (printRecordShape shape)
  when (unwrap moduleName == options.mainModule) $
    writeJava options.directory "MainRun.java" (Runtime.mainRunSource className)

writeJava :: String -> String -> String -> Aff Unit
writeJava directory fileName source =
  let path = directory <> "/" <> fileName
  in withContext ("write Java " <> path) $ FS.writeTextFile UTF8 path source
