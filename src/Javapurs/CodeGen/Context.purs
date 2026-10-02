module Javapurs.CodeGen.Context
  ( CodegenEnv, LoopContext, TranslationContext, Position(..), EffectContext(..)
  , initialContext, valueContext, tailContext, closureContext, captureLoops
  , Translation, pureExpression, asExpression, prependStatement
  ) where

import Prelude

import Data.Array as Array
import Data.Map (Map)
import Data.Maybe (Maybe)
import Data.Tuple (Tuple)
import Javapurs.JavaAst (JavaExpr(..), JavaParamType)
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr, TcoRef)
import PureScript.Backend.Optimizer.CoreFn (Ident, ModuleName)
import PureScript.Backend.Optimizer.Syntax (Level)

-- Module facts and the lexical names of invocation-local invariant caches.
-- Control/effect position belongs to TranslationContext, not this environment.
type CodegenEnv =
  { moduleName :: String
  , sourceModule :: ModuleName
  , bindings :: Array (Tuple Ident TcoExpr)
  , lazyBindings :: Array String
  , boxedFunctions :: Array (Tuple String Int)
  , typedRecords :: Boolean
  , loopInvariants :: Boolean
  , intFunctions :: Boolean
  , ownedFunctions :: Map String { javaName :: String, params :: Array JavaParamType }
  , invariantLocals :: Array (Tuple (Tuple (Maybe Ident) Level) String)
  , invariantScope :: String
  }

type LoopContext =
  { ident :: String
  , params :: Array String
  , canContinue :: Boolean
  , ref :: TcoRef
  }

data Position = ValuePosition | TailPosition
derive instance Eq Position

-- Construct an action value, or translate the body of an action being executed.
data EffectContext = EffectValue | ExecutingEffect
derive instance Eq EffectContext

type TranslationContext =
  { loops :: Array LoopContext
  , position :: Position
  , effect :: EffectContext
  }

initialContext :: TranslationContext
initialContext = { loops: [], position: ValuePosition, effect: EffectValue }

-- Operands construct values even inside an executing effect. Their statements
-- stay inside their own expression; they cannot continue a loop at this site.
valueContext :: TranslationContext -> TranslationContext
valueContext context = context { position = ValuePosition, effect = EffectValue }

tailContext :: TranslationContext -> TranslationContext
tailContext context = context { position = TailPosition }

-- A source closure keeps iteration snapshots but cannot continue its caller's
-- loop. Retaining the entries is essential for translating captured locals.
captureLoops :: Array LoopContext -> Array LoopContext
captureLoops = map (_ { canContinue = false })

closureContext :: TranslationContext -> TranslationContext
closureContext context = (tailContext context) { loops = captureLoops context.loops }

-- Execute statements once, in order, then evaluate the result in their scope.
-- Only sequential continuations may prepend statements. Operands use
-- asExpression so a later argument/guard never runs ahead of an earlier one.
type Translation = { statements :: Array JavaExpr, result :: JavaExpr }

pureExpression :: JavaExpr -> Translation
pureExpression result = { statements: [], result }

asExpression :: Translation -> JavaExpr
asExpression { statements, result } =
  if Array.null statements then result else JavaBlock statements result

prependStatement :: JavaExpr -> Translation -> Translation
prependStatement statement translated = translated
  { statements = Array.cons statement translated.statements }
