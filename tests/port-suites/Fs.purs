module Test.PortRunner where

import Prelude

import Effect (Effect)
import Effect.Aff (Aff)
import Effect.Console (log)
import Test as Test
import Test.Streams as Streams
import TestAff as TestAff
import TestAsync as TestAsync

foreign import awaitAff :: Aff Unit -> Effect Unit

-- The synchronous filesystem suites return after their eager callbacks. The
-- Aff directory traversal is joined explicitly through the shared JVM boundary.
main :: Effect Unit
main = do
  Test.main
  TestAsync.main
  Streams.main
  awaitAff TestAff.testAff
  log "[OK] node-fs suite"
