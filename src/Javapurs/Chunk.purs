-- | Bound Java expression trees by lifting eligible values into __chunk$N helpers.
-- | Run after Rename. The traversal owns lexical Java types and visits children
-- | before parents; Captures owns dependencies/barriers, Extraction owns the
-- | cost model and admission. See docs/chunking.md for the decision path.
module Javapurs.Chunk (chunkFile) where

import Prelude

import Control.Monad.State (State, gets, modify_, runState)
import Data.Array as Array
import Data.Either (Either(..))
import Data.Foldable (sum)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..), fst, snd)
import Javapurs.Chunk.Captures
  ( Captures, CaptureBarrier(..), analyzeCaptures, noCaptures, localCapture
  , rawCaptures, combineCaptures, withoutBindings, isClosed
  )
import Javapurs.Chunk.Extraction
  ( ChunkedValue, LocalTypes, HelperParams, ResultForm(..), ExtractionPlan(..)
  , planExtraction, maxChunkCost, nodeCost, textCost, scopeCost, filledArrayCost, arrayGroupSize
  )
import Javapurs.JavaAst (JavaExpr(..), JavaFile, JavaParamType(..))
import Javapurs.Naming (loopSnapshotName)

type ChunkedStatement = { expr :: JavaExpr, cost :: Int }
type ArrayGroupCall = { offset :: Int, count :: Int, call :: JavaExpr }

type ChunkState =
  { counter :: Int
  , localCounter :: Int
  , helpers :: Array JavaExpr
  , locals :: LocalTypes
  }

type Chunk = State ChunkState

chunkFile :: JavaFile -> JavaFile
chunkFile file =
  let
    Tuple decls state = runState (traverse chunkDeclaration file.decls) initialState
  in
    file { decls = state.helpers <> decls }

initialState :: ChunkState
initialState = { counter: 0, localCounter: 0, helpers: [], locals: Map.empty }

-- | Types available at an extraction site, rather than all syntactically bound
-- | names. Restore them at each scope, but retain helper names and declarations.
withLocalTypes :: forall a. LocalTypes -> Chunk a -> Chunk a
withLocalTypes extension action = do
  previous <- gets _.locals
  modify_ \state -> state { locals = Map.union extension previous }
  result <- action
  modify_ \state -> state { locals = previous }
  pure result

genericLocals :: Array String -> LocalTypes
genericLocals = Map.fromFoldable <<< map (\name -> Tuple name ParamObject)

bindLocal :: String -> JavaParamType -> Chunk Unit
bindLocal name ty = modify_ \state -> state { locals = Map.insert name ty state.locals }

chunkDeclaration :: JavaExpr -> Chunk JavaExpr
chunkDeclaration = case _ of
  JavaAssign name value -> JavaAssign name <<< _.expr <$> chunkValue value
  JavaLazyAssign name value -> JavaLazyAssign name <<< _.expr <$> chunkValue value
  JavaStaticMethod name params body -> do
    value <- withLocalTypes (Map.fromFoldable params) (chunkValue body)
    pure (JavaStaticMethod name params value.expr)
  declaration -> pure declaration

-- | Rebuild children in their lexical/typed positions, then decide whether this
-- | root should move. A refusal keeps the rebuilt children, including helpers.
chunkValue :: JavaExpr -> Chunk ChunkedValue
chunkValue expression = do
  value <- rebuildValue expression
  locals <- gets _.locals
  case planExtraction locals value of
    ExtractWith params -> extractValue params value.expr
    KeepOriginal _ -> pure value

