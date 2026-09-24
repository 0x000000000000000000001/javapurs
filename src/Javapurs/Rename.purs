-- | Makes every Java local unique within its method.
-- |
-- | TAST levels are reused across sibling scopes and inlining can translate the
-- | same binding twice, but Java rejects one local hiding another. Declarations
-- | (let and let-rec binders, lambda parameters and local assignment statements)
-- | are renamed and their references follow. Scopes are restored when a block,
-- | lambda or let body ends, so references outside their scope keep their name.
module Javapurs.Rename where

import Prelude

import Control.Monad.State (State, gets, modify_, runState)
import Data.Array as Array
import Data.Array.NonEmpty as NonEmptyArray
import Data.Char as Char
import Data.Maybe (Maybe(..))
import Data.String as String
import Data.String.CodeUnits as StringCodeUnits
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..), fst)
import Javapurs.JavaAst (JavaExpr(..))

type RenameState = { counter :: Int, env :: Array (Tuple String String) }

renameExpr :: JavaExpr -> JavaExpr
renameExpr = renameWith []

-- | Renames with a starting environment, for the regression scripts that
-- | check how a given binding is rewritten.
renameWith :: Array (Tuple String String) -> JavaExpr -> JavaExpr
renameWith env expression = case runState (rename expression) { counter: 0, env } of
  Tuple result _ -> result

lookupName :: String -> Array (Tuple String String) -> String
lookupName name env = case Array.find (\(Tuple key _) -> key == name) env of
  Just (Tuple _ value) -> value
  Nothing -> name

localName :: String -> State RenameState String
localName name = do
  state <- gets identity
  modify_ \current -> current { counter = current.counter + 1 }
  pure (name <> "_i" <> show state.counter)

-- | Renames the given binders, runs the body with them in scope, and then
-- | restores the enclosing scope.
scoped :: Array String -> (Array String -> State RenameState JavaExpr) -> State RenameState JavaExpr
scoped names body = do
  outerEnv <- gets _.env
  renamedNames <- traverse localName names
  modify_ \state -> state { env = Array.zipWith Tuple names renamedNames <> outerEnv }
  result <- body renamedNames
  modify_ \state -> state { env = outerEnv }
  pure result

