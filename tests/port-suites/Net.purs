module Test.PortRunner where

import Prelude

import Effect (Effect)
import Effect.Aff (Aff)
import Effect.Console (log)
import Test.Main (testNet)

foreign import awaitAff :: Aff Unit -> Effect Unit

-- The socket/server lifecycle runs on JVM background threads. Join the
-- explicit close action before announcing completion.
main :: Effect Unit
main = do
  awaitAff testNet
  log "[OK] node-net suite"