-- | Statement roots never become value helpers. Their value operands can.
-- | A nonrecursive declaration is added only after processing its initializer.
chunkStatement :: JavaExpr -> Chunk ChunkedStatement
chunkStatement statement = case statement of
  JavaLocalAssign name value -> do
    info <- chunkValue value
    bindLocal name ParamObject
    pure { expr: JavaLocalAssign name info.expr, cost: nodeCost [ info.cost ] }
  JavaIntLocalAssign name value -> do
    info <- chunkValue value
    bindLocal name ParamInt
    pure { expr: JavaIntLocalAssign name info.expr, cost: nodeCost [ info.cost ] }
  JavaLocalSet name value -> do
    info <- chunkValue value
    pure { expr: JavaLocalSet name info.expr, cost: nodeCost [ info.cost ] }
  JavaArraySet array index value -> do
    arrayInfo <- chunkValue array
    indexInfo <- chunkValue index
    valueInfo <- chunkValue value
    pure
      { expr: JavaArraySet arrayInfo.expr indexInfo.expr valueInfo.expr
      , cost: nodeCost [ arrayInfo.cost, indexInfo.cost, valueInfo.cost ]
      }
  JavaFieldSet target className fieldName fieldType value -> do
    targetInfo <- chunkValue target
    valueInfo <- chunkValue value
    pure
      { expr: JavaFieldSet targetInfo.expr className fieldName fieldType valueInfo.expr
      , cost: nodeCost [ targetInfo.cost, valueInfo.cost ]
      }
  JavaIf condition yes no -> rebuildBranches condition yes no
  JavaBlock statements body -> rebuildBlock scopeCost statements body
  JavaRaw _ -> pure { expr: statement, cost: 1 }
  JavaWhileTrue _ _ _ _ -> pure { expr: statement, cost: 1 }
  JavaMemoizedLoop _ _ _ _ _ -> pure { expr: statement, cost: 1 }
  _ -> do
    value <- chunkValue statement
    pure { expr: value.expr, cost: value.cost }

rebuildBranches :: JavaExpr -> Array JavaExpr -> Array JavaExpr -> Chunk ChunkedStatement
rebuildBranches condition yes no = do
  conditionInfo <- chunkValue condition
  thenInfos <- withLocalTypes Map.empty (traverse chunkStatement yes)
  elseInfos <- withLocalTypes Map.empty (traverse chunkStatement no)
  pure
    { expr: JavaIf conditionInfo.expr (map _.expr thenInfos) (map _.expr elseInfos)
    , cost: nodeCost [ conditionInfo.cost, sum (map _.cost thenInfos), sum (map _.cost elseInfos) ]
    }

