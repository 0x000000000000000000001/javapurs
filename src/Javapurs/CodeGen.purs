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
import PureScript.Backend.Optimizer.Convert (BackendModule)
import PureScript.Backend.Optimizer.CoreFn (Ident(..), Prop(..), Literal(..), Qualified(..), ModuleName(..))
import Data.String as String
import Data.Newtype (unwrap)

type LoopCtx = { ident :: String, params :: Array String }

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
  Typed _ inner -> extractUncurriedAbs inner
  _ -> Nothing

translateExpr :: String -> Array LoopCtx -> Boolean -> TcoExpr -> JavaExpr
translateExpr modName loopCtx isTail (TcoExpr tcoAnalysis syntax) = case syntax of
  Lit lit -> case lit of
    LitString s -> JavaString s
    LitInt i -> JavaRaw (show i)
    LitNumber n -> JavaRaw (show n)
    LitBoolean b -> JavaRaw (if b then "true" else "false")
    LitChar c -> JavaString (CodeUnits.singleton c)
    LitRecord fields ->
      JavaRecord (map (\(Prop k v) -> Tuple k (translateExpr modName loopCtx false v)) fields)
    LitArray elements ->
      JavaArray (map (translateExpr modName loopCtx false) elements)
    _ -> JavaRaw "null /* TODO: other literals */"
  App fn args ->
    let
      flattenApp :: TcoExpr -> { fn :: TcoExpr, args :: Array TcoExpr }
      flattenApp e@(TcoExpr _ syn) = case syn of
        App f a -> let res = flattenApp f in { fn: res.fn, args: res.args <> Array.fromFoldable a }
        _ -> { fn: e, args: [] }
      
      flat = flattenApp (TcoExpr tcoAnalysis syntax)
      
      isTcoCall = case flat.fn of
        TcoExpr _ (Var (Qualified _ (Ident fnName))) ->
          let checkName = String.replaceAll (String.Pattern "'") (String.Replacement "_") (String.replaceAll (String.Pattern "$") (String.Replacement "") fnName)
          in isTail && Array.elem checkName (map _.ident loopCtx)
        TcoExpr _ (Local (Just (Ident fnName)) (Level lvl)) ->
          isTail && Array.elem (localId (Just (Ident fnName)) (Level lvl)) (map _.ident loopCtx)
        _ -> false
    in
      if isTcoCall then
        let
          targetCtx = case flat.fn of
             TcoExpr _ (Var (Qualified _ (Ident fnName))) ->
               let checkName = String.replaceAll (String.Pattern "'") (String.Replacement "_") (String.replaceAll (String.Pattern "$") (String.Replacement "") fnName)
               in Array.find (\c -> c.ident == checkName) loopCtx
             TcoExpr _ (Local (Just (Ident fnName)) (Level lvl)) ->
               Array.find (\c -> c.ident == localId (Just (Ident fnName)) (Level lvl)) loopCtx
             _ -> Nothing
        in case targetCtx of
          Just ctx ->
            JavaContinue ctx.ident (map (\arg -> translateExpr modName loopCtx false arg) flat.args)
          Nothing ->
            foldl (\acc arg -> JavaApply acc (translateExpr modName loopCtx false arg)) (translateExpr modName loopCtx false fn) (Array.fromFoldable args)
      else
        foldl (\acc arg -> JavaApply acc (translateExpr modName loopCtx false arg)) (translateExpr modName loopCtx false fn) (Array.fromFoldable args)
  UncurriedApp fn args ->
    let
      -- Check if we are doing a TCO call!
      isTcoCall = case fn of
        TcoExpr _ (Var (Qualified _ (Ident fnName))) ->
          let checkName = String.replaceAll (String.Pattern "'") (String.Replacement "_") (String.replaceAll (String.Pattern "$") (String.Replacement "") fnName)
          in isTail && Array.elem checkName (map _.ident loopCtx)
        TcoExpr _ (Local (Just (Ident fnName)) (Level lvl)) ->
          isTail && Array.elem (localId (Just (Ident fnName)) (Level lvl)) (map _.ident loopCtx)
        _ -> false
    in
      if isTcoCall then
        let
          targetCtx = case fn of
             TcoExpr _ (Var (Qualified _ (Ident fnName))) ->
               let checkName = String.replaceAll (String.Pattern "'") (String.Replacement "_") (String.replaceAll (String.Pattern "$") (String.Replacement "") fnName)
               in Array.find (\c -> c.ident == checkName) loopCtx
             TcoExpr _ (Local (Just (Ident fnName)) (Level lvl)) ->
               Array.find (\c -> c.ident == localId (Just (Ident fnName)) (Level lvl)) loopCtx
             _ -> Nothing
        in case targetCtx of
          Just ctx ->
            JavaContinue ctx.ident (map (\arg -> translateExpr modName loopCtx false arg) args)
          Nothing ->
            foldl (\acc arg -> JavaApply acc (translateExpr modName loopCtx false arg)) (translateExpr modName loopCtx false fn) (Array.fromFoldable args)
      else
        foldl (\acc arg -> JavaApply acc (translateExpr modName loopCtx false arg)) (translateExpr modName loopCtx false fn) (Array.fromFoldable args)
  UncurriedEffectApp fn args ->
    foldl (\acc arg -> JavaApply acc (translateExpr modName loopCtx false arg)) (translateExpr modName loopCtx false fn) (Array.fromFoldable args)
  UncurriedEffectAbs args expr ->
    let
      argsArray = map (\(Tuple mbI lvl) -> localId mbI lvl) (Array.fromFoldable args)
    in
      JavaAbs argsArray (translateExpr modName [] true expr)
  Local mbIdent (Level lvl) ->
    let
      varName = localId mbIdent (Level lvl)
      isLoopVar = Array.any (\ctx -> Array.elem varName ctx.params) loopCtx
    in
      if isLoopVar then JavaLocal ("__final_" <> varName) else JavaLocal varName
  Abs args body ->
    foldr (\(Tuple mbI lvl) acc -> JavaAbs [localId mbI lvl] acc) (translateExpr modName [] true body) (Array.fromFoldable args)
  UncurriedAbs args body ->
    let
      argsArray = map (\(Tuple mbI lvl) -> localId mbI lvl) args
    in
      JavaAbs argsArray (translateExpr modName [] true body)
  Let mbI lvl val body ->
    JavaLet (localId mbI lvl) (translateExpr modName loopCtx false val) (translateExpr modName loopCtx isTail body)
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
                  newCtx = { ident: javaName, params: abs.args }
                  newLoopCtx = Array.cons newCtx loopCtx
                  loopBody = translateExpr modName newLoopCtx true abs.body
                  funcBody = JavaWhileTrue abs.args loopBody
                in
                  JavaLet javaName (JavaAbs abs.args funcBody) (translateExpr modName loopCtx isTail body)
              Nothing ->
                JavaRaw "null /* TODO: LetRec isLoop but not Abs */"
          Nothing -> JavaRaw "null /* LetRec empty */"
      else
        let
          bindsArray = map (\(Tuple (Ident name) val) -> Tuple (localId (Just (Ident name)) lvl) (translateExpr modName loopCtx false val)) (Array.fromFoldable binds)
        in
          JavaLetRec bindsArray (translateExpr modName loopCtx isTail body)
  EffectBind mbI lvl val body ->
    JavaLet (localId mbI lvl) (translateExpr modName loopCtx false val) (translateExpr modName loopCtx isTail body)
  EffectPure val -> translateExpr modName loopCtx isTail val
  EffectDefer val -> translateExpr modName loopCtx false val
  Typed _ expr ->
    translateExpr modName loopCtx isTail expr
  CtorSaturated (Qualified mbMod _) _ _ (Ident ctorName) args ->
    let
      safeCtorName = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_") ctorName
      modPart = case mbMod of
        Just (ModuleName mn) -> String.replaceAll (String.Pattern ".") (String.Replacement "_") mn
        Nothing -> modName
      javaClass = modPart <> "." <> safeCtorName
      mappedArgs = Array.fromFoldable (map (\(Tuple _ val) -> translateExpr modName loopCtx false val) args)
    in
      JavaNew javaClass mappedArgs
  CtorDef _ _ (Ident ctorName) fields ->
    let
      safeCtorName = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_") ctorName
      javaClass = modName <> "." <> safeCtorName
      numFields = Array.length fields
      mappedFields = Array.mapWithIndex (\i _ -> "value" <> show i) fields
      body = JavaNew javaClass (map JavaLocal mappedFields)
    in
      if numFields == 0 then
        body
      else
        JavaAbs mappedFields body
  Branch pairs def ->
    Array.foldr
      (\(Pair cond body) acc ->
         JavaTernary (translateExpr modName loopCtx false cond) (translateExpr modName loopCtx isTail body) acc
      )
      (translateExpr modName loopCtx isTail def)
      (NEA.toArray pairs)
  Fail msg ->
    JavaThrow msg
  Accessor expr acc -> case acc of
    GetProp prop ->
      JavaMapGet (translateExpr modName loopCtx false expr) prop
    GetCtorField (Qualified mbMod _) _ _ (Ident ctorName) _ idx ->
      let
        safeCtorName = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_") ctorName
        modPart = case mbMod of
          Just (ModuleName mn) -> String.replaceAll (String.Pattern ".") (String.Replacement "_") mn
          Nothing -> modName
        javaClass = modPart <> "." <> safeCtorName
      in
        JavaPropertyAccess (translateExpr modName loopCtx false expr) javaClass ("value" <> show idx)
    _ -> JavaRaw "null /* TODO: Accessor */"
  Update expr updates ->
    JavaMapUpdate (translateExpr modName loopCtx false expr) (map (\(Prop prop val) -> Tuple prop (translateExpr modName loopCtx false val)) updates)
  PrimOp op -> case op of
    Op1 op1 e -> translateOperator1 modName op1 (translateExpr modName loopCtx false e)
    Op2 op2 e1 e2 -> translateOperator2 modName op2 (translateExpr modName loopCtx false e1) (translateExpr modName loopCtx false e2)
  Var qi -> case qi of
    Qualified mbMod (Ident name) ->
      let
        qModName = case mbMod of
          Just (ModuleName m) -> Just (String.replaceAll (String.Pattern ".") (String.Replacement "_") m)
          Nothing -> Nothing
      in JavaGlobalVar qModName (sanitizeName name)
  _ -> JavaRaw ("null /* TODO: " <> syntaxTag syntax <> " */")

