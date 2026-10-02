module Javapurs.CodeGen.Expr (translateExpression, translateValue, translateLoop) where

import Prelude

import Data.Array as Array
import Data.Array.NonEmpty as NEA
import Data.Foldable (any, foldl, foldr)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Newtype (unwrap)
import Data.String.CodeUnits as CodeUnits
import Data.Tuple (Tuple(..))
import Javapurs.CodeGen.Context (CodegenEnv, EffectContext(..), LoopContext, Position(..), Translation, TranslationContext, asExpression, captureLoops, closureContext, initialContext, prependStatement, pureExpression, tailContext, valueContext)
import Javapurs.CodeGen.Syntax (Application, extractUncurriedAbs, flattenApp, isEffectNode, stripEffectAbs, stripEffectDefer, unwrapTcoExpr)
import Javapurs.ControlFlow (hasAnyContinue, hasDirectContinue, hasTargetContinue)
import Javapurs.IntFunctions (abstractFunction, applyFunction)
import Javapurs.IntLoops (intLoopParams)
import Javapurs.JavaAst (JavaExpr(..), children)
import Javapurs.LoopInvariants (prepareLoop)
import Javapurs.Naming (constructorClassName, lazyGetterName, loopSnapshotName, modulePrefix, safeCtorName, sanitizeName)
import Javapurs.Operators (translateOperator1, translateOperator2)
import Javapurs.RecordShapes (recordShape, recordShapeOf)
import Javapurs.Representation (coerceArgument)
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr(..))
import PureScript.Backend.Optimizer.Codegen.Tco as Tco
import PureScript.Backend.Optimizer.CoreFn (Ident(..), Literal(..), Prop(..), Qualified(..))
import PureScript.Backend.Optimizer.CoreFn as CoreFn
import PureScript.Backend.Optimizer.FreeVars (localId)
import PureScript.Backend.Optimizer.Syntax (BackendAccessor(..), BackendEffect(..), BackendOperator(..), BackendSyntax(..), Level, Pair(..))

-- This is the only recursive dispatcher. Workers below own their evaluation
-- boundaries; the exhaustive cases keep new BackendSyntax constructors visible.
translateExpression :: CodegenEnv -> TranslationContext -> TcoExpr -> Translation
translateExpression env context expression@(TcoExpr analysis syntax)
  | context.effect == EffectValue && isEffectNode expression =
      -- The synthesized Supplier is the execution envelope of this action.
      -- Source lambdas use closureContext separately. Entering the envelope
      -- clears tail position; only explicit effect continuations restore it.
      pureExpression $ JavaAbs [] $ asExpression $ translateExpression env
        (context { effect = ExecutingEffect, position = ValuePosition }) expression
  | otherwise = case syntax of
      Lit literal -> pureExpression $ translateLiteral env context literal
      App _ _ ->
        let flat = flattenApp expression
        in case ownedCall env context flat of
          Just worker -> pureExpression worker
          Nothing -> pureExpression $ translateApplication env context flat
      UncurriedApp _ _ -> pureExpression $ translateApplication env context (flattenApp expression)
      UncurriedEffectApp fn args -> pureExpression $
        foldl JavaApply (translateValue env context fn) (map (translateValue env context) args)
      Abs args body ->
        let result = translateExpression env (closureContext (context { effect = EffectValue })) body
        in pureExpression $ foldr (\(Tuple ident level) rest -> JavaAbs [ localId ident level ] rest)
          (asExpression result) (NEA.toArray args)
      UncurriedAbs args body -> translateUncurriedFunction env context args body
      UncurriedEffectAbs args body -> translateUncurriedFunction env context args body
      Local ident level -> pureExpression $ translateLocal env context ident level
      Var name -> pureExpression $ translateGlobal env name
      Let ident level value body -> translateBinding env context ident level value body
      LetRec level bindings body -> translateRecursiveBindings env context (unwrap analysis).role level (NEA.toArray bindings) body
      EffectPure value -> translateExpression env (context { effect = EffectValue }) value
      EffectDefer body -> translateExpression env (tailContext context) body
      PrimEffect effect -> translatePrimitiveEffect env context effect
      EffectBind ident level action rest -> translateEffectBind env context ident level action rest
      Typed ty inner -> translateTyped env context ty inner
      TypeApp inner _ -> translateExpression env context inner
      Branch cases fallback -> translateBranches env context (NEA.toArray cases) fallback
      Fail message -> pureExpression $ JavaThrow message
      CtorSaturated (Qualified qualifier _) _ _ (Ident name) args ->
        let
          modPart = case qualifier of
            Just mod -> modulePrefix mod
            Nothing -> env.moduleName
          values = map (\(Tuple _ value) -> translateValue env context value) args
        in pureExpression $
          if Array.null values then JavaCtorSingleton modPart (safeCtorName name)
          else JavaNew (constructorClassName modPart name) values
      CtorDef _ _ (Ident name) fields ->
        let args = Array.mapWithIndex (\index _ -> "value" <> show index) fields
        in pureExpression $
          if Array.null args then JavaCtorSingleton env.moduleName (safeCtorName name)
          else JavaAbs args (JavaNew (constructorClassName env.moduleName name) (map JavaLocal args))
      Accessor value accessor -> pureExpression $ translateAccessor env context value accessor
      Update value updates -> pureExpression $
        JavaMapUpdate (translateValue env context value) (translateFields env context updates)
      PrimOp operator -> pureExpression $ case operator of
        Op1 op value -> translateOperator1 env.moduleName op (translateValue env context value)
        Op2 op left right -> translateOperator2 env.moduleName op
          (translateValue env context left) (translateValue env context right)
      PrimUndefined -> pureExpression $ JavaRaw "null /* TODO: PrimUndefined */"

