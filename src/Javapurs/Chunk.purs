-- | Lifts large subexpressions out of a method body.
-- |
-- | javac attributes and compiles one expression tree at a time. A single
-- | initializer with tens of thousands of applications needs gigabytes of heap
-- | and can exceed the 64K method limit anyway. Any subtree above a node
-- | budget becomes a `__chunk$N` static method that receives the locals it
-- | reads as parameters. Chunks are emitted deepest first, which splits a
-- | long application chain or a large branch tree into a series of calls
-- | instead of one giant method. Statement-only nodes (`if`, raw text) are
-- | never extracted themselves, only the values inside them.
module Javapurs.Chunk (chunkFile) where

import Prelude

import Control.Monad.State (State, gets, modify_, runState)
import Data.Array as Array
import Data.Foldable (foldl, foldM, sum)
import Data.Maybe (Maybe(..))
import Data.Set (Set)
import Data.Set as Set
import Data.String as String
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..), fst, snd)
import Javapurs.JavaAst (JavaExpr(..), JavaFile, children)

-- | Largest method body the emitter keeps in one piece, in cost units. A cost
-- | unit is roughly one Java operation; the JVM stops at 65535 bytecode bytes,
-- | so the budget leaves room for the casts around each application.
maxChunkCost :: Int
maxChunkCost = 256


type Info =
  { expr :: JavaExpr
  , cost :: Int
  , free :: Maybe (Set String)
  -- | A node whose printed form can be returned from a method.
  , extractable :: Boolean
  }

type StatementInfo = { expr :: JavaExpr, cost :: Int }

type ChunkState = { counter :: Int, localCounter :: Int, helpers :: Array JavaExpr }

type Chunk = State ChunkState

chunkFile :: JavaFile -> JavaFile
chunkFile file =
  let
    Tuple decls state = runState (traverse chunkDecl file.decls) initialState
  in
    file { decls = state.helpers <> decls }

initialState :: ChunkState
initialState = { counter: 0, localCounter: 0, helpers: [] }

