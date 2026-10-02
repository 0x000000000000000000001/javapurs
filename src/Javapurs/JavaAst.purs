-- | JavaExpr is a mixed IR: values, statements, declarations and method selectors.
-- | Position contracts and lexical scopes are documented in docs/ast.md.
-- | The structural traversal below is exhaustive but deliberately scope-blind.
module Javapurs.JavaAst
  ( JavaExpr(..)
  , JavaParamType(..)
  , JavaRecordFieldType(..)
  , JavaRecordShape(..)
  , JavaFile
  , children
  , traverseChildren
  , mapChildren
  , rewriteBottomUp
  ) where

import Prelude

import Data.Const (Const(..), getConst)
import Data.Identity (Identity(..))
import Data.Maybe (Maybe)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))

-- A proven Int parameter or field stays primitive; every other value keeps the
-- generic Object ABI. The marker is only used where a declaration is emitted
-- (static workers and ADT classes); call sites keep using plain Java values.
data JavaParamType = ParamObject | ParamInt

derive instance eqJavaParamType :: Eq JavaParamType
derive instance ordJavaParamType :: Ord JavaParamType

data JavaExpr
  = JavaString String
  | JavaCall JavaExpr (Array JavaExpr)
  -- Selectors only belong in JavaCall's callee slot; they are not values.
  -- Their names are already escaped and never participate in local renaming.
  | JavaStaticMethodRef (Maybe String) String
  | JavaInstanceMethodRef JavaExpr String String
  | JavaFunction JavaExpr
  | JavaLocal String
  | JavaAbs (Array String) JavaExpr
  | JavaTypedAbs (Array (Tuple String JavaParamType)) JavaExpr
  | JavaIntAbs String JavaExpr
  | JavaNew String (Array JavaExpr)
  | JavaCtorSingleton String String
  | JavaTernary JavaExpr JavaExpr JavaExpr
  | JavaThrow String
  | JavaRecord (Array (Tuple String JavaExpr))
  | JavaTypedRecord JavaRecordShape (Array (Tuple String JavaExpr))
  | JavaTypedRecordGet JavaRecordShape JavaExpr String
  | JavaTypedRecordUpdate JavaRecordShape JavaExpr (Array (Tuple String JavaExpr))
  | JavaArray (Array JavaExpr)
  -- The loop identity is the name a `JavaContinue` targets. Nested loops may
  -- jump to an enclosing loop, so each loop must be able to recognize the
  -- continues that belong to it.
  | JavaWhileTrue String (Array String) (Array String) JavaExpr
  | JavaMemoizedLoop String (Array String) (Array String) (Array (Tuple String JavaExpr)) JavaExpr
  | JavaLoopInvariant String
  | JavaContinue String (Array JavaExpr)
  | JavaMapGet JavaExpr String
  | JavaMapUpdate JavaExpr (Array (Tuple String JavaExpr))
  | JavaInstanceOf JavaExpr String
  | JavaPropertyAccess JavaExpr String String
  | JavaApply JavaExpr JavaExpr
  | JavaIntApply JavaExpr JavaExpr
  | JavaLet String JavaExpr JavaExpr
  | JavaLetRec (Array (Tuple String JavaExpr)) JavaExpr
  | JavaGlobalVar (Maybe String) String -- Module/FFI field read, not a local.
  | JavaClassDecl String (Array (Tuple String JavaParamType)) Boolean
  | JavaRaw String -- Opaque escape hatch; see Javapurs.Raw and docs/ast.md.
  | JavaAssign String JavaExpr
  | JavaLazyAssign String JavaExpr
  | JavaStaticMethod String (Array (Tuple String JavaParamType)) JavaExpr
  | JavaLocalAssign String JavaExpr -- Nonrecursive declaration, not mutation.
  | JavaIntLocalAssign String JavaExpr
  | JavaBinaryOp String JavaExpr JavaExpr
  | JavaUnaryOp String JavaExpr
  | JavaArrayIndex JavaExpr JavaExpr
  | JavaArraySet JavaExpr JavaExpr JavaExpr
  | JavaCast String JavaExpr
  | JavaBlock (Array JavaExpr) JavaExpr
  -- Mutation statements used by ownership workers. The field write casts the
  -- value the same way a constructor parameter does, so a proven Int field can
  -- accept both a primitive and a boxed value.
  | JavaFieldSet JavaExpr String String JavaParamType JavaExpr
  | JavaLocalSet String JavaExpr
  | JavaIf JavaExpr (Array JavaExpr) (Array JavaExpr)

-- | Direct children in source order. Includes deferred bodies and initializers;
-- | this is neither a free-variable analysis nor a dynamic evaluation trace.
children :: JavaExpr -> Array JavaExpr
children expression = getConst (traverseChildren (\child -> Const [ child ]) expression)

