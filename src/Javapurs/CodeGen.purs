module Javapurs.CodeGen where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))
import Data.Foldable (any, foldl, foldr, foldMap)
import Data.Map (Map)
import Data.Map as Map
import PureScript.Backend.Optimizer.Syntax (BackendSyntax(..), Level(..), Pair(..), BackendOperator(..), BackendAccessor(..), BackendEffect(..))
import PureScript.Backend.Optimizer.FreeVars (localId)
import Data.Array.NonEmpty as NEA
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr(..))
import Data.String.CodeUnits as CodeUnits
import Data.Newtype (unwrap)
import PureScript.Backend.Optimizer.Codegen.Tco as Tco
import Javapurs.JavaAst (JavaExpr(..), children, JavaParamType(..), JavaFile)
import Javapurs.IntLoops (intLoopParams)
import Javapurs.RecordShapes (recordShape, recordShapeOf, collectRecordShapes)
import Javapurs.RecordTypes (annotateRecordTypes)
import Javapurs.LoopInvariants (prepareLoop)
import Javapurs.DirectCalls (directCalls)
import Javapurs.Reuse (reuseConstructors)
import Javapurs.FunctionTypes (annotateFunctionTypes)
import Javapurs.IntFunctions (abstractFunction, applyFunction)
import Javapurs.Naming (modulePrefix, sanitizeName)
import Javapurs.Operators (translateOperator1, translateOperator2)
import Javapurs.Ownership (prepare)
import PureScript.Backend.Optimizer.CoreFn as CoreFn
import Javapurs.Printer (hasAnyContinue, hasDirectContinue)
import PureScript.Backend.Optimizer.Convert (BackendModule)
import PureScript.Backend.Optimizer.CoreFn (Ident(..), Prop(..), Qualified(..), ModuleName(..), Literal(..))
import Data.String as String

type LoopCtx = { ident :: String, params :: Array String, canContinue :: Boolean }

-- A closure captures the current iteration's values, but cannot continue its caller's loop.
captureLoopCtx :: Array LoopCtx -> Array LoopCtx
captureLoopCtx = map (_ { canContinue = false })

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

type TransRes = { stmts :: Array JavaExpr, expr :: JavaExpr }

pureExpr :: JavaExpr -> TransRes
pureExpr e = { stmts: [], expr: e }

wrapInBlock :: TransRes -> JavaExpr
wrapInBlock res =
  if Array.length res.stmts == 0 then res.expr
  else JavaBlock res.stmts res.expr

-- | A call to an ownership worker is a flat static call. Only freshly built
-- | trees reach this path: the pass rewrites nothing else, so the worker may
-- | consume what it receives.
ownedCall :: CodegenEnv -> Array LoopCtx -> TcoExpr -> Maybe JavaExpr
ownedCall env loopCtx expression =
  let flat = flattenApp expression
  in case unwrapTcoExpr flat.fn of
    Var (Qualified qualifier (Ident name))
      | qualifier == Nothing || qualifier == Just env.sourceModule ->
          case Map.lookup name env.ownedFunctions of
            Just fn
              | Array.length flat.args == Array.length fn.params ->
                  Just $ JavaCall (JavaLocal fn.javaName)
                    (Array.zipWith
                      (\param arg -> case param of
                        ParamInt -> JavaCast "int" (wrapInBlock (translateExpr env loopCtx false arg))
                        _ -> wrapInBlock (translateExpr env loopCtx false arg))
                      fn.params flat.args)
              | not (Array.null fn.params) && Array.length flat.args == Array.length fn.params - 1 ->
                  -- The module call has no donor yet: a fresh tree cannot be
                  -- shared, so the worker starts without a reusable cell.
                  Just $ JavaCall (JavaLocal fn.javaName)
                    (Array.zipWith
                      (\param arg -> case param of
                        ParamInt -> JavaCast "int" (wrapInBlock (translateExpr env loopCtx false arg))
                        _ -> wrapInBlock (translateExpr env loopCtx false arg))
                      (Array.take (Array.length flat.args) fn.params) flat.args
                      <> [ JavaRaw "null" ])
            _ -> Nothing
    _ -> Nothing

