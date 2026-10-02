-- | Lower a proven candidate to declarations. Failure at any use rejects the
-- | whole worker. Reads, retirement and cell selection are delegated to Cells;
-- | writes occur only after the prepared snapshots, in source argument order.
module Javapurs.Ownership.Workers (workerDeclarations) where

import Prelude

import Control.Alternative (guard)
import Control.Monad.State (evalStateT)
import Control.Monad.Trans.Class (lift)
import Data.Array as Array
import Data.Array.NonEmpty as NonEmptyArray
import Data.Foldable (any, foldM)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Newtype (unwrap)
import Data.String as String
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..), fst, snd)
import Javapurs.JavaAst (JavaExpr(..), JavaParamType(..))
import Javapurs.Naming (loopSnapshotName)
import Javapurs.Ownership.Analysis (continuationPaths, hasTailSelfCall, leafValue, leaves, pathValue, scalar, snapshotScalar, snapshotScalarValue, treeTerm)
import Javapurs.Ownership.Candidates (argJavaType, strip)
import Javapurs.Ownership.Cells (freshName, plan, takeCell)
import Javapurs.Ownership.Model (ArgType(..), Argument(..), Candidate, CellPool, Context, Env, FieldType(..), Gen, Generated, Path(..), ScalarType(..), Term(..), TreeSpec, TreeTerm(..), Value(..), overlap, termExpr)
import Javapurs.Printer (printExpr)
import PureScript.Backend.Optimizer.Semantics (NeutralExpr(..))
import PureScript.Backend.Optimizer.Syntax (BackendSyntax(..), Pair(..))
import PureScript.Backend.Optimizer.Syntax as Syn

emitTree :: Context -> Env -> CellPool -> Boolean -> TreeTerm -> Gen Generated
emitTree context env pool outer = case _ of
  Existing expr -> pure { stmts: [], expr, pool }
  Empty -> pure { stmts: [], expr: leafValue context.candidate.spec, pool }
  Keep _ -> lift Nothing
  Construct args -> do
    values <- emitArguments context env pool args
    cell <- takeCell context values.pool
    name <- case cell.expr of
      JavaLocal name -> pure name
      _ -> lift Nothing
    let
      spec = context.candidate.spec
      assigns = Array.mapWithIndex
        (\index value -> JavaFieldSet (JavaLocal name) spec.nodeClass ("value" <> show index) (fieldJavaType spec index) value)
        values.exprs
      result = JavaLocal name
    if cell.nonNull then
      pure { stmts: values.stmts <> cell.stmts <> assigns, expr: result, pool: cell.pool }
    else
      pure
        { stmts: values.stmts <> cell.stmts <>
            [ JavaIf (JavaBinaryOp "==" (JavaLocal name) (JavaRaw "null"))
                [ JavaLocalSet name (JavaNew spec.nodeClass values.exprs) ] assigns ]
        , expr: result
        , pool: cell.pool
        }
  Call key args -> do
    fn <- lift $ Map.lookup key context.candidates
    values <- emitArguments context env pool args
    -- Captures resolve as borrowed scalars, never as consumable tree paths.
    captures <- traverse (\ref ->
      lift $ scalar context env (NeutralExpr (Syn.Local (fst ref) (snd ref)))) fn.captures
    donor <- if outer then takeCell context values.pool
      else pure { stmts: [], expr: JavaRaw "null", pool: values.pool, nonNull: false }
    result <- freshName "__result_"
    pure
      { stmts: values.stmts <> donor.stmts
          <> [ JavaLocalAssign result
                 (JavaCall (JavaStaticMethodRef Nothing fn.javaName) (map _.expr captures <> values.exprs <> [ donor.expr ])) ]
      , expr: JavaLocal result
      , pool: donor.pool
      }

fieldJavaType :: TreeSpec -> Int -> JavaParamType
fieldJavaType spec index = case Array.index spec.fields index of
  Just IntField -> ParamInt
  _ -> ParamObject

emitArguments :: Context -> Env -> CellPool -> Array Argument -> Gen
  { stmts :: Array JavaExpr, exprs :: Array JavaExpr, pool :: CellPool }
emitArguments context env pool = foldM step { stmts: [], exprs: [], pool }
  where
  step result arg = do
    value <- emitArgument context env result.pool arg
    pure { stmts: result.stmts <> value.stmts, exprs: Array.snoc result.exprs value.expr, pool: value.pool }

emitArgument :: Context -> Env -> CellPool -> Argument -> Gen Generated
emitArgument context env pool = case _ of
  TreeArg tree -> emitTree context env pool false tree
  ScalarArg value -> pure { stmts: [], expr: value.expr, pool }

