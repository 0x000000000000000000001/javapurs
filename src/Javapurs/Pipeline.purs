module Javapurs.Pipeline (lowerModule) where

import Prelude

import Javapurs.Chunk (chunkFile)
import Javapurs.CodeGen (translateWithIntFunctions)
import Javapurs.Config (PipelineOptions)
import Javapurs.JavaAst (JavaFile)
import Javapurs.Rename (renameExpr)
import PureScript.Backend.Optimizer.Convert (BackendModule)

-- The production Java pipeline, after PBO. Rename must precede chunking:
-- extraction identifies free variables by their unique lexical names.
-- CodeGen itself owns its TCO/type analyses, direct calls and constructor reuse.
lowerModule :: PipelineOptions -> BackendModule -> JavaFile
lowerModule options backendModule =
  let
    translated = translateWithIntFunctions options.codegen backendModule
    renamed = translated { decls = map renameExpr translated.decls }
  in
    if options.chunkEnabled then chunkFile renamed else renamed