syntaxTag :: BackendSyntax TcoExpr -> String
syntaxTag = case _ of
  Var _ -> "Var"
  Local _ _ -> "Local"
  Lit _ -> "Lit"
  App _ _ -> "App"
  Abs _ _ -> "Abs"
  UncurriedApp _ _ -> "UncurriedApp"
  UncurriedAbs _ _ -> "UncurriedAbs"
  UncurriedEffectApp _ _ -> "UncurriedEffectApp"
  UncurriedEffectAbs _ _ -> "UncurriedEffectAbs"
  Accessor _ _ -> "Accessor"
  Update _ _ -> "Update"
  CtorSaturated _ _ _ _ _ -> "CtorSaturated"
  CtorDef _ _ _ _ -> "CtorDef"
  LetRec _ _ _ -> "LetRec"
  Let _ _ _ _ -> "Let"
  EffectBind _ _ _ _ -> "EffectBind"
  EffectPure _ -> "EffectPure"
  EffectDefer _ -> "EffectDefer"
  Branch _ _ -> "Branch"
  PrimOp _ -> "PrimOp"
  PrimEffect _ -> "PrimEffect"
  PrimUndefined -> "PrimUndefined"
  Fail _ -> "Fail"
  Typed _ _ -> "Typed"

translate :: BackendModule -> JavaFile
translate mod =
  let
    -- We just find `main` and translate it. For now we only care about Baby Step 1 (the single `main` binding).
    Tuple _ tcoBindings = foldl
      (\(Tuple env acc) group ->
          let
            tcoBinds = map (\(Tuple k v) -> Tuple k (Tco.analyze env v)) group.bindings
          in
            Tuple env (Array.snoc acc { recursive: group.recursive, bindings: tcoBinds })
      )
      (Tuple [] [])
      mod.bindings

    modNameStr = case mod.name of
      ModuleName m -> String.replaceAll (String.Pattern ".") (String.Replacement "_") m

    mainDecls = Array.concatMap
      ( \group ->
          if group.recursive && Array.length group.bindings == 1 then
            case Array.head group.bindings of
              Just (Tuple (Ident name) expr) ->
                case extractUncurriedAbs expr of
                  Just abs ->
                    let
                      javaName = sanitizeName name
                      newCtx = { ident: javaName, params: abs.args }
                      loopBody = translateExpr modNameStr [newCtx] true abs.body
                      funcBody = JavaWhileTrue abs.args loopBody
                    in
                      [JavaAssign javaName (JavaAbs abs.args funcBody)]
                  Nothing ->
                    [JavaAssign (sanitizeName name) (translateExpr modNameStr [] false expr)]
              Nothing -> []
          else
            map
              ( \(Tuple (Ident name) expr) ->
                  JavaAssign (sanitizeName name) (translateExpr modNameStr [] false expr)
              )
              group.bindings
      )
      tcoBindings

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
  OpIsTag (Qualified mbMod (Ident tag)) ->
    let
      safeTag = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_") tag
      modPart = case mbMod of
        Just (ModuleName mn) -> String.replaceAll (String.Pattern ".") (String.Replacement "_") mn
        Nothing -> modName
      javaClass = modPart <> "." <> safeTag
    in
      JavaInstanceOf e javaClass
  _ -> JavaRaw ("null /* TODO: Op1 */")

