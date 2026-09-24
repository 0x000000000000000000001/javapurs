module Javapurs.JavaAst where

import Prelude (class Eq, class Ord)
import Data.Maybe (Maybe)
import Data.Tuple (Tuple)

-- A proven Int parameter or field stays primitive; every other value keeps the
-- generic Object ABI. The marker is only used where a declaration is emitted
-- (static workers and ADT classes); call sites keep using plain Java values.
data JavaParamType = ParamObject | ParamInt

derive instance eqJavaParamType :: Eq JavaParamType
derive instance ordJavaParamType :: Ord JavaParamType

data JavaExpr
  = JavaString String
  | JavaCall JavaExpr (Array JavaExpr)
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
  | JavaWhileTrue (Array String) (Array String) JavaExpr
  | JavaMemoizedLoop (Array String) (Array String) (Array (Tuple String JavaExpr)) JavaExpr
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
  | JavaGlobalVar (Maybe String) String
  | JavaClassDecl String (Array (Tuple String JavaParamType)) Boolean
  | JavaRaw String
  | JavaAssign String JavaExpr
  | JavaLazyAssign String JavaExpr
  | JavaStaticMethod String (Array (Tuple String JavaParamType)) JavaExpr
  | JavaLocalAssign String JavaExpr
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
