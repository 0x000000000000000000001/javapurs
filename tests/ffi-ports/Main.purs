module Main where

import Prelude
import Control.Parallel (parallel, sequential)
import Control.Alt ((<|>))
import Data.Either (Either(..))
import Effect (Effect)
import Effect.Aff (Aff, Canceler(..), attempt, bracket, error, forkAff, joinFiber, killFiber, makeAff, never, supervise, throwError)
import Effect.Class (liftEffect)
import Effect.Console (log)
import Effect.Exception (message, throw)
import Effect.Ref as Ref
import Promise as Promise
import Promise.Aff as Bridge
import Promise.Lazy as Lazy
import Test.Assert (assertEqual)
import Unsafe.Coerce (unsafeCoerce)

foreign import data Gate :: Type
foreign import newGate :: Effect Gate
foreign import signal :: Gate -> Effect Unit
foreign import wait :: Gate -> Effect Unit
foreign import awaitAff :: Aff Unit -> Effect Unit

check :: forall a. Eq a => Show a => String -> a -> a -> Aff Unit
check label expected actual = liftEffect do
  assertEqual { expected, actual }
  log ("FFI: " <> label)

deferred :: Effect
  { promise :: Promise.Promise Int
  , resolve :: Int -> Effect Unit
  , reject :: Promise.Rejection -> Effect Unit
  }
deferred = do
  success <- Ref.new (\_ -> pure unit)
  failure <- Ref.new (\_ -> pure unit)
  promise <- Promise.new \resolve reject -> do
    Ref.write resolve success
    Ref.write reject failure
  pure
    { promise
    , resolve: \value -> Ref.read success >>= (_ $ value)
    , reject: \value -> Ref.read failure >>= (_ $ value)
    }

checks :: Aff Unit
checks = do
  cell <- liftEffect $ Ref.new 0
  previous <- liftEffect $ Ref.modify' (\n -> { state: n + 1, value: n }) cell
  check "Ref.modify result" 0 previous
  current <- liftEffect $ Ref.read cell
  check "Ref.modify state" 1 current

  fiber <- forkAff $ pure 42
  first <- joinFiber fiber
  second <- joinFiber fiber
  check "repeated join" [ 42, 42 ] [ first, second ]

  released <- liftEffect $ Ref.new false
  result <- bracket (pure 2) (\_ -> liftEffect $ Ref.write true released) (\n -> pure (n + 1))
  cleanup <- liftEffect $ Ref.read released
  check "bracket cleanup" { result: 3, cleanup: true } { result, cleanup }

  started <- liftEffect newGate
  cancelled <- liftEffect $ Ref.new ""
  pending <- forkAff $ makeAff \_ -> do
    signal started
    pure $ Canceler \cause -> liftEffect $ Ref.write (message cause) cancelled
  liftEffect $ wait started
  killFiber (error "stop") pending
  cause <- liftEffect $ Ref.read cancelled
  check "cancellation cause" "stop" cause

  ready <- liftEffect newGate
  cleaned <- liftEffect $ Ref.new false
  supervise do
    _ <- forkAff $ bracket
      (liftEffect $ signal ready)
      (\_ -> liftEffect $ Ref.write true cleaned)
      (\_ -> never)
    liftEffect $ wait ready
  didClean <- liftEffect $ Ref.read cleaned
  check "supervised cleanup" true didClean

  unitResult <- sequential $ parallel (pure unit) <|> parallel (throwError (error "loser"))
  check "Unit race" unit unitResult

  gate <- liftEffect newGate
  promise <- liftEffect $ Bridge.fromAff do
    liftEffect $ wait gate
    pure 123
  consumer <- forkAff $ Bridge.toAff promise
  liftEffect $ signal gate
  value <- joinFiber consumer
  check "pending Aff-Promise roundtrip" 123 value

  failed <- liftEffect $ Bridge.fromAff (throwError (error "roundtrip") :: Aff Int)
  rejected <- attempt $ Bridge.toAff failed
  check "Aff-Promise rejection" (Left "roundtrip") (case rejected of
    Left failure -> Left (message failure)
    Right n -> Right n)
  stringFailure <- attempt $ Bridge.toAff (Promise.reject (unsafeCoerce "string error") :: Promise.Promise Int)
  check "string rejection coercion" (Left "string error") (case stringFailure of
    Left failure -> Left (message failure)
    Right n -> Right n)
  fromEffect <- Bridge.toAffE $ Bridge.fromAff $ pure 456
  check "toAffE" 456 fromEffect
  custom <- attempt $ Bridge.toAff' (\_ -> error "custom") (Promise.reject (unsafeCoerce 3) :: Promise.Promise Int)
  check "custom rejection coercion" (Left "custom") (case custom of
    Left failure -> Left (message failure)
    Right n -> Right n)
  one <- liftEffect deferred
  two <- liftEffect deferred
  all <- liftEffect $ Promise.all [ one.promise, two.promise ]
  liftEffect $ two.resolve 2
  liftEffect $ one.resolve 1
  ordered <- Bridge.toAff all
  check "Promise.all order" [ 1, 2 ] ordered

  loser <- liftEffect deferred
  winner <- liftEffect deferred
  race <- liftEffect $ Promise.race [ loser.promise, winner.promise ]
  liftEffect $ winner.reject (unsafeCoerce "first settlement")
  liftEffect $ loser.resolve 2
  raceFailure <- attempt $ Bridge.toAff race
  check "Promise.race rejection" (Left "first settlement") (case raceFailure of
    Left failure -> Left (message failure)
    Right n -> Right n)

  disposal <- liftEffect deferred
  finalized <- liftEffect $ Promise.finally
    (Promise.then_ (\_ -> pure (Promise.resolve unit)) disposal.promise)
    (Promise.resolve 789)
  liftEffect $ disposal.resolve 0
  finalValue <- Bridge.toAff finalized
  check "Promise.finally pending cleanup" 789 finalValue

  handlerFailure <- liftEffect $ Promise.then_ (\_ -> throw "handler" :: Effect (Promise.Promise Int)) (Promise.resolve 1)
  thrown <- attempt (Bridge.toAff handlerFailure :: Aff Int)
  check "Promise handler exception" (Left "handler") (case thrown of
    Left failure -> Left (message failure)
    Right n -> Right n)

  lazyValue <- Bridge.toAffE $ Lazy.toPromise do
    n <- Lazy.new (\resolve _ -> resolve 30)
    pure (n + 1)
  check "Promise.Lazy" 31 lazyValue
  liftEffect $ log "FFI ports: 17 PureScript contract checks passed"

main :: Effect Unit
main = awaitAff checks
