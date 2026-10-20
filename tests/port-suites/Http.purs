module Test.PortRunner where

import Prelude

import Effect (Effect)
import Effect.Aff (Aff)
import Effect.Console (log)
import Test.Main (testHttp)

foreign import awaitAff :: Aff Unit -> Effect Unit

main :: Effect Unit
main = do
  awaitAff testHttp
  log "[OK] node-http suite"
