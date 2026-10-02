-- | Syntactic/type admission and stable worker names. A candidate is not yet a
-- | consumption proof: Analysis/Cells/Workers must validate every use later.
module Javapurs.Ownership.Candidates
  ( treeSpecs, candidate, localCandidates, reserveWorkers
  , strip, qualify, adtName, spine, ctorNames, nullaryCtorNames
  , argJavaType, argJavaTypes, scalarJavaType
  ) where

import Prelude

import Control.Alternative (guard)
import Data.Array as Array
import Data.Array.NonEmpty as NonEmptyArray
import Data.Foldable (foldMap, foldl)
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Newtype (unwrap)
import Data.Set as Set
import Data.String as String
import Data.String.Pattern (Pattern(..))
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..), snd)
import Javapurs.JavaAst (JavaParamType(..))
import Javapurs.Naming (constructorClassName, modulePrefix, sanitizeName)
import Javapurs.Ownership.Model (ArgType(..), Candidate, CandidateKey(..), FieldType(..), LocalRef, ScalarType(..), TreeSpec)
import PureScript.Backend.Optimizer.Convert (BackendModule)
import PureScript.Backend.Optimizer.CoreFn (DataDecl, ExprType(..), Ident(..), ModuleName, Qualified(..))
import PureScript.Backend.Optimizer.Semantics (NeutralExpr(..))
import PureScript.Backend.Optimizer.Syntax (BackendSyntax(..), Level)
import PureScript.Backend.Optimizer.Syntax as Syn

-- Wrapper stripping recognizes syntax only. annotation retains the original
-- definition's type through TypeApp; its type argument never types a binder.
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
ctorNames decls = Set.fromFoldable $ Array.concatMap (\decl -> map _.name decl.constructors) decls

-- Match the declared ADT name, so List a / Map k v cover their instantiations.
adtName :: ExprType -> Maybe String
adtName = case _ of
  ADT name _ _ -> Just name
  _ -> Nothing

isTreeType :: String -> ExprType -> Boolean
isTreeType name ty = adtName ty == Just name

scalarType :: Map String DataDecl -> ExprType -> Maybe ScalarType
scalarType decls = case _ of
  Int -> Just ScalarInt
  Boolean -> Just ScalarBoolean
  Number -> Just ScalarObject
  String -> Just ScalarObject
  Char -> Just ScalarObject
  ADT name _ _ -> do
    void (Map.lookup name decls)
    pure ScalarObject
  TypeVar _ -> Just ScalarObject
  _ -> Nothing

-- Exactly one non-nullary constructor, at most one leaf, and a recursive field.
treeSpecs :: BackendModule -> Array TreeSpec
treeSpecs mod = Array.mapMaybe make mod.dataDecls
  where
  decls = declByName mod.name mod.dataDecls
  make decl = do
    let
      fullName = fullTypeName mod.name decl
      ty = ADT fullName (String.split (Pattern ".") fullName) (map TypeVar decl.vars)
      nodes = Array.filter (not <<< Array.null <<< _.fields) decl.constructors
      nullary = Array.filter (Array.null <<< _.fields) decl.constructors
    node <- case nodes of
      [ only ] | Array.length nullary <= 1 -> Just only
      _ -> Nothing
    fields <- traverse (\field -> fieldType decls fullName field) node.fields
    guard (Array.elem TreeField fields)
    pure
      { ty
      , nodeCtor: Qualified (Just mod.name) (Ident node.name)
      , nodeClass: constructorClassName (modulePrefix mod.name) node.name
      , leaf: map (\ctor -> Qualified (Just mod.name) (Ident ctor.name)) (Array.head nullary)
      , fields
      }

fieldType :: Map String DataDecl -> String -> ExprType -> Maybe FieldType
fieldType decls treeName field
  | isTreeType treeName field = Just TreeField
  | otherwise = case field of
      Int -> Just IntField
      _ -> ObjectField <$ scalarType decls field

