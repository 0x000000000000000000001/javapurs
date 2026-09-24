module Javapurs.DirectCalls (directCalls) where

import Prelude

import Control.Monad.State (State, modify_, runState)
import Data.Array as Array
import Data.Foldable (foldr)
import Data.Maybe (Maybe(..))
import Data.Set (Set)
import Data.Set as Set
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..), fst, snd)
import Javapurs.JavaAst (JavaExpr(..), JavaParamType(..), JavaFile)

type Candidate = { name :: String, worker :: String, index :: Int, arity :: Int, params :: Array JavaParamType, lazy :: Boolean }
type Lambdas = { groups :: Array (Array (Tuple String JavaParamType)), args :: Array (Tuple String JavaParamType), body :: JavaExpr }

-- A definition becomes callable directly only from later declarations. In
-- particular, neither its own initializer nor an earlier initializer may bypass
-- the public field read. Workers are emitted only for actual rewritten calls.
-- Recursive (lazy) bindings call themselves through their getter inside their
-- own value; those saturated self calls may use a worker directly, because the
-- closure body only runs after the getter completed. Unary recursive functions
-- (for example a depth traversal) qualify as well.
directCalls :: String -> JavaFile -> JavaFile
directCalls moduleName file =
  let
    names = Array.mapMaybe declarationName file.decls
    candidates = Array.mapMaybe identity $ Array.mapWithIndex
      (\index declaration -> case declaration of
        JavaAssign name value -> do
          lambdas <- lambdaChain 2 value
          mkCandidate name index lambdas false
        JavaLazyAssign name value -> do
          lambdas <- lambdaChain 1 value
          mkCandidate name index lambdas true
        _ -> Nothing) file.decls
    mkCandidate name index lambdas lazy =
      let worker = "__direct$" <> show index
      in if Array.length (Array.filter (_ == name) names) == 1 &&
          not (Array.elem worker names) then
        Just { name, worker, index, arity: Array.length lambdas.args, params: map snd lambdas.args, lazy }
      else Nothing
    Tuple rewritten used = runState
      (traverse identity (Array.mapWithIndex (rewrite moduleName candidates) file.decls)) Set.empty
    emit index declaration = case Array.find (\candidate -> candidate.index == index) candidates of
      Just candidate | Set.member index used -> case declaration of
        JavaAssign name value -> case lambdaChain 2 value of
          Just lambdas ->
            [ JavaAssign name (foldr JavaAbs
                (workerCall moduleName candidate (map (JavaLocal <<< fst) lambdas.args)) (map (map fst) lambdas.groups))
            , JavaStaticMethod candidate.worker lambdas.args lambdas.body
            ]
          Nothing -> [declaration]
        JavaLazyAssign name value -> case lambdaChain 1 value of
          Just lambdas ->
            [ JavaLazyAssign name (foldr JavaAbs
                (workerCall moduleName candidate (map (JavaLocal <<< fst) lambdas.args)) (map (map fst) lambdas.groups))
            , JavaStaticMethod candidate.worker lambdas.args lambdas.body
            ]
          Nothing -> [declaration]
        _ -> [declaration]
      _ -> [declaration]
  in file { decls = Array.concat (Array.mapWithIndex emit rewritten) }

declarationName :: JavaExpr -> Maybe String
declarationName = case _ of
  JavaAssign name _ -> Just name
  JavaLazyAssign name _ -> Just name
  JavaStaticMethod name _ _ -> Just name
  _ -> Nothing

-- Only contiguous, nonempty lambdas are flattened. A block, call or any other
-- computation is the worker body, even when that computation returns a closure.
-- Keeping that boundary preserves the timing of subsequent overapplication.
-- Typed lambdas carry proven primitive parameters; plain lambdas stay Object.
lambdaChain :: Int -> JavaExpr -> Maybe Lambdas
lambdaChain minimum = collect [] []
  where
  collect groups args expression = case expression of
    JavaAbs parameters body
      | Array.null parameters -> Nothing
      | Array.length args + Array.length parameters > 32 -> Nothing
      | otherwise -> collect (Array.snoc groups (map (\name -> Tuple name ParamObject) parameters)) (args <> map (\name -> Tuple name ParamObject) parameters) body
    JavaTypedAbs parameters body
      | Array.null parameters -> Nothing
      | Array.length args + Array.length parameters > 32 -> Nothing
      | otherwise -> collect (Array.snoc groups parameters) (args <> parameters) body
    _
      | Array.length args >= minimum && Array.length (Array.nub (map fst args)) == Array.length args ->
          Just { groups, args, body: expression }
      | otherwise -> Nothing

-- Primitive worker parameters need an unboxing cast at every call site; the
-- public curried chains and the guarded fallbacks keep Object arguments.
workerCall :: String -> Candidate -> Array JavaExpr -> JavaExpr
workerCall moduleName candidate args =
  JavaCall (JavaGlobalVar (Just moduleName) candidate.worker)
    (Array.zipWith (\paramType arg -> case paramType of
        ParamInt -> JavaCast "int" arg
        _ -> arg) candidate.params args)

lazyGetter :: String -> String -> String
lazyGetter moduleName name = moduleName <> ".__lazy_get_" <> name

type Rewrite = State (Set Int)

