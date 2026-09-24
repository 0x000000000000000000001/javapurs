-- | Consuming workers for closed, first-order tree functions.
-- |
-- | A worker may update the nodes it receives in place because every caller
-- | hands over a tree it no longer uses, and a fresh tree shares nothing with a
-- | previously reachable one. The proofs live here: a call is only rewritten
-- | when its tree arguments are constructed values, and inside a worker every
-- | read is copied into a temporary before any node changes. Fields of the tree
-- | constructors lose `final` so the emitted code can update them.
module Javapurs.Ownership (prepare) where

import Prelude

import Control.Alternative (guard)
import Control.Monad.State (StateT, evalStateT, get, put)
import Control.Monad.Trans.Class (lift)
import Data.Array as Array
import Data.Array.NonEmpty as NonEmptyArray
import Data.Foldable (all, any, foldMap, foldl, foldM)
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe, isJust)
import Data.Newtype (unwrap)
import Data.Set as Set
import Data.String as String
import Data.String.CodeUnits as StringCodeUnits
import Data.String.Pattern (Pattern(..))
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..), fst)
import Javapurs.JavaAst (JavaExpr(..), JavaParamType(..))
import Javapurs.Naming (constructorClassName, modulePrefix, safeCtorName, sanitizeName)
import Javapurs.Operators (translateOperator1, translateOperator2)
import Javapurs.Printer (printExpr)
import PureScript.Backend.Optimizer.Convert (BackendModule)
import PureScript.Backend.Optimizer.CoreFn (DataDecl, ExprType(..), Ident(..), Literal(..), ModuleName(..), Qualified(..))
import PureScript.Backend.Optimizer.Semantics (NeutralExpr(..))
import PureScript.Backend.Optimizer.Syntax (BackendAccessor(..), BackendOperator(..), BackendOperator1(..), BackendOperator2(..), BackendSyntax(..), Level, Pair(..))
import PureScript.Backend.Optimizer.Syntax as Syn

type LocalRef = Tuple (Maybe Ident) Level

data Path = Path String (Array Int)
derive instance eqPath :: Eq Path
derive instance ordPath :: Ord Path

-- | The Java representation of a scalar value. Proven Int values stay
-- | primitive; everything else is an Object or a primitive boolean.
data ScalarType = ScalarInt | ScalarBoolean | ScalarObject
derive instance eqScalarType :: Eq ScalarType

type Scalar = { expr :: JavaExpr, ty :: ScalarType, reads :: Array Path }

data Value = Tree Path | Scalar Scalar

type Env = Map LocalRef Value

data FieldType = TreeField | IntField | ObjectField
derive instance eqFieldType :: Eq FieldType

data ArgType = ArgTree | ArgInt | ArgObject
derive instance eqArgType :: Eq ArgType

type TreeSpec =
  { ty :: ExprType
  , nodeCtor :: Qualified Ident
  , nodeClass :: String
  , leaf :: Maybe (Qualified Ident)
  , fields :: Array FieldType
  }

type Candidate =
  { original :: Ident
  , worker :: Ident
  , javaName :: String
  , spec :: TreeSpec
  , args :: Array LocalRef
  , argTypes :: Array ArgType
  , body :: NeutralExpr
  }

type Context =
  { moduleName :: ModuleName
  , candidate :: Candidate
  , candidates :: Map Ident Candidate
  , dataDecls :: Array DataDecl
  , donorName :: String
  }

-- | A tree still standing in memory: a borrowed path, the empty leaf, a
-- | construction, or a call to a consuming worker.
data TreeTerm
  = Keep Path
  | Empty
  | Construct (Array Argument)
  | Call Ident (Array Argument)
  | Existing JavaExpr

data Argument = TreeArg TreeTerm | ScalarArg Scalar

type CellPool = { known :: Array String, nullable :: Array String }
type Generated = { stmts :: Array JavaExpr, expr :: JavaExpr, pool :: CellPool }
type TakenCell = { stmts :: Array JavaExpr, expr :: JavaExpr, pool :: CellPool, nonNull :: Boolean }
type Gen = StateT Int Maybe

