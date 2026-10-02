module Javapurs.Printer.Body
  ( BodyMode(..), Loop, printBody, printIntBody, printLoopBody
  , printTcoThrow, printLetRecBindings
  ) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..))
import Data.String as String
import Data.Tuple (Tuple(..))
import Javapurs.ControlFlow (hasDirectContinue)
import Javapurs.CountedLoops (CountedLoop, countedLoop)
import Javapurs.JavaAst (JavaExpr(..))
import Javapurs.Naming (loopNextName, loopSnapshotName, loopStorageName)
import Javapurs.Printer.Syntax (Render, comma, quote, statements)

type Loop =
  { ident :: String
  , params :: Array String
  , intParams :: Array String
  , invariants :: Array (Tuple String JavaExpr)
  , body :: JavaExpr
  }

-- A function/worker can host a loop directly. A deferred Supplier preserves
-- the loop as a returned expression inside its get() method.
data BodyMode = MethodBody | SupplierBody

data BodyPlan
  = InlineLoop Loop
  | TailStatements JavaExpr
  | BlockReturn (Array JavaExpr) JavaExpr
  | ExpressionReturn JavaExpr

planBody :: BodyMode -> JavaExpr -> BodyPlan
planBody MethodBody (JavaWhileTrue ident params intParams body) =
  InlineLoop { ident, params, intParams, invariants: [], body }
planBody MethodBody (JavaMemoizedLoop ident params intParams invariants body) =
  InlineLoop { ident, params, intParams, invariants, body }
planBody _ body
  | bodyNeedsTail body = TailStatements body
  | otherwise = case body of
      JavaBlock prefix result -> BlockReturn prefix result
      _ -> ExpressionReturn body

-- These are layout decisions, not control-flow analyses: only the result path
-- can become a statement tail. Conditions/initializers remain expressions.
branchNeedsStatements :: JavaExpr -> Boolean
branchNeedsStatements = case _ of
  JavaBlock _ _ -> true
  JavaLet _ _ _ -> true
  JavaLetRec _ _ -> true
  JavaTernary _ yes no -> branchNeedsStatements yes || branchNeedsStatements no
  _ -> false

bodyNeedsTail :: JavaExpr -> Boolean
bodyNeedsTail = case _ of
  JavaTernary _ yes no ->
    branchNeedsStatements yes || branchNeedsStatements no || bodyNeedsTail yes || bodyNeedsTail no
  JavaBlock _ body -> bodyNeedsTail body
  JavaLet _ _ body -> bodyNeedsTail body
  JavaLetRec _ body -> bodyNeedsTail body
  _ -> false

printBody :: Render -> BodyMode -> JavaExpr -> String
printBody render mode body = case planBody mode body of
  InlineLoop loop -> printLoopBody render loop
  TailStatements tail -> "{ " <> printTail render FunctionTail tail <> " }"
  BlockReturn prefix result -> "{ " <> statements render prefix <> " return " <> render result <> "; }"
  ExpressionReturn result -> "{ return " <> render result <> "; }"

-- __IntFn has an int result contract. Preserve its expression/block form and
-- unbox only the final value; generic methods above return Object.
printIntBody :: Render -> JavaExpr -> String
printIntBody render = case _ of
  JavaBlock prefix result -> "{ " <> statements render prefix <> " return ((int) (" <> render result <> ")); }"
  result -> "((int) (" <> render result <> "))"

data TailContext = FunctionTail | LoopTail Loop

-- Both method and loop tails share scoped blocks/lets/branches. Only a live
-- loop tail may emit a direct continue. Expression rendering across a closure
-- boundary still uses TcoLoop, and jumps to parents are rethrown by inner loops.
printTail :: Render -> TailContext -> JavaExpr -> String
printTail render context expression = case context of
  LoopTail _ | not (hasDirectContinue expression) && not (branchNeedsStatements expression) -> printReturn render expression
  _ -> case expression of
    JavaContinue target values -> case context of
      LoopTail loop
        | target == loop.ident && Array.length loop.params == Array.length values -> printParallelContinue render loop values
        | otherwise -> printTcoThrow render target values
      FunctionTail -> printReturn render expression
    JavaTernary condition yes no ->
      "if ((Boolean) (" <> render condition <> ")) { " <>
      printTail render context yes <> "} else { " <> printTail render context no <> "} "
    JavaBlock prefix body ->
      "{ " <> statements render prefix <> " " <> printTail render context body <> "} "
    JavaLet name value body ->
      "{ Object " <> name <> " = " <> render value <> "; " <> printTail render context body <> "} "
    JavaLetRec bindings body ->
      "{ " <> printLetRecBindings render bindings <> printTail render context body <> "} "
    _ -> printReturn render expression

printReturn :: Render -> JavaExpr -> String
printReturn render expression = "return " <> render expression <> "; "

