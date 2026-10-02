-- | The ownership proof's vocabulary. Paths describe borrowed input locations;
-- | TreeTerm describes a result before mutation, Term a snapshotted worker body.
module Javapurs.Ownership.Model
  ( LocalRef, Path(..), ScalarType(..), Scalar, Value(..), Env
  , FieldType(..), ArgType(..), TreeSpec, CandidateKey(..), Candidate, Context
  , TreeTerm(..), Argument(..), CellPool, Generated, TakenCell, Gen
  , Term(..), termExpr, pathExpr, prefix, overlap, prefixes, appendField
  ) where

import Prelude

import Control.Monad.State (StateT)
import Data.Array as Array
import Data.Foldable (foldl)
import Data.Map (Map)
import Data.Maybe (Maybe)
import Data.Tuple (Tuple)
import Javapurs.JavaAst (JavaExpr(..))
import PureScript.Backend.Optimizer.CoreFn (DataDecl, ExprType, Ident, ModuleName, Qualified)
import PureScript.Backend.Optimizer.Semantics (NeutralExpr)
import PureScript.Backend.Optimizer.Syntax (Level)

type LocalRef = Tuple (Maybe Ident) Level

data Path = Path String (Array Int)
derive instance eqPath :: Eq Path

data ScalarType = ScalarInt | ScalarBoolean | ScalarObject
derive instance eqScalarType :: Eq ScalarType

-- reads tracks input nodes whose fields have not yet been snapshotted.
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

data CandidateKey = TopLevelKey Ident | LocalKey (Maybe Ident) Level
derive instance eqCandidateKey :: Eq CandidateKey
derive instance ordCandidateKey :: Ord CandidateKey

type Candidate =
  { original :: Ident
  , key :: CandidateKey
  , worker :: Ident
  , javaName :: String
  , spec :: TreeSpec
  , captures :: Array LocalRef
  , args :: Array LocalRef
  , argTypes :: Array ArgType
  , body :: NeutralExpr
  }

type Context =
  { moduleName :: ModuleName
  , candidate :: Candidate
  , candidates :: Map CandidateKey Candidate
  , dataDecls :: Array DataDecl
  , donorName :: String
  }

-- Existing is introduced by snapshotting; a Keep must never reach emission.
data TreeTerm = Keep Path | Empty | Construct (Array Argument)
  | Call CandidateKey (Array Argument) | Existing JavaExpr
data Argument = TreeArg TreeTerm | ScalarArg Scalar

-- known slots contain reusable nodes; nullable slots need a node-class check
-- and are cleared when taken. A shared nullary leaf is never a reusable cell.
type CellPool = { known :: Array String, nullable :: Array String }
type Generated = { stmts :: Array JavaExpr, expr :: JavaExpr, pool :: CellPool }
type TakenCell = { stmts :: Array JavaExpr, expr :: JavaExpr, pool :: CellPool, nonNull :: Boolean }
type Gen = StateT Int Maybe

data Term = TermReturn JavaExpr | TermContinue JavaExpr
  | TermIf JavaExpr Term Term | TermStmts (Array JavaExpr) Term

termExpr :: Term -> JavaExpr
termExpr = case _ of
  TermReturn value -> value
  TermContinue jump -> jump
  TermIf condition yes no -> JavaTernary condition (termExpr yes) (termExpr no)
  TermStmts stmts term -> JavaBlock stmts (termExpr term)

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
