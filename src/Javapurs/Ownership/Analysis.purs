-- | Recognize reads/results without mutating an input. The resulting TreeTerm
-- | still contains borrowed paths; Cells must prove disjointness and snapshot
-- | them before Workers can emit writes. Nothing rejects the whole candidate.
module Javapurs.Ownership.Analysis
  ( pathValue, scalar, snapshotScalar, snapshotScalarValue, leafValue
  , knownCall, treeTerm, leaves, disjoint, continuationPaths, hasTailSelfCall
  , freshTree, callees
  ) where

import Prelude

import Control.Alternative (guard)
import Data.Array as Array
import Data.Array.NonEmpty as NonEmptyArray
import Data.Foldable (all, any, foldMap)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe, isJust)
import Data.Newtype (unwrap)
import Data.Set as Set
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import Javapurs.JavaAst (JavaExpr(..))
import Javapurs.Literals (charLiteral, numberLiteral)
import Javapurs.Naming (constructorClassName, modulePrefix, safeCtorName)
import Javapurs.Operators (translateOperator1, translateOperator2)
import Javapurs.Ownership.Candidates (adtName, ctorNames, nullaryCtorNames, qualify, scalarJavaType, spine, strip)
import Javapurs.Ownership.Model (ArgType(..), Argument(..), Candidate, CandidateKey(..), Context, Env, FieldType(..), Path, Scalar, ScalarType(..), TreeSpec, TreeTerm(..), Value(..), appendField, overlap, pathExpr)
import PureScript.Backend.Optimizer.CoreFn (Ident(..), Literal(..), ModuleName(..), Qualified(..))
import PureScript.Backend.Optimizer.Semantics (NeutralExpr(..))
import PureScript.Backend.Optimizer.Syntax (BackendAccessor(..), BackendOperator(..), BackendOperator1(..), BackendOperator2(..), BackendSyntax(..), Pair(..))

pathValue :: Context -> Env -> NeutralExpr -> Maybe Path
pathValue context env expr = case strip expr of
  Local name level -> case Map.lookup (Tuple name level) env of
    Just (Tree path) -> Just path
    _ -> Nothing
  Accessor base (GetCtorField ctor _ _ _ _ index) -> do
    guard (qualify context.moduleName ctor == context.candidate.spec.nodeCtor)
    fieldKind <- Array.index context.candidate.spec.fields index
    guard (fieldKind == TreeField)
    path <- pathValue context env base
    pure (appendField path index)
  _ -> Nothing

ctorClass :: Context -> Qualified Ident -> Maybe String
ctorClass context (Qualified mbMod (Ident name)) = do
  let modName = fromMaybe context.moduleName mbMod
  guard (modName == context.moduleName)
  guard (Set.member name (ctorNames context.dataDecls))
  pure (constructorClassName (modulePrefix modName) name)

nullaryCtor :: Context -> Qualified Ident -> Maybe JavaExpr
nullaryCtor context (Qualified mbMod (Ident name)) = do
  let modName = fromMaybe context.moduleName mbMod
  guard (modName == context.moduleName)
  guard (Set.member name (nullaryCtorNames context.dataDecls))
  pure (JavaCtorSingleton (modulePrefix modName) (safeCtorName name))

leafValue :: TreeSpec -> JavaExpr
leafValue spec = case spec.leaf of
  Just (Qualified mbMod (Ident name)) ->
    JavaCtorSingleton (modulePrefix (fromMaybe (ModuleName "") mbMod)) (safeCtorName name)
  Nothing -> JavaRaw "null"

