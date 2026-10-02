-- | Lexical dependencies and barriers to moving a subtree into an Object helper.
-- | Run after Rename. This analysis does not decide cost, types or helper names.
module Javapurs.Chunk.Captures
  ( Captures
  , CaptureBarrier(..)
  , analyzeCaptures
  , noCaptures
  , localCapture
  , rawCaptures
  , combineCaptures
  , withoutBindings
  , isClosed
  ) where

import Prelude

import Data.Either (Either(..))
import Data.Foldable (foldl, foldM)
import Data.Set (Set)
import Data.Set as Set
import Data.Traversable (traverse)
import Data.Tuple (fst, snd)
import Javapurs.JavaAst (JavaExpr(..), children)
import Javapurs.Naming (loopSnapshotName, loopStorageName, loopNextName)
import Javapurs.Raw (isClosedValue)

-- | A known set may be empty without being pure: a closed call can have effects.
-- | Left prevents extraction, even when other children have known dependencies.
type Captures = Either CaptureBarrier (Set String)

data CaptureBarrier
  = OpaqueJava
  | LoopJump
  | InvariantCache
  | OuterLocalWrite String
  | LoopStatement
  | ModuleDeclaration
  | UnsupportedExpression

noCaptures :: Captures
noCaptures = Right Set.empty

localCapture :: String -> Captures
localCapture = Right <<< Set.singleton

rawCaptures :: String -> Captures
rawCaptures code = if isClosedValue code then noCaptures else Left OpaqueJava

-- | Retain the first barrier in source order, or union all known dependencies.
combineCaptures :: Array Captures -> Captures
combineCaptures = foldl combine noCaptures
  where
  combine acc next = do
    left <- acc
    right <- next
    pure (Set.union left right)

withoutBindings :: Array String -> Captures -> Captures
withoutBindings names = map \free -> foldl (flip Set.delete) free names

isClosed :: Captures -> Boolean
isClosed = case _ of
  Right names -> Set.isEmpty names
  Left _ -> false

analyzeCaptures :: JavaExpr -> Captures
analyzeCaptures = freeOf Set.empty

-- | Bound names are internal to this candidate. An outer local write cannot
-- | become a write to a copied parameter; mutations through arrays/objects keep
-- | their identity when the reference itself is passed to the helper.
freeOf :: Set String -> JavaExpr -> Captures
freeOf boundNames expression = case expression of
  JavaLocal name -> Right (Set.difference (Set.singleton name) boundNames)
  JavaLoopInvariant _ -> Left InvariantCache
  JavaString _ -> noCaptures
  JavaRaw code -> rawCaptures code
  JavaGlobalVar _ _ -> noCaptures
  JavaCtorSingleton _ _ -> noCaptures
  JavaThrow _ -> noCaptures
  JavaClassDecl _ _ _ -> noCaptures
  JavaAbs params body -> freeOf (insertAll params boundNames) body
  JavaTypedAbs params body -> freeOf (insertAll (map fst params) boundNames) body
  JavaIntAbs arg body -> freeOf (Set.insert arg boundNames) body
  JavaStaticMethod _ params body -> freeOf (insertAll (map fst params) boundNames) body
  JavaLet name value body -> do
    valueFree <- freeOf boundNames value
    bodyFree <- freeOf (Set.insert name boundNames) body
    pure (Set.union valueFree bodyFree)
  JavaLetRec bindings body -> do
    let bound = insertAll (map fst bindings) boundNames
    bindingFrees <- traverse (freeOf bound <<< snd) bindings
    bodyFree <- freeOf bound body
    pure (Set.unions (bindingFrees <> [ bodyFree ]))
  JavaBlock statements body -> do
    scope <- threadStatements boundNames statements
    bodyFree <- freeOf scope.bound body
    pure (Set.union scope.reads bodyFree)
  JavaIf condition thenStatements elseStatements -> do
    conditionFree <- freeOf boundNames condition
    thenFree <- statementListFree boundNames thenStatements
    elseFree <- statementListFree boundNames elseStatements
    pure (Set.unions [ conditionFree, thenFree, elseFree ])
  JavaWhileTrue loopId args intParams body ->
    let
      reads = Set.fromFoldable args <> Set.fromFoldable intParams
      bound = Set.insert loopId (Set.union (loopInternals args intParams) boundNames)
    in combineCaptures [ Right (Set.difference reads boundNames), freeOf bound body ]
  JavaMemoizedLoop loopId args intParams invariants body -> do
    let
      reads = Set.fromFoldable args <> Set.fromFoldable intParams
      bound = insertAll (map fst invariants) (Set.insert loopId (Set.union (loopInternals args intParams) boundNames))
    invariantFrees <- traverse (freeOf boundNames <<< snd) invariants
    bodyFree <- freeOf bound body
    pure (Set.unions [ Set.difference reads boundNames, bodyFree, Set.unions invariantFrees ])
  JavaContinue _ _ -> Left LoopJump
  JavaLocalAssign _ value -> freeOf boundNames value
  JavaIntLocalAssign _ value -> freeOf boundNames value
  JavaLocalSet name value
    | Set.member name boundNames -> freeOf boundNames value
    | otherwise -> Left (OuterLocalWrite name)
  JavaArraySet array index value -> combineCaptures (map (freeOf boundNames) [ array, index, value ])
  JavaFieldSet target _ _ _ value -> combineCaptures (map (freeOf boundNames) [ target, value ])
  JavaAssign _ _ -> Left ModuleDeclaration
  JavaLazyAssign _ _ -> Left ModuleDeclaration
  _ -> combineCaptures (map (freeOf boundNames) (children expression))

type StatementScope = { bound :: Set String, reads :: Set String }

-- | Only declarations extend the following statements' scope. Blocks and both
-- | branches analyze their own scopes through freeOf and cannot leak bindings.
threadStatements :: Set String -> Array JavaExpr -> Either CaptureBarrier StatementScope
threadStatements boundNames = foldM step { bound: boundNames, reads: Set.empty }
  where
  step scope statement = case statement of
    JavaLocalAssign name value -> declare scope name value
    JavaIntLocalAssign name value -> declare scope name value
    JavaRaw _ -> Left OpaqueJava
    JavaWhileTrue _ _ _ _ -> Left LoopStatement
    JavaMemoizedLoop _ _ _ _ _ -> Left LoopStatement
    _ -> do
      reads <- freeOf scope.bound statement
      pure { bound: scope.bound, reads: Set.union scope.reads reads }

  declare scope name value = do
    reads <- freeOf scope.bound value
    pure { bound: Set.insert name scope.bound, reads: Set.union scope.reads reads }

statementListFree :: Set String -> Array JavaExpr -> Captures
statementListFree boundNames statements = _.reads <$> threadStatements boundNames statements

loopInternals :: Array String -> Array String -> Set String
loopInternals args intParams =
  let names = args <> intParams
  in Set.fromFoldable (map loopStorageName names <> map loopSnapshotName names <> map loopNextName names)

insertAll :: Array String -> Set String -> Set String
insertAll names set = foldl (flip Set.insert) set names