-- | Ordinary blocks pay the Supplier scope weight. A loop's own statement block
-- | is already in its method and supplies identity as the weight instead.
rebuildBlock :: (Int -> Int) -> Array JavaExpr -> JavaExpr -> Chunk ChunkedStatement
rebuildBlock weight statements body = withLocalTypes Map.empty do
  statements' <- traverse chunkStatement statements
  value <- chunkValue body
  pure
    { expr: JavaBlock (map _.expr statements') value.expr
    , cost: weight (nodeCost [ sum (map _.cost statements'), value.cost ])
    }

rebuildValue :: JavaExpr -> Chunk ChunkedValue
rebuildValue expression = case expression of
  JavaString text -> closedValue expression (textCost text)
  JavaRaw text -> pure
    { expr: expression, cost: textCost text, captures: rawCaptures text, form: RawFragment }
  JavaLocal name -> pure (valueResult expression 1 (localCapture name))
  -- This local is an IntSupplier, not an Object/int helper parameter.
  JavaLoopInvariant _ -> opaqueValue InvariantCache expression
  JavaGlobalVar _ _ -> closedValue expression 1
  JavaStaticMethodRef _ _ -> pure
    { expr: expression, cost: 1, captures: noCaptures, form: MethodSelector }
  JavaInstanceMethodRef receiver className method -> do
    value <- chunkValue receiver
    pure
      { expr: JavaInstanceMethodRef value.expr className method
      , cost: nodeCost [ value.cost ]
      , captures: value.captures
      , form: MethodSelector
      }
  JavaCtorSingleton _ _ -> closedValue expression 1
  JavaThrow message -> closedValue expression (textCost message)
  JavaClassDecl _ _ _ -> closedValue expression 1
  JavaCall selector args -> do
    -- Rebuild the selector, but never replace it with an Object-returning call.
    selectorInfo <- rebuildValue selector
    argInfos <- traverse chunkValue args
    valueWithChildren (JavaCall selectorInfo.expr (map _.expr argInfos)) (Array.cons selectorInfo argInfos)
  JavaFunction body -> do
    value <- chunkValue body
    valueWithChild (JavaFunction value.expr) value
  JavaAbs params body -> do
    value <- withLocalTypes (genericLocals params) (chunkValue body)
    bindingValue (JavaAbs params value.expr) params value
  JavaTypedAbs params body -> do
    -- Typed curried closures still implement Function<Object, Object>.
    value <- withLocalTypes (genericLocals (map fst params)) (chunkValue body)
    bindingValue (JavaTypedAbs params value.expr) (map fst params) value
  JavaIntAbs arg body -> do
    value <- withLocalTypes (Map.singleton arg ParamInt) (chunkValue body)
    bindingValue (JavaIntAbs arg value.expr) [ arg ] value
  JavaNew className args -> do
    values <- traverse chunkValue args
    valueWithChildren (JavaNew className (map _.expr values)) values
  JavaTernary condition yes no -> do
    conditionInfo <- chunkValue condition
    yesInfo <- chunkValue yes
    noInfo <- chunkValue no
    valueWithChildren (JavaTernary conditionInfo.expr yesInfo.expr noInfo.expr) [ conditionInfo, yesInfo, noInfo ]
  JavaRecord fields -> do
    values <- traverse chunkField fields
    valueWithChildren (JavaRecord (map fieldExpr values)) (map snd values)
  JavaTypedRecord shape fields -> do
    values <- traverse chunkField fields
    valueWithChildren (JavaTypedRecord shape (map fieldExpr values)) (map snd values)
  JavaTypedRecordGet shape receiver prop -> do
    value <- chunkValue receiver
    valueWithChild (JavaTypedRecordGet shape value.expr prop) value
  JavaTypedRecordUpdate shape receiver updates -> do
    value <- chunkValue receiver
    fields <- traverse chunkField updates
    valueWithChildren (JavaTypedRecordUpdate shape value.expr (map fieldExpr fields)) (Array.cons value (map snd fields))
  JavaArray items -> do
    values <- traverse chunkValue items
    if largeClosedArray values then chunkClosedArray values
    else valueWithChildren (JavaArray (map _.expr values)) values
  JavaMapGet receiver prop -> do
    value <- chunkValue receiver
    valueWithChild (JavaMapGet value.expr prop) value
  JavaMapUpdate receiver updates -> do
    value <- chunkValue receiver
    fields <- traverse chunkField updates
    valueWithChildren (JavaMapUpdate value.expr (map fieldExpr fields)) (Array.cons value (map snd fields))
  JavaInstanceOf receiver className -> do
    value <- chunkValue receiver
    valueWithChild (JavaInstanceOf value.expr className) value
  JavaPropertyAccess receiver className prop -> do
    value <- chunkValue receiver
    valueWithChild (JavaPropertyAccess value.expr className prop) value
  JavaApply fn arg -> do
    fnInfo <- chunkValue fn
    argInfo <- chunkValue arg
    valueWithChildren (JavaApply fnInfo.expr argInfo.expr) [ fnInfo, argInfo ]
  JavaIntApply fn arg -> do
    fnInfo <- chunkValue fn
    argInfo <- chunkValue arg
    valueWithChildren (JavaIntApply fnInfo.expr argInfo.expr) [ fnInfo, argInfo ]
  JavaLet name initializer body -> do
    value <- chunkValue initializer
    bodyInfo <- withLocalTypes (Map.singleton name ParamObject) (chunkValue body)
    pure (valueResult (JavaLet name value.expr bodyInfo.expr)
      (scopeCost (nodeCost [ value.cost, bodyInfo.cost ]))
      (combineCaptures [ value.captures, withoutBindings [ name ] bodyInfo.captures ]))
  JavaLetRec bindings body -> do
    -- The printer creates recursive fields, filled only after closure creation.
    -- Initializers can mention them, but cannot pass their uninitialized values
    -- to helpers. Exclude their types here; admit them only in the finished body.
    values <- traverse chunkField bindings
    let names = map fst values
    bodyInfo <- withLocalTypes (genericLocals names) (chunkValue body)
    pure (valueResult (JavaLetRec (map fieldExpr values) bodyInfo.expr)
      (scopeCost (nodeCost (map (_.cost <<< snd) values <> [ bodyInfo.cost ])))
      (withoutBindings names (combineCaptures (map (_.captures <<< snd) values <> [ bodyInfo.captures ]))))
  JavaBinaryOp operator left right -> do
    -- Java operators need the operand's static type. Rebuild each root without
    -- extracting it, while still processing extractible children underneath.
    leftInfo <- rebuildValue left
    rightInfo <- rebuildValue right
    valueWithChildren (JavaBinaryOp operator leftInfo.expr rightInfo.expr) [ leftInfo, rightInfo ]
  JavaUnaryOp operator operand -> do
    value <- rebuildValue operand
    valueWithChild (JavaUnaryOp operator value.expr) value
  JavaArrayIndex array index -> do
    arrayInfo <- chunkValue array
    indexInfo <- chunkValue index
    valueWithChildren (JavaArrayIndex arrayInfo.expr indexInfo.expr) [ arrayInfo, indexInfo ]
  JavaCast ty operand -> do
    value <- chunkValue operand
    pure { expr: JavaCast ty value.expr, cost: nodeCost [ value.cost ], captures: value.captures, form: PreserveCast }
  JavaBlock statements body -> analyzedValue <$> rebuildBlock scopeCost statements body
  JavaIf condition yes no -> do
    value <- rebuildBranches condition yes no
    pure ((analyzedValue value) { form = StatementOnly })
  JavaWhileTrue loopId params intParams body -> do
    value <- withLocalTypes (loopSnapshots params intParams) (chunkLoopBody body)
    let rebuilt = JavaWhileTrue loopId params intParams value.expr
    pure (valueResult rebuilt (nodeCost [ value.cost ]) (analyzeCaptures rebuilt))
  JavaMemoizedLoop loopId params intParams invariants body -> do
    fields <- traverse chunkField invariants
    value <- withLocalTypes (loopSnapshots params intParams) (chunkLoopBody body)
    let rebuilt = JavaMemoizedLoop loopId params intParams (map fieldExpr fields) value.expr
    pure (valueResult rebuilt (nodeCost (map (_.cost <<< snd) fields <> [ value.cost ])) (analyzeCaptures rebuilt))
  JavaContinue _ _ -> opaqueValue LoopJump expression
  _ -> opaqueValue UnsupportedExpression expression

chunkLoopBody :: JavaExpr -> Chunk ChunkedValue
chunkLoopBody = case _ of
  JavaBlock statements body -> analyzedValue <$> rebuildBlock identity statements body
  other -> chunkValue other

chunkField :: Tuple String JavaExpr -> Chunk (Tuple String ChunkedValue)
chunkField (Tuple name value) = Tuple name <$> chunkValue value

fieldExpr :: Tuple String ChunkedValue -> Tuple String JavaExpr
fieldExpr (Tuple name value) = Tuple name value.expr

valueResult :: JavaExpr -> Int -> Captures -> ChunkedValue
valueResult expr cost captures = { expr, cost, captures, form: ObjectResult }

-- Statement containers need lexical analysis of the rebuilt sequence rather
-- than the union of individual statements (which would lose their binders).
analyzedValue :: ChunkedStatement -> ChunkedValue
analyzedValue value = valueResult value.expr value.cost (analyzeCaptures value.expr)

closedValue :: JavaExpr -> Int -> Chunk ChunkedValue
closedValue expr cost = pure (valueResult expr cost noCaptures)

opaqueValue :: CaptureBarrier -> JavaExpr -> Chunk ChunkedValue
opaqueValue barrier expr = pure { expr, cost: 1, captures: Left barrier, form: OpaqueRoot }

valueWithChild :: JavaExpr -> ChunkedValue -> Chunk ChunkedValue
valueWithChild expr value = pure (valueResult expr (nodeCost [ value.cost ]) value.captures)

valueWithChildren :: JavaExpr -> Array ChunkedValue -> Chunk ChunkedValue
valueWithChildren expr values = pure (valueResult expr (nodeCost (map _.cost values)) (combineCaptures (map _.captures values)))

bindingValue :: JavaExpr -> Array String -> ChunkedValue -> Chunk ChunkedValue
bindingValue expr names value = pure (valueResult expr (nodeCost [ value.cost ]) (withoutBindings names value.captures))

-- | Only final per-iteration snapshots are available as helper parameters.
-- | The mutable loop storage and memoized IntSuppliers never enter LocalTypes.
loopSnapshots :: Array String -> Array String -> LocalTypes
loopSnapshots params intParams = Map.fromFoldable $ map
  (\name -> Tuple (loopSnapshotName name) (if Array.elem name intParams then ParamInt else ParamObject)) params

-- Helper construction ---------------------------------------------------------

-- | Both ordinary extraction and closed-array groups use the same allocator.
-- | Children have emitted their helpers first; numbering/order stay deterministic.
emitHelper :: HelperParams -> JavaExpr -> Chunk JavaExpr
emitHelper params body = do
  counter <- gets _.counter
  let name = "__chunk$" <> show counter
  modify_ \state -> state
    { counter = counter + 1
    , helpers = state.helpers <> [ JavaStaticMethod name params body ]
    }
  pure (JavaCall (JavaStaticMethodRef Nothing name) (map (JavaLocal <<< fst) params))

-- | The call still reads every argument. An enclosing extraction must transport
-- | these captures again, rather than assuming the new call is closed.
extractValue :: HelperParams -> JavaExpr -> Chunk ChunkedValue
extractValue params body = do
  call <- emitHelper params body
  pure (valueResult call (1 + Array.length params) (combineCaptures (map (localCapture <<< fst) params)))

largeClosedArray :: Array ChunkedValue -> Boolean
largeClosedArray values = nodeCost (map _.cost values) > maxChunkCost && Array.all (isClosed <<< _.captures) values

-- | The group helpers are nullary, so every item must be closed. The array is
-- | allocated once, then filled in original order. Closed does not mean pure.
chunkClosedArray :: Array ChunkedValue -> Chunk ChunkedValue
chunkClosedArray values = do
  name <- freshArrayLocal
  groups <- emitArrayGroups 0 (groupItems values)
  let
    size = Array.length values
    allocation = JavaLocalAssign name (JavaRaw ("new Object[" <> show size <> "]"))
    fill = Array.concatMap (fillGroup name) groups
    body = JavaBlock (Array.cons allocation fill) (JavaLocal name)
  pure (valueResult body (filledArrayCost size) (analyzeCaptures body))

groupItems :: Array ChunkedValue -> Array (Array JavaExpr)
groupItems values = splitGroups (arrayGroupSize (map _.cost values)) values
  where
  splitGroups size remaining = case Array.splitAt size remaining of
    { before, after: _ } | Array.null before -> []
    { before, after } -> Array.cons (map _.expr before) (splitGroups size after)

emitArrayGroups :: Int -> Array (Array JavaExpr) -> Chunk (Array ArrayGroupCall)
emitArrayGroups offset groups = case Array.uncons groups of
  Nothing -> pure []
  Just { head: items, tail } -> do
    call <- emitHelper [] (JavaArray items)
    rest <- emitArrayGroups (offset + Array.length items) tail
    pure (Array.cons { offset, count: Array.length items, call } rest)

-- | Materialize each group exactly once before reading its elements. Duplicating
-- | the call would repeat all effects/allocations and destroy object sharing.
fillGroup :: String -> ArrayGroupCall -> Array JavaExpr
fillGroup arrayName group =
  let groupName = arrayName <> "$group" <> show group.offset
  in Array.cons (JavaLocalAssign groupName group.call) $ Array.mapWithIndex
    (\index _ ->
      JavaArraySet (JavaLocal arrayName) (JavaRaw (show (group.offset + index)))
        (JavaArrayIndex (JavaLocal groupName) (JavaRaw (show index))))
    (Array.range 0 (group.count - 1))

freshArrayLocal :: Chunk String
freshArrayLocal = do
  counter <- gets _.localCounter
  modify_ \state -> state { localCounter = counter + 1 }
  pure ("__arr$" <> show counter)
