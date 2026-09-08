module Javapurs.IntLoops (intLoopParams) where

import Prelude

import Data.Array as Array
import Data.Foldable (foldMap)
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr(..))
import PureScript.Backend.Optimizer.CoreFn as CoreFn
import PureScript.Backend.Optimizer.FreeVars (localId)
import PureScript.Backend.Optimizer.Syntax (BackendSyntax(..), BackendOperator(..), BackendOperator1(..), BackendOperator2(..))

-- The optimizer can specialize operations while retaining a polymorphic outer
-- function annotation. Both explicit TAST Int annotations and the operands of
-- typed Int primitives prove a local's representation; call arguments do not.
intLoopParams :: Array String -> TcoExpr -> Array String
intLoopParams params body =
  let proven = intLocals body
  in Array.filter (\param -> Array.elem param proven) params

intLocals :: TcoExpr -> Array String
intLocals (TcoExpr _ syntax) =
  let
    here = case syntax of
      Typed CoreFn.Int expr -> directLocal expr
      PrimOp (Op1 op expr) -> case op of
        OpIntNegate -> directLocal expr
        OpIntBitNot -> directLocal expr
        _ -> []
      PrimOp (Op2 op left right) | hasIntOperands op ->
        directLocal left <> directLocal right
      _ -> []
  in here <> foldMap intLocals syntax

directLocal :: TcoExpr -> Array String
directLocal (TcoExpr _ syntax) = case syntax of
  Local ident level -> [localId ident level]
  Typed _ expr -> directLocal expr
  -- Instantiating a polymorphic value at Int does not make its binder an Int.
  -- Likewise, an Int returned by f(x) gives no representation proof for x.
  _ -> []

hasIntOperands :: BackendOperator2 -> Boolean
hasIntOperands = case _ of
  OpIntNum _ -> true
  OpIntOrd _ -> true
  OpIntBitAnd -> true
  OpIntBitOr -> true
  OpIntBitShiftLeft -> true
  OpIntBitShiftRight -> true
  OpIntBitZeroFillShiftRight -> true
  OpIntBitXor -> true
  _ -> false