rewrite :: String -> Array Candidate -> Int -> JavaExpr -> Rewrite JavaExpr
rewrite moduleName candidates declarationIndex expression = do
  -- Rewriting children first allows exactly the saturated prefix of an
  -- overapplication to become a method call. Later arguments remain outside it.
  result <- children (rewrite moduleName candidates declarationIndex) expression
  case application result of
    Just { head: JavaGlobalVar qualifier name, args }
      | qualifier == Nothing || qualifier == Just moduleName ->
          case Array.find (\candidate -> candidate.name == name &&
              candidate.index < declarationIndex && candidate.arity == Array.length args) candidates of
            Just candidate -> do
              modify_ (Set.insert candidate.index)
              -- Lazy getters can enter a later declaration while the module
              -- is still initializing. Preserve the original curried path when
              -- its public field has not been initialized yet, including the
              -- point at which a null call stops evaluating later arguments.
              pure (JavaTernary
                (JavaBinaryOp "==" (JavaGlobalVar qualifier name) (JavaRaw "null"))
                result (workerCall moduleName candidate args))
            Nothing -> pure result
    Just { head: JavaCall (JavaRaw getterName) [], args }
      | Just candidate <- Array.find (\c -> c.lazy &&
            c.index == declarationIndex && c.arity == Array.length args &&
            getterName == lazyGetter moduleName c.name) candidates -> do
          -- The function calls itself. Its own getter already completed before
          -- any body can run, so the worker needs no initialization guard.
          modify_ (Set.insert candidate.index)
          pure (workerCall moduleName candidate args)
    _ -> pure result

application :: JavaExpr -> Maybe { head :: JavaExpr, args :: Array JavaExpr }
application = collect []
  where
  collect args = case _ of
    JavaApply fn arg
      | Array.length args < 32 -> collect (Array.cons arg args) fn
      | otherwise -> Nothing
    head
      | not (Array.null args) -> Just { head, args }
      | otherwise -> Nothing

-- Preserve every structural child and leave raw Java opaque. This traversal
-- neither prints expressions early nor changes binder names or record metadata.
children :: (JavaExpr -> Rewrite JavaExpr) -> JavaExpr -> Rewrite JavaExpr
children visit expression = case expression of
  JavaCall fn args -> JavaCall <$> visit fn <*> traverse visit args
  JavaFunction value -> JavaFunction <$> visit value
  JavaAbs args body -> JavaAbs args <$> visit body
  JavaTypedAbs args body -> JavaTypedAbs args <$> visit body
  JavaIntAbs arg body -> JavaIntAbs arg <$> visit body
  JavaNew name args -> JavaNew name <$> traverse visit args
  JavaTernary condition yes no -> JavaTernary <$> visit condition <*> visit yes <*> visit no
  JavaRecord fields -> JavaRecord <$> fieldsOf fields
  JavaTypedRecord shape fields -> JavaTypedRecord shape <$> fieldsOf fields
  JavaTypedRecordGet shape value label -> (\value' -> JavaTypedRecordGet shape value' label) <$> visit value
  JavaTypedRecordUpdate shape value fields -> JavaTypedRecordUpdate shape <$> visit value <*> fieldsOf fields
  JavaArray values -> JavaArray <$> traverse visit values
  JavaWhileTrue args intParams body -> JavaWhileTrue args intParams <$> visit body
  JavaMemoizedLoop args intParams invariants body -> JavaMemoizedLoop args intParams <$> fieldsOf invariants <*> visit body
  JavaContinue name args -> JavaContinue name <$> traverse visit args
  JavaMapGet value label -> (\value' -> JavaMapGet value' label) <$> visit value
  JavaMapUpdate value fields -> JavaMapUpdate <$> visit value <*> fieldsOf fields
  JavaInstanceOf value name -> (\value' -> JavaInstanceOf value' name) <$> visit value
  JavaPropertyAccess value name property -> (\value' -> JavaPropertyAccess value' name property) <$> visit value
  JavaApply fn arg -> JavaApply <$> visit fn <*> visit arg
  JavaIntApply fn arg -> JavaIntApply <$> visit fn <*> visit arg
  JavaLet name value body -> JavaLet name <$> visit value <*> visit body
  JavaLetRec bindings body -> JavaLetRec <$> fieldsOf bindings <*> visit body
  JavaAssign name value -> JavaAssign name <$> visit value
  JavaLazyAssign name value -> JavaLazyAssign name <$> visit value
  JavaStaticMethod name args body -> JavaStaticMethod name args <$> visit body
  JavaLocalAssign name value -> JavaLocalAssign name <$> visit value
  JavaIntLocalAssign name value -> JavaIntLocalAssign name <$> visit value
  JavaBinaryOp operator left right -> JavaBinaryOp operator <$> visit left <*> visit right
  JavaUnaryOp operator value -> JavaUnaryOp operator <$> visit value
  JavaArrayIndex value index -> JavaArrayIndex <$> visit value <*> visit index
  JavaCast name value -> JavaCast name <$> visit value
  JavaBlock statements value -> JavaBlock <$> traverse visit statements <*> visit value
  _ -> pure expression
  where
  fieldsOf = traverse (\(Tuple name value) -> Tuple name <$> visit value)