-- | A worker body as straight-line statements ending in a return or a jump
-- | back to the worker loop.
data Term
  = TermReturn JavaExpr
  | TermContinue JavaExpr
  | TermIf JavaExpr Term Term
  | TermStmts (Array JavaExpr) Term

hasTermContinue :: Term -> Boolean
hasTermContinue = case _ of
  TermReturn _ -> false
  TermContinue _ -> true
  TermIf _ yes no -> hasTermContinue yes || hasTermContinue no
  TermStmts _ term -> hasTermContinue term

termExpr :: Term -> JavaExpr
termExpr = case _ of
  TermReturn value -> value
  TermContinue jump -> jump
  TermIf condition yes no -> JavaTernary condition (termExpr yes) (termExpr no)
  TermStmts stmts term -> JavaBlock stmts (termExpr term)

-- | The prepared module, its worker declarations and the flat signatures that
-- | call sites must use.
type Prepared =
  { module :: BackendModule
  , declarations :: Array JavaExpr
  , functions :: Map String { javaName :: String, params :: Array JavaParamType }
  , mutableClasses :: Array String
  , diagnostics :: Array String
  }

prepare :: BackendModule -> Prepared
prepare mod =
  let
    specs = treeSpecs mod
    found = reserveWorkers mod $ Array.mapMaybe (candidate mod specs) (Array.concatMap _.bindings mod.bindings)
    initial = Map.fromFoldable $ map (\fn -> Tuple fn.original fn) found
    accepted = validateCandidates mod initial
    workers = Array.fromFoldable (Map.values accepted)
    contextOf fn =
      { moduleName: mod.name
      , candidate: fn
      , candidates: accepted
      , dataDecls: mod.dataDecls
      , donorName: "__donor"
      }
    declarations = foldMap (\fn -> fromMaybe [] (workerDeclarations (contextOf fn) fn)) workers
    functions = Map.fromFoldable $ map (\fn -> Tuple (unwrap fn.worker)
      { javaName: fn.javaName, params: argJavaTypes fn.argTypes <> [ ParamObject ] }) workers
    mutableClasses = Array.nub $ map (\fn -> fn.spec.nodeClass) workers
    diagnostics = Array.concat
      [ [ "ownership: " <> show (Array.length specs) <> " tree types, "
            <> show (Map.size initial) <> " candidates, "
            <> show (Map.size accepted) <> " accepted" ]
      , if Array.null workers then []
        else [ "ownership: consuming workers for " <> String.joinWith ", " (map (unwrap <<< _.original) workers) ]
      ]
  in
    { module: mod { bindings = map (\group -> group { bindings = map (\(Tuple name expr) ->
        Tuple name (rewrite mod.name mod.dataDecls accepted expr)) group.bindings }) mod.bindings }
    , declarations
    , functions
    , mutableClasses
    , diagnostics
    }

strip :: NeutralExpr -> BackendSyntax NeutralExpr
strip (NeutralExpr syn) = case syn of
  Typed _ inner -> strip inner
  Syn.TypeApp inner _ -> strip inner
  _ -> syn

annotation :: NeutralExpr -> Maybe ExprType
annotation (NeutralExpr syn) = case syn of
  Typed ty _ -> Just ty
  Syn.TypeApp inner _ -> annotation inner
  _ -> Nothing

arrow :: ExprType -> { args :: Array ExprType, result :: ExprType }
arrow (Func args result) = let next = arrow result in { args: args <> next.args, result: next.result }
arrow ty = { args: [], result: ty }

abstractions :: NeutralExpr -> { args :: Array LocalRef, body :: NeutralExpr }
abstractions expr = case strip expr of
  Abs args body -> let next = abstractions body in { args: NonEmptyArray.toArray args <> next.args, body: next.body }
  UncurriedAbs args body | not (Array.null args) ->
    let next = abstractions body in { args: args <> next.args, body: next.body }
  _ -> { args: [], body: expr }