translateOperator2 _ op e1 e2 = case op of
  OpBooleanOrd OpEq -> JavaCall (JavaRaw "java.util.Objects.equals") [e1, e2]
  OpIntNum OpAdd -> JavaBinaryOp "+" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntNum OpSubtract -> JavaBinaryOp "-" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntNum OpMultiply -> JavaBinaryOp "*" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntNum OpDivide -> JavaBinaryOp "/" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntOrd OpEq -> JavaBinaryOp "==" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntOrd OpNotEq -> JavaBinaryOp "!=" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntOrd OpGt -> JavaBinaryOp ">" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntOrd OpGte -> JavaBinaryOp ">=" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntOrd OpLt -> JavaBinaryOp "<" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  OpIntOrd OpLte -> JavaBinaryOp "<=" (JavaCast "Integer" e1) (JavaCast "Integer" e2)
  _ -> JavaRaw ("null /* TODO: Op2 */")

sanitizeName :: String -> String
sanitizeName n =
  let
    n' = String.replaceAll (String.Pattern "$") (String.Replacement "") (String.replaceAll (String.Pattern "'") (String.Replacement "$prime") n)
    isKeyword x = x == "void" || x == "class" || x == "return" || x == "const" || x == "new" || x == "throw" || x == "catch" || x == "try" || x == "if" || x == "else" || x == "while" || x == "for" || x == "do" || x == "switch" || x == "case" || x == "default" || x == "break" || x == "continue" || x == "boolean" || x == "byte" || x == "char" || x == "short" || x == "int" || x == "long" || x == "float" || x == "double" || x == "true" || x == "false" || x == "null" || x == "this" || x == "super" || x == "instanceof" || x == "public" || x == "protected" || x == "private" || x == "static" || x == "final" || x == "abstract" || x == "interface" || x == "implements" || x == "extends" || x == "package" || x == "import" || x == "throws" || x == "enum" || x == "assert" || x == "strictfp" || x == "native" || x == "synchronized" || x == "transient" || x == "volatile"
  in
    if isKeyword n' then "$" <> n' else n'