-- An operand's statements remain at its original evaluation site. In
-- particular, do not concatenate the statements of several call arguments.
translateValue :: CodegenEnv -> TranslationContext -> TcoExpr -> JavaExpr
translateValue env context = asExpression <<< translateExpression env (valueContext context)

-- Calls ---------------------------------------------------------------------

-- Ownership workers have priority for App only. The ownership pass establishes
-- freshness; an omitted final donor becomes null. UncurriedApp deliberately
-- shares only the ordinary/TCO path, not this specialized admission rule.
ownedCall :: CodegenEnv -> TranslationContext -> Application -> Maybe JavaExpr
ownedCall env context flat = case unwrapTcoExpr flat.fn of
  Var (Qualified qualifier (Ident name))
    | qualifier == Nothing || qualifier == Just env.sourceModule -> do
        worker <- Map.lookup name env.ownedFunctions
        let
          arity = Array.length worker.params
          supplied = Array.length flat.args
          invoke extra = JavaCall (JavaStaticMethodRef Nothing worker.javaName)
            (Array.zipWith translateArgument worker.params flat.args <> extra)
        if supplied == arity then Just (invoke [])
        else if arity > 0 && supplied == arity - 1 then Just (invoke [ JavaRaw "null" ])
        else Nothing
  _ -> Nothing
  where
  translateArgument parameter argument = coerceArgument parameter (translateValue env context argument)

translateApplication :: CodegenEnv -> TranslationContext -> Application -> JavaExpr
translateApplication env context flat =
  let arguments = map (translateValue env context) flat.args
  in case tailTarget context flat of
    Just target -> JavaContinue target.ident arguments
    Nothing ->
      let function = translateValue env context flat.fn
      in if env.intFunctions then applyFunction (boxedFunctionArity env flat.fn) flat.fn function arguments
         else foldl JavaApply function arguments

-- Position, liveness and exact saturation are independent requirements. A
-- closure retains its loops for snapshot reads but loses their jump capability.
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