qualify :: ModuleName -> Qualified Ident -> Qualified Ident
qualify current (Qualified mod ident) = Qualified (Just (fromMaybe current mod)) ident

fullTypeName :: ModuleName -> DataDecl -> String
fullTypeName mod decl = unwrap mod <> "." <> decl.name

declByName :: ModuleName -> Array DataDecl -> Map String DataDecl
declByName mod decls = Map.fromFoldable (map (\decl -> Tuple (fullTypeName mod decl) decl) decls)

nullaryCtorNames :: Array DataDecl -> Set.Set String
nullaryCtorNames decls = Set.fromFoldable $ Array.concatMap
  (\decl -> map _.name (Array.filter (Array.null <<< _.fields) decl.constructors)) decls

ctorNames :: Array DataDecl -> Set.Set String
ctorNames decls = Set.fromFoldable $ Array.concatMap
  (\decl -> map _.name decl.constructors) decls

scalarType :: Map String DataDecl -> ExprType -> Maybe ScalarType
scalarType decls = case _ of
  Int -> Just ScalarInt
  Boolean -> Just ScalarBoolean
  Number -> Just ScalarObject
  String -> Just ScalarObject
  Char -> Just ScalarObject
  ADT name _ _ -> do
    decl <- Map.lookup name decls
    guard (Array.null decl.vars)
    guard (all (Array.null <<< _.fields) decl.constructors)
    pure ScalarObject
  _ -> Nothing

treeSpecs :: BackendModule -> Array TreeSpec
treeSpecs mod = Array.mapMaybe make mod.dataDecls
  where
  decls = declByName mod.name mod.dataDecls
  make decl = do
    guard (Array.null decl.vars)
    let
      fullName = fullTypeName mod.name decl
      ty = ADT fullName (String.split (Pattern ".") fullName) []
      nodes = Array.filter (not <<< Array.null <<< _.fields) decl.constructors
      nullary = Array.filter (Array.null <<< _.fields) decl.constructors
    node <- case nodes of
      [ only ] | Array.length nullary <= 1 -> Just only
      _ -> Nothing
    fields <- traverse (\field -> fieldType decls ty field) node.fields
    guard (Array.elem TreeField fields)
    pure
      { ty
      , nodeCtor: Qualified (Just mod.name) (Ident node.name)
      , nodeClass: constructorClassName (modulePrefix mod.name) node.name
      , leaf: map (\ctor -> Qualified (Just mod.name) (Ident ctor.name)) (Array.head nullary)
      , fields
      }

fieldType :: Map String DataDecl -> ExprType -> ExprType -> Maybe FieldType
fieldType decls treeTy field
  | field == treeTy = Just TreeField
  | otherwise = case field of
      Int -> Just IntField
      _ -> ObjectField <$ scalarType decls field

argType :: Map String DataDecl -> TreeSpec -> ExprType -> Maybe ArgType
argType decls spec ty
  | ty == spec.ty = Just ArgTree
  | otherwise = case scalarType decls ty of
      Just ScalarInt -> Just ArgInt
      Just _ -> Just ArgObject
      Nothing -> Nothing

argJavaType :: ArgType -> JavaParamType
argJavaType = case _ of
  ArgInt -> ParamInt
  _ -> ParamObject

argJavaTypes :: Array ArgType -> Array JavaParamType
argJavaTypes = map argJavaType

scalarJavaType :: FieldType -> ScalarType
scalarJavaType = case _ of
  IntField -> ScalarInt
  _ -> ScalarObject

candidate :: BackendModule -> Array TreeSpec -> Tuple Ident NeutralExpr -> Maybe Candidate
candidate mod specs (Tuple original@(Ident name) expr) = do
  signature <- arrow <$> annotation expr
  spec <- Array.find (\s -> s.ty == signature.result) specs
  let lambda = abstractions expr
  guard (not (Array.null lambda.args) && Array.length lambda.args == Array.length signature.args)
  argTypes <- traverse (argType (declByName mod.name mod.dataDecls) spec) signature.args
  guard (Array.elem ArgTree argTypes)
  let javaName = sanitizeName ("__owned_" <> name)
  pure { original, worker: Ident ("__owned_" <> name), javaName, spec, args: lambda.args, argTypes, body: lambda.body }

