module Javapurs.Rename where

import Prelude
import Javapurs.JavaAst (JavaExpr(..))
import Data.Tuple (Tuple(..))
import Data.Array as Array
import Data.Maybe (Maybe(..))
import Data.Foldable (foldl)
import Data.String as String

type State = Int

renameExpr :: JavaExpr -> JavaExpr
renameExpr e = let Tuple e' _ = rename [] 0 e in e'

lookupName :: String -> Array (Tuple String String) -> String
lookupName name env = case Array.find (\(Tuple k _) -> k == name) env of
  Just (Tuple _ v) -> v
  Nothing -> name

rename :: Array (Tuple String String) -> State -> JavaExpr -> Tuple JavaExpr State
rename env s = case _ of
  JavaString str -> Tuple (JavaString str) s
  JavaCall f args ->
    let Tuple f' s1 = rename env s f
        Tuple args' s2 = foldl (\(Tuple acc s') arg -> let Tuple arg' s'' = rename env s' arg in Tuple (Array.snoc acc arg') s'') (Tuple [] s1) args
    in Tuple (JavaCall f' args') s2
  JavaApply f a ->
    let Tuple f' s1 = rename env s f
        Tuple a' s2 = rename env s1 a
    in Tuple (JavaApply f' a') s2
  JavaFunction e ->
    let Tuple e' s1 = rename env s e
    in Tuple (JavaFunction e') s1
  JavaLocal n ->
    if String.take 8 n == "__final_" then
      let baseName = String.drop 8 n
          renamed = lookupName baseName env
      in Tuple (JavaLocal ("__final_" <> renamed)) s
    else
      Tuple (JavaLocal (lookupName n env)) s
  JavaAbs args body ->
    let args' = map (\n -> n <> "_i" <> show s) args
        env' = foldl (\acc (Tuple n newN) -> Array.cons (Tuple n newN) acc) env (Array.zip args args')
        s1 = s + Array.length args
        Tuple body' s2 = rename env' s1 body
    in Tuple (JavaAbs args' body') s2
  JavaNew c args ->
    let Tuple args' s2 = foldl (\(Tuple acc s') arg -> let Tuple arg' s'' = rename env s' arg in Tuple (Array.snoc acc arg') s'') (Tuple [] s) args
    in Tuple (JavaNew c args') s2
  JavaTernary c t f ->
    let Tuple c' s1 = rename env s c
        Tuple t' s2 = rename env s1 t
        Tuple f' s3 = rename env s2 f
    in Tuple (JavaTernary c' t' f') s3
  JavaThrow msg -> Tuple (JavaThrow msg) s
  JavaRecord pairs ->
    let Tuple pairs' s1 = foldl (\(Tuple acc s') (Tuple k v) -> let Tuple v' s'' = rename env s' v in Tuple (Array.snoc acc (Tuple k v')) s'') (Tuple [] s) pairs
    in Tuple (JavaRecord pairs') s1
  JavaArray args ->
    let Tuple args' s1 = foldl (\(Tuple acc s') arg -> let Tuple arg' s'' = rename env s' arg in Tuple (Array.snoc acc arg') s'') (Tuple [] s) args
    in Tuple (JavaArray args') s1
  JavaWhileTrue args body ->
    let args' = map (\n -> lookupName n env) args
        Tuple body' s2 = rename env s body
    in Tuple (JavaWhileTrue args' body') s2
  JavaContinue n args ->
    let Tuple args' s1 = foldl (\(Tuple acc s') arg -> let Tuple arg' s'' = rename env s' arg in Tuple (Array.snoc acc arg') s'') (Tuple [] s) args
    in Tuple (JavaContinue (lookupName n env) args') s1
  JavaMapGet e p ->
    let Tuple e' s1 = rename env s e
    in Tuple (JavaMapGet e' p) s1
  JavaMapUpdate e pairs ->
    let Tuple e' s1 = rename env s e
        Tuple pairs' s2 = foldl (\(Tuple acc s') (Tuple k v) -> let Tuple v' s'' = rename env s' v in Tuple (Array.snoc acc (Tuple k v')) s'') (Tuple [] s1) pairs
    in Tuple (JavaMapUpdate e' pairs') s2
  JavaInstanceOf e c ->
    let Tuple e' s1 = rename env s e
    in Tuple (JavaInstanceOf e' c) s1
  JavaPropertyAccess e c p ->
    let Tuple e' s1 = rename env s e
    in Tuple (JavaPropertyAccess e' c p) s1
  JavaLet n val body ->
    let Tuple val' s1 = rename env s val
        newN = n <> "_i" <> show s1
        env' = Array.cons (Tuple n newN) env
        Tuple body' s2 = rename env' (s1 + 1) body
    in Tuple (JavaLet newN val' body') s2
  JavaLetRec binds body ->
    let names = map (\(Tuple n _) -> n) binds
        newNames = Array.mapWithIndex (\i n -> n <> "_i" <> show (s + i)) names
        s1 = s + Array.length names
        env' = foldl (\acc (Tuple n newN) -> Array.cons (Tuple n newN) acc) env (Array.zip names newNames)
        Tuple binds' s2 = foldl (\(Tuple acc s') (Tuple (Tuple n val) newN) ->
                                    let Tuple val' s'' = rename env' s' val
                                    in Tuple (Array.snoc acc (Tuple newN val')) s''
                                ) (Tuple [] s1) (Array.zip binds newNames)
        Tuple body' s3 = rename env' s2 body
    in Tuple (JavaLetRec binds' body') s3
  JavaGlobalVar m n -> Tuple (JavaGlobalVar m n) s
  JavaClassDecl c args -> Tuple (JavaClassDecl c args) s
  JavaRaw r -> Tuple (JavaRaw r) s
  JavaAssign n e ->
    let Tuple e' s1 = rename env s e
    in Tuple (JavaAssign (lookupName n env) e') s1
  JavaBinaryOp op l r ->
    let Tuple l' s1 = rename env s l
        Tuple r' s2 = rename env s1 r
    in Tuple (JavaBinaryOp op l' r') s2
  JavaCast c e ->
    let Tuple e' s1 = rename env s e
    in Tuple (JavaCast c e') s1
