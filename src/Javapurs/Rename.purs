-- | Make local bindings unique before chunking. Each lexical scope restores
-- | its environment, but never the freshness counter: sibling Java scopes and
-- | inlined copies cannot accidentally share a generated local name.
module Javapurs.Rename (renameExpr, renameWith) where

import Prelude

import Control.Monad.State (State, gets, modify_, runState)
import Data.Array as Array
import Data.Maybe (Maybe(..))
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..), fst)
import Javapurs.JavaAst (JavaExpr(..), traverseChildren)
import Javapurs.Naming (loopSnapshotName, renamedLocal, snapshotBaseName)
import Javapurs.Raw (renameIdentifiers)

type RenameState = { counter :: Int, env :: Array (Tuple String String) }
type Rename = State RenameState

renameExpr :: JavaExpr -> JavaExpr
renameExpr = renameWith []

-- | A starting lexical environment is useful for isolated AST consumers.
-- | It never rewrites module fields, method names, class names or field labels.
renameWith :: Array (Tuple String String) -> JavaExpr -> JavaExpr
renameWith env expression = case runState (rename expression) { counter: 0, env } of
  Tuple result _ -> result

lookupName :: String -> Array (Tuple String String) -> String
lookupName name env = case Array.find (\(Tuple key _) -> key == name) env of
  Just (Tuple _ value) -> value
  Nothing -> name

lookupCurrent :: String -> Rename String
lookupCurrent name = gets (lookupName name <<< _.env)

freshLocal :: String -> Rename String
freshLocal name = do
  counter <- gets _.counter
  modify_ \state -> state { counter = state.counter + 1 }
  pure (renamedLocal name counter)

-- Restore only the lexical environment, including between sister branches.
inScope :: forall a. Rename a -> Rename a
inScope action = do
  outer <- gets _.env
  result <- action
  modify_ \state -> state { env = outer }
  pure result

bindNames :: Array String -> Rename (Array String)
bindNames names = do
  renamed <- traverse freshLocal names
  modify_ \state -> state { env = Array.zipWith Tuple names renamed <> state.env }
  pure renamed

scoped :: Array String -> (Array String -> Rename JavaExpr) -> Rename JavaExpr
scoped names body = inScope (bindNames names >>= body)

-- All members of a recursive/cache group are visible in every initializer.
renameGroup :: Array (Tuple String JavaExpr) -> Rename (Array (Tuple String JavaExpr))
renameGroup bindings = do
  names <- bindNames (map fst bindings)
  traverse (\(Tuple (Tuple _ value) name) -> Tuple name <$> rename value) (Array.zip bindings names)

-- A statement declaration is nonrecursive: its initializer sees the previous
-- environment. Reserve the suffix first to keep traversal-order naming stable.
declareLocal :: (String -> JavaExpr -> JavaExpr) -> String -> JavaExpr -> Rename JavaExpr
declareLocal constructor name value = do
  renamed <- freshLocal name
  value' <- rename value
  modify_ \state -> state { env = Array.cons (Tuple name renamed) state.env }
  pure (constructor renamed value')

rename :: JavaExpr -> Rename JavaExpr
rename expression = case expression of
  JavaLocal name -> case snapshotBaseName name of
    Just base -> JavaLocal <<< loopSnapshotName <$> lookupCurrent base
    Nothing -> JavaLocal <$> lookupCurrent name
  JavaAbs args body -> scoped args \names -> JavaAbs names <$> rename body
  JavaTypedAbs params body -> scoped (map fst params) \names ->
    JavaTypedAbs (Array.zipWith (\(Tuple _ ty) name -> Tuple name ty) params names) <$> rename body
  JavaIntAbs arg body -> scoped [ arg ] \names -> case names of
    [ name ] -> JavaIntAbs name <$> rename body
    _ -> pure expression
  JavaStaticMethod name params body -> scoped (map fst params) \names ->
    JavaStaticMethod name (Array.zipWith (\(Tuple _ ty) renamed -> Tuple renamed ty) params names) <$> rename body
  JavaLet name value body -> do
    value' <- rename value
    scoped [ name ] \names -> case names of
      [ bound ] -> JavaLet bound value' <$> rename body
      _ -> pure expression
  JavaLetRec bindings body -> inScope do
    bindings' <- renameGroup bindings
    JavaLetRec bindings' <$> rename body
  JavaLocalAssign name value -> declareLocal JavaLocalAssign name value
  JavaIntLocalAssign name value -> declareLocal JavaIntLocalAssign name value
  JavaLocalSet name value -> JavaLocalSet <$> lookupCurrent name <*> rename value
  JavaBlock statements body -> inScope $
    JavaBlock <$> traverse rename statements <*> rename body
  JavaIf condition thenStatements elseStatements ->
    JavaIf <$> rename condition <*> inScope (traverse rename thenStatements) <*> inScope (traverse rename elseStatements)
  JavaWhileTrue loopId args intParams body ->
    JavaWhileTrue <$> lookupCurrent loopId <*> traverse lookupCurrent args <*> traverse lookupCurrent intParams <*> inScope (rename body)
  JavaMemoizedLoop loopId args intParams invariants body -> do
    loopId' <- lookupCurrent loopId
    args' <- traverse lookupCurrent args
    intParams' <- traverse lookupCurrent intParams
    inScope $ JavaMemoizedLoop loopId' args' intParams' <$> renameGroup invariants <*> rename body
  JavaLoopInvariant name -> JavaLoopInvariant <$> lookupCurrent name
  JavaContinue target args -> JavaContinue <$> lookupCurrent target <*> traverse rename args
  JavaRaw code -> do
    env <- gets _.env
    pure (JavaRaw (renameIdentifiers (flip lookupName env) code))
  -- Only nodes above own lexical behavior. The common traversal preserves
  -- declaration/selector names, field labels and types while visiting values.
  _ -> traverseChildren rename expression