-- | Worker names must not collide with an existing binding or foreign symbol.
reserveWorkers :: BackendModule -> Array Candidate -> Array Candidate
reserveWorkers mod candidates = _.candidates $ foldl assign { reserved, candidates: [] } candidates
  where
  reserved :: Set.Set String
  reserved = Set.fromFoldable bindingNames

  bindingNames :: Array String
  bindingNames =
    map bindingName bindingList
      <> map foreignName (Array.fromFoldable (Map.keys mod.foreign))

  bindingList :: Array (Tuple Ident NeutralExpr)
  bindingList = Array.concatMap _.bindings mod.bindings

  bindingName :: Tuple Ident NeutralExpr -> String
  bindingName (Tuple (Ident name) _) = sanitizeName name

  foreignName :: Ident -> String
  foreignName (Ident name) = sanitizeName name
  assign acc fn =
    let
      choose index =
        let candidateName = if index == 0 then fn.javaName else fn.javaName <> "_" <> show index
        in if Set.member candidateName acc.reserved then choose (index + 1)
           else fn { javaName = candidateName, worker = Ident candidateName }
      renamed = choose 0
    in
      { reserved: Set.insert renamed.javaName acc.reserved
      , candidates: Array.snoc acc.candidates renamed
      }

pathExpr :: TreeSpec -> Path -> JavaExpr
pathExpr spec (Path root fields) = foldl step (JavaLocal root) fields
  where
  step value index = JavaPropertyAccess value spec.nodeClass ("value" <> show index)

prefix :: Path -> Path -> Boolean
prefix (Path a xs) (Path b ys) = a == b && Array.take (Array.length xs) ys == xs

overlap :: Path -> Path -> Boolean
overlap a b = prefix a b || prefix b a

prefixes :: Path -> Array Path
prefixes (Path root fields) =
  if Array.null fields then []
  else map (Path root <<< flip Array.take fields) (Array.range 0 (Array.length fields - 1))

appendField :: Path -> Int -> Path
appendField (Path root fields) index = Path root (Array.snoc fields index)

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

-- | A local constructor reference of this module, with its Java class.
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

-- | Scalars are plain Java expressions with a known representation. A local
-- | constructor of an all-nullary type is a shared singleton.
scalar :: Context -> Env -> NeutralExpr -> Maybe Scalar
scalar context env expr = case strip expr of
  Local name level -> case Map.lookup (Tuple name level) env of
    Just (Scalar value) -> Just value
    _ -> Nothing
  Lit lit -> literalScalar lit
  CtorSaturated ctor _ _ _ fields | Array.null fields ->
    nullaryScalar context ctor
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
  LitNumber value -> Just { expr: JavaRaw (show value), ty: ScalarObject, reads: [] }
  LitString value -> Just { expr: JavaString value, ty: ScalarObject, reads: [] }
  LitChar value -> Just { expr: JavaRaw ("'" <> StringCodeUnits.singleton value <> "'"), ty: ScalarObject, reads: [] }
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

spine :: NeutralExpr -> { head :: NeutralExpr, args :: Array NeutralExpr }
spine expr = case strip expr of
  App fn args -> let inner = spine fn in inner { args = inner.args <> NonEmptyArray.toArray args }
  UncurriedApp fn args -> let inner = spine fn in inner { args = inner.args <> args }
  _ -> { head: expr, args: [] }

knownCall :: Context -> NeutralExpr -> Maybe { fn :: Candidate, args :: Array NeutralExpr }
knownCall context expr = do
  let call = spine expr
  name <- case strip call.head of
    Var qualified -> case qualify context.moduleName qualified of
      Qualified (Just mod) name | mod == context.moduleName -> Just name
      _ -> Nothing
    _ -> Nothing
  fn <- Map.lookup name context.candidates
  guard (fn.spec.ty == context.candidate.spec.ty && Array.length call.args == Array.length fn.args)
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
      Call call.fn.original <$> traverse (\(Tuple kind value) -> argument context env kind value)
        (Array.zip call.fn.argTypes call.args)

