module Javapurs.CodeGen where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))
import Data.Foldable (foldl, foldr)
import PureScript.Backend.Optimizer.Syntax (BackendSyntax(..), Level(..), Pair(..), BackendOperator(..), BackendOperator1(..), BackendOperator2(..), BackendAccessor(..), BackendOperatorOrd(..), BackendOperatorNum(..))
import PureScript.Backend.Optimizer.FreeVars (localId)
import Data.Array.NonEmpty as NEA
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr(..))
import Data.String.CodeUnits as CodeUnits
import Data.Newtype (unwrap)
import PureScript.Backend.Optimizer.Codegen.Tco as Tco
import Javapurs.JavaAst (JavaExpr(..), JavaFile)
import Javapurs.Printer (printExpr)
import PureScript.Backend.Optimizer.Convert (BackendModule)
import Debug as Debug
import PureScript.Backend.Optimizer.CoreFn (Ident(..), Prop(..), Qualified(..), ModuleName(..), Module(..), Literal(..))
import Data.String as String

type LoopCtx = { ident :: String, params :: Array String }

type TransRes = { stmts :: Array JavaExpr, expr :: JavaExpr }

pureExpr :: JavaExpr -> TransRes
pureExpr e = { stmts: [], expr: e }

wrapInBlock :: TransRes -> JavaExpr
wrapInBlock res =
  if Array.length res.stmts == 0 then res.expr
  else JavaBlock res.stmts res.expr

translateExpr :: String -> Array LoopCtx -> Boolean -> TcoExpr -> TransRes
translateExpr modName loopCtx isTail tcoExpr =
  translateExprWith false modName loopCtx isTail tcoExpr

