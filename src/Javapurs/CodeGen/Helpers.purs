-- | Pure helpers for the expression translator: call-target selection, boxed
-- | arity, local/global lookup, literals, accessors and branch assembly. Keeping
-- | them here leaves CodeGen.Expr focused on the recursive dispatcher.
module Javapurs.CodeGen.Helpers
  ( GuardedTranslation
  , boxedFunctionArity
  , executeEffect
  , guardedExpression
  , mentionsJavaLocal
  , tailTarget
  , translateAccessor
  , translateFields
  , translateGlobal
  , translateLiteral
  , translateLocal
  ) where

import Prelude

import Data.Array as Array
import Data.Foldable (any)
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))
import Javapurs.CodeGen.Context (CodegenEnv, LoopContext, Position(..), Translation, TranslationContext, asExpression)
import Javapurs.CodeGen.Syntax (Application, isEffectNode, unwrapTcoExpr)
import Javapurs.JavaAst (JavaExpr(..), children)
import Javapurs.Literals (charLiteral, numberLiteral)
import Javapurs.Naming (constructorClassName, lazyGetterName, loopSnapshotName, modulePrefix, sanitizeName)
import Javapurs.RecordShapes (recordShapeOf)
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr)
import PureScript.Backend.Optimizer.CoreFn (Ident(..), Literal(..), Prop(..), Qualified(..))
import PureScript.Backend.Optimizer.FreeVars (localId)
import PureScript.Backend.Optimizer.Syntax (BackendAccessor(..), BackendSyntax(..), Level)

tailTarget :: TranslationContext -> Application -> Maybe LoopContext
tailTarget context flat
  | context.position /= TailPosition = Nothing
  | otherwise = do
      name <- case unwrapTcoExpr flat.fn of
        Local ident@(Just _) level -> Just (localId ident level)
        Var (Qualified _ (Ident ident)) -> Just (sanitizeName ident)
        _ -> Nothing
      target <- Array.find (\loop -> loop.canContinue && loop.ident == name) context.loops
      if Array.length target.params == Array.length flat.args then Just target else Nothing

boxedFunctionArity :: CodegenEnv -> TcoExpr -> Int
boxedFunctionArity env expression = case unwrapTcoExpr expression of
  Var (Qualified qualifier (Ident name))
    | qualifier == Nothing || qualifier == Just env.sourceModule ->
        case Array.find (\(Tuple ident _) -> ident == sanitizeName name) env.boxedFunctions of
          Just (Tuple _ arity) -> arity
          Nothing -> 0
  _ -> 0

mentionsJavaLocal :: String -> JavaExpr -> Boolean
mentionsJavaLocal name = case _ of
  JavaLocal local -> local == name
  expression -> any (mentionsJavaLocal name) (children expression)

executeEffect :: TcoExpr -> JavaExpr -> JavaExpr
executeEffect source value =
  if isEffectNode source then value
  else JavaCall (JavaInstanceMethodRef value "java.util.function.Supplier" "get") []

type GuardedTranslation = { condition :: Translation, value :: Translation }

guardedExpression :: GuardedTranslation -> JavaExpr -> JavaExpr
guardedExpression { condition, value } rest =
  let branch = JavaTernary condition.result (asExpression value) rest
  in if Array.null condition.statements && Array.null value.statements then branch
     else JavaBlock condition.statements branch

translateLocal :: CodegenEnv -> TranslationContext -> Maybe Ident -> Level -> JavaExpr
translateLocal env context ident level =
  let name = localId ident level
  in case Array.find (\(Tuple local _) -> local == Tuple ident level) env.invariantLocals of
    Just (Tuple _ cache) -> JavaLoopInvariant cache
    Nothing ->
      if any (\loop -> Array.elem name loop.params) context.loops then JavaLocal (loopSnapshotName name)
      else JavaLocal name

translateGlobal :: CodegenEnv -> Qualified Ident -> JavaExpr
translateGlobal env (Qualified qualifier (Ident name)) =
  let
    moduleName = map modulePrefix qualifier
    javaName = sanitizeName name
    isCurrentModule = moduleName == Nothing || moduleName == Just env.moduleName
  in if isCurrentModule && Array.elem javaName env.lazyBindings then
       JavaCall (JavaStaticMethodRef (Just env.moduleName) (lazyGetterName javaName)) []
     else JavaGlobalVar moduleName javaName

translateLiteral :: (TcoExpr -> JavaExpr) -> Literal TcoExpr -> JavaExpr
translateLiteral value = case _ of
  LitInt n -> JavaRaw (show n)
  LitNumber n -> JavaRaw (numberLiteral n)
  LitString s -> JavaString s
  -- Char shares the one-character String representation used by Java FFI.
  LitChar c -> charLiteral c
  LitBoolean b -> JavaRaw (if b then "true" else "false")
  LitArray elements -> JavaArray (map value elements)
  LitRecord fields -> JavaRecord (translateFields value fields)

translateFields :: (TcoExpr -> JavaExpr) -> Array (Prop TcoExpr) -> Array (Tuple String JavaExpr)
translateFields value = map (\(Prop name field) -> Tuple name (value field))

translateAccessor :: (TcoExpr -> JavaExpr) -> CodegenEnv -> TcoExpr -> BackendAccessor -> JavaExpr
translateAccessor value env target accessor =
  let receiver = value target
  in case accessor of
    GetProp property -> case if env.typedRecords then recordShapeOf target else Nothing of
      Just shape -> JavaTypedRecordGet shape receiver property
      Nothing -> JavaMapGet receiver property
    GetCtorField (Qualified qualifier _) _ _ (Ident name) _ index ->
      let modPart = case qualifier of
            Just mod -> modulePrefix mod
            Nothing -> env.moduleName
      in JavaPropertyAccess receiver (constructorClassName modPart name) ("value" <> show index)
    GetIndex index -> JavaArrayIndex receiver (JavaRaw (show index))