-- Cache allocation belongs to each fully applied invocation. Computations stay
-- deferred until their original use; a failure never marks a cache ready.
printLoopBody :: Render -> Loop -> String
printLoopBody render loop =
  let counted = case countedPlan loop of
        Just plan -> printCountedLoop render loop plan
        Nothing -> ""
  in
    "{ " <>
    String.joinWith "" (map (\param -> loopParamType loop param <> " " <> loopStorageName param <>
      " = " <> printLoopValue render loop param (JavaLocal param) <> "; ") loop.params) <>
    String.joinWith "" (map (printInvariant render) loop.invariants) <>
    counted <>
    "while(true) { " <>
      printSnapshots loop <>
      "try { " <> printTail render (LoopTail loop) loop.body <>
      "} catch (TcoLoop __tco_ex) { " <>
        "if (!" <> quote loop.ident <> ".equals(__tco_ex.loopId)) throw __tco_ex; " <>
        String.joinWith "" (Array.mapWithIndex (\index param -> loopStorageName param <> " = " <>
          printLoopValue render loop param (JavaRaw ("__tco_ex.args[" <> show index <> "]")) <> "; ") loop.params) <>
      "} " <>
    "} " <>
    "}"

countedPlan :: Loop -> Maybe CountedLoop
countedPlan loop = do
  plan <- countedLoop loop.params loop.intParams loop.body
  case plan.step of
    JavaContinue target _ | target == loop.ident -> Just plan
    _ -> Nothing

printCountedLoop :: Render -> Loop -> CountedLoop -> String
printCountedLoop render loop plan =
  -- Negative countdowns reach zero only after Int wraparound: use the original
  -- loop below. The counted path cannot overflow its own index, even at MAX.
  "if (" <> loopStorageName plan.counter <> " >= 0) { " <>
    "for (int __counted$index = 0, __counted$limit = " <> loopStorageName plan.counter <> "; __counted$index < __counted$limit; __counted$index++) { " <>
      printSnapshots loop <>
      printTail render (LoopTail loop) plan.step <>
    "} " <>
    printSnapshots loop <>
    "return " <> render plan.result <> "; " <>
  "} "

printParallelContinue :: Render -> Loop -> Array JavaExpr -> String
printParallelContinue render loop values =
  "{ " <>
    -- Evaluate every next value before mutating any storage, so swaps, captures
    -- and an exception in a later argument all see the old iteration.
    String.joinWith "" (map (\(Tuple param value) ->
      "final " <> loopParamType loop param <> " " <> loopNextName param <> " = " <>
        printLoopValue render loop param value <> "; ") (Array.zip loop.params values)) <>
    String.joinWith "" (map (\param -> loopStorageName param <> " = " <> loopNextName param <> "; ") loop.params) <>
    "continue; } "

printTcoThrow :: Render -> String -> Array JavaExpr -> String
printTcoThrow render ident values =
  "throw new TcoLoop(" <> quote ident <> ", new Object[]{" <> comma (map render values) <> "}); "

printInvariant :: Render -> Tuple String JavaExpr -> String
printInvariant render (Tuple name value) =
  "final java.util.function.IntSupplier " <> name <> " = new java.util.function.IntSupplier() { " <>
    "private boolean ready; private int value; " <>
    "public int getAsInt() { if (!ready) { value = ((int) (" <> render value <> ")); ready = true; } return value; } " <>
  "}; "

printSnapshots :: Loop -> String
printSnapshots loop = String.joinWith "" (map (\param ->
  "final " <> loopParamType loop param <> " " <> loopSnapshotName param <> " = " <> loopStorageName param <> "; ") loop.params)

loopParamType :: Loop -> String -> String
loopParamType loop name = if Array.elem name loop.intParams then "int" else "Object"

printLoopValue :: Render -> Loop -> String -> JavaExpr -> String
printLoopValue render loop name expression =
  render (if Array.elem name loop.intParams then JavaCast "int" expression else expression)

printLetRecBindings :: Render -> Array (Tuple String JavaExpr) -> String
printLetRecBindings render bindings = case Array.head bindings of
  Nothing -> ""
  Just (Tuple firstName _) ->
    let
      -- Rename makes bindings unique. Nested scopes emitted in the same Java
      -- method therefore receive distinct local class and instance names.
      scopeClass = "LetRecScope_" <> firstName
      scopeVar = "__letrec_" <> firstName
    in
      "class " <> scopeClass <> " { " <>
        String.joinWith "" (map (\(Tuple name _) -> "Object " <> name <> "; ") bindings) <>
        scopeClass <> "() { " <>
          String.joinWith "" (map (\(Tuple name value) -> name <> " = " <> render value <> "; ") bindings) <>
        "} " <>
      "} " <>
      scopeClass <> " " <> scopeVar <> " = new " <> scopeClass <> "(); " <>
      String.joinWith "" (map (\(Tuple name _) -> "Object " <> name <> " = " <> scopeVar <> "." <> name <> "; ") bindings)
