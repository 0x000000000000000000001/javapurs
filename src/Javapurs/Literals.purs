-- | Scalar literals shared by ordinary translation and consuming workers.
-- | The ownership path must preserve the same Object wrappers and IEEE values.
module Javapurs.Literals (charLiteral, numberLiteral) where

import Prelude

import Data.String.CodeUnits as CodeUnits
import Javapurs.JavaAst (JavaExpr(..))

-- PureScript Char uses the FFI's one-character String ABI, never Character.
-- JavaString delegates escaping to the common printer.
charLiteral :: Char -> JavaExpr
charLiteral = JavaString <<< CodeUnits.singleton

-- JavaScript show uses names that are not Java expressions for special Number
-- values. Java constants preserve those values; -0.0 must also keep its sign.
numberLiteral :: Number -> String
numberLiteral n =
  let
    positiveInfinity = 1.0 / 0.0
    negativeInfinity = -1.0 / 0.0
  in if n /= n then "Double.NaN"
     else if n == positiveInfinity then "Double.POSITIVE_INFINITY"
     else if n == negativeInfinity then "Double.NEGATIVE_INFINITY"
     else if n == 0.0 then if 1.0 / n == negativeInfinity then "-0.0" else "0.0"
     else show n