translateExprWith :: Boolean -> String -> Array LoopCtx -> Boolean -> TcoExpr -> TransRes
translateExprWith inEffectBlock modName loopCtx isTail tcoExpr@(TcoExpr tcoAnalysis syntax) =
  let isEff = isEffectNode tcoExpr
  in if isEff && not inEffectBlock then
    let res = translateExprWith true modName loopCtx false tcoExpr
    in pureExpr $ JavaAbs [] (wrapInBlock res)
  else case syntax of
  Lit lit -> case lit of
    LitInt n -> pureExpr $ JavaRaw (show n)
    LitNumber n -> pureExpr $ JavaRaw (show n)
    LitString s -> pureExpr $ JavaString s
    LitChar c -> pureExpr $ JavaRaw ("'" <> CodeUnits.singleton c <> "'")
    LitBoolean b -> pureExpr $ JavaRaw (if b then "true" else "false")
    LitArray elements ->
      let resElemsExprs = map (\e -> wrapInBlock (translateExpr modName loopCtx false e)) elements
      in pureExpr $ JavaArray resElemsExprs
    LitRecord fields ->
      let resFieldsExprs = map (\(Prop k v) -> Tuple k (wrapInBlock (translateExpr modName loopCtx false v))) fields
      in pureExpr $ JavaRecord resFieldsExprs
  App _ _ ->
    let
      flat = flattenApp tcoExpr
      resFnExpr = wrapInBlock (translateExpr modName loopCtx false flat.fn)
      argsExprs = map (\a -> wrapInBlock (translateExpr modName loopCtx false a)) flat.args
    in
      if isTail then
        let targetCtx = case unwrapTcoExpr flat.fn of
             Local (Just (Ident fnName)) (Level lvl) ->
               Array.find (\c -> c.ident == localId (Just (Ident fnName)) (Level lvl)) loopCtx
             _ -> Nothing
        in case targetCtx of
          Just ctx ->
            if Array.length flat.args == Array.length ctx.params then
               pureExpr $ JavaContinue ctx.ident argsExprs
            else
               pureExpr $ foldl JavaApply resFnExpr argsExprs
          Nothing -> pureExpr $ foldl JavaApply resFnExpr argsExprs
      else
        pureExpr $ foldl JavaApply resFnExpr argsExprs
  UncurriedApp _ _ ->
    let
      flat = flattenApp tcoExpr
      resFnExpr = wrapInBlock (translateExpr modName loopCtx false flat.fn)
      argsExprs = map (\a -> wrapInBlock (translateExpr modName loopCtx false a)) flat.args
    in
      if isTail then
        let targetCtx = case unwrapTcoExpr flat.fn of
             Local (Just (Ident fnName)) (Level lvl) ->
               Array.find (\c -> c.ident == localId (Just (Ident fnName)) (Level lvl)) loopCtx
             _ -> Nothing
        in case targetCtx of
          Just ctx ->
            if Array.length flat.args == Array.length ctx.params then
               pureExpr $ JavaContinue ctx.ident argsExprs
            else
               pureExpr $ foldl JavaApply resFnExpr argsExprs
          Nothing -> pureExpr $ foldl JavaApply resFnExpr argsExprs
      else
        pureExpr $ foldl JavaApply resFnExpr argsExprs
  UncurriedEffectApp fn args ->
    let
      resFnExpr = wrapInBlock (translateExpr modName loopCtx false fn)
      argsExprs = map (\a -> wrapInBlock (translateExpr modName loopCtx false a)) (Array.fromFoldable args)
    in pureExpr $ foldl JavaApply resFnExpr argsExprs
  UncurriedAbs args body ->
    let
      argsArray = map (\(Tuple mbI lvl) -> localId mbI lvl) args
      resBody = translateExprWith inEffectBlock modName [] true body
    in
      if inEffectBlock && Array.length args == 0 then resBody
      else pureExpr $ JavaAbs argsArray (wrapInBlock resBody)
  UncurriedEffectAbs args expr ->
    let
      argsArray = map (\(Tuple mbI lvl) -> localId mbI lvl) (Array.fromFoldable args)
      resBody = translateExprWith inEffectBlock modName [] true expr
    in
      if inEffectBlock && Array.length args == 0 then resBody
      else pureExpr $ JavaAbs argsArray (wrapInBlock resBody)
  Local mbIdent (Level lvl) ->
    let
      varName = localId mbIdent (Level lvl)
      isLoopVar = Array.any (\ctx -> Array.elem varName ctx.params) loopCtx
    in
      pureExpr $ if isLoopVar then JavaLocal ("__final_" <> varName) else JavaLocal varName
  Abs args body ->
    let resBody = translateExpr modName [] true body
    in pureExpr $ foldr (\(Tuple mbI lvl) acc -> JavaAbs [localId mbI lvl] acc) (wrapInBlock resBody) (Array.fromFoldable args)
  UncurriedAbs args body ->
    let
      argsArray = map (\(Tuple mbI lvl) -> localId mbI lvl) args
      resBody = translateExpr modName [] true body
    in
      pureExpr $ JavaAbs argsArray (wrapInBlock resBody)
  Let mbI lvl val body ->
    let
      resValExpr = wrapInBlock (translateExpr modName loopCtx false val)
      varName = localId mbI lvl
      assignStmt = JavaLocalAssign varName resValExpr
      resBody = translateExprWith inEffectBlock modName loopCtx isTail body
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
                  newLoopCtx = { ident: javaName, params: abs.args }
                  loopBody = translateExpr modName [newLoopCtx] true abs.body
                  funcBody = JavaWhileTrue abs.args (wrapInBlock loopBody)
                in
                  let resBody = translateExprWith inEffectBlock modName loopCtx isTail body
                  in { stmts: [JavaLocalAssign javaName (JavaAbs abs.args funcBody)] <> resBody.stmts, expr: resBody.expr }
              Nothing ->
                let
                  bindsArray = map (\(Tuple (Ident n) v) -> Tuple (localId (Just (Ident n)) lvl) (wrapInBlock (translateExpr modName loopCtx false v))) (Array.fromFoldable binds)
                  resBody = translateExprWith inEffectBlock modName loopCtx isTail body
                in { stmts: [JavaLetRec bindsArray (wrapInBlock resBody)], expr: JavaRaw "null" }
          Nothing -> pureExpr $ JavaRaw "null"
      else
        let
          bindsArray = map (\(Tuple (Ident name) val) -> Tuple (localId (Just (Ident name)) lvl) (wrapInBlock (translateExpr modName loopCtx false val))) (Array.fromFoldable binds)
          resBody = translateExprWith inEffectBlock modName loopCtx isTail body
        in pureExpr $ JavaLetRec bindsArray (wrapInBlock resBody)
  EffectPure val -> translateExpr modName loopCtx isTail val
  EffectDefer val -> translateExprWith inEffectBlock modName loopCtx true val
  EffectBind mbI lvl expr rest ->
    let
      realExpr = stripEffectDefer expr
      realRest = stripEffectAbs rest
      resExprExpr = wrapInBlock (translateExprWith true modName loopCtx false realExpr)
      varName = localId mbI lvl
      executedExpr =
        if isEffectNode realExpr then resExprExpr
        else JavaCall (JavaPropertyAccess resExprExpr "java.util.function.Supplier" "get") []
      assignStmt = JavaLocalAssign varName executedExpr
      resRest = translateExprWith true modName loopCtx isTail realRest
      executedRestExpr =
        if isEffectNode realRest then resRest.expr
        else JavaCall (JavaPropertyAccess resRest.expr "java.util.function.Supplier" "get") []
    in { stmts: Array.cons assignStmt resRest.stmts, expr: executedRestExpr }
  Fail msg -> pureExpr $ JavaThrow msg
  Typed _ expr -> translateExprWith inEffectBlock modName loopCtx isTail expr
  CtorSaturated (Qualified mbMod _) _ _ (Ident ctorName) args ->
    let
      safeCtorName = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_") ctorName
      modPart = case mbMod of
        Just (ModuleName mn) -> String.replaceAll (String.Pattern ".") (String.Replacement "_") mn
        Nothing -> modName
      javaClass = modPart <> "." <> safeCtorName
      resArgsExprs = map (\(Tuple _ val) -> wrapInBlock (translateExpr modName loopCtx false val)) (Array.fromFoldable args)
    in pureExpr $ JavaNew javaClass resArgsExprs
  CtorDef _ _ (Ident ctorName) fields ->
    let
      safeCtorName = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_") ctorName
      javaClass = modName <> "." <> safeCtorName
      numFields = Array.length fields
      mappedFields = Array.mapWithIndex (\i _ -> "value" <> show i) fields
      body = JavaNew javaClass (map JavaLocal mappedFields)
    in
      if numFields == 0 then
        pureExpr body
      else
        pureExpr $ JavaAbs mappedFields body
  Accessor expr acc -> case acc of
    GetProp prop ->
      let resExprExpr = wrapInBlock (translateExpr modName loopCtx false expr)
      in pureExpr $ JavaMapGet resExprExpr prop
    GetCtorField (Qualified mbMod _) _ _ (Ident ctorName) _ idx ->
      let
        safeCtorName = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_") ctorName
        modPart = case mbMod of
          Just (ModuleName mn) -> String.replaceAll (String.Pattern ".") (String.Replacement "_") mn
          Nothing -> modName
        javaClass = modPart <> "." <> safeCtorName
        resExprExpr = wrapInBlock (translateExpr modName loopCtx false expr)
      in pureExpr $ JavaPropertyAccess resExprExpr javaClass ("value" <> show idx)
    _ -> pureExpr $ JavaRaw "null /* TODO: Accessor */"
  Update expr updates ->
    let resExprExpr = wrapInBlock (translateExpr modName loopCtx false expr)
        mappedUpdates = map (\(Prop prop val) -> Tuple prop (wrapInBlock (translateExpr modName loopCtx false val))) updates
    in pureExpr $ JavaMapUpdate resExprExpr mappedUpdates
  Var qi -> case qi of
    Qualified mbMod (Ident name) ->
      let
        qModName = case mbMod of
          Just (ModuleName m) -> Just (String.replaceAll (String.Pattern ".") (String.Replacement "_") m)
          Nothing -> Nothing
      in pureExpr $ JavaGlobalVar qModName (sanitizeName name)
  Branch cases def ->
    let
      resDef = translateExpr modName loopCtx isTail def
      mappedArgs = Array.fromFoldable (map (\(Pair c v) -> 
        let rc = translateExpr modName loopCtx false c
            rv = translateExpr modName loopCtx isTail v
        in { cStmts: rc.stmts, cExpr: rc.expr, vStmts: rv.stmts, vExpr: rv.expr }
      ) cases)
      
      buildTernary :: Array { cStmts :: Array JavaExpr, cExpr :: JavaExpr, vStmts :: Array JavaExpr, vExpr :: JavaExpr } -> JavaExpr -> JavaExpr
      buildTernary [] d = d
      buildTernary arr d =
        case Array.uncons arr of
          Just { head, tail } ->
            let restTernary = buildTernary tail d
            in if Array.length head.cStmts > 0 || Array.length head.vStmts > 0 then
                 JavaBlock head.cStmts (JavaTernary head.cExpr (wrapInBlock { stmts: head.vStmts, expr: head.vExpr }) restTernary)
               else
                 JavaTernary head.cExpr head.vExpr restTernary
          Nothing -> d
          
    in { stmts: resDef.stmts, expr: buildTernary mappedArgs resDef.expr }
  PrimOp op -> case op of
    Op1 op1 e -> 
      let resExpr = wrapInBlock (translateExpr modName loopCtx false e)
      in pureExpr $ translateOperator1 modName op1 resExpr
    Op2 op2 e1 e2 ->
      let res1Expr = wrapInBlock (translateExpr modName loopCtx false e1)
          res2Expr = wrapInBlock (translateExpr modName loopCtx false e2)
      in pureExpr $ translateOperator2 modName op2 res1Expr res2Expr
  PrimUndefined -> pureExpr $ JavaRaw "null /* TODO: PrimUndefined */"
  _ -> pureExpr $ JavaRaw ("null /* TODO: unknown syntax " <> syntaxTag syntax <> " */")

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
stripEffectDefer expr@(TcoExpr a syn) = case unwrapTcoExpr expr of
  EffectDefer inner -> stripEffectDefer inner
  Abs _ inner -> stripEffectDefer inner
  Let ident lvl val body -> TcoExpr a (Let ident lvl val (stripEffectDefer body))
  LetRec lvl bindings body -> TcoExpr a (LetRec lvl bindings (stripEffectDefer body))
  _ -> expr

