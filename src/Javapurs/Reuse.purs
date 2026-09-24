module Javapurs.Reuse (reuseConstructors) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..), snd)
import Javapurs.JavaAst (JavaExpr(..), JavaFile, JavaParamType(..))

-- A constructor rebuilt from its own scrutinee can share that value instead of
-- allocating. Two shapes are recognized: every argument is the projection of
-- the same value at the same index, or exactly one field is replaced by a
-- shared nullary constructor while the others are matching projections. In the
-- second case a single field test decides between the source and a fresh node.
reuseConstructors :: String -> JavaFile -> JavaFile
reuseConstructors moduleName file =
  let
    ctors = map (qualify moduleName) (Array.mapMaybe ctorOf file.decls)
    rewrite = mapExpr (reuse ctors)
  in file { decls = map rewrite file.decls }

type CtorInfo = { name :: String, kinds :: Array JavaParamType }

ctorOf :: JavaExpr -> Maybe CtorInfo
ctorOf = case _ of
  JavaClassDecl name fields _ -> Just { name, kinds: map snd fields }
  _ -> Nothing

-- Constructor classes are declared with their bare name and referenced with
-- the module prefix, so the search table keeps the qualified form.
qualify :: String -> CtorInfo -> CtorInfo
qualify moduleName info = info { name = moduleName <> "." <> info.name }

reuse :: Array CtorInfo -> JavaExpr -> JavaExpr
reuse ctors expression = case expression of
  JavaNew className args
    | Just info <- Array.find (\c -> c.name == className) ctors
    , Array.length args == Array.length info.kinds ->
        case allProjections className args of
          Just scrutinee -> JavaLocal scrutinee
          Nothing -> case replacement ctors className info args of
            Just { scrutinee, field, constant } ->
              JavaTernary
                (JavaBinaryOp "==" (projection className field scrutinee) constant)
                (JavaLocal scrutinee)
                expression
            Nothing -> expression
  _ -> expression

-- Every argument is the projection of one local at its own position.
allProjections :: String -> Array JavaExpr -> Maybe String
allProjections className args = do
  let scrutinees = Array.mapMaybe identity (Array.mapWithIndex (projectionAt className) args)
  if Array.length scrutinees /= Array.length args then Nothing
  else case Array.nub scrutinees of
    [ scrutinee ] -> Just scrutinee
    _ -> Nothing

-- Exactly one argument is a shared nullary constructor; all the others are
-- projections of one local at their own positions. A primitive field cannot
-- use reference equality, so only Object fields are considered.
replacement :: Array CtorInfo -> String -> CtorInfo -> Array JavaExpr
  -> Maybe { scrutinee :: String, field :: Int, constant :: JavaExpr }
replacement ctors className info args = do
  case Array.mapMaybe identity (Array.mapWithIndex (\index arg -> Tuple index <$> constantClass ctors arg) args) of
    [ Tuple index _ ] | index < Array.length info.kinds ->
      case Array.index info.kinds index of
        Just ParamObject -> do
          scrutinee <- othersProjection className index args
          value <- Array.index args index
          Just { scrutinee, field: index, constant: value }
        _ -> Nothing
    _ -> Nothing

-- All arguments except one fixed position are projections of one local.
othersProjection :: String -> Int -> Array JavaExpr -> Maybe String
othersProjection className skip args = do
  let
    scrutinees = Array.mapMaybe identity
      (Array.mapWithIndex (\index arg -> if index == skip then Nothing else projectionAt className index arg) args)
  if Array.length scrutinees /= Array.length args - 1 then Nothing
  else case Array.nub scrutinees of
    [ scrutinee ] -> Just scrutinee
    _ -> Nothing

projectionAt :: String -> Int -> JavaExpr -> Maybe String
projectionAt className index = case _ of
  JavaPropertyAccess (JavaLocal scrutinee) cls prop
    | cls == className
    , prop == "value" <> show index -> Just scrutinee
  _ -> Nothing

-- A constant that cannot be observed by value: a shared nullary constructor.
constantClass :: Array CtorInfo -> JavaExpr -> Maybe String
constantClass ctors = case _ of
  JavaCtorSingleton modName ctorName -> Just (modName <> "." <> ctorName)
  JavaGlobalVar (Just modName) name
    | Just _ <- Array.find (\c -> c.name == modName <> "." <> name && Array.null c.kinds) ctors ->
        Just (modName <> "." <> name)
  _ -> Nothing