-- Recursive definitions still use the generic loop ABI. Do not adapt their
-- saturated calls; closures returned after that prefix can still be primitive.
-- | Whether a translated expression still names a local, which Java rejects
-- | when the local is the initializer of its own declaration.
mentionsJavaLocal :: String -> JavaExpr -> Boolean
mentionsJavaLocal name expr = case expr of
  JavaLocal local -> local == name
  _ -> any (mentionsJavaLocal name) (children expr)

boxedFunctionArity :: CodegenEnv -> TcoExpr -> Int
boxedFunctionArity env expression = case unwrapTcoExpr expression of
  Var (Qualified qualifier (Ident name))
    | qualifier == Nothing || qualifier == Just env.sourceModule ->
        case Array.find (\(Tuple ident _) -> ident == sanitizeName name) env.boxedFunctions of
          Just (Tuple _ arity) -> arity
          Nothing -> 0
  _ -> 0

translateLoop :: CodegenEnv -> Array LoopCtx -> String -> Array String -> TcoExpr -> JavaExpr
translateLoop env parentCtx name args body =
  let
    scope = env.invariantScope <> "$" <> name
    plan = if env.loopInvariants then prepareLoop env.sourceModule env.bindings scope body
      else { body, invariants: [] }
    loopEnv = env
      { invariantLocals = map (\item -> Tuple item.local item.name) plan.invariants <> env.invariantLocals
      , invariantScope = scope
      }
    ctx = { ident: name, params: args, canContinue: true }
    expression = wrapInBlock (translateExpr loopEnv (Array.cons ctx (captureLoopCtx parentCtx)) true plan.body)
    intParams = if hasDirectContinue expression then intLoopParams args body else []
    values = map (\item -> Tuple item.name (wrapInBlock (translateExpr env (captureLoopCtx parentCtx) false item.value))) plan.invariants
    -- A recursive definition with no back edge runs at most once. Emitting its
    -- body directly keeps the original parameter names and primitive types
    -- instead of boxing every argument into loop storage.
    directExpr = wrapInBlock (translateExpr loopEnv (captureLoopCtx parentCtx) false plan.body)
  in if Array.null values && not (hasAnyContinue expression) then directExpr
     else if Array.null values then JavaWhileTrue args intParams expression
     else JavaMemoizedLoop args intParams values expression

translateExpr :: CodegenEnv -> Array LoopCtx -> Boolean -> TcoExpr -> TransRes
translateExpr env loopCtx isTail tcoExpr =
  translateExprWith false env loopCtx isTail tcoExpr

