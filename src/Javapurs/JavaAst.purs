module Javapurs.JavaAst where

import Prelude
import Data.Maybe (Maybe)
import Data.Tuple (Tuple)

data JavaExpr
  = JavaString String
  | JavaCall JavaExpr (Array JavaExpr)
  | JavaFunction JavaExpr
  | JavaLocal String
  | JavaAbs (Array String) JavaExpr
  | JavaNew String (Array JavaExpr)
  | JavaTernary JavaExpr JavaExpr JavaExpr
  | JavaThrow String
  | JavaRecord (Array (Tuple String JavaExpr))
  | JavaWhileTrue (Array String) JavaExpr
  | JavaContinue String (Array JavaExpr)
  | JavaMapGet JavaExpr String
  | JavaMapUpdate JavaExpr (Array (Tuple String JavaExpr))
  | JavaInstanceOf JavaExpr String
  | JavaPropertyAccess JavaExpr String String
  | JavaApply JavaExpr JavaExpr
  | JavaLet String JavaExpr JavaExpr
  | JavaLetRec (Array (Tuple String JavaExpr)) JavaExpr
  | JavaGlobalVar (Maybe String) String
  | JavaClassDecl String (Array String)
  | JavaRaw String
  | JavaAssign String JavaExpr
  | JavaBinaryOp String JavaExpr JavaExpr
  | JavaCast String JavaExpr

type JavaFile =
  { decls :: Array JavaExpr
  }