-- | One layer only. Metadata (names, labels, field types, record shapes) is
-- | preserved. A visitor that knows about binders must intercept those nodes
-- | before using this traversal, as Rename does.
traverseChildren :: forall f. Applicative f => (JavaExpr -> f JavaExpr) -> JavaExpr -> f JavaExpr
traverseChildren visit expression = case expression of
  JavaString _ -> pure expression
  JavaCall fn args -> JavaCall <$> visit fn <*> traverse visit args
  JavaStaticMethodRef _ _ -> pure expression
  JavaInstanceMethodRef value className method -> (\value' -> JavaInstanceMethodRef value' className method) <$> visit value
  JavaFunction value -> JavaFunction <$> visit value
  JavaLocal _ -> pure expression
  JavaAbs args body -> JavaAbs args <$> visit body
  JavaTypedAbs args body -> JavaTypedAbs args <$> visit body
  JavaIntAbs arg body -> JavaIntAbs arg <$> visit body
  JavaNew name args -> JavaNew name <$> traverse visit args
  JavaCtorSingleton _ _ -> pure expression
  JavaTernary condition yes no -> JavaTernary <$> visit condition <*> visit yes <*> visit no
  JavaThrow _ -> pure expression
  JavaRecord fields -> JavaRecord <$> fieldsOf fields
  JavaTypedRecord shape fields -> JavaTypedRecord shape <$> fieldsOf fields
  JavaTypedRecordGet shape value label -> (\value' -> JavaTypedRecordGet shape value' label) <$> visit value
  JavaTypedRecordUpdate shape value fields -> JavaTypedRecordUpdate shape <$> visit value <*> fieldsOf fields
  JavaArray values -> JavaArray <$> traverse visit values
  JavaWhileTrue loopId args intParams body -> JavaWhileTrue loopId args intParams <$> visit body
  JavaMemoizedLoop loopId args intParams invariants body -> JavaMemoizedLoop loopId args intParams <$> fieldsOf invariants <*> visit body
  JavaLoopInvariant _ -> pure expression
  JavaContinue name args -> JavaContinue name <$> traverse visit args
  JavaMapGet value label -> (\value' -> JavaMapGet value' label) <$> visit value
  JavaMapUpdate value fields -> JavaMapUpdate <$> visit value <*> fieldsOf fields
  JavaInstanceOf value name -> (\value' -> JavaInstanceOf value' name) <$> visit value
  JavaPropertyAccess value name property -> (\value' -> JavaPropertyAccess value' name property) <$> visit value
  JavaApply fn arg -> JavaApply <$> visit fn <*> visit arg
  JavaIntApply fn arg -> JavaIntApply <$> visit fn <*> visit arg
  JavaLet name value body -> JavaLet name <$> visit value <*> visit body
  JavaLetRec bindings body -> JavaLetRec <$> fieldsOf bindings <*> visit body
  JavaGlobalVar _ _ -> pure expression
  JavaClassDecl _ _ _ -> pure expression
  JavaRaw _ -> pure expression
  JavaAssign name value -> JavaAssign name <$> visit value
  JavaLazyAssign name value -> JavaLazyAssign name <$> visit value
  JavaStaticMethod name args body -> JavaStaticMethod name args <$> visit body
  JavaLocalAssign name value -> JavaLocalAssign name <$> visit value
  JavaIntLocalAssign name value -> JavaIntLocalAssign name <$> visit value
  JavaBinaryOp operator left right -> JavaBinaryOp operator <$> visit left <*> visit right
  JavaUnaryOp operator value -> JavaUnaryOp operator <$> visit value
  JavaArrayIndex value index -> JavaArrayIndex <$> visit value <*> visit index
  JavaArraySet array index value -> JavaArraySet <$> visit array <*> visit index <*> visit value
  JavaCast name value -> JavaCast name <$> visit value
  JavaBlock statements value -> JavaBlock <$> traverse visit statements <*> visit value
  JavaFieldSet target className fieldName fieldType value ->
    JavaFieldSet <$> visit target <*> pure className <*> pure fieldName <*> pure fieldType <*> visit value
  JavaLocalSet name value -> JavaLocalSet name <$> visit value
  JavaIf condition thenStmts elseStmts -> JavaIf <$> visit condition <*> traverse visit thenStmts <*> traverse visit elseStmts
  where
  fieldsOf = traverse (\(Tuple name value) -> Tuple name <$> visit value)

mapChildren :: (JavaExpr -> JavaExpr) -> JavaExpr -> JavaExpr
mapChildren visit expression = case traverseChildren (Identity <<< visit) expression of
  Identity result -> result

-- | Rewrite each original node after its children. Newly introduced nodes are
-- | not revisited. Binding names and scopes remain the caller's responsibility.
rewriteBottomUp :: (JavaExpr -> JavaExpr) -> JavaExpr -> JavaExpr
rewriteBottomUp rewrite = go
  where
  go expression = rewrite (mapChildren go expression)

data JavaRecordFieldType = RecordInt | RecordObject | RecordNested

newtype JavaRecordShape = JavaRecordShape (Array (Tuple String JavaRecordFieldType))

derive instance eqJavaRecordFieldType :: Eq JavaRecordFieldType
derive instance eqJavaRecordShape :: Eq JavaRecordShape
derive instance ordJavaRecordFieldType :: Ord JavaRecordFieldType
derive instance ordJavaRecordShape :: Ord JavaRecordShape

type JavaFile =
  { decls :: Array JavaExpr
  , recordShapes :: Array JavaRecordShape
  }