translateExprWith :: Boolean -> CodegenEnv -> Array LoopCtx -> Boolean -> TcoExpr -> TransRes
translateExprWith inEffectBlock env loopCtx isTail tcoExpr@(TcoExpr tcoAnalysis syntax) =
  let isEff = isEffectNode tcoExpr
  in if isEff && not inEffectBlock then
    let res = translateExprWith true env loopCtx false tcoExpr
    in pureExpr $ JavaAbs [] (wrapInBlock res)
  else case syntax of
  Lit lit -> case lit of
    LitInt n -> pureExpr $ JavaRaw (show n)
    LitNumber n -> pureExpr $ JavaRaw (show n)
    LitString s -> pureExpr $ JavaString s
    LitChar c -> pureExpr $ JavaRaw ("'" <> CodeUnits.singleton c <> "'")
    LitBoolean b -> pureExpr $ JavaRaw (if b then "true" else "false")
    LitArray elements ->
      let resElemsExprs = map (\e -> wrapInBlock (translateExpr env loopCtx false e)) elements
      in pureExpr $ JavaArray resElemsExprs
    LitRecord fields ->
      let resFieldsExprs = map (\(Prop k v) -> Tuple k (wrapInBlock (translateExpr env loopCtx false v))) fields
      in pureExpr $ JavaRecord resFieldsExprs
  App _ _ ->
    case ownedCall env loopCtx tcoExpr of
      Just direct -> pureExpr direct
      Nothing ->
        let
          flat = flattenApp tcoExpr
          resFnExpr = wrapInBlock (translateExpr env loopCtx false flat.fn)
          argsExprs = map (\a -> wrapInBlock (translateExpr env loopCtx false a)) flat.args
          application = if env.intFunctions then applyFunction (boxedFunctionArity env flat.fn) flat.fn resFnExpr argsExprs else foldl JavaApply resFnExpr argsExprs
        in
          if isTail then
            let targetCtx = case unwrapTcoExpr flat.fn of
                 Local (Just (Ident fnName)) (Level lvl) ->
                   Array.find (\c -> c.canContinue && c.ident == localId (Just (Ident fnName)) (Level lvl)) loopCtx
                 Var (Qualified _ (Ident fnName)) ->
                   Array.find (\c -> c.canContinue && c.ident == sanitizeName fnName) loopCtx
                 _ -> Nothing
            in case targetCtx of
              Just ctx ->
                if Array.length flat.args == Array.length ctx.params then
                   pureExpr $ JavaContinue ctx.ident argsExprs
                else
                   pureExpr application
              Nothing -> pureExpr application
          else
            pureExpr application
  UncurriedApp _ _ ->
    let
      flat = flattenApp tcoExpr
      resFnExpr = wrapInBlock (translateExpr env loopCtx false flat.fn)
      argsExprs = map (\a -> wrapInBlock (translateExpr env loopCtx false a)) flat.args
      application = if env.intFunctions then applyFunction (boxedFunctionArity env flat.fn) flat.fn resFnExpr argsExprs else foldl JavaApply resFnExpr argsExprs
    in
      if isTail then
        let targetCtx = case unwrapTcoExpr flat.fn of
             Local (Just (Ident fnName)) (Level lvl) ->
               Array.find (\c -> c.canContinue && c.ident == localId (Just (Ident fnName)) (Level lvl)) loopCtx
             Var (Qualified _ (Ident fnName)) ->
               Array.find (\c -> c.canContinue && c.ident == sanitizeName fnName) loopCtx
             _ -> Nothing
        in case targetCtx of
          Just ctx ->
            if Array.length flat.args == Array.length ctx.params then
               pureExpr $ JavaContinue ctx.ident argsExprs
            else
               pureExpr application
          Nothing -> pureExpr application
      else
        pureExpr application
  UncurriedEffectApp fn args ->
    let
      resFnExpr = wrapInBlock (translateExpr env loopCtx false fn)
      argsExprs = map (\a -> wrapInBlock (translateExpr env loopCtx false a)) (Array.fromFoldable args)
    in pureExpr $ foldl JavaApply resFnExpr argsExprs
  UncurriedAbs args body ->
    let
      argsArray = map (\(Tuple mbI lvl) -> localId mbI lvl) args
      resBody = translateExprWith inEffectBlock env (captureLoopCtx loopCtx) true body
    in
      if inEffectBlock && Array.length args == 0 then resBody
      else pureExpr $ JavaAbs argsArray (wrapInBlock resBody)
  UncurriedEffectAbs args expr ->
    let
      argsArray = map (\(Tuple mbI lvl) -> localId mbI lvl) (Array.fromFoldable args)
      resBody = translateExprWith inEffectBlock env (captureLoopCtx loopCtx) true expr
    in
      if inEffectBlock && Array.length args == 0 then resBody
      else pureExpr $ JavaAbs argsArray (wrapInBlock resBody)
  Local mbIdent (Level lvl) ->
    let
      varName = localId mbIdent (Level lvl)
      isLoopVar = Array.any (\ctx -> Array.elem varName ctx.params) loopCtx
    in
      pureExpr $ case Array.find (\(Tuple local _) -> local == Tuple mbIdent (Level lvl)) env.invariantLocals of
        Just (Tuple _ name) -> JavaLoopInvariant name
        Nothing -> if isLoopVar then JavaLocal ("__final_" <> varName) else JavaLocal varName
  Abs args body ->
    let resBody = translateExpr env (captureLoopCtx loopCtx) true body
    in pureExpr $ foldr (\(Tuple mbI lvl) acc -> JavaAbs [localId mbI lvl] acc) (wrapInBlock resBody) (Array.fromFoldable args)
  Let mbI lvl val body ->
    let
      resValExpr = wrapInBlock (translateExpr env loopCtx false val)
      varName = localId mbI lvl
      -- A proven Int binding keeps a primitive local; reads in Object contexts
      -- still box, while the hot int uses stay unboxed.
      assignStmt = case val of
        TcoExpr _ (Typed CoreFn.Int _) -> JavaIntLocalAssign varName resValExpr
        _ -> JavaLocalAssign varName resValExpr
      resBody = translateExprWith inEffectBlock env loopCtx isTail body
    in { stmts: [assignStmt] <> resBody.stmts, expr: resBody.expr }
  LetRec lvl binds body ->
    let
      tcoInfo = unwrap tcoAnalysis
      isLoop = tcoInfo.role.isLoop
    in
      if isLoop && Array.length (Array.fromFoldable binds) == 1 then
        case Array.head (Array.fromFoldable binds) of
          Just (Tuple (Ident name) val) ->
            let
              javaName = localId (Just (Ident name)) lvl
            in case extractUncurriedAbs val of
              Just abs ->
                let
                  funcBody = translateLoop env loopCtx javaName abs.args abs.body
                  loopValue = JavaAbs abs.args funcBody
                  resBody = translateExprWith inEffectBlock env loopCtx isTail body
                in
                  if mentionsJavaLocal javaName loopValue then
                    -- The loop body still names the binding (a non-uniform use),
                    -- so it needs the scope cell that JavaLetRec gives it.
                    pureExpr $ JavaLetRec [ Tuple javaName loopValue ] (wrapInBlock resBody)
                  else
                    { stmts: [JavaLocalAssign javaName loopValue] <> resBody.stmts, expr: resBody.expr }
              Nothing ->
                let
                  bindsArray = map (\(Tuple (Ident n) v) -> Tuple (localId (Just (Ident n)) lvl) (wrapInBlock (translateExpr env loopCtx false v))) (Array.fromFoldable binds)
                  resBody = translateExprWith inEffectBlock env loopCtx isTail body
                in { stmts: [JavaLetRec bindsArray (wrapInBlock resBody)], expr: JavaRaw "null" }
          Nothing -> pureExpr $ JavaRaw "null"
      else
        let
          bindsArray = map (\(Tuple (Ident name) val) -> Tuple (localId (Just (Ident name)) lvl) (wrapInBlock (translateExpr env loopCtx false val))) (Array.fromFoldable binds)
          resBody = translateExprWith inEffectBlock env loopCtx isTail body
        in pureExpr $ JavaLetRec bindsArray (wrapInBlock resBody)
  EffectPure val -> translateExpr env loopCtx isTail val
  EffectDefer val -> translateExprWith inEffectBlock env loopCtx true val
  PrimEffect effect -> case effect of
    -- A mutable reference is a one-element Object array, the same shape the
    -- Ref and ST ports use.
    EffectRefNew value ->
      let res = wrapInBlock (translateExpr env loopCtx false value)
      in pureExpr $ JavaArray [ res ]
    EffectRefRead reference ->
      let res = wrapInBlock (translateExpr env loopCtx false reference)
      in pureExpr $ JavaArrayIndex res (JavaRaw "0")
    EffectRefWrite reference value ->
      let
        resRef = translateExpr env loopCtx false reference
        resValue = translateExpr env loopCtx false value
      in
        { stmts: resRef.stmts <> resValue.stmts
            <> [ JavaArraySet (wrapInBlock resRef) (JavaRaw "0") (wrapInBlock resValue) ]
        , expr: wrapInBlock resValue
        }
  EffectBind mbI lvl expr rest ->
    let
      realExpr = stripEffectDefer expr
      realRest = stripEffectAbs rest
      resExprExpr = wrapInBlock (translateExprWith true env loopCtx false realExpr)
      varName = localId mbI lvl
      executedExpr =
        if isEffectNode realExpr then resExprExpr
        else JavaCall (JavaPropertyAccess resExprExpr "java.util.function.Supplier" "get") []
      assignStmt = JavaLocalAssign varName executedExpr
      resRest = translateExprWith true env loopCtx isTail realRest
      executedRestExpr =
        if isEffectNode realRest then resRest.expr
        else JavaCall (JavaPropertyAccess resRest.expr "java.util.function.Supplier" "get") []
    in { stmts: Array.cons assignStmt resRest.stmts, expr: executedRestExpr }
  Fail msg -> pureExpr $ JavaThrow msg
  Typed ty expr ->
    case if env.intFunctions then translateTypedFunction ty expr else Nothing of
      Just result -> result
      Nothing -> case if env.typedRecords then recordShape ty else Nothing of
        Just shape -> case unwrapTcoExpr expr of
          Lit (LitRecord fields) ->
            let values = map (\(Prop k v) -> Tuple k (wrapInBlock (translateExpr env loopCtx false v))) fields
            in pureExpr $ JavaTypedRecord shape values
          Update target updates | recordShapeOf target == Just shape ->
            let
              base = wrapInBlock (translateExpr env loopCtx false target)
              values = map (\(Prop k v) -> Tuple k (wrapInBlock (translateExpr env loopCtx false v))) updates
            in pureExpr $ JavaTypedRecordUpdate shape base values
          _ -> translateExprWith inEffectBlock env loopCtx isTail expr
        Nothing -> translateExprWith inEffectBlock env loopCtx isTail expr
  TypeApp expr _ -> translateExprWith inEffectBlock env loopCtx isTail expr
  CtorSaturated (Qualified mbMod _) _ _ (Ident ctorName) args ->
    let
      safeCtorName = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_") ctorName
      modPart = case mbMod of
        Just mn -> modulePrefix mn
        Nothing -> env.moduleName
      javaClass = modPart <> "." <> safeCtorName
      resArgsExprs = map (\(Tuple _ val) -> wrapInBlock (translateExpr env loopCtx false val)) (Array.fromFoldable args)
    in pureExpr $
      if Array.null resArgsExprs then JavaCtorSingleton modPart safeCtorName
      else JavaNew javaClass resArgsExprs
  CtorDef _ _ (Ident ctorName) fields ->
    let
      safeCtorName = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_") ctorName
      javaClass = env.moduleName <> "." <> safeCtorName
      numFields = Array.length fields
      mappedFields = Array.mapWithIndex (\i _ -> "value" <> show i) fields
      body = JavaNew javaClass (map JavaLocal mappedFields)
    in
      if numFields == 0 then
        pureExpr $ JavaCtorSingleton env.moduleName safeCtorName
      else
        pureExpr $ JavaAbs mappedFields body
  Accessor expr acc -> case acc of
    GetProp prop ->
      let resExprExpr = wrapInBlock (translateExpr env loopCtx false expr)
      in pureExpr $ case if env.typedRecords then recordShapeOf expr else Nothing of
        Just shape -> JavaTypedRecordGet shape resExprExpr prop
        Nothing -> JavaMapGet resExprExpr prop
    GetCtorField (Qualified mbMod _) _ _ (Ident ctorName) _ idx ->
      let
        safeCtorName = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_") ctorName
        modPart = case mbMod of
          Just mn -> modulePrefix mn
          Nothing -> env.moduleName
        javaClass = modPart <> "." <> safeCtorName
        resExprExpr = wrapInBlock (translateExpr env loopCtx false expr)
      in pureExpr $ JavaPropertyAccess resExprExpr javaClass ("value" <> show idx)
    GetIndex index ->
      let resExprExpr = wrapInBlock (translateExpr env loopCtx false expr)
      in pureExpr $ JavaArrayIndex resExprExpr (JavaRaw (show index))
    _ -> pureExpr $ JavaRaw "null /* TODO: Accessor */"
  Update expr updates ->
    let resExprExpr = wrapInBlock (translateExpr env loopCtx false expr)
        mappedUpdates = map (\(Prop prop val) -> Tuple prop (wrapInBlock (translateExpr env loopCtx false val))) updates
    in pureExpr $ JavaMapUpdate resExprExpr mappedUpdates
  Var qi -> case qi of
    Qualified mbMod (Ident name) ->
      let
        qModName = case mbMod of
          Just m -> Just (modulePrefix m)
          Nothing -> Nothing
        javaName = sanitizeName name
        isCurrentModule = qModName == Nothing || qModName == Just env.moduleName
      in pureExpr $
        if isCurrentModule && Array.elem javaName env.lazyBindings then
          JavaCall (JavaRaw (env.moduleName <> ".__lazy_get_" <> javaName)) []
        else
          JavaGlobalVar qModName javaName
  Branch cases def ->
    let
      resDef = translateExpr env loopCtx isTail def
      mappedArgs = Array.fromFoldable (map (\(Pair c v) -> 
        let rc = translateExpr env loopCtx false c
            rv = translateExpr env loopCtx isTail v
        in { cStmts: rc.stmts, cExpr: rc.expr, vStmts: rv.stmts, vExpr: rv.expr }
      ) cases)
      
      buildTernary :: Array { cStmts :: Array JavaExpr, cExpr :: JavaExpr, vStmts :: Array JavaExpr, vExpr :: JavaExpr } -> { stmts :: Array JavaExpr, expr :: JavaExpr } -> JavaExpr
      buildTernary [] defRes = wrapInBlock defRes
      buildTernary arr defRes =
        case Array.uncons arr of
          Just { head, tail } ->
            let restTernary = buildTernary tail defRes
            in if Array.length head.cStmts > 0 || Array.length head.vStmts > 0 then
                 JavaBlock head.cStmts (JavaTernary head.cExpr (wrapInBlock { stmts: head.vStmts, expr: head.vExpr }) restTernary)
               else
                 JavaTernary head.cExpr head.vExpr restTernary
          Nothing -> wrapInBlock defRes
          
    in { stmts: [], expr: buildTernary mappedArgs resDef }
  PrimOp op -> case op of
    Op1 op1 e -> 
      let resExpr = wrapInBlock (translateExpr env loopCtx false e)
      in pureExpr $ translateOperator1 env.moduleName op1 resExpr
    Op2 op2 e1 e2 ->
      let res1Expr = wrapInBlock (translateExpr env loopCtx false e1)
          res2Expr = wrapInBlock (translateExpr env loopCtx false e2)
      in pureExpr $ translateOperator2 env.moduleName op2 res1Expr res2Expr
  PrimUndefined -> pureExpr $ JavaRaw "null /* TODO: PrimUndefined */"
  _ -> pureExpr $ JavaRaw ("null /* TODO: unknown syntax " <> syntaxTag syntax <> " */")
  where
  -- Definition types select primitive binders; instantiating a polymorphic
  -- value only selects a compatible call site, never rewrites its binders.
  translateTypedFunction ty@(CoreFn.Func _ _) (TcoExpr _ functionSyntax) = case functionSyntax of
    Abs args body -> Just $ function (Array.fromFoldable args) body
    UncurriedAbs args body | not (Array.null args) -> Just $ function args body
    _ -> Nothing
    where
    function args body =
      let result = translateExprWith inEffectBlock env (captureLoopCtx loopCtx) true body
      in pureExpr $ abstractFunction (Just ty) (map (\(Tuple ident level) -> localId ident level) args) (wrapInBlock result)
  translateTypedFunction _ _ = Nothing