argument :: Context -> Env -> ArgType -> NeutralExpr -> Maybe Argument
argument context env expected expr =
  if expected == ArgTree then TreeArg <$> treeTerm context env expr
  else do
    value <- scalar context env expr
    pure (ScalarArg value)

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

freshName :: String -> Gen String
freshName prefix_ = do
  next <- get
  put (next + 1)
  pure (prefix_ <> show next)

snapshot :: TreeSpec -> TreeTerm -> Gen { stmts :: Array JavaExpr, term :: TreeTerm }
snapshot spec = case _ of
  Keep path -> do
    name <- freshName "__read_"
    pure { stmts: [ JavaLocalAssign name (pathExpr spec path) ], term: Existing (JavaLocal name) }
  Construct args -> do
    result <- traverse (snapshotArgument spec) args
    pure { stmts: foldMap _.stmts result, term: Construct (map _.arg result) }
  Call name args -> do
    result <- traverse (snapshotArgument spec) args
    pure { stmts: foldMap _.stmts result, term: Call name (map _.arg result) }
  term -> pure { stmts: [], term }

snapshotArgument :: TreeSpec -> Argument -> Gen { stmts :: Array JavaExpr, arg :: Argument }
snapshotArgument spec = case _ of
  TreeArg value -> do
    result <- snapshot spec value
    pure { stmts: result.stmts, arg: TreeArg result.term }
  ScalarArg value -> do
    name <- freshName "__scalar_"
    pure { stmts: [ snapshotScalar name value ], arg: ScalarArg (snapshotScalarValue name value) }

-- | A worker whose body ends in a self tail call becomes a loop, so its
-- | parameters are read through the per-iteration snapshots.
hasTailSelfCall :: Context -> Env -> NeutralExpr -> Boolean
hasTailSelfCall context env expr = case strip expr of
  Branch branches fallback ->
    any (\(Pair _ body) -> hasTailSelfCall context env body) (NonEmptyArray.toArray branches)
      || hasTailSelfCall context env fallback
  Let _ _ _ body -> hasTailSelfCall context env body
  Fail _ -> false
  _ -> case treeTerm context env expr of
    Just (Call name _) -> name == context.candidate.original
    _ -> false

takeCell :: Context -> CellPool -> Gen TakenCell
takeCell context pool = case Array.uncons pool.known of
  Just { head, tail } -> pure
    { stmts: [], expr: JavaLocal head, pool: pool { known = tail }, nonNull: true }
  Nothing -> do
    name <- freshName "__cell_"
    let
      -- A dead local may hold the shared leaf, which is never a reusable node.
      takeOne slot rest =
        [ JavaIf (JavaBinaryOp "&&"
              (JavaInstanceOf (JavaLocal slot) context.candidate.spec.nodeClass)
              (JavaBinaryOp "!=" (JavaLocal slot) (JavaRaw "null")))
            [ JavaLocalSet name (JavaLocal slot), JavaLocalSet slot (JavaRaw "null") ]
            rest ]
    pure
      { stmts: [ JavaLocalAssign name (JavaRaw "null") ] <> Array.foldr takeOne [] pool.nullable
      , expr: JavaLocal name
      , pool
      , nonNull: false
      }

emitTree :: Context -> CellPool -> Boolean -> TreeTerm -> Gen Generated
emitTree context pool outer = case _ of
  Existing expr -> pure { stmts: [], expr, pool }
  Empty -> pure { stmts: [], expr: leafValue context.candidate.spec, pool }
  Keep _ -> lift Nothing
  Construct args -> do
    values <- emitArguments context pool args
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
                [ JavaLocalSet name (JavaNew spec.nodeClass values.exprs) ]
                assigns
            ]
        , expr: result
        , pool: cell.pool
        }
  Call name args -> do
    fn <- lift $ Map.lookup name context.candidates
    values <- emitArguments context pool args
    donor <- if outer then takeCell context values.pool
      else pure { stmts: [], expr: JavaRaw "null", pool: values.pool, nonNull: false }
    result <- freshName "__result_"
    pure
      { stmts: values.stmts <> donor.stmts
          <> [ JavaLocalAssign result (JavaCall (JavaLocal fn.javaName) (values.exprs <> [ donor.expr ])) ]
      , expr: JavaLocal result
      , pool: donor.pool
      }