stripEffectAbs :: TcoExpr -> TcoExpr
stripEffectAbs expr@(TcoExpr a syn) =
  let unwrapped = unwrapTcoExpr expr
  in case unwrapped of
  UncurriedEffectAbs [] body -> stripEffectAbs body
  UncurriedAbs [] body -> stripEffectAbs body
  Abs args body ->
    if Array.length (Array.fromFoldable args) == 1 then
      case Array.head (Array.fromFoldable args) of
        Just (Tuple Nothing _) -> stripEffectAbs body
        Just (Tuple (Just (Ident name)) _) ->
           let _ = Debug.trace ("STRIP_EFFECT_ABS SAW IDENT: " <> name) (\_ -> unit)
           in if name == "$__unused" then stripEffectAbs body else expr
        _ -> expr
    else expr
  EffectDefer body -> stripEffectAbs body
  Let ident lvl val body -> TcoExpr a (Let ident lvl val (stripEffectAbs body))
  LetRec lvl bindings body -> TcoExpr a (LetRec lvl bindings (stripEffectAbs body))
  _ -> case syn of
    Typed t inner -> TcoExpr a (Typed t (stripEffectAbs inner))
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
  _ -> Nothing

flattenApp :: TcoExpr -> { fn :: TcoExpr, args :: Array TcoExpr }
flattenApp expr@(TcoExpr _ syntax) = case syntax of
  App fn args ->
    let inner = flattenApp fn
    in { fn: inner.fn, args: inner.args <> NEA.toArray args }
  UncurriedApp fn args ->
    let inner = flattenApp fn
    in { fn: inner.fn, args: inner.args <> Array.fromFoldable args }
  Typed _ inner -> flattenApp inner
  _ -> { fn: expr, args: [] }