chunkDecl :: JavaExpr -> Chunk JavaExpr
chunkDecl = case _ of
  JavaAssign name value -> do
    info <- chunkValue value
    pure (JavaAssign name info.expr)
  JavaLazyAssign name value -> do
    info <- chunkValue value
    pure (JavaLazyAssign name info.expr)
  JavaStaticMethod name args body -> do
    body' <- chunkMethodBody body
    pure (JavaStaticMethod name args body')
  declaration -> pure declaration

chunkMethodBody :: JavaExpr -> Chunk JavaExpr
chunkMethodBody = case _ of
  JavaBlock statements expression -> do
    statements' <- traverse chunkStmt statements
    info <- chunkValue expression
    pure (JavaBlock (map (_.expr) statements') info.expr)
  body -> do
    info <- chunkValue body
    pure info.expr

-- | Statement positions can still hold large closed values. Control flow and
-- | raw text stay whole; only values inside them are candidates.
chunkStmt :: JavaExpr -> Chunk StatementInfo
chunkStmt statement = case statement of
  JavaLocalAssign name value -> do
    info <- chunkValue value
    pure { expr: JavaLocalAssign name info.expr, cost: 1 + info.cost }
  JavaIntLocalAssign name value -> do
    info <- chunkValue value
    pure { expr: JavaIntLocalAssign name info.expr, cost: 1 + info.cost }
  JavaLocalSet name value -> do
    info <- chunkValue value
    pure { expr: JavaLocalSet name info.expr, cost: 1 + info.cost }
  JavaArraySet array index value -> do
    arrayInfo <- chunkValue array
    indexInfo <- chunkValue index
    valueInfo <- chunkValue value
    pure
      { expr: JavaArraySet arrayInfo.expr indexInfo.expr valueInfo.expr
      , cost: 1 + arrayInfo.cost + indexInfo.cost + valueInfo.cost
      }
  JavaFieldSet target className fieldName fieldType value -> do
    targetInfo <- chunkValue target
    valueInfo <- chunkValue value
    pure
      { expr: JavaFieldSet targetInfo.expr className fieldName fieldType valueInfo.expr
      , cost: 1 + targetInfo.cost + valueInfo.cost
      }
  JavaIf condition thenStatements elseStatements -> do
    conditionInfo <- chunkValue condition
    thenInfos <- traverse chunkStmt thenStatements
    elseInfos <- traverse chunkStmt elseStatements
    pure
      { expr: JavaIf conditionInfo.expr (map (_.expr) thenInfos) (map (_.expr) elseInfos)
      , cost: 1 + conditionInfo.cost + sum (map (_.cost) thenInfos) + sum (map (_.cost) elseInfos)
      }
  JavaBlock statements expression -> do
    statements' <- traverse chunkStmt statements
    info <- chunkValue expression
    pure
      { expr: JavaBlock (map (_.expr) statements') info.expr
      , cost: 1 + sum (map (_.cost) statements') + info.cost
      }
  JavaRaw _ -> pure { expr: statement, cost: 1 }
  JavaWhileTrue _ _ _ _ -> pure { expr: statement, cost: 1 }
  JavaMemoizedLoop _ _ _ _ _ -> pure { expr: statement, cost: 1 }
  _ -> do
    info <- chunkValue statement
    pure { expr: info.expr, cost: info.cost }

chunkValue :: JavaExpr -> Chunk Info
chunkValue expression = do
  info <- build expression
  -- Only closed subtrees are lifted: passing free locals as parameters needs
  -- scope-aware rewriting that is easy to get wrong across shadowing lets.
  if info.extractable && info.cost > maxChunkCost && info.free == Just Set.empty then
    extract info.expr
  else
    pure info

-- | Move a closed subtree into a nullary `__chunk$N` method.
extract :: JavaExpr -> Chunk Info
extract expression = do
  counter <- gets _.counter
  let name = "__chunk$" <> show counter
  modify_ \state -> state
    { counter = counter + 1
    , helpers = state.helpers <> [ JavaStaticMethod name [] expression ]
    }
  pure { expr: JavaCall (JavaGlobalVar Nothing name) [], cost: 1, free: Just Set.empty, extractable: true }

-- | A large array literal becomes a block that allocates the array and fills
-- | it from group helpers. Each helper returns a small array, so one method
-- | never carries more than a budget of element constructors. Filling the
-- | allocated array keeps the element order and the sharing of the literal.
-- | Items must be closed: the group helpers are nullary.
splitArray :: Array Info -> Chunk Info
splitArray infos = do
  localName <- freshLocal
  let groups = groupItems infos
  groupCalls <- makeGroupHelpers 0 groups
  let
    size = Array.length infos
    allocation = JavaLocalAssign localName (JavaRaw ("new Object[" <> show size <> "]"))
    fillStatements = Array.concatMap (fillGroup localName) groupCalls
    block = JavaBlock (Array.cons allocation fillStatements) (JavaLocal localName)
  pure { expr: block, cost: 1 + size * 8, free: freeOf Set.empty block, extractable: true }

-- | Group adjacent items so that one group's total cost stays within budget.
-- | A single item over budget forms its own group; it cannot be split further
-- | without parameters.
groupItems :: Array Info -> Array (Array JavaExpr)
groupItems infos =
  if Array.null infos then []
  else
    let
      maxItemCost = Array.foldl (\acc info -> max acc info.cost) 1 infos
      groupSize = max 1 (maxChunkCost / maxItemCost)
    in
      splitGroups groupSize infos
  where
  splitGroups groupSize remaining = case Array.splitAt groupSize remaining of
    { before, after: _ } | Array.null before -> []
    { before, after } -> Array.cons (map (_.expr) before) (splitGroups groupSize after)

makeGroupHelpers :: Int -> Array (Array JavaExpr) -> Chunk (Array { offset :: Int, count :: Int, call :: JavaExpr })
makeGroupHelpers offset groups = case Array.uncons groups of
  Nothing -> pure []
  Just { head: items, tail } -> do
    counter <- gets _.counter
    let name = "__chunk$" <> show counter
    modify_ \state -> state
      { counter = counter + 1
      , helpers = state.helpers <> [ JavaStaticMethod name [] (JavaArray items) ]
      }
    rest <- makeGroupHelpers (offset + Array.length items) tail
    pure (Array.cons { offset, count: Array.length items, call: JavaCall (JavaGlobalVar Nothing name) [] } rest)

fillGroup :: String -> { offset :: Int, count :: Int, call :: JavaExpr } -> Array JavaExpr
fillGroup localName group =
  Array.mapWithIndex
    (\j _ ->
      JavaArraySet (JavaLocal localName) (JavaRaw (show (group.offset + j)))
        (JavaArrayIndex group.call (JavaRaw (show j))))
    (Array.range 0 (group.count - 1))

freshLocal :: Chunk String
freshLocal = do
  counter <- gets _.localCounter
  modify_ \state -> state { localCounter = counter + 1 }
  pure ("__arr$" <> show counter)

build :: JavaExpr -> Chunk Info
build expression = case expression of
  JavaString value -> leaf (JavaString value) (1 + String.length value / 16)
  JavaRaw value -> leaf (JavaRaw value) (1 + String.length value / 16)
  JavaLocal name -> pure { expr: JavaLocal name, cost: 1, free: Just (Set.singleton name), extractable: true }
  -- A loop invariant prints as `name.getAsInt()` on an `IntSupplier` local;
  -- a lifted parameter would change its type.
  JavaLoopInvariant _ -> opaque expression
  JavaGlobalVar qualifier name -> leaf (JavaGlobalVar qualifier name) 1
  JavaCtorSingleton moduleName ctorName -> leaf (JavaCtorSingleton moduleName ctorName) 1
  JavaThrow message -> leaf (JavaThrow message) (1 + String.length message / 16)
  JavaClassDecl className fields mutable -> leaf (JavaClassDecl className fields mutable) 1
  JavaCall fn args -> do
    fnInfo <- chunkValue fn
    argInfos <- traverse chunkValue args
    many (JavaCall fnInfo.expr (map (_.expr) argInfos)) (consInfo fnInfo argInfos)
  JavaFunction value -> do
    info <- chunkValue value
    unary (JavaFunction info.expr) info
  JavaAbs params body -> do
    info <- chunkValue body
    bound (JavaAbs params info.expr) params info
  JavaTypedAbs params body -> do
    info <- chunkValue body
    bound (JavaTypedAbs params info.expr) (map fst params) info
  JavaIntAbs arg body -> do
    info <- chunkValue body
    bound (JavaIntAbs arg info.expr) [ arg ] info
  JavaNew className args -> do
    infos <- traverse chunkValue args
    many (JavaNew className (map (_.expr) infos)) infos
  JavaTernary condition yes no -> do
    conditionInfo <- chunkValue condition
    yesInfo <- chunkValue yes
    noInfo <- chunkValue no
    many (JavaTernary conditionInfo.expr yesInfo.expr noInfo.expr) [ conditionInfo, yesInfo, noInfo ]
  JavaRecord fields -> do
    infos <- traverse chunkField fields
    many (JavaRecord (map fieldExpr infos)) (map fieldInfo infos)
  JavaTypedRecord shape fields -> do
    infos <- traverse chunkField fields
    many (JavaTypedRecord shape (map fieldExpr infos)) (map fieldInfo infos)
  JavaTypedRecordGet shape value prop -> do
    info <- chunkValue value
    unary (JavaTypedRecordGet shape info.expr prop) info
  JavaTypedRecordUpdate shape value updates -> do
    valueInfo <- chunkValue value
    updateInfos <- traverse chunkField updates
    many (JavaTypedRecordUpdate shape valueInfo.expr (map fieldExpr updateInfos)) (consInfo valueInfo (map fieldInfo updateInfos))
  JavaArray values -> do
    infos <- traverse chunkValue values
    let totalCost = 1 + sum (map (_.cost) infos)
    if totalCost > maxChunkCost && Array.all (\info -> info.free == Just Set.empty) infos then
      splitArray infos
    else
      many (JavaArray (map (_.expr) infos)) infos
  JavaMapGet value prop -> do
    info <- chunkValue value
    unary (JavaMapGet info.expr prop) info
  JavaMapUpdate value updates -> do
    valueInfo <- chunkValue value
    updateInfos <- traverse chunkField updates
    many (JavaMapUpdate valueInfo.expr (map fieldExpr updateInfos)) (consInfo valueInfo (map fieldInfo updateInfos))
  JavaInstanceOf value className -> do
    info <- chunkValue value
    unary (JavaInstanceOf info.expr className) info
  JavaPropertyAccess value className prop -> do
    info <- chunkValue value
    unary (JavaPropertyAccess info.expr className prop) info
  JavaApply fn arg -> do
    fnInfo <- chunkValue fn
    argInfo <- chunkValue arg
    many (JavaApply fnInfo.expr argInfo.expr) [ fnInfo, argInfo ]
  JavaIntApply fn arg -> do
    fnInfo <- chunkValue fn
    argInfo <- chunkValue arg
    many (JavaIntApply fnInfo.expr argInfo.expr) [ fnInfo, argInfo ]
  JavaLet name value body -> do
    valueInfo <- chunkValue value
    bodyInfo <- chunkValue body
    pure
      { expr: JavaLet name valueInfo.expr bodyInfo.expr
      , cost: 1 + valueInfo.cost + bodyInfo.cost
      , free: unionFrees [ valueInfo.free, removeNames [ name ] bodyInfo.free ]
      , extractable: true
      }
  JavaLetRec bindings body -> do
    bindingInfos <- traverse chunkBinding bindings
    bodyInfo <- chunkValue body
    let names = map (_.name) bindingInfos
    pure
      { expr: JavaLetRec (map (\binding -> Tuple binding.name binding.info.expr) bindingInfos) bodyInfo.expr
      , cost: 1 + sum (map (_.info.cost) bindingInfos) + bodyInfo.cost
      , free: removeNames names (unionFrees (map (_.info.free) bindingInfos <> [ bodyInfo.free ]))
      , extractable: true
      }
  JavaBinaryOp operator left right -> do
    leftInfo <- chunkValue left
    rightInfo <- chunkValue right
    many (JavaBinaryOp operator leftInfo.expr rightInfo.expr) [ leftInfo, rightInfo ]
  JavaUnaryOp operator value -> do
    info <- chunkValue value
    unary (JavaUnaryOp operator info.expr) info
  JavaArrayIndex array index -> do
    arrayInfo <- chunkValue array
    indexInfo <- chunkValue index
    many (JavaArrayIndex arrayInfo.expr indexInfo.expr) [ arrayInfo, indexInfo ]
  JavaCast ty value -> do
    info <- chunkValue value
    unary (JavaCast ty info.expr) info
  JavaBlock statements body -> do
    statementInfos <- traverse chunkStmt statements
    info <- chunkValue body
    let
      rebuilt = JavaBlock (map (_.expr) statementInfos) info.expr
      statementCost = sum (map (_.cost) statementInfos)
    pure
      { expr: rebuilt
      , cost: 1 + statementCost + info.cost
      , free: freeOf Set.empty rebuilt
      , extractable: true
      }
  JavaIf condition thenStatements elseStatements -> do
    conditionInfo <- chunkValue condition
    thenInfos <- traverse chunkStmt thenStatements
    elseInfos <- traverse chunkStmt elseStatements
    let
      rebuilt = JavaIf conditionInfo.expr (map (_.expr) thenInfos) (map (_.expr) elseInfos)
      totalCost = 1 + conditionInfo.cost + sum (map (_.cost) thenInfos) + sum (map (_.cost) elseInfos)
    pure { expr: rebuilt, cost: totalCost, free: freeOf Set.empty rebuilt, extractable: false }
  JavaWhileTrue loopId params intParams body -> do
    info <- chunkLoopBody body
    let rebuilt = JavaWhileTrue loopId params intParams info.expr
    pure { expr: rebuilt, cost: 1 + info.cost, free: freeOf Set.empty rebuilt, extractable: true }
  JavaMemoizedLoop loopId params intParams invariants body -> do
    invariantInfos <- traverse chunkField invariants
    info <- chunkLoopBody body
    let
      rebuilt = JavaMemoizedLoop loopId params intParams (map fieldExpr invariantInfos) info.expr
      invariantCost = sum (map (_.cost <<< fieldInfo) invariantInfos)
    pure { expr: rebuilt, cost: 1 + invariantCost + info.cost, free: freeOf Set.empty rebuilt, extractable: true }
  -- Statement containers and control flow stay opaque: their pieces are not
  -- values and cannot be called from another method.
  _ -> opaque expression

-- | A loop body is a statement tree. Values inside are still chunked, while
-- | `JavaContinue` and nested loops stay whole so the control flow is intact.
chunkLoopBody :: JavaExpr -> Chunk Info
chunkLoopBody body = case body of
  JavaBlock statements expression -> do
    statementInfos <- traverse chunkStmt statements
    info <- chunkValue expression
    let
      rebuilt = JavaBlock (map (_.expr) statementInfos) info.expr
      totalCost = 1 + sum (map (_.cost) statementInfos) + info.cost
    pure { expr: rebuilt, cost: totalCost, free: freeOf Set.empty rebuilt, extractable: true }
  other -> chunkValue other

chunkField :: Tuple String JavaExpr -> Chunk (Tuple String Info)
chunkField (Tuple name value) = do
  info <- chunkValue value
  pure (Tuple name info)

chunkBinding :: Tuple String JavaExpr -> Chunk { name :: String, info :: Info }
chunkBinding (Tuple bindingName value) = do
  info <- chunkValue value
  pure { name: bindingName, info }

leaf :: JavaExpr -> Int -> Chunk Info
leaf expression cost = pure { expr: expression, cost, free: Just Set.empty, extractable: true }

opaque :: JavaExpr -> Chunk Info
opaque expression = pure { expr: expression, cost: 1, free: Nothing, extractable: false }

unary :: JavaExpr -> Info -> Chunk Info
unary expression info = pure { expr: expression, cost: 1 + info.cost, free: info.free, extractable: true }

many :: JavaExpr -> Array Info -> Chunk Info
many expression infos = pure
  { expr: expression
  , cost: 1 + sum (map (_.cost) infos)
  , free: unionFrees (map (_.free) infos)
  , extractable: true
  }

bound :: JavaExpr -> Array String -> Info -> Chunk Info
bound expression names info = pure
  { expr: expression
  , cost: 1 + info.cost
  , free: removeNames names info.free
  , extractable: true
  }

consInfo :: Info -> Array Info -> Array Info
consInfo info infos = [ info ] <> infos

fieldExpr :: Tuple String Info -> Tuple String JavaExpr
fieldExpr (Tuple name info) = Tuple name info.expr

fieldInfo :: Tuple String Info -> Info
fieldInfo (Tuple _ info) = info

removeNames :: Array String -> Maybe (Set String) -> Maybe (Set String)
removeNames names = map \names' -> foldl (flip Set.delete) names' names

unionFrees :: Array (Maybe (Set String)) -> Maybe (Set String)
unionFrees = foldl step (Just Set.empty)
  where
  step Nothing _ = Nothing
  step _ Nothing = Nothing
  step (Just acc) (Just names) = Just (Set.union acc names)

-- | Names a node reads but does not bind itself. `Nothing` means the shape is
-- | too dynamic to lift (control flow, declarations or raw statements).
freeOf :: Set String -> JavaExpr -> Maybe (Set String)
freeOf boundNames expression = case expression of
  JavaLocal name -> unbound [ name ]
  JavaLoopInvariant _ -> Nothing
  JavaString _ -> Just Set.empty
  JavaRaw _ -> Just Set.empty
  JavaGlobalVar _ _ -> Just Set.empty
  JavaCtorSingleton _ _ -> Just Set.empty
  JavaThrow _ -> Just Set.empty
  JavaClassDecl _ _ _ -> Just Set.empty
  JavaAbs params body -> freeOf (insertAll params boundNames) body
  JavaTypedAbs params body -> freeOf (insertAll (map fst params) boundNames) body
  JavaIntAbs arg body -> freeOf (Set.insert arg boundNames) body
  JavaStaticMethod _ params body -> freeOf (insertAll (map fst params) boundNames) body
  JavaLet name value body -> do
    valueFree <- freeOf boundNames value
    bodyFree <- freeOf (Set.insert name boundNames) body
    pure (Set.union valueFree bodyFree)
  JavaLetRec bindings body -> do
    let names = map fst bindings
    let bound' = insertAll names boundNames
    bindingFrees <- traverse (freeOf bound') (map snd bindings)
    bodyFree <- freeOf bound' body
    pure (Set.unions (bindingFrees <> [ bodyFree ]))
  JavaBlock statements body -> do
    threaded <- threadStatements boundNames statements
    bodyFree <- freeOf threaded.bound body
    pure (Set.union threaded.free bodyFree)
  JavaIf condition thenStatements elseStatements -> do
    conditionFree <- freeOf boundNames condition
    thenFree <- statementListFree boundNames thenStatements
    elseFree <- statementListFree boundNames elseStatements
    pure (Set.unions [ conditionFree, thenFree, elseFree ])
  JavaWhileTrue loopId args intParams body -> do
    let reads = Set.fromFoldable args <> Set.fromFoldable intParams
    let internals = loopInternals args intParams
    bodyFree <- freeOf (Set.insert loopId (Set.union internals boundNames)) body
    pure (Set.union (Set.difference reads boundNames) bodyFree)
  JavaMemoizedLoop loopId args intParams invariants body -> do
    let reads = Set.fromFoldable args <> Set.fromFoldable intParams
    let internals = loopInternals args intParams
    let invariantNames = Set.fromFoldable (map fst invariants)
    invariantFrees <- traverse (freeOf boundNames) (map snd invariants)
    bodyFree <- freeOf (insertAll (Set.toUnfoldable invariantNames) (Set.insert loopId (Set.union internals boundNames))) body
    pure (Set.unions [ Set.difference reads boundNames, bodyFree, Set.unions invariantFrees ])
  JavaContinue target values -> do
    valueFrees <- traverse (freeOf boundNames) values
    pure (Set.insert target (Set.unions valueFrees))
  JavaLocalAssign _ value -> freeOf boundNames value
  JavaIntLocalAssign _ value -> freeOf boundNames value
  JavaLocalSet name value -> do
    valueFree <- freeOf boundNames value
    pure (Set.insert name valueFree)
  JavaArraySet array index value -> do
    arrayFree <- freeOf boundNames array
    indexFree <- freeOf boundNames index
    valueFree <- freeOf boundNames value
    pure (Set.unions [ arrayFree, indexFree, valueFree ])
  JavaFieldSet target _ _ _ value -> do
    targetFree <- freeOf boundNames target
    valueFree <- freeOf boundNames value
    pure (Set.union targetFree valueFree)
  JavaAssign _ _ -> Nothing
  JavaLazyAssign _ _ -> Nothing
  _ -> do
    childFrees <- traverse (freeOf boundNames) (children expression)
    pure (Set.unions childFrees)

threadStatements :: Set String -> Array JavaExpr -> Maybe { bound :: Set String, free :: Set String }
threadStatements boundNames statements = foldM step { bound: boundNames, free: Set.empty } statements
  where
  step acc statement = case statement of
    JavaLocalAssign name value -> do
      valueFree <- freeOf acc.bound value
      pure { bound: Set.insert name acc.bound, free: Set.union valueFree acc.free }
    JavaIntLocalAssign name value -> do
      valueFree <- freeOf acc.bound value
      pure { bound: Set.insert name acc.bound, free: Set.union valueFree acc.free }
    JavaLocalSet name value -> do
      valueFree <- freeOf acc.bound value
      pure { bound: acc.bound, free: Set.unions [ Set.insert name Set.empty, valueFree, acc.free ] }
    JavaIf condition thenStatements elseStatements -> do
      conditionFree <- freeOf acc.bound condition
      thenFree <- statementListFree acc.bound thenStatements
      elseFree <- statementListFree acc.bound elseStatements
      pure { bound: acc.bound, free: Set.unions [ conditionFree, thenFree, elseFree, acc.free ] }
    JavaBlock statements' expression -> do
      blockFree <- freeOf acc.bound (JavaBlock statements' expression)
      pure { bound: acc.bound, free: Set.union blockFree acc.free }
    JavaRaw _ -> pure acc
    JavaWhileTrue _ _ _ _ -> Nothing
    JavaMemoizedLoop _ _ _ _ _ -> Nothing
    _ -> do
      statementFree <- freeOf acc.bound statement
      pure { bound: acc.bound, free: Set.union statementFree acc.free }

statementListFree :: Set String -> Array JavaExpr -> Maybe (Set String)
statementListFree boundNames statements = do
  threaded <- threadStatements boundNames statements
  pure threaded.free

loopInternals :: Array String -> Array String -> Set String
loopInternals args intParams =
  let
    all = args <> intParams
    withPrefix prefix = map (\name -> prefix <> name) all
  in
    Set.fromFoldable (withPrefix "__tco_" <> withPrefix "__final_" <> withPrefix "__next_")

insertAll :: Array String -> Set String -> Set String
insertAll names set = foldl (flip Set.insert) set names

unbound :: Array String -> Maybe (Set String)
unbound = Just <<< Set.fromFoldable