fieldJavaType :: TreeSpec -> Int -> JavaParamType
fieldJavaType spec index = case Array.index spec.fields index of
  Just IntField -> ParamInt
  _ -> ParamObject

emitArguments :: Context -> CellPool -> Array Argument -> Gen
  { stmts :: Array JavaExpr, exprs :: Array JavaExpr, pool :: CellPool }
emitArguments context pool = foldM step { stmts: [], exprs: [], pool }
  where
  step result arg = do
    value <- emitArgument context result.pool arg
    pure { stmts: result.stmts <> value.stmts, exprs: Array.snoc result.exprs value.expr, pool: value.pool }

emitArgument :: Context -> CellPool -> Argument -> Gen Generated
emitArgument context pool = case _ of
  TreeArg tree -> emitTree context pool false tree
  ScalarArg value -> pure { stmts: [], expr: value.expr, pool }

plan :: Context -> Env -> Array Path -> TreeTerm -> Gen
  { stmts :: Array JavaExpr, term :: TreeTerm, pool :: CellPool, retired :: Array Path }
plan context env future term = do
  lift $ guard (disjoint $ leaves term)
  captured <- snapshot context.candidate.spec term
  let
    retained = leaves term
    roots = Array.mapMaybe (case _ of
      Tree (Path root _) -> Just (Path root [])
      _ -> Nothing) (Array.fromFoldable $ Map.values env)
    nonNull = Array.nub $ foldMap prefixes retained
    candidates = Array.nub $ roots <> nonNull
    dead = Array.filter (\path -> not (any (\kept -> prefix kept path) retained)
      && not (any (overlap path) future)) candidates
  slots <- traverse (\path -> do
    name <- freshName "__dead_"
    pure { name, nonNull: Array.elem path nonNull, stmt: JavaLocalAssign name (pathExpr context.candidate.spec path) }) dead
  donor <- freshName "__donor_slot_"
  pure
    { stmts: captured.stmts <> [ JavaLocalAssign donor (JavaLocal context.donorName) ] <> map _.stmt slots
    , term: captured.term
    , pool: { known: map _.name (Array.filter _.nonNull slots)
            , nullable: [ donor ] <> map _.name (Array.filter (not <<< _.nonNull) slots) }
    , retired: retained <> dead
    }

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
        result <- emitTree context prepared.pool true prepared.term
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
               , JavaLocalSet context.donorName (JavaRaw "null")
               ])
          rest)
  _ -> do
    term <- lift $ treeTerm context env expr
    prepared <- plan context env [] term
    case prepared.term of
      Call name args | name == context.candidate.original -> do
        values <- emitArguments context prepared.pool args
        donor <- takeCell context values.pool
        pure (TermStmts
          (prepared.stmts <> values.stmts <> donor.stmts)
          (TermContinue (JavaContinue (unwrap context.candidate.worker) (values.exprs <> [ donor.expr ]))))
      _ -> do
        result <- emitTree context prepared.pool true prepared.term
        pure (TermStmts (prepared.stmts <> result.stmts) (TermReturn result.expr))

type Decision = { cases :: Array (Tuple JavaExpr Term), fallback :: Term }

collectTermIf :: Term -> Decision
collectTermIf = go []
  where
  go acc = case _ of
    TermIf condition yes no -> go (Array.snoc acc (Tuple condition yes)) no
    fallback -> { cases: acc, fallback }

-- | Rough printed size of a term. The budget keeps every emitted method small
-- | enough for HotSpot to compile and inline it.
termSize :: Term -> Int
termSize term = String.length (printExpr (termExpr term))

