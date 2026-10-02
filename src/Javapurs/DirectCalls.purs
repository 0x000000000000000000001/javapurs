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
import Javapurs.JavaAst (JavaExpr(..), JavaParamType(..), JavaFile, traverseChildren)
import Javapurs.Naming (lazyGetterName)
import Javapurs.Representation (coerceArgument)

type Candidate = { name :: String, worker :: String, index :: Int, arity :: Int, params :: Array JavaParamType, lazy :: Boolean }
type Lambdas = { groups :: Array (Array (Tuple String JavaParamType)), args :: Array (Tuple String JavaParamType), body :: JavaExpr }
type CallPlan = { candidate :: Candidate, args :: Array JavaExpr, guardField :: Maybe JavaExpr }

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
      (traverse identity (Array.mapWithIndex (\index declaration ->
        rewrite moduleName candidates index (case declaration of
          JavaLazyAssign _ _ -> true
          _ -> false) declaration) file.decls)) Set.empty
    emit index declaration = case Array.find (\candidate -> candidate.index == index) candidates of
      Just candidate | Set.member index used -> case declaration of
        JavaAssign name value -> emitWorker JavaAssign 2 candidate name value declaration
        JavaLazyAssign name value -> emitWorker JavaLazyAssign 1 candidate name value declaration
        _ -> [declaration]
      _ -> [declaration]
    -- Read the rewritten body, not the original candidate body: self calls and
    -- calls to other workers may already have changed. Public lambdas stay boxed.
    emitWorker binding minimum candidate name value original = case lambdaChain minimum value of
      Just lambdas ->
        [ binding name (foldr JavaAbs
            (workerCall moduleName candidate (map (JavaLocal <<< fst) lambdas.args)) (map (map fst) lambdas.groups))
        , JavaStaticMethod candidate.worker lambdas.args lambdas.body
        ]
      Nothing -> [original]
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
  JavaCall (JavaStaticMethodRef (Just moduleName) candidate.worker)
    (Array.zipWith coerceArgument candidate.params args)

type Rewrite = State (Set Int)

rewrite :: String -> Array Candidate -> Int -> Boolean -> JavaExpr -> Rewrite JavaExpr
rewrite moduleName candidates declarationIndex fromLazy expression = do
  -- Rewriting children first allows exactly the saturated prefix of an
  -- overapplication to become a method call. Later arguments remain outside it.
  result <- traverseChildren (rewrite moduleName candidates declarationIndex fromLazy) expression
  case admitCall moduleName candidates declarationIndex fromLazy result of
    Nothing -> pure result
    Just plan -> do
      modify_ (Set.insert plan.candidate.index)
      let direct = workerCall moduleName plan.candidate plan.args
      pure case plan.guardField of
        Just field -> JavaTernary (JavaBinaryOp "==" field (JavaRaw "null")) result direct
        -- Eager-to-eager calls need no fallback. Keeping arguments just once
        -- avoids exponential output growth for nested saturated calls.
        Nothing -> direct

-- Admission is pure: initialization order and saturation choose a guarded or
-- direct call before rewrite records reachability and constructs Java nodes.
admitCall :: String -> Array Candidate -> Int -> Boolean -> JavaExpr -> Maybe CallPlan
admitCall moduleName candidates declarationIndex fromLazy expression =
  case application expression of
    Just { head: JavaGlobalVar qualifier name, args }
      | qualifier == Nothing || qualifier == Just moduleName ->
          case Array.find (\candidate -> candidate.name == name &&
              candidate.index < declarationIndex && candidate.arity == Array.length args) candidates of
            Just candidate -> Just
              { candidate, args
              -- A lazy caller can run before an earlier eager field is assigned
              -- through reentrant module initialization. Either lazy endpoint
              -- therefore preserves the curried fallback and its failure timing.
              , guardField: if candidate.lazy || fromLazy then Just (JavaGlobalVar qualifier name) else Nothing
              }
            Nothing -> Nothing
    Just { head: JavaCall (JavaStaticMethodRef qualifier getterName) [], args }
      | qualifier == Nothing || qualifier == Just moduleName
      , Just candidate <- Array.find (\c -> c.lazy &&
            c.index == declarationIndex && c.arity == Array.length args &&
             getterName == lazyGetterName c.name) candidates ->
          -- The function calls itself. Its own getter already completed before
          -- any body can run, so the worker needs no initialization guard.
          Just { candidate, args, guardField: Nothing }
    _ -> Nothing

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