emitBody :: Context -> Env -> NeutralExpr -> Gen Term
emitBody context env expr = case strip expr of
  Branch branches fallback -> do
    def <- emitBody context env fallback
    cases <- traverse (\(Pair condition body) -> do
      cond <- lift $ scalar context env condition
      result <- emitBody context env body
      pure { condition: cond.expr, term: result }) (NonEmptyArray.toArray branches)
    pure $ Array.foldr (\branch rest -> TermIf branch.condition branch.term rest) def cases
  Fail message -> pure (TermReturn (JavaThrow message))
  LetRec _ _ body -> emitBody context env body
  Let name level binding body -> case pathValue context env binding of
    Just path -> emitBody context (Map.insert (Tuple name level) (Tree path) env) body
    Nothing -> case scalar context env binding of
      Just value -> do
        temporary <- freshName "__let_scalar_"
        rest <- emitBody context (Map.insert (Tuple name level) (Scalar (snapshotScalarValue temporary value)) env) body
        pure (TermStmts [ snapshotScalar temporary value ] rest)
      Nothing -> do
        term <- lift $ treeTerm context env binding
        let consumed = leaves term
            future = continuationPaths env body
        lift $ guard (not (any (\path -> any (overlap path) future) consumed))
        prepared <- plan context env future term
        result <- emitTree context env prepared.pool true prepared.term
        temporary <- freshName "__let_tree_"
        let
          remaining = Map.filter (case _ of
            Tree path -> not (any (overlap path) prepared.retired)
            Scalar value -> not (any (\path -> any (overlap path) prepared.retired) value.reads)) env
          nextEnv = Map.insert (Tuple name level) (Tree (Path temporary [])) remaining
        rest <- emitBody context nextEnv body
        pure (TermStmts
          (prepared.stmts <> result.stmts
            <> [ JavaLocalAssign temporary result.expr
               , JavaLocalSet context.donorName (JavaRaw "null") ]) rest)
  _ -> do
    term <- lift $ treeTerm context env expr
    prepared <- plan context env [] term
    case prepared.term of
      Call key args | key == context.candidate.key -> do
        values <- emitArguments context env prepared.pool args
        donor <- takeCell context values.pool
        pure (TermStmts (prepared.stmts <> values.stmts <> donor.stmts)
          (TermContinue (JavaContinue (unwrap context.candidate.worker) (values.exprs <> [ donor.expr ]))))
      _ -> do
        result <- emitTree context env prepared.pool true prepared.term
        pure (TermStmts (prepared.stmts <> result.stmts) (TermReturn result.expr))

type Decision = { cases :: Array (Tuple JavaExpr Term), fallback :: Term }

collectTermIf :: Term -> Decision
collectTermIf = go []
  where
  go acc = case _ of
    TermIf condition yes no -> go (Array.snoc acc (Tuple condition yes)) no
    fallback -> { cases: acc, fallback }

-- Printed-character heuristic, not a bytecode-size or HotSpot-inlining proof.
-- Nonbranching terms and loop workers are not split by this helper; the later
-- Java chunker still owns expression extraction for the assembled file.
termSize :: Term -> Int
termSize term = String.length (printExpr (termExpr term))

termBudget :: Int
termBudget = 6000

compileTerm :: String -> Array (Tuple String JavaParamType) -> Term -> Array JavaExpr
compileTerm name allParams term =
  let
    decision = collectTermIf term
    caseArgs = map (JavaLocal <<< fst) allParams
    caseCount = Array.length decision.cases
    caseName index = name <> "$case" <> show index
    fallbackName = caseName caseCount
  in
    if termSize term <= termBudget || Array.null decision.cases then
      [ JavaStaticMethod name allParams (termExpr term) ]
    else
      let
        caseDecls = Array.concat $ Array.mapWithIndex (\index (Tuple _ body) ->
          compileTerm (caseName index) allParams body) decision.cases
        fallbackDecls = compileTerm fallbackName allParams decision.fallback
        go index = case Array.index decision.cases index of
          Just (Tuple condition _) ->
            JavaTernary condition (JavaCall (JavaStaticMethodRef Nothing (caseName index)) caseArgs) (go (index + 1))
          Nothing -> JavaCall (JavaStaticMethodRef Nothing fallbackName) caseArgs
      in caseDecls <> fallbackDecls <> [ JavaStaticMethod name allParams (go 0) ]

workerDeclarations :: Context -> Candidate -> Maybe (Array JavaExpr)
workerDeclarations context fn = do
  let
    captureParams = Array.mapWithIndex (\index _ -> Tuple ("captured" <> show index) ParamObject) fn.captures
    captureEnv = Map.fromFoldable $ Array.mapWithIndex (\index ref ->
      Tuple ref (Scalar { expr: JavaLocal ("captured" <> show index), ty: ScalarObject, reads: [] })) fn.captures
    params = Array.mapWithIndex (\index argTy -> Tuple ("owned" <> show index) (argJavaType argTy)) fn.argTypes
    donorArg = "donor"
    argEnv nameOf = Array.mapWithIndex (\index ref ->
      let
        name = "owned" <> show index
        argTy = fromMaybe ArgObject (Array.index fn.argTypes index)
      in
        Tuple ref (case argTy of
          ArgTree -> Tree (Path (nameOf name) [])
          ArgInt -> Scalar { expr: JavaLocal (nameOf name), ty: ScalarInt, reads: [] }
          ArgObject -> Scalar { expr: JavaLocal (nameOf name), ty: ScalarObject, reads: [] })) fn.args
    envWith nameOf = Map.fromFoldable (Map.toUnfoldable captureEnv <> argEnv nameOf)
    loops = hasTailSelfCall context fn.body
    env = envWith (\name -> if loops then loopSnapshotName name else name)
    donorName = if loops then "__donorOwned" else "donor"
    context' = context { candidate = fn, donorName = donorName }
  term <- evalStateT (emitBody context' env fn.body) 0
  let
    intParams = Array.mapMaybe (\(Tuple name javaTy) -> if javaTy == ParamInt then Just name else Nothing) params
    loopArgs = map fst params <> [ donorArg ]
    allParams = captureParams <> params <> [ Tuple donorArg ParamObject ]
    initialize = if loops then [ JavaLocalAssign donorName (JavaLocal (loopSnapshotName donorArg)) ] else []
  if loops then
    pure [ JavaStaticMethod fn.javaName allParams (JavaWhileTrue fn.javaName loopArgs intParams (JavaBlock initialize (termExpr term))) ]
  else pure (compileTerm fn.javaName allParams term)
