-- | Control queries over the IR, independent of Java rendering.
module Javapurs.ControlFlow (hasDirectContinue, hasAnyContinue, hasTargetContinue) where

import Prelude

import Data.Array as Array
import Javapurs.JavaAst (JavaExpr(..), children)

-- | A tail that can be printed in the current loop method. Initializers,
-- | operands, conditions and deferred bodies are not direct continuation sites.
hasDirectContinue :: JavaExpr -> Boolean
hasDirectContinue = case _ of
  JavaContinue _ _ -> true
  JavaTernary _ yes no -> hasDirectContinue yes || hasDirectContinue no
  JavaBlock _ body -> hasDirectContinue body
  JavaLet _ _ body -> hasDirectContinue body
  JavaLetRec _ body -> hasDirectContinue body
  _ -> false

-- | Includes operand/statement positions that need the TcoLoop fallback.
-- | Deferred bodies and nested loops are boundaries for this local query.
-- | Use hasTargetContinue to find joins from inside those boundaries.
hasAnyContinue :: JavaExpr -> Boolean
hasAnyContinue = case _ of
  JavaContinue _ _ -> true
  JavaFunction _ -> false
  JavaAbs _ _ -> false
  JavaTypedAbs _ _ -> false
  JavaIntAbs _ _ -> false
  JavaWhileTrue _ _ _ _ -> false
  JavaMemoizedLoop _ _ _ _ _ -> false
  JavaStaticMethod _ _ _ -> false
  JavaClassDecl _ _ _ -> false
  JavaLazyAssign _ _ -> false
  expression -> Array.any hasAnyContinue (children expression)

-- | Searches through closures and nested loops: an inner join may target an
-- | enclosing loop. The target is a control identity, not a lexical variable.
hasTargetContinue :: String -> JavaExpr -> Boolean
hasTargetContinue target expression = case expression of
  JavaContinue loopId _ | loopId == target -> true
  _ -> Array.any (hasTargetContinue target) (children expression)