rename :: JavaExpr -> State RenameState JavaExpr
rename expression = case expression of
  JavaString str -> pure (JavaString str)
  JavaCall fn args -> JavaCall <$> rename fn <*> traverse rename args
  JavaApply fn arg -> JavaApply <$> rename fn <*> rename arg
  JavaIntApply fn arg -> JavaIntApply <$> rename fn <*> rename arg
  JavaFunction value -> JavaFunction <$> rename value
  JavaLocal name
    | String.take 8 name == "__final_" -> do
        renamed <- lookupCurrent (String.drop 8 name)
        pure (JavaLocal ("__final_" <> renamed))
    | otherwise -> JavaLocal <$> lookupCurrent name
  JavaAbs args body -> scoped args \renamed -> JavaAbs renamed <$> rename body
  JavaTypedAbs params body -> scoped (map fst params) \renamed ->
    JavaTypedAbs (Array.zipWith (\(Tuple _ ty) name -> Tuple name ty) params renamed) <$> rename body
  JavaIntAbs arg body -> scoped [ arg ] \renamed -> case renamed of
    [ name ] -> JavaIntAbs name <$> rename body
    _ -> pure expression
  JavaStaticMethod name args body -> scoped (map fst args) \renamed ->
    JavaStaticMethod name (Array.zipWith (\(Tuple _ ty) newName -> Tuple newName ty) args renamed) <$> rename body
  JavaNew className args -> JavaNew className <$> traverse rename args
  JavaCtorSingleton modName ctorName -> pure (JavaCtorSingleton modName ctorName)
  JavaTernary condition yes no -> JavaTernary <$> rename condition <*> rename yes <*> rename no
  JavaThrow msg -> pure (JavaThrow msg)
  JavaRecord fields -> JavaRecord <$> renameFields fields
  JavaTypedRecord shape fields -> JavaTypedRecord shape <$> renameFields fields
  JavaTypedRecordGet shape value prop -> (\value' -> JavaTypedRecordGet shape value' prop) <$> rename value
  JavaTypedRecordUpdate shape value updates -> JavaTypedRecordUpdate shape <$> rename value <*> renameFields updates
  JavaArray items -> JavaArray <$> traverse rename items
  JavaWhileTrue args intParams body -> do
    args' <- traverse lookupCurrent args
    intParams' <- traverse lookupCurrent intParams
    JavaWhileTrue args' intParams' <$> rename body
  JavaMemoizedLoop args intParams invariants body -> do
    args' <- traverse lookupCurrent args
    intParams' <- traverse lookupCurrent intParams
    outerEnv <- gets _.env
    renamedNames <- traverse (\(Tuple name _) -> localName name) invariants
    modify_ \state -> state { env = Array.zipWith (\entry name -> Tuple (fst entry) name) invariants renamedNames <> outerEnv }
    values <- traverse (\(Tuple (Tuple _ value) name) -> Tuple name <$> rename value) (Array.zip invariants renamedNames)
    body' <- rename body
    modify_ \state -> state { env = outerEnv }
    pure (JavaMemoizedLoop args' intParams' values body')
  JavaLoopInvariant name -> JavaLoopInvariant <$> lookupCurrent name
  JavaContinue ctx args -> JavaContinue <$> lookupCurrent ctx <*> traverse rename args
  JavaMapGet value prop -> (\value' -> JavaMapGet value' prop) <$> rename value
  JavaMapUpdate value updates -> JavaMapUpdate <$> rename value <*> renameFields updates
  JavaInstanceOf value className -> (\value' -> JavaInstanceOf value' className) <$> rename value
  JavaPropertyAccess value className prop -> (\value' -> JavaPropertyAccess value' className prop) <$> rename value
  JavaLet name value body -> do
    value' <- rename value
    scoped [ name ] \renamed -> case renamed of
      [ bound ] -> JavaLet bound value' <$> rename body
      _ -> pure expression
  JavaLetRec binds body -> do
    outerEnv <- gets _.env
    renamedNames <- traverse (\(Tuple name _) -> localName name) binds
    modify_ \state -> state { env = Array.zipWith (\(Tuple name _) newName -> Tuple name newName) binds renamedNames <> outerEnv }
    renamedBinds <- traverse (\(Tuple (Tuple _ value) name) -> Tuple name <$> rename value) (Array.zip binds renamedNames)
    body' <- rename body
    modify_ \state -> state { env = outerEnv }
    pure (JavaLetRec renamedBinds body')
  JavaGlobalVar modName name -> pure (JavaGlobalVar modName name)
  JavaClassDecl className fields mutable -> pure (JavaClassDecl className fields mutable)
  JavaRaw code -> do
    env <- gets _.env
    pure (JavaRaw (renameRaw env code))
  JavaAssign name value -> JavaAssign <$> lookupCurrent name <*> rename value
  JavaLazyAssign name value -> JavaLazyAssign <$> lookupCurrent name <*> rename value
  JavaBinaryOp op left right -> JavaBinaryOp op <$> rename left <*> rename right
  JavaUnaryOp op value -> JavaUnaryOp op <$> rename value
  JavaArrayIndex array index -> JavaArrayIndex <$> rename array <*> rename index
  JavaArraySet array index value -> JavaArraySet <$> rename array <*> rename index <*> rename value
  JavaCast ty value -> JavaCast ty <$> rename value
  JavaLocalAssign name value -> do
    renamed <- localName name
    modify_ \state -> state { env = Array.cons (Tuple name renamed) state.env }
    value' <- rename value
    pure (JavaLocalAssign renamed value')
  JavaIntLocalAssign name value -> do
    renamed <- localName name
    modify_ \state -> state { env = Array.cons (Tuple name renamed) state.env }
    value' <- rename value
    pure (JavaIntLocalAssign renamed value')
  JavaBlock stmts body -> do
    outerEnv <- gets _.env
    stmts' <- traverse rename stmts
    body' <- rename body
    modify_ \state -> state { env = outerEnv }
    pure (JavaBlock stmts' body')
  JavaFieldSet target className fieldName fieldType value ->
    JavaFieldSet <$> rename target <*> pure className <*> pure fieldName <*> pure fieldType <*> rename value
  JavaLocalSet name value -> do
    renamed <- lookupCurrent name
    JavaLocalSet renamed <$> rename value
  JavaIf condition thenStmts elseStmts -> do
    condition' <- rename condition
    outerEnv <- gets _.env
    thenStmts' <- traverse rename thenStmts
    modify_ \state -> state { env = outerEnv }
    elseStmts' <- traverse rename elseStmts
    modify_ \state -> state { env = outerEnv }
    pure (JavaIf condition' thenStmts' elseStmts')
  where
  lookupCurrent name = do
    env <- gets _.env
    pure (lookupName name env)

  renameFields fields = traverse (\(Tuple key value) -> Tuple key <$> rename value) fields

-- | Raw Java is opaque except for identifiers that name a renamed local, which
-- | the operator translations reference from generated text.
renameRaw :: Array (Tuple String String) -> String -> String
renameRaw env code =
  String.joinWith "" (map (renamePart <<< NonEmptyArray.toArray) (Array.groupBy sameKind (StringCodeUnits.toCharArray code)))
  where
  isIdentifierChar char =
    let code = Char.toCharCode char
    in (code >= 97 && code <= 122)
      || (code >= 65 && code <= 90)
      || (code >= 48 && code <= 57)
      || char == '_'
      || char == '$'
  sameKind left right = isIdentifierChar left && isIdentifierChar right
  renamePart chars = case Array.head chars of
    Just first | isIdentifierChar first -> lookupName (StringCodeUnits.fromCharArray chars) env
    _ -> StringCodeUnits.fromCharArray chars
