module Javapurs.CountedLoops (CountedLoop, countedLoop) where

import Prelude

import Data.Array as Array
import Data.Foldable (all)
import Data.Int as Int
import Data.Maybe (Maybe(..))
import Javapurs.JavaAst (JavaExpr(..))

type CountedLoop =
  { counter :: String
  , step :: JavaExpr
  , result :: JavaExpr
  }

-- Int representations have already been proved from the TAST. Restrict this
-- lowering to pure primitive expressions: no calls can throw a TcoLoop across
-- the counted loop's method boundary, and no evaluation effects are moved.
countedLoop :: Array String -> Array String -> JavaExpr -> Maybe CountedLoop
countedLoop params intParams = case _ of
  JavaTernary cond result step@(JavaContinue _ values)
    | Array.length params == Array.length values
    , all (\param -> Array.elem param intParams) params
    , all (isIntExpr params) values
    , isIntExpr params result -> do
        counter <- zeroTest params cond
        index <- Array.elemIndex counter params
        next <- Array.index values index
        case stripIntCast next of
          JavaBinaryOp "-" left right
            | isSnapshot counter left && isLiteral "1" right ->
                Just { counter, step, result }
          _ -> Nothing
  _ -> Nothing

zeroTest :: Array String -> JavaExpr -> Maybe String
zeroTest params = case _ of
  JavaBinaryOp "==" left right ->
    Array.find (\param ->
      (isSnapshot param left && isLiteral "0" right) ||
      (isLiteral "0" left && isSnapshot param right)
    ) params
  _ -> Nothing

isSnapshot :: String -> JavaExpr -> Boolean
isSnapshot param expr = case stripIntCast expr of
  JavaLocal name -> name == "__final_" <> param
  _ -> false

isLiteral :: String -> JavaExpr -> Boolean
isLiteral expected expr = case stripIntCast expr of
  JavaRaw literal -> literal == expected
  _ -> false

stripIntCast :: JavaExpr -> JavaExpr
stripIntCast = case _ of
  JavaCast "int" expr -> stripIntCast expr
  expr -> expr

isIntExpr :: Array String -> JavaExpr -> Boolean
isIntExpr params = case _ of
  JavaLocal name -> Array.any (\param -> name == "__final_" <> param) params
  JavaRaw literal -> case Int.fromString literal of
    Just value -> Int.toStringAs Int.decimal value == literal
    Nothing -> false
  JavaCast "int" expr -> isIntExpr params expr
  JavaBinaryOp op left right ->
    Array.elem op ["+", "-", "*", "&", "|", "^", "<<", ">>", ">>>"] &&
    isIntExpr params left && isIntExpr params right
  _ -> false
