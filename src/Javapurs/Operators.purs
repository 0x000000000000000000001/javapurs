module Javapurs.Operators (translateOperator1, translateOperator2) where

import Prelude

import Data.Maybe (Maybe(..))
import Javapurs.Naming (modulePrefix)
import Data.String as String
import Javapurs.JavaAst (JavaExpr(..))
import PureScript.Backend.Optimizer.CoreFn (Ident(..), Qualified(..))
import PureScript.Backend.Optimizer.Syntax (BackendOperator1(..), BackendOperator2(..), BackendOperatorNum(..), BackendOperatorOrd(..))

translateOperator1 :: String -> BackendOperator1 -> JavaExpr -> JavaExpr
translateOperator1 modName op e = case op of
  OpBooleanNot -> JavaUnaryOp "!" (JavaCast "Boolean" e)
  OpIntBitNot -> JavaUnaryOp "~" (JavaCast "int" e)
  OpIntNegate -> JavaUnaryOp "-" (JavaCast "int" e)
  OpNumberNegate -> JavaUnaryOp "-" (JavaCast "Double" e)
  OpArrayLength -> JavaPropertyAccess e "Object[]" "length"
  OpIsTag (Qualified mbMod (Ident tag)) ->
    let
      safeTag = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_") tag
      modPart = case mbMod of
        Just mn -> modulePrefix mn
        Nothing -> modName
      javaClass = modPart <> "." <> safeTag
    in
      JavaInstanceOf e javaClass