-- Recursive definitions retain the generic loop ABI for their saturated
-- prefix; a returned closure can still select the primitive representation.
boxedFunctionArity :: CodegenEnv -> TcoExpr -> Int
boxedFunctionArity env expression = case unwrapTcoExpr expression of
  Var (Qualified qualifier (Ident name))
    | qualifier == Nothing || qualifier == Just env.sourceModule ->
        case Array.find (\(Tuple ident _) -> ident == sanitizeName name) env.boxedFunctions of
          Just (Tuple _ arity) -> arity
          Nothing -> 0
  _ -> 0

-- Functions, type evidence and bindings --------------------------------------

translateUncurriedFunction :: CodegenEnv -> TranslationContext -> Array (Tuple (Maybe Ident) Level) -> TcoExpr -> Translation
translateUncurriedFunction env context args body =
  let result = translateExpression env (closureContext context) body
  in if context.effect == ExecutingEffect && Array.null args then result
     else pureExpression $ JavaAbs (map (\(Tuple ident level) -> localId ident level) args) (asExpression result)

translateTyped :: CodegenEnv -> TranslationContext -> CoreFn.ExprType -> TcoExpr -> Translation
translateTyped env context ty expression =
  case if env.intFunctions then translateTypedFunction env context ty expression else Nothing of
    Just result -> result
    Nothing -> case if env.typedRecords then recordShape ty else Nothing of
      Just shape -> case unwrapTcoExpr expression of
        Lit (LitRecord fields) -> pureExpression $ JavaTypedRecord shape (translateFields env context fields)
        Update target updates | recordShapeOf target == Just shape -> pureExpression $
          JavaTypedRecordUpdate shape (translateValue env context target) (translateFields env context updates)
        _ -> translateExpression env context expression
      Nothing -> translateExpression env context expression

-- Only definition types select primitive binders. TypeApp preserves the
-- context and translates its child; it never rewrites polymorphic binders.
translateTypedFunction :: CodegenEnv -> TranslationContext -> CoreFn.ExprType -> TcoExpr -> Maybe Translation
translateTypedFunction env context ty@(CoreFn.Func _ _) (TcoExpr _ syntax) = case syntax of
  Abs args body -> Just $ function (NEA.toArray args) body
  UncurriedAbs args body | not (Array.null args) -> Just $ function args body
  _ -> Nothing
  where
  function args body = pureExpression $ abstractFunction (Just ty)
    (map (\(Tuple ident level) -> localId ident level) args)
    (asExpression (translateExpression env (closureContext context) body))
translateTypedFunction _ _ _ _ = Nothing

translateBinding :: CodegenEnv -> TranslationContext -> Maybe Ident -> Level -> TcoExpr -> TcoExpr -> Translation
translateBinding env context ident level value body =
  let
    initializer = translateValue env context value
    name = localId ident level
    -- A proven Int binding keeps a primitive local; Object uses still box it.
    assignment = case value of
      TcoExpr _ (Typed CoreFn.Int _) -> JavaIntLocalAssign name initializer
      _ -> JavaLocalAssign name initializer
  in prependStatement assignment (translateExpression env context body)

translateRecursiveBindings :: CodegenEnv -> TranslationContext -> Tco.TcoRole -> Level -> Array (Tuple Ident TcoExpr) -> TcoExpr -> Translation
translateRecursiveBindings env context role level bindings body =
  case bindings of
    [ Tuple ident value ] | role.isLoop ->
      case extractUncurriedAbs value of
        Just abstraction ->
          let
            javaName = localId (Just ident) level
            ref = Tco.TcoLocal (Just ident) level
            loop = translateLoop env context ref role.joins javaName abstraction.args abstraction.body
            function = JavaAbs abstraction.args loop
          in if mentionsJavaLocal javaName function then
               -- A remaining non-uniform self use needs the recursive scope
               -- cell: Java forbids reading a local in its own initializer.
               pureExpression $ JavaLetRec [ Tuple javaName function ] (asExpression continuation)
             else prependStatement (JavaLocalAssign javaName function) continuation
        Nothing ->
          -- Preserve the statement form for a loop-marked, non-function value.
          { statements: [ recursiveScope unit ], result: JavaRaw "null" }
    _ -> pureExpression (recursiveScope unit)
  where
  continuation = translateExpression env context body
  -- A rejected representation must not translate its bindings speculatively:
  -- doing so would duplicate work at every nested recursive binding.
  recursiveScope _ = JavaLetRec
    (map (\(Tuple ident value) -> Tuple (localId (Just ident) level) (translateValue env context value)) bindings)
    (asExpression continuation)