unwrapTcoExpr :: TcoExpr -> BackendSyntax TcoExpr
unwrapTcoExpr (TcoExpr _ syntax) = case syntax of
  Typed _ inner -> unwrapTcoExpr inner
  _ -> syntax

translate :: BackendModule -> JavaFile
translate mod =
  let
    modNameStr = case mod.name of
      ModuleName m -> String.replaceAll (String.Pattern ".") (String.Replacement "_") m

    Tuple _ analyzedBindings = foldl
      (\(Tuple env acc) group ->
          let
            tcoBinds = map (\(Tuple k v) -> Tuple k (Tco.analyze env v)) group.bindings
          in
            Tuple env (Array.snoc acc { recursive: group.recursive, bindings: tcoBinds })
      )
      (Tuple [] [])
      mod.bindings

    mainDecls = Array.concatMap
      ( \group ->
          if group.recursive then
            map
              ( \(Tuple (Ident n) expr) ->
                  case extractUncurriedAbs expr of
                    Just abs ->
                      let
                        javaName = sanitizeName n
                        newCtx = { ident: javaName, params: abs.args }
                        loopBody = translateExpr modNameStr [newCtx] true abs.body
                        funcBody = JavaWhileTrue abs.args (wrapInBlock loopBody)
                      in
                        JavaAssign javaName (JavaAbs abs.args funcBody)
                    Nothing ->
                      let res = translateExpr modNameStr [] false expr
                      in JavaAssign (sanitizeName n) (wrapInBlock res)
              )
              group.bindings
          else
            map
              ( \(Tuple (Ident n) expr) ->
                  let res = translateExpr modNameStr [] false expr
                  in JavaAssign (sanitizeName n) (wrapInBlock res)
              )
              group.bindings
      )
      analyzedBindings

    dataClasses = Array.concatMap (\decl ->
        map (\ctor ->
            let
              safeCtorName = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_") ctor.name
              args = Array.mapWithIndex (\i _ -> "value" <> show i) ctor.fields
            in
              JavaClassDecl safeCtorName args
        ) decl.constructors
      ) mod.dataDecls

    decls = dataClasses <> mainDecls
  in
    { decls }