scalar :: Context -> Env -> NeutralExpr -> Maybe Scalar
scalar context env expr = case strip expr of
  Local name level -> case Map.lookup (Tuple name level) env of
    Just (Scalar value) -> Just value
    _ -> Nothing
  Lit lit -> literalScalar lit
  CtorSaturated ctor _ _ _ fields | Array.null fields -> nullaryScalar context ctor
  Var ctor -> nullaryScalar context ctor
  Accessor base (GetCtorField ctor _ _ _ _ index) -> do
    guard (qualify context.moduleName ctor == context.candidate.spec.nodeCtor)
    fieldKind <- Array.index context.candidate.spec.fields index
    guard (fieldKind /= TreeField)
    path <- pathValue context env base
    pure
      { expr: JavaPropertyAccess (pathExpr context.candidate.spec path) context.candidate.spec.nodeClass ("value" <> show index)
      , ty: scalarJavaType fieldKind
      , reads: [ path ]
      }
  PrimOp (Op1 (OpIsTag ctor) value) -> case pathValue context env value of
    Just path -> do
      className <- ctorClass context (qualify context.moduleName ctor)
      pure { expr: JavaInstanceOf (pathExpr context.candidate.spec path) className, ty: ScalarBoolean, reads: [ path ] }
    Nothing -> do
      value' <- scalar context env value
      className <- ctorClass context (qualify context.moduleName ctor)
      pure { expr: JavaInstanceOf value'.expr className, ty: ScalarBoolean, reads: value'.reads }
  PrimOp (Op1 op value) -> do
    value' <- scalar context env value
    pure (value' { expr = translateOperator1 (unwrap context.moduleName) op value'.expr })
  PrimOp (Op2 op left right) -> do
    left' <- scalar context env left
    right' <- scalar context env right
    pure
      { expr: translateOperator2 (unwrap context.moduleName) op left'.expr right'.expr
      , ty: operatorScalarType op
      , reads: left'.reads <> right'.reads
      }
  _ -> Nothing

nullaryScalar :: Context -> Qualified Ident -> Maybe Scalar
nullaryScalar context ctor = do
  value <- nullaryCtor context (qualify context.moduleName ctor)
  pure { expr: value, ty: ScalarObject, reads: [] }

literalScalar :: Literal NeutralExpr -> Maybe Scalar
literalScalar = case _ of
  LitInt value -> Just { expr: JavaRaw (show value), ty: ScalarInt, reads: [] }
  LitNumber value -> Just { expr: JavaRaw (numberLiteral value), ty: ScalarObject, reads: [] }
  LitString value -> Just { expr: JavaString value, ty: ScalarObject, reads: [] }
  LitChar value -> Just { expr: charLiteral value, ty: ScalarObject, reads: [] }
  LitBoolean value -> Just { expr: JavaRaw (if value then "true" else "false"), ty: ScalarBoolean, reads: [] }
  _ -> Nothing

operatorScalarType :: BackendOperator2 -> ScalarType
operatorScalarType = case _ of
  OpIntNum _ -> ScalarInt
  OpIntBitAnd -> ScalarInt
  OpIntBitOr -> ScalarInt
  OpIntBitShiftLeft -> ScalarInt
  OpIntBitShiftRight -> ScalarInt
  OpIntBitXor -> ScalarInt
  OpIntBitZeroFillShiftRight -> ScalarInt
  OpIntOrd _ -> ScalarBoolean
  OpNumberOrd _ -> ScalarBoolean
  OpStringOrd _ -> ScalarBoolean
  OpCharOrd _ -> ScalarBoolean
  OpBooleanOrd _ -> ScalarBoolean
  OpBooleanAnd -> ScalarBoolean
  OpBooleanOr -> ScalarBoolean
  OpNumberNum _ -> ScalarObject
  OpStringAppend -> ScalarObject
  OpArrayIndex -> ScalarObject

snapshotScalar :: String -> Scalar -> JavaExpr
snapshotScalar name value = case value.ty of
  ScalarInt -> JavaIntLocalAssign name value.expr
  _ -> JavaLocalAssign name value.expr

snapshotScalarValue :: String -> Scalar -> Scalar
snapshotScalarValue name value = value { expr = JavaLocal name, reads = [] }

knownCall :: Context -> NeutralExpr -> Maybe { fn :: Candidate, args :: Array NeutralExpr }
knownCall context expr = do
  let call = spine expr
  key <- case strip call.head of
    Var qualified -> case qualify context.moduleName qualified of
      Qualified (Just mod) name | mod == context.moduleName -> Just (TopLevelKey name)
      _ -> Nothing
    Local name level -> Just (LocalKey name level)
    _ -> Nothing
  fn <- Map.lookup key context.candidates
  guard (adtName fn.spec.ty == adtName context.candidate.spec.ty && Array.length call.args == Array.length fn.args)
  pure { fn, args: call.args }