projection :: String -> Int -> String -> JavaExpr
projection className index scrutinee =
  JavaPropertyAccess (JavaLocal scrutinee) className ("value" <> show index)

-- Applies the rewrite to every subexpression, bottom-up.
mapExpr :: (JavaExpr -> JavaExpr) -> JavaExpr -> JavaExpr
mapExpr rewrite = go
  where
  go :: JavaExpr -> JavaExpr
  go expression = rewrite (rebuild expression)

  rebuild :: JavaExpr -> JavaExpr
  rebuild = case _ of
    JavaString value -> JavaString value
    JavaCall fn args -> JavaCall (go fn) (map go args)
    JavaFunction value -> JavaFunction (go value)
    JavaLocal name -> JavaLocal name
    JavaAbs names body -> JavaAbs names (go body)
    JavaTypedAbs params body -> JavaTypedAbs params (go body)
    JavaIntAbs name body -> JavaIntAbs name (go body)
    JavaNew className args -> JavaNew className (map go args)
    JavaCtorSingleton modName ctorName -> JavaCtorSingleton modName ctorName
    JavaTernary cond yes no -> JavaTernary (go cond) (go yes) (go no)
    JavaThrow value -> JavaThrow value
    JavaRecord fields -> JavaRecord (map (\(Tuple key value) -> Tuple key (go value)) fields)
    JavaTypedRecord shape fields -> JavaTypedRecord shape (map (\(Tuple key value) -> Tuple key (go value)) fields)
    JavaTypedRecordGet shape value prop -> JavaTypedRecordGet shape (go value) prop
    JavaTypedRecordUpdate shape value updates ->
      JavaTypedRecordUpdate shape (go value) (map (\(Tuple key item) -> Tuple key (go item)) updates)
    JavaArray items -> JavaArray (map go items)
    JavaWhileTrue args intParams body -> JavaWhileTrue args intParams (go body)
    JavaMemoizedLoop args intParams invariants body ->
      JavaMemoizedLoop args intParams (map (\(Tuple name value) -> Tuple name (go value)) invariants) (go body)
    JavaLoopInvariant name -> JavaLoopInvariant name
    JavaContinue name args -> JavaContinue name (map go args)
    JavaMapGet value prop -> JavaMapGet (go value) prop
    JavaMapUpdate value updates -> JavaMapUpdate (go value) (map (\(Tuple key item) -> Tuple key (go item)) updates)
    JavaInstanceOf value className -> JavaInstanceOf (go value) className
    JavaPropertyAccess value className prop -> JavaPropertyAccess (go value) className prop
    JavaApply fn arg -> JavaApply (go fn) (go arg)
    JavaIntApply fn arg -> JavaIntApply (go fn) (go arg)
    JavaLet name value body -> JavaLet name (go value) (go body)
    JavaLetRec binds body -> JavaLetRec (map (\(Tuple name value) -> Tuple name (go value)) binds) (go body)
    JavaGlobalVar modName name -> JavaGlobalVar modName name
    JavaClassDecl name fields mutable -> JavaClassDecl name fields mutable
    JavaRaw code -> JavaRaw code
    JavaAssign name value -> JavaAssign name (go value)
    JavaLazyAssign name value -> JavaLazyAssign name (go value)
    JavaStaticMethod name args body -> JavaStaticMethod name args (go body)
    JavaLocalAssign name value -> JavaLocalAssign name (go value)
    JavaIntLocalAssign name value -> JavaIntLocalAssign name (go value)
    JavaBinaryOp op left right -> JavaBinaryOp op (go left) (go right)
    JavaUnaryOp op value -> JavaUnaryOp op (go value)
    JavaArrayIndex array index -> JavaArrayIndex (go array) (go index)
    JavaArraySet array index value -> JavaArraySet (go array) (go index) (go value)
    JavaCast ty value -> JavaCast ty (go value)
    JavaBlock stmts value -> JavaBlock (map go stmts) (go value)
    JavaFieldSet target className fieldName fieldType value ->
      JavaFieldSet (go target) className fieldName fieldType (go value)
    JavaLocalSet name value -> JavaLocalSet name (go value)
    JavaIf condition thenStmts elseStmts ->
      JavaIf (go condition) (map go thenStmts) (map go elseStmts)
