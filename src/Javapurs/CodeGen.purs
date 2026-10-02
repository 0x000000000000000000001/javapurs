module Javapurs.CodeGen
  ( translate, translateWithRecords, translateWithOptions
  , translateWithDirectCalls, translateWithIntFunctions
  , module Syntax
  ) where

import Prelude

import Data.Array as Array
import Data.Foldable (foldMap)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))
import Javapurs.CodeGen.Context (CodegenEnv, initialContext)
import Javapurs.CodeGen.Expr (translateLoop, translateValue)
import Javapurs.CodeGen.Syntax (extractUncurriedAbs) as Syntax
import Javapurs.Config (CodegenOptions)
import Javapurs.DirectCalls (directCalls)
import Javapurs.FunctionTypes (annotateFunctionTypes)
import Javapurs.JavaAst (JavaExpr(..), JavaFile)
import Javapurs.Naming (modulePrefix, safeCtorName, sanitizeName)
import Javapurs.Ownership (prepare)
import Javapurs.RecordShapes (collectRecordShapes)
import Javapurs.RecordTypes (annotateRecordTypes)
import Javapurs.Representation (paramKinds, parameterType)
import Javapurs.Reuse (reuseConstructors)
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr)
import PureScript.Backend.Optimizer.Codegen.Tco as Tco
import PureScript.Backend.Optimizer.Convert (BackendModule)
import PureScript.Backend.Optimizer.CoreFn (Ident(..), Qualified(..))

translate :: BackendModule -> JavaFile
translate = translateWithRecords true

translateWithRecords :: Boolean -> BackendModule -> JavaFile
translateWithRecords typedRecords = translateWithOptions { typedRecords, loopInvariants: true }

translateWithOptions :: { typedRecords :: Boolean, loopInvariants :: Boolean } -> BackendModule -> JavaFile
translateWithOptions { typedRecords, loopInvariants } =
  translateWithDirectCalls { typedRecords, loopInvariants, directCalls: true }

translateWithDirectCalls :: { typedRecords :: Boolean, loopInvariants :: Boolean, directCalls :: Boolean } -> BackendModule -> JavaFile
translateWithDirectCalls { typedRecords, loopInvariants, directCalls: enabled } =
  translateWithIntFunctions { typedRecords, loopInvariants, directCalls: enabled, intFunctions: true, ownership: true }

type AnalyzedGroup = { recursive :: Boolean, bindings :: Array (Tuple Ident TcoExpr) }

-- Module assembly owns analysis order and the post-translation passes. Expr
-- owns recursive translation; Context and Syntax document its boundaries.
translateWithIntFunctions :: CodegenOptions -> BackendModule -> JavaFile
translateWithIntFunctions options@{ typedRecords, loopInvariants, intFunctions } original =
  let
    ownership = if options.ownership then prepare original
      else { module: original, declarations: [], functions: Map.empty, mutableClasses: [], diagnostics: [] }
    mod = ownership.module
    moduleName = modulePrefix mod.name
    rawGroups = map (\group ->
      { recursive: group.recursive
      , bindings: map (\(Tuple name value) -> Tuple name (annotateRecordTypes (Tco.analyze [] value))) group.bindings
      }) mod.bindings
    rawBindings = Array.concatMap _.bindings rawGroups
    groups = if intFunctions then map (\group -> group
      { bindings = map (\(Tuple name value) -> Tuple name (annotateFunctionTypes mod.name rawBindings value)) group.bindings
      }) rawGroups else rawGroups
    bindings = Array.concatMap _.bindings groups
    boxedFunctions = Array.concatMap boxedArities groups
    translateGroup group =
      let env =
            { moduleName
            , sourceModule: mod.name
            , bindings
            , lazyBindings: if group.recursive then map (\(Tuple (Ident name) _) -> sanitizeName name) group.bindings else []
            , boxedFunctions
            , typedRecords
            , loopInvariants
            , intFunctions
            , ownedFunctions: ownership.functions
            , invariantLocals: []
            , invariantScope: ""
            }
      in map (translateTopLevel env group.recursive) group.bindings
    dataClasses = Array.concatMap (\decl -> map (\ctor ->
      let
        name = safeCtorName ctor.name
        -- Int field evidence selects storage; constructors keep the Object ABI.
        fields = Array.mapWithIndex (\index fieldType -> Tuple ("value" <> show index) (parameterType fieldType)) ctor.fields
      in JavaClassDecl name fields (Array.elem (moduleName <> "." <> name) ownership.mutableClasses)
      ) decl.constructors) mod.dataDecls
    file =
      { decls: dataClasses <> Array.concatMap translateGroup groups <> ownership.declarations
      , recordShapes: if typedRecords then Array.nub $ foldMap (\(Tuple _ value) -> collectRecordShapes value) bindings else []
      }
    rewritten = if options.directCalls then directCalls moduleName file else file
  in reuseConstructors moduleName rewritten

boxedArities :: AnalyzedGroup -> Array (Tuple String Int)
boxedArities group =
  if group.recursive then Array.mapMaybe (\(Tuple (Ident name) value) -> map
    (\abstraction -> Tuple (sanitizeName name) (Array.length abstraction.args)) (Syntax.extractUncurriedAbs value)) group.bindings
  else []

translateTopLevel :: CodegenEnv -> Boolean -> Tuple Ident TcoExpr -> JavaExpr
translateTopLevel env recursive (Tuple ident@(Ident name) expression) =
  let javaName = sanitizeName name
  in if recursive then
       case Syntax.extractUncurriedAbs expression of
         Just abstraction ->
           let
             ref = Tco.TcoTopLevel (Qualified (Just env.sourceModule) ident)
             body = translateLoop env initialContext ref [] javaName abstraction.args abstraction.body
           in JavaLazyAssign javaName (JavaTypedAbs (Array.zip abstraction.args (paramKinds expression abstraction.args)) body)
         Nothing -> JavaLazyAssign javaName (translateValue env initialContext expression)
     else JavaAssign javaName (translateValue env initialContext expression)