treeTerm :: Context -> Env -> NeutralExpr -> Maybe TreeTerm
treeTerm context env expr = case pathValue context env expr of
  Just path -> Just (Keep path)
  Nothing -> case strip expr of
    CtorSaturated ctor _ _ _ fields -> do
      let qualified = qualify context.moduleName ctor
      if Just qualified == context.candidate.spec.leaf && Array.null fields then pure Empty
      else do
        guard (qualified == context.candidate.spec.nodeCtor)
        guard (Array.length fields == Array.length context.candidate.spec.fields)
        Construct <$> traverse (\(Tuple kind (Tuple _ value)) -> argument context env (fieldArgType kind) value)
          (Array.zip context.candidate.spec.fields fields)
    Var ctor | Just (qualify context.moduleName ctor) == context.candidate.spec.leaf -> Just Empty
    _ -> do
      call <- knownCall context expr
      Call call.fn.key <$> traverse (\(Tuple kind value) -> argument context env kind value)
        (Array.zip call.fn.argTypes call.args)

argument :: Context -> Env -> ArgType -> NeutralExpr -> Maybe Argument
argument context env expected expr =
  if expected == ArgTree then TreeArg <$> treeTerm context env expr
  else ScalarArg <$> scalar context env expr

fieldArgType :: FieldType -> ArgType
fieldArgType = case _ of
  TreeField -> ArgTree
  IntField -> ArgInt
  ObjectField -> ArgObject

leaves :: TreeTerm -> Array Path
leaves = case _ of
  Keep path -> [ path ]
  Construct args -> foldMap argumentLeaves args
  Call _ args -> foldMap argumentLeaves args
  _ -> []
  where
  argumentLeaves (TreeArg value) = leaves value
  argumentLeaves _ = []

-- Equality and ancestor/descendant overlap both represent aliases.
disjoint :: Array Path -> Boolean
disjoint paths = all identity (Array.mapWithIndex
  (\index path -> not (any (overlap path) (Array.drop (index + 1) paths))) paths)

continuationPaths :: Env -> NeutralExpr -> Array Path
continuationPaths env (NeutralExpr syn) = case syn of
  Local name level -> case Map.lookup (Tuple name level) env of
    Just (Tree path) -> [ path ]
    Just (Scalar value) -> value.reads
    _ -> []
  _ -> foldMap (continuationPaths env) syn

-- Decide whether to install the loop from its target, before resolving argument
-- values. Let aliases are not in the initial Env yet; using treeTerm here would
-- hide a valid self jump that emitBody later discovers. Full usage validation
-- still runs with the loop's snapshot environment before accepting the worker.
hasTailSelfCall :: Context -> NeutralExpr -> Boolean
hasTailSelfCall context expr = case strip expr of
  Branch branches fallback ->
    any (\(Pair _ body) -> hasTailSelfCall context body) (NonEmptyArray.toArray branches)
      || hasTailSelfCall context fallback
  Let _ _ _ body -> hasTailSelfCall context body
  LetRec _ _ body -> hasTailSelfCall context body
  Fail _ -> false
  _ -> case knownCall context expr of
    Just call -> call.fn.key == context.candidate.key
    _ -> false

-- The rewrite boundary accepts fresh constructor trees, never a borrowed local,
-- opaque call or global tree. Scalars must also be recognizable in an empty env.
freshTree :: Context -> NeutralExpr -> Boolean
freshTree context expr = case strip expr of
  CtorSaturated ctor _ _ _ fields ->
    let qualified = qualify context.moduleName ctor
    in if Just qualified == context.candidate.spec.leaf then Array.null fields
       else qualified == context.candidate.spec.nodeCtor
         && Array.length fields == Array.length context.candidate.spec.fields
         && all (\(Tuple kind (Tuple _ value)) ->
              if kind == TreeField then freshTree context value
              else isJust (scalar context Map.empty value))
            (Array.zip context.candidate.spec.fields fields)
  Var ctor -> Just (qualify context.moduleName ctor) == context.candidate.spec.leaf
  _ -> false

callees :: Context -> NeutralExpr -> Array CandidateKey
callees context expr@(NeutralExpr syn) =
  (case knownCall context expr of
    Just call -> [ call.fn.key ]
    Nothing -> []) <> foldMap (callees context) syn
