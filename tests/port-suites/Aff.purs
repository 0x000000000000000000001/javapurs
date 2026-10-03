module Test.PortRunner where

import Prelude
import Data.Time.Duration (Milliseconds(..))
import Effect (Effect)
import Effect.Aff (Aff, delay, never, supervise, throwError)
import Effect.Class (liftEffect)
import Effect.Exception (error)
import Test.Assert (assert')
import Test.Main (suite)

foreign import mode :: Effect String
foreign import awaitAff :: Aff Unit -> Effect Unit

main :: Effect Unit
main = do
  selected <- mode
  awaitAff $ supervise case selected of
    "late-failure" -> delay (Milliseconds 10.0) *> liftEffect (assert' "runner late assertion" false)
    "rejection" -> delay (Milliseconds 10.0) *> throwError (error "runner rejection")
    "timeout" -> never
    _ -> suite