argType :: Map String DataDecl -> TreeSpec -> ExprType -> Maybe ArgType
argType decls spec ty
  | isTreeType (fromMaybe "" (adtName spec.ty)) ty = Just ArgTree
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
candidate mod specs (Tuple original expr) = mkCandidate mod specs (TopLevelKey original) Nothing original expr

localCandidate :: BackendModule -> Array TreeSpec -> Level -> Tuple Ident NeutralExpr -> Maybe Candidate
localCandidate mod specs level (Tuple original expr) =
  mkCandidate mod specs (LocalKey (Just original) level) (Just (unwrap level)) original expr

mkCandidate :: BackendModule -> Array TreeSpec -> CandidateKey -> Maybe Int -> Ident -> NeutralExpr -> Maybe Candidate
mkCandidate mod specs key level original expr = do
  signature <- arrow <$> annotation expr
  spec <- Array.find (\s -> adtName s.ty == adtName signature.result) specs
  let lambda = abstractions expr
  guard (not (Array.null lambda.args) && Array.length lambda.args == Array.length signature.args)
  argTypes <- traverse (argType (declByName mod.name mod.dataDecls) spec) signature.args
  guard (Array.elem ArgTree argTypes)
  -- Captured values are borrowed. Treating them as scalars will reject a later
  -- tree use; never promote a capture to an owned argument.
  let
    captures = case level of
      Nothing -> []
      Just groupLevel -> Array.nub (freeLocalsBelow groupLevel lambda.body)
    name = unwrap original
    javaName = sanitizeName ("__owned_" <> name)
  pure { original, key, worker: Ident ("__owned_" <> name), javaName, spec, captures, args: lambda.args, argTypes, body: lambda.body }

-- Absolute levels below a recursive group belong to its enclosing scope.
freeLocalsBelow :: Int -> NeutralExpr -> Array LocalRef
freeLocalsBelow level (NeutralExpr syn) = case syn of
  Local name lvl | unwrap lvl < level -> [ Tuple name lvl ]
  _ -> foldMap (freeLocalsBelow level) syn

localCandidates :: BackendModule -> Array TreeSpec -> Array Candidate
localCandidates mod specs =
  Array.concatMap (\group -> Array.concatMap (walk <<< snd) group.bindings) mod.bindings
  where
  walk (NeutralExpr syn) = case syn of
    LetRec level binds body ->
      let members = NonEmptyArray.toArray binds
      in Array.mapMaybe (localCandidate mod specs level) members
        <> Array.concatMap (walk <<< snd) members <> walk body
    _ -> foldMap walk syn

-- Reserve before validation: rejection never renumbers another worker.
reserveWorkers :: BackendModule -> Array Candidate -> Array Candidate
reserveWorkers mod candidates = _.candidates $ foldl assign { reserved, candidates: [] } candidates
  where
  reserved = Set.fromFoldable $
    map (sanitizeName <<< unwrap <<< (\(Tuple name _) -> name)) (Array.concatMap _.bindings mod.bindings)
      <> map (sanitizeName <<< unwrap) (Array.fromFoldable (Map.keys mod.foreign))
  assign acc fn =
    let
      choose index =
        let candidateName = if index == 0 then fn.javaName else fn.javaName <> "_" <> show index
        in if Set.member candidateName acc.reserved then choose (index + 1)
           else fn { javaName = candidateName, worker = Ident candidateName }
      renamed = choose 0
    in { reserved: Set.insert renamed.javaName acc.reserved, candidates: Array.snoc acc.candidates renamed }

spine :: NeutralExpr -> { head :: NeutralExpr, args :: Array NeutralExpr }
spine expr = case strip expr of
  App fn args -> let inner = spine fn in inner { args = inner.args <> NonEmptyArray.toArray args }
  UncurriedApp fn args -> let inner = spine fn in inner { args = inner.args <> args }
  _ -> { head: expr, args: [] }