syntaxTag :: BackendSyntax TcoExpr -> String
syntaxTag = case _ of
  Var _ -> "Var"
  Local _ _ -> "Local"
  Lit _ -> "Lit"
  App _ _ -> "App"
  UncurriedApp _ _ -> "UncurriedApp"
  UncurriedEffectApp _ _ -> "UncurriedEffectApp"
  Abs _ _ -> "Abs"
  UncurriedAbs _ _ -> "UncurriedAbs"
  UncurriedEffectAbs _ _ -> "UncurriedEffectAbs"
  Let _ _ _ _ -> "Let"
  LetRec _ _ _ -> "LetRec"
  EffectPure _ -> "EffectPure"
  EffectDefer _ -> "EffectDefer"
  EffectBind _ _ _ _ -> "EffectBind"
  Branch _ _ -> "Branch"
  Fail _ -> "Fail"
  Accessor _ _ -> "Accessor"
  Update _ _ -> "Update"
  CtorSaturated _ _ _ _ _ -> "CtorSaturated"
  CtorDef _ _ _ _ -> "CtorDef"
  PrimOp _ -> "PrimOp"
  PrimEffect _ -> "PrimEffect"
  PrimUndefined -> "PrimUndefined"
  Typed _ _ -> "Typed"
  TypeApp _ _ -> "TypeApp"