mentionsJavaLocal :: String -> JavaExpr -> Boolean
mentionsJavaLocal name = case _ of
  JavaLocal local -> local == name
  expression -> any (mentionsJavaLocal name) (children expression)

-- Effects -------------------------------------------------------------------

translateEffectBind :: CodegenEnv -> TranslationContext -> Maybe Ident -> Level -> TcoExpr -> TcoExpr -> Translation
translateEffectBind env context ident level action rest =
  let
    executing = context { effect = ExecutingEffect }
    sourceAction = stripEffectDefer action
    sourceRest = stripEffectAbs rest
    actionResult = translateExpression env (executing { position = ValuePosition }) sourceAction
    continuation = translateExpression env executing sourceRest
    assignment = JavaLocalAssign (localId ident level) (executeEffect sourceAction (asExpression actionResult))
  in prependStatement assignment (continuation { result = executeEffect sourceRest continuation.result })

-- Explicit effect nodes already yield their executed result here. A foreign
-- call, branch or other ordinary value still yields a Supplier to force once.
executeEffect :: TcoExpr -> JavaExpr -> JavaExpr
executeEffect source value =
  if isEffectNode source then value
  else JavaCall (JavaInstanceMethodRef value "java.util.function.Supplier" "get") []

translatePrimitiveEffect :: CodegenEnv -> TranslationContext -> BackendEffect TcoExpr -> Translation
translatePrimitiveEffect env context = case _ of
  -- ST references use the same one-element array representation as the ports.
  EffectRefNew value -> pureExpression $ JavaArray [ translateValue env context value ]
  EffectRefRead reference -> pureExpression $ JavaArrayIndex (translateValue env context reference) (JavaRaw "0")
  EffectRefWrite reference value ->
    -- Keep both operands at a single evaluation site, reference before value.
    -- The returned value must be the very object stored, including allocations.
    -- These backend-only names are scoped and made fresh by Rename.
    { statements:
        [ JavaLocalAssign "__ref$write" (JavaCast "Object[]" (translateValue env context reference))
        , JavaLocalAssign "__value$write" (translateValue env context value)
        , JavaArraySet (JavaLocal "__ref$write") (JavaRaw "0") (JavaLocal "__value$write")
        ]
    , result: JavaLocal "__value$write"
    }

-- Branches ------------------------------------------------------------------

type GuardedTranslation = { condition :: Translation, value :: Translation }

translateBranches :: CodegenEnv -> TranslationContext -> Array (Pair TcoExpr) -> TcoExpr -> Translation
translateBranches env context cases fallback =
  let
    -- Each arm constructs a value (possibly an effect Supplier). Its terminal
    -- position is preserved, while guards always use ordinary operand context.
    armContext = context { effect = EffectValue }
    translateCase (Pair condition value) =
      { condition: translateExpression env (valueContext context) condition
      , value: translateExpression env armContext value
      }
  in pureExpression $ foldr guardedExpression
    (asExpression (translateExpression env armContext fallback)) (map translateCase cases)

guardedExpression :: GuardedTranslation -> JavaExpr -> JavaExpr
guardedExpression { condition, value } rest =
  let branch = JavaTernary condition.result (asExpression value) rest
  in if Array.null condition.statements && Array.null value.statements then branch
     else JavaBlock condition.statements branch

-- Loops and captured values --------------------------------------------------