translateOperator1 :: String -> BackendOperator1 -> JavaExpr -> JavaExpr
translateOperator1 modName op e = case op of
  OpBooleanNot -> JavaRaw ("!(" <> printExpr (JavaCast "Boolean" e) <> ")")
  OpIntBitNot -> JavaRaw ("~(" <> printExpr (JavaCast "Integer" e) <> ")")
  OpIntNegate -> JavaRaw ("-(" <> printExpr (JavaCast "Integer" e) <> ")")
  OpNumberNegate -> JavaRaw ("-(" <> printExpr (JavaCast "Double" e) <> ")")
  OpArrayLength -> JavaRaw ("((Object[]) " <> printExpr e <> ").length")
  OpIsTag (Qualified mbMod (Ident tag)) ->
    let
      safeTag = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_") tag
      modPart = case mbMod of
        Just (ModuleName mn) -> String.replaceAll (String.Pattern ".") (String.Replacement "_") mn
        Nothing -> modName
      javaClass = modPart <> "." <> safeTag
    in
      JavaInstanceOf e javaClass

translateOperator2 :: String -> BackendOperator2 -> JavaExpr -> JavaExpr -> JavaExpr
translateOperator2 _ op e1 e2 = case op of
  OpBooleanAnd -> JavaBinaryOp "&&" (JavaCast "Boolean" e1) (JavaCast "Boolean" e2)
  OpBooleanOr -> JavaBinaryOp "||" (JavaCast "Boolean" e1) (JavaCast "Boolean" e2)
  OpBooleanOrd OpEq -> JavaCall (JavaRaw "java.util.Objects.equals") [e1, e2]
  OpBooleanOrd OpNotEq -> JavaRaw ("!(" <> printExpr (JavaCall (JavaRaw "java.util.Objects.equals") [e1, e2]) <> ")")
  OpBooleanOrd OpGt -> JavaBinaryOp "&&" (JavaCast "Boolean" e1) (JavaRaw ("!(" <> printExpr (JavaCast "Boolean" e2) <> ")"))
  OpBooleanOrd OpGte -> JavaBinaryOp "||" (JavaCast "Boolean" e1) (JavaRaw ("!(" <> printExpr (JavaCast "Boolean" e2) <> ")"))
  OpBooleanOrd OpLt -> JavaBinaryOp "&&" (JavaRaw ("!(" <> printExpr (JavaCast "Boolean" e1) <> ")")) (JavaCast "Boolean" e2)
  OpBooleanOrd OpLte -> JavaBinaryOp "||" (JavaRaw ("!(" <> printExpr (JavaCast "Boolean" e1) <> ")")) (JavaCast "Boolean" e2)
  OpCharOrd OpEq -> JavaCall (JavaRaw "java.util.Objects.equals") [e1, e2]
  OpCharOrd OpNotEq -> JavaRaw ("!(" <> printExpr (JavaCall (JavaRaw "java.util.Objects.equals") [e1, e2]) <> ")")
  OpCharOrd OpGt -> JavaBinaryOp ">" (JavaCast "Character" e1) (JavaCast "Character" e2)
  OpCharOrd OpGte -> JavaBinaryOp ">=" (JavaCast "Character" e1) (JavaCast "Character" e2)
  OpCharOrd OpLt -> JavaBinaryOp "<" (JavaCast "Character" e1) (JavaCast "Character" e2)
  OpCharOrd OpLte -> JavaBinaryOp "<=" (JavaCast "Character" e1) (JavaCast "Character" e2)
  OpIntBitAnd -> JavaBinaryOp "&" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntBitOr -> JavaBinaryOp "|" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntBitShiftLeft -> JavaBinaryOp "<<" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntBitShiftRight -> JavaBinaryOp ">>" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntBitXor -> JavaBinaryOp "^" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntBitZeroFillShiftRight -> JavaBinaryOp ">>>" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntNum OpAdd -> JavaBinaryOp "+" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntNum OpSubtract -> JavaBinaryOp "-" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntNum OpMultiply -> JavaBinaryOp "*" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntNum OpDivide -> JavaBinaryOp "/" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntOrd OpEq -> JavaCall (JavaRaw "java.util.Objects.equals") [e1, e2]
  OpIntOrd OpNotEq -> JavaRaw ("!(" <> printExpr (JavaCall (JavaRaw "java.util.Objects.equals") [e1, e2]) <> ")")
  OpIntOrd OpGt -> JavaBinaryOp ">" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntOrd OpGte -> JavaBinaryOp ">=" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntOrd OpLt -> JavaBinaryOp "<" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntOrd OpLte -> JavaBinaryOp "<=" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpNumberNum OpAdd -> JavaBinaryOp "+" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpNumberNum OpSubtract -> JavaBinaryOp "-" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpNumberNum OpMultiply -> JavaBinaryOp "*" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpNumberNum OpDivide -> JavaBinaryOp "/" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpNumberOrd OpEq -> JavaCall (JavaRaw "java.util.Objects.equals") [e1, e2]
  OpNumberOrd OpNotEq -> JavaRaw ("!(" <> printExpr (JavaCall (JavaRaw "java.util.Objects.equals") [e1, e2]) <> ")")
  OpNumberOrd OpGt -> JavaBinaryOp ">" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpNumberOrd OpGte -> JavaBinaryOp ">=" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpNumberOrd OpLt -> JavaBinaryOp "<" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpNumberOrd OpLte -> JavaBinaryOp "<=" (JavaCast "Double" e1) (JavaCast "Double" e2)
  OpStringAppend -> JavaBinaryOp "+" (JavaCast "String" e1) (JavaCast "String" e2)
  OpStringOrd OpEq -> JavaCall (JavaRaw "java.util.Objects.equals") [e1, e2]
  OpStringOrd OpNotEq -> JavaRaw ("!(" <> printExpr (JavaCall (JavaRaw "java.util.Objects.equals") [e1, e2]) <> ")")
  OpStringOrd OpGt -> JavaBinaryOp ">" (JavaRaw ("((String) " <> printExpr e1 <> ").compareTo((String) " <> printExpr e2 <> ")")) (JavaRaw "0")
  OpStringOrd OpGte -> JavaBinaryOp ">=" (JavaRaw ("((String) " <> printExpr e1 <> ").compareTo((String) " <> printExpr e2 <> ")")) (JavaRaw "0")
  OpStringOrd OpLt -> JavaBinaryOp "<" (JavaRaw ("((String) " <> printExpr e1 <> ").compareTo((String) " <> printExpr e2 <> ")")) (JavaRaw "0")
  OpStringOrd OpLte -> JavaBinaryOp "<=" (JavaRaw ("((String) " <> printExpr e1 <> ").compareTo((String) " <> printExpr e2 <> ")")) (JavaRaw "0")
  OpArrayIndex -> JavaRaw ("((Object[]) " <> printExpr e1 <> ")[" <> printExpr (JavaCast "Integer" e2) <> "]")

sanitizeName :: String -> String
sanitizeName n =
  let
    n' = String.replaceAll (String.Pattern "$") (String.Replacement "") (String.replaceAll (String.Pattern "'") (String.Replacement "$prime") n)
    isKeyword x = x == "void" || x == "class" || x == "return" || x == "const" || x == "new" || x == "throw" || x == "catch" || x == "try" || x == "finally" || x == "if" || x == "else" || x == "while" || x == "for" || x == "do" || x == "switch" || x == "case" || x == "default" || x == "break" || x == "continue" || x == "boolean" || x == "byte" || x == "char" || x == "short" || x == "int" || x == "long" || x == "float" || x == "double" || x == "true" || x == "false" || x == "null" || x == "this" || x == "super" || x == "instanceof" || x == "public" || x == "protected" || x == "private" || x == "static" || x == "final" || x == "abstract" || x == "interface" || x == "implements" || x == "extends" || x == "package" || x == "import" || x == "throws" || x == "enum" || x == "assert" || x == "strictfp" || x == "native" || x == "synchronized" || x == "transient" || x == "volatile"
  in
    if isKeyword n' then "$" <> n' else n'