termBudget :: Int
termBudget = 6000

-- | Compiles a terminal term into methods no larger than the budget. A term
-- | that fits becomes one method; otherwise each branch level becomes a
-- | dispatcher calling one method per case, and only the cases that still
-- | exceed the budget are split further. Every condition is evaluated once.
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
            JavaTernary condition (JavaCall (JavaLocal (caseName index)) caseArgs) (go (index + 1))
          Nothing -> JavaCall (JavaLocal fallbackName) caseArgs
      in
        caseDecls <> fallbackDecls <> [ JavaStaticMethod name allParams (go 0) ]

workerDeclarations :: Context -> Candidate -> Maybe (Array JavaExpr)
workerDeclarations context fn = do
  let
    params = Array.mapWithIndex (\index argTy -> Tuple ("owned" <> show index) (argJavaType argTy)) fn.argTypes
    donorArg = "donor"
    envWith nameOf = Map.fromFoldable $ Array.mapWithIndex (\index ref ->
      let
        name = "owned" <> show index
        argTy = fromMaybe ArgObject (Array.index fn.argTypes index)
      in
        Tuple ref (case argTy of
          ArgTree -> Tree (Path (nameOf name) [])
          ArgInt -> Scalar { expr: JavaLocal (nameOf name), ty: ScalarInt, reads: [] }
          ArgObject -> Scalar { expr: JavaLocal (nameOf name), ty: ScalarObject, reads: [] })) fn.args
    plainEnv = envWith identity
    loops = hasTailSelfCall context plainEnv fn.body
    env = envWith (\name -> if loops then "__final_" <> name else name)
    donorName = if loops then "__donorOwned" else "donor"
    context' = context { candidate = fn, donorName = donorName }
  term <- evalStateT (emitBody context' env fn.body) 0
  let
    intParams = Array.mapMaybe (\(Tuple name javaTy) -> if javaTy == ParamInt then Just name else Nothing) params
    loopArgs = map fst params <> [ donorArg ]
    allParams = params <> [ Tuple donorArg ParamObject ]
    initialize = if loops then [ JavaLocalAssign donorName (JavaLocal ("__final_" <> donorArg)) ] else []
  if loops then
    pure [ JavaStaticMethod fn.javaName allParams (JavaWhileTrue loopArgs intParams (JavaBlock initialize (termExpr term))) ]
  else
    pure (compileTerm fn.javaName allParams term)

validateCandidates :: BackendModule -> Map Ident Candidate -> Map Ident Candidate
validateCandidates mod candidates =
  let accepted = Map.filter (\fn -> isJust (workerDeclarations (contextOf fn) fn)) candidates
  in if Map.size accepted == Map.size candidates then accepted else validateCandidates mod accepted
  where
  contextOf fn =
    { moduleName: mod.name
    , candidate: fn
    , candidates
    , dataDecls: mod.dataDecls
    , donorName: "__donor"
    }

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

rewrite :: ModuleName -> Array DataDecl -> Map Ident Candidate -> NeutralExpr -> NeutralExpr
rewrite moduleName dataDecls candidates original@(NeutralExpr syn) =
  let
    call = spine original
    target = case strip call.head of
      Var qualified -> case qualify moduleName qualified of
        Qualified (Just mod) name | mod == moduleName -> Map.lookup name candidates
        _ -> Nothing
      _ -> Nothing
    choose = do
      fn <- target
      guard (Array.length call.args == Array.length fn.args)
      let context =
            { moduleName
            , candidate: fn
            , candidates
            , dataDecls
            , donorName: "__donor"
            }
      guard (all (\(Tuple kind value) -> kind /= ArgTree || freshTree context value) (Array.zip fn.argTypes call.args))
      args <- NonEmptyArray.fromArray (map (rewrite moduleName dataDecls candidates) call.args)
      pure $ NeutralExpr $ Syn.App (NeutralExpr $ Syn.Var (Qualified (Just moduleName) fn.worker)) args
  in
    fromMaybe (NeutralExpr $ map (rewrite moduleName dataDecls candidates) syn) choose