isEffectNode :: TcoExpr -> Boolean
isEffectNode expr = case unwrapTcoExpr expr of
  EffectBind _ _ _ _ -> true
  EffectPure _ -> true
  EffectDefer _ -> false
  PrimEffect _ -> true
  Let _ _ _ body -> isEffectNode body
  LetRec _ _ body -> isEffectNode body
  _ -> false

stripEffectDefer :: TcoExpr -> TcoExpr
stripEffectDefer expr@(TcoExpr a syn) = case syn of
  Typed ty inner -> TcoExpr a (Typed ty (stripEffectDefer inner))
  TypeApp inner ty -> TcoExpr a (TypeApp (stripEffectDefer inner) ty)
  EffectDefer inner -> stripEffectDefer inner
  Abs _ inner -> stripEffectDefer inner
  Let ident lvl val body -> TcoExpr a (Let ident lvl val (stripEffectDefer body))
  LetRec lvl bindings body -> TcoExpr a (LetRec lvl bindings (stripEffectDefer body))
  _ -> expr

stripEffectAbs :: TcoExpr -> TcoExpr
stripEffectAbs expr@(TcoExpr a syn) = case syn of
  Typed ty inner -> TcoExpr a (Typed ty (stripEffectAbs inner))
  TypeApp inner ty -> TcoExpr a (TypeApp (stripEffectAbs inner) ty)
  UncurriedEffectAbs [] body -> stripEffectAbs body
  UncurriedAbs [] body -> stripEffectAbs body
  Abs args body ->
    if Array.length (Array.fromFoldable args) == 1 then
      case Array.head (Array.fromFoldable args) of
        Just (Tuple Nothing _) -> stripEffectAbs body
        Just (Tuple (Just (Ident name)) _) ->
           if name == "$__unused" then stripEffectAbs body else expr
        _ -> expr
    else expr
  EffectDefer body -> stripEffectAbs body
  Let ident lvl val body -> TcoExpr a (Let ident lvl val (stripEffectAbs body))
  LetRec lvl bindings body -> TcoExpr a (LetRec lvl bindings (stripEffectAbs body))
  _ -> expr

