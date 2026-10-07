module Test.PortRunner where

import Prelude
import Data.Identity (Identity(..))
import Data.Newtype (un)
import Data.Time.Duration (Milliseconds(..))
import Effect (Effect)
import Effect.Aff (Aff, delay, never, supervise, throwError)
import Effect.Class (liftEffect)
import Effect.Exception (error)
import Test.Main (spec)
import Test.Spec (Spec, it)
import Test.Spec.Assertions (fail)
import Test.Spec.Console (write)
import Test.Spec.Reporter.Console (consoleReporter)
import Test.Spec.Runner (defaultConfig, evalSpecT)
import Test.Spec.Summary (Summary(..), summarize)

foreign import mode :: Effect String
foreign import awaitAff :: Aff Unit -> Effect Unit

-- Spec captures assertion failures in its result tree. Merely awaiting an Aff
-- with exit=false would lose them; inspect results before announcing completion.
runChecked :: Spec Unit -> Aff Unit
runChecked tests = do
  results <- un Identity $ evalSpecT (defaultConfig { exit = false }) [ consoleReporter ] tests
  let Count counts = summarize results
  when (counts.failed /= 0 || counts.pending /= 0) $ throwError (error "Port spec failed or has pending tests")
  liftEffect $ write $ "PORT SPEC PASSED: " <> show counts.passed <> "\n"

main :: Effect Unit
main = do
  selected <- mode
  awaitAff $ supervise case selected of
    "late-failure" -> delay (Milliseconds 10.0) *> fail "runner late assertion"
    "rejection" -> delay (Milliseconds 10.0) *> throwError (error "runner rejection")
    "timeout" -> never
    "spec-failure" -> runChecked $ it "delayed Spec failure" do
      delay (Milliseconds 10.0)
      fail "runner Spec assertion"
    _ -> runChecked spec