translateLoop :: CodegenEnv -> TranslationContext -> Tco.TcoRef -> Array Tco.TcoRef -> String -> Array String -> TcoExpr -> JavaExpr
translateLoop env parent ref joins name args body =
  let
    scope = env.invariantScope <> "$" <> name
    plan = if env.loopInvariants then prepareLoop env.sourceModule env.bindings scope body
      else { body, invariants: [] }
    loopEnv = env
      { invariantLocals = map (\item -> Tuple item.local item.name) plan.invariants <> env.invariantLocals
      , invariantScope = scope
      }
    loop = { ident: name, params: args, canContinue: true, ref }
    -- Only proven joins to still-live parents survive. A source closure has
    -- already revoked canContinue, and entering a nested loop cannot restore it.
    keepJoin outer = outer { canContinue = outer.canContinue && Array.elem outer.ref joins }
    loopContext = initialContext
      { loops = Array.cons loop (map keepJoin parent.loops), position = TailPosition }
    expression = asExpression (translateExpression loopEnv loopContext plan.body)
    intParams = if hasDirectContinue expression then intLoopParams args body else []
    captured = initialContext { loops = captureLoops parent.loops }
    invariants = map (\item -> Tuple item.name (translateValue env captured item.value)) plan.invariants
    -- No back edge: preserve the original parameters/primitive types. A jump
    -- through a nested closure still needs a loop that can catch its target.
    hasJump = hasTargetContinue name expression
  in if Array.null invariants && not (hasAnyContinue expression) && not hasJump then
       translateValue loopEnv captured plan.body
     else if Array.null invariants then JavaWhileTrue name args intParams expression
     else JavaMemoizedLoop name args intParams invariants expression

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

-- Literal values and accessors -----------------------------------------------

translateLiteral :: CodegenEnv -> TranslationContext -> Literal TcoExpr -> JavaExpr
translateLiteral env context = case _ of
  LitInt n -> JavaRaw (show n)
  LitNumber n -> JavaRaw (numberLiteral n)
  LitString s -> JavaString s
  -- Char shares the one-character String representation used by Java FFI.
  LitChar c -> JavaString (CodeUnits.singleton c)
  LitBoolean b -> JavaRaw (if b then "true" else "false")
  LitArray elements -> JavaArray (map (translateValue env context) elements)
  LitRecord fields -> JavaRecord (translateFields env context fields)

translateFields :: CodegenEnv -> TranslationContext -> Array (Prop TcoExpr) -> Array (Tuple String JavaExpr)
translateFields env context = map (\(Prop name value) -> Tuple name (translateValue env context value))

translateAccessor :: CodegenEnv -> TranslationContext -> TcoExpr -> BackendAccessor -> JavaExpr
translateAccessor env context value accessor =
  let receiver = translateValue env context value
  in case accessor of
    GetProp property -> case if env.typedRecords then recordShapeOf value else Nothing of
      Just shape -> JavaTypedRecordGet shape receiver property
      Nothing -> JavaMapGet receiver property
    GetCtorField (Qualified qualifier _) _ _ (Ident name) _ index ->
      let modPart = case qualifier of
            Just mod -> modulePrefix mod
            Nothing -> env.moduleName
      in JavaPropertyAccess receiver (constructorClassName modPart name) ("value" <> show index)
    GetIndex index -> JavaArrayIndex receiver (JavaRaw (show index))

-- JavaScript show uses names that are not Java expressions for special Number
-- values. Java constants preserve those values; -0.0 must also keep its sign.
numberLiteral :: Number -> String
numberLiteral n =
  let
    positiveInfinity = 1.0 / 0.0
    negativeInfinity = -1.0 / 0.0
  in if n /= n then "Double.NaN"
     else if n == positiveInfinity then "Double.POSITIVE_INFINITY"
     else if n == negativeInfinity then "Double.NEGATIVE_INFINITY"
     else if n == 0.0 then if 1.0 / n == negativeInfinity then "-0.0" else "0.0"
     else show n
