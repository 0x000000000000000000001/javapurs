module Test.PortRunner where

import Prelude
import Effect (Effect)
import Effect.Exception (error)
import Promise as Promise
import Promise.Rejection as Rejection
import Test.Assert (assert')
import Test.Main (suite, delay)

foreign import mode :: Effect String
foreign import awaitPromise :: Promise.Promise Unit -> Effect Unit

main :: Effect Unit
main = do
  selected <- mode
  result <- case selected of
    "late-failure" -> delay 10 >>= Promise.then_ (\_ -> do
      assert' "runner late assertion" false
      pure (Promise.resolve unit))
    "rejection" -> delay 10 >>= Promise.then_ (\_ -> pure (Promise.reject (Rejection.fromError (error "runner rejection")) :: Promise.Promise Unit))
    "timeout" -> Promise.new (\(_ :: Unit -> Effect Unit) _ -> pure unit)
    _ -> suite
  awaitPromise result