extractUncurriedAbs :: TcoExpr -> Maybe { args :: Array String, body :: TcoExpr }
extractUncurriedAbs (TcoExpr _ syntax) = case syntax of
  Abs args body ->
    let
      thisArgs = map (\(Tuple mbI lvl) -> localId mbI lvl) (Array.fromFoldable args)
    in case extractUncurriedAbs body of
      Just inner -> Just { args: thisArgs <> inner.args, body: inner.body }
      Nothing -> Just { args: thisArgs, body }
  UncurriedAbs args body ->
    Just { args: map (\(Tuple mbI lvl) -> localId mbI lvl) args, body }
  UncurriedEffectAbs args body ->
    Just { args: map (\(Tuple mbI lvl) -> localId mbI lvl) args, body }
  Typed _ inner -> extractUncurriedAbs inner
  TypeApp inner _ -> extractUncurriedAbs inner
  _ -> Nothing

flattenApp :: TcoExpr -> { fn :: TcoExpr, args :: Array TcoExpr }
flattenApp expr@(TcoExpr _ syntax) = case syntax of
  App fn args ->
    let inner = flattenApp fn
    in { fn: inner.fn, args: inner.args <> NEA.toArray args }
  UncurriedApp fn args ->
    let inner = flattenApp fn
    in { fn: inner.fn, args: inner.args <> Array.fromFoldable args }
  Typed _ inner ->
    let flat = flattenApp inner
    in if Array.null flat.args then { fn: expr, args: [] } else flat
  TypeApp inner _ ->
    let flat = flattenApp inner
    in if Array.null flat.args then { fn: expr, args: [] } else flat
  _ -> { fn: expr, args: [] }