translateOperator2 :: String -> BackendOperator2 -> JavaExpr -> JavaExpr -> JavaExpr
translateOperator2 _ op e1 e2 = case op of
  OpBooleanAnd -> JavaBinaryOp "&&" (JavaCast "Boolean" e1) (JavaCast "Boolean" e2)
  OpBooleanOr -> JavaBinaryOp "||" (JavaCast "Boolean" e1) (JavaCast "Boolean" e2)
  OpBooleanOrd OpEq -> objectEquals e1 e2
  OpBooleanOrd OpNotEq -> JavaUnaryOp "!" (objectEquals e1 e2)
  OpBooleanOrd OpGt -> JavaBinaryOp "&&" (JavaCast "Boolean" e1) (JavaUnaryOp "!" (JavaCast "Boolean" e2))
  OpBooleanOrd OpGte -> JavaBinaryOp "||" (JavaCast "Boolean" e1) (JavaUnaryOp "!" (JavaCast "Boolean" e2))
  OpBooleanOrd OpLt -> JavaBinaryOp "&&" (JavaUnaryOp "!" (JavaCast "Boolean" e1)) (JavaCast "Boolean" e2)
  OpBooleanOrd OpLte -> JavaBinaryOp "||" (JavaUnaryOp "!" (JavaCast "Boolean" e1)) (JavaCast "Boolean" e2)
  OpCharOrd OpEq -> objectEquals e1 e2
  OpCharOrd OpNotEq -> JavaUnaryOp "!" (objectEquals e1 e2)
  OpCharOrd OpGt -> JavaBinaryOp ">" (JavaCast "Character" e1) (JavaCast "Character" e2)
  OpCharOrd OpGte -> JavaBinaryOp ">=" (JavaCast "Character" e1) (JavaCast "Character" e2)
  OpCharOrd OpLt -> JavaBinaryOp "<" (JavaCast "Character" e1) (JavaCast "Character" e2)
  OpCharOrd OpLte -> JavaBinaryOp "<=" (JavaCast "Character" e1) (JavaCast "Character" e2)
  OpIntBitAnd -> JavaBinaryOp "&" (JavaCast "int" e1) (JavaCast "int" e2)
  OpIntBitOr -> JavaBinaryOp "|" (JavaCast "int" e1) (JavaCast "int" e2)
  OpIntBitShiftLeft -> JavaBinaryOp "<<" (JavaCast "int" e1) (JavaCast "int" e2)
  OpIntBitShiftRight -> JavaBinaryOp ">>" (JavaCast "int" e1) (JavaCast "int" e2)
  OpIntBitXor -> JavaBinaryOp "^" (JavaCast "int" e1) (JavaCast "int" e2)
  OpIntBitZeroFillShiftRight -> JavaBinaryOp ">>>" (JavaCast "int" e1) (JavaCast "int" e2)
  OpIntNum OpAdd -> JavaBinaryOp "+" (JavaCast "int" e1) (JavaCast "int" e2)
  OpIntNum OpSubtract -> JavaBinaryOp "-" (JavaCast "int" e1) (JavaCast "int" e2)
  OpIntNum OpMultiply -> JavaBinaryOp "*" (JavaCast "int" e1) (JavaCast "int" e2)
  OpIntNum OpDivide ->
    -- EuclideanRing intDiv: floor towards negative infinity for a positive
    -- divisor, mirrored for a negative one, and a zero divisor returns zero
    -- instead of throwing. The negation stays in double precision so that
    -- Int.MIN_VALUE remains a usable divisor.
    let
      left = JavaCast "Integer" (JavaLocal "__div_l")
      right = JavaCast "Integer" (JavaLocal "__div_r")
      quotient divisor = JavaCast "int" (mathCall "floor" [ JavaBinaryOp "/" (JavaCast "double" left) divisor ])
    in JavaBlock
      [ JavaLocalAssign "__div_l" e1, JavaLocalAssign "__div_r" e2 ]
      (JavaTernary (JavaBinaryOp "==" right (JavaRaw "0")) (JavaRaw "0")
        (JavaTernary (JavaBinaryOp ">" right (JavaRaw "0"))
          (quotient right) (JavaUnaryOp "-" (quotient (JavaUnaryOp "-" (JavaCast "double" right))))))
  OpIntNum OpMod ->
    let
      left = JavaCast "Integer" (JavaLocal "__mod_l")
      right = JavaCast "Integer" (JavaLocal "__mod_r")
    in JavaBlock
      [ JavaLocalAssign "__mod_l" e1, JavaLocalAssign "__mod_r" e2 ]
      -- Widen before abs so that MIN_VALUE remains a positive divisor.
      (JavaTernary (JavaBinaryOp "==" right (JavaRaw "0")) (JavaRaw "0")
        (JavaCast "int" (mathCall "floorMod" [ JavaCast "long" left, mathCall "abs" [ JavaCast "long" right ] ])))
  OpIntOrd OpEq -> JavaBinaryOp "==" (JavaCast "int" e1) (JavaCast "int" e2)
  OpIntOrd OpNotEq -> JavaBinaryOp "!=" (JavaCast "int" e1) (JavaCast "int" e2)
  OpIntOrd OpGt -> JavaBinaryOp ">" (JavaCast "int" e1) (JavaCast "int" e2)
  OpIntOrd OpGte -> JavaBinaryOp ">=" (JavaCast "int" e1) (JavaCast "int" e2)
  OpIntOrd OpLt -> JavaBinaryOp "<" (JavaCast "int" e1) (JavaCast "int" e2)
  OpIntOrd OpLte -> JavaBinaryOp "<=" (JavaCast "int" e1) (JavaCast "int" e2)
  OpNumberNum OpAdd -> JavaBinaryOp "+" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpNumberNum OpSubtract -> JavaBinaryOp "-" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpNumberNum OpMultiply -> JavaBinaryOp "*" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpNumberNum OpDivide -> JavaBinaryOp "/" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpNumberNum OpMod ->
    -- EuclideanRing Number always returns zero, after evaluating both operands.
    JavaBlock [ JavaLocalAssign "__mod_l" e1, JavaLocalAssign "__mod_r" e2 ] (JavaRaw "0.0")
  OpNumberOrd OpEq -> JavaBinaryOp "==" (JavaCast "double" e1) (JavaCast "double" e2)
  OpNumberOrd OpNotEq -> JavaBinaryOp "!=" (JavaCast "double" e1) (JavaCast "double" e2)
  OpNumberOrd OpGt -> JavaBinaryOp ">" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpNumberOrd OpGte -> JavaBinaryOp ">=" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpNumberOrd OpLt -> JavaBinaryOp "<" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpNumberOrd OpLte -> JavaBinaryOp "<=" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpStringAppend -> JavaBinaryOp "+" (JavaCast "String" e1) (JavaCast "String" e2)
  OpStringOrd OpEq -> objectEquals e1 e2
  OpStringOrd OpNotEq -> JavaUnaryOp "!" (objectEquals e1 e2)
  OpStringOrd OpGt -> JavaBinaryOp ">" (JavaCall (JavaInstanceMethodRef e1 "String" "compareTo") [JavaCast "String" e2]) (JavaRaw "0")
  OpStringOrd OpGte -> JavaBinaryOp ">=" (JavaCall (JavaInstanceMethodRef e1 "String" "compareTo") [JavaCast "String" e2]) (JavaRaw "0")
  OpStringOrd OpLt -> JavaBinaryOp "<" (JavaCall (JavaInstanceMethodRef e1 "String" "compareTo") [JavaCast "String" e2]) (JavaRaw "0")
  OpStringOrd OpLte -> JavaBinaryOp "<=" (JavaCall (JavaInstanceMethodRef e1 "String" "compareTo") [JavaCast "String" e2]) (JavaRaw "0")
  OpArrayIndex -> JavaArrayIndex e1 e2

objectEquals :: JavaExpr -> JavaExpr -> JavaExpr
objectEquals left right = JavaCall (JavaStaticMethodRef (Just "java.util.Objects") "equals") [ left, right ]

mathCall :: String -> Array JavaExpr -> JavaExpr
mathCall name = JavaCall (JavaStaticMethodRef (Just "Math") name)