unwrapTcoExpr :: TcoExpr -> BackendSyntax TcoExpr
unwrapTcoExpr (TcoExpr _ syntax) = case syntax of
  Typed _ inner -> unwrapTcoExpr inner
  TypeApp inner _ -> unwrapTcoExpr inner
  _ -> syntax

translate :: BackendModule -> JavaFile
translate = translateWithRecords true

translateWithRecords :: Boolean -> BackendModule -> JavaFile
translateWithRecords typedRecords = translateWithOptions { typedRecords, loopInvariants: true }

translateWithOptions :: { typedRecords :: Boolean, loopInvariants :: Boolean } -> BackendModule -> JavaFile
translateWithOptions { typedRecords, loopInvariants } =
  translateWithDirectCalls { typedRecords, loopInvariants, directCalls: true }

translateWithDirectCalls :: { typedRecords :: Boolean, loopInvariants :: Boolean, directCalls :: Boolean } -> BackendModule -> JavaFile
translateWithDirectCalls { typedRecords, loopInvariants, directCalls: enabled } =
  translateWithIntFunctions { typedRecords, loopInvariants, directCalls: enabled, intFunctions: true, ownership: true }

translateWithIntFunctions :: { typedRecords :: Boolean, loopInvariants :: Boolean, directCalls :: Boolean, intFunctions :: Boolean, ownership :: Boolean } -> BackendModule -> JavaFile
translateWithIntFunctions options@{ typedRecords, loopInvariants, intFunctions } mod0 =
  let
    ownership =
      if options.ownership then prepare mod0
      else { module: mod0, declarations: [], functions: Map.empty, mutableClasses: [], diagnostics: [] }
    mod = ownership.module
    modNameStr = modulePrefix mod.name

    Tuple _ rawBindings = foldl
      (\(Tuple env acc) group ->
          let
            tcoBinds = map (\(Tuple k v) -> Tuple k (annotateRecordTypes (Tco.analyze env v))) group.bindings
          in
            Tuple env (Array.snoc acc { recursive: group.recursive, bindings: tcoBinds })
      )
      (Tuple [] [])
      mod.bindings

    analyzedBindings = if intFunctions then map
      (\group -> group { bindings = map (\(Tuple name value) -> Tuple name
        (annotateFunctionTypes mod.name (Array.concatMap _.bindings rawBindings) value)) group.bindings }) rawBindings
      else rawBindings

    boxedFunctions = Array.concatMap (\group -> if group.recursive then
      Array.mapMaybe (\(Tuple (Ident name) value) -> map
        (\abs -> Tuple (sanitizeName name) (Array.length abs.args)) (extractUncurriedAbs value)) group.bindings
      else []) analyzedBindings

    mainDecls = Array.concatMap
      ( \group ->
          let
            env =
              { moduleName: modNameStr
              , sourceModule: mod.name
              , bindings: Array.concatMap _.bindings analyzedBindings
              , lazyBindings: if group.recursive then map (\(Tuple (Ident name) _) -> sanitizeName name) group.bindings else []
              , boxedFunctions
              , typedRecords
              , loopInvariants
              , intFunctions
              , ownedFunctions: ownership.functions
              , invariantLocals: []
              , invariantScope: ""
              }
          in if group.recursive then
            map
              ( \(Tuple (Ident n) expr) ->
                  case extractUncurriedAbs expr of
                    Just abs ->
                      let
                        javaName = sanitizeName n
                        funcBody = translateLoop env [] javaName abs.args abs.body
                      in
                        JavaLazyAssign javaName (JavaTypedAbs (Array.zip abs.args (paramKinds expr abs.args)) funcBody)
                    Nothing ->
                      let res = translateExpr env [] false expr
                      in JavaLazyAssign (sanitizeName n) (wrapInBlock res)
              )
              group.bindings
          else
            map
              ( \(Tuple (Ident n) expr) ->
                  let res = translateExpr env [] false expr
                  in JavaAssign (sanitizeName n) (wrapInBlock res)
              )
              group.bindings
      )
      analyzedBindings

    dataClasses = Array.concatMap (\decl ->
        map (\ctor ->
            let
              safeCtorName = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_") ctor.name
              -- A proven Int field stays primitive; the Object constructor keeps
              -- cross-module call sites working by unboxing on assignment.
              fields = Array.mapWithIndex (\i fieldType -> Tuple ("value" <> show i) (case fieldType of
                CoreFn.Int -> ParamInt
                _ -> ParamObject)) ctor.fields
              classFullName = modNameStr <> "." <> safeCtorName
            in
              JavaClassDecl safeCtorName fields (Array.elem classFullName ownership.mutableClasses)
        ) decl.constructors
      ) mod.dataDecls

    decls = dataClasses <> mainDecls <> ownership.declarations
    file =
      { decls
      , recordShapes: if typedRecords then Array.nub $ foldMap (\group -> foldMap (\(Tuple _ expr) -> collectRecordShapes expr) group.bindings) analyzedBindings else []
      }
    rewritten = if options.directCalls then directCalls modNameStr file else file
  in reuseConstructors modNameStr rewritten

-- Abs levels, so the type only contributes when it covers the same arity.
paramKinds :: TcoExpr -> Array String -> Array JavaParamType
paramKinds (TcoExpr _ syntax) args = case syntax of
  Typed ty _ -> case ty of
    CoreFn.Func paramTypes _ | Array.length paramTypes == Array.length args ->
      map (\paramType -> case paramType of
        CoreFn.Int -> ParamInt
        _ -> ParamObject) paramTypes
    _ -> Array.replicate (Array.length args) ParamObject
  _ -> Array.replicate (Array.length args) ParamObject
