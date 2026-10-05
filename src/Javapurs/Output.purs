module Javapurs.Output (Output, validatePaths, withOutput, writeJava, recordForeign) where

import Prelude
import Effect (Effect)
import Effect.Aff (Aff, bracket)
import Effect.Class (liftEffect)
import Javapurs.Diagnostics (withContext)
import Javapurs.Ffi (ForeignReport)
import Javapurs.Metrics as Metrics

-- Node owns the filesystem transaction: private staging, ownership inventory,
-- publication/rollback, and recovery of an interrupted process.
foreign import data Output :: Type
foreign import validatePaths :: String -> String -> Effect Unit
foreign import begin :: String -> Effect Output
foreign import writeJava :: Output -> String -> String -> Effect Unit
foreign import recordForeign :: Output -> ForeignReport -> Effect Unit
foreign import commit :: Output -> Effect Unit
foreign import close :: Output -> Effect Unit
foreign import reportWritten :: String -> Effect Unit

withOutput :: String -> (Output -> Aff Unit) -> Aff Unit
withOutput directory action = do
  bracket
    (withContext ("prepare Java output " <> directory) $ liftEffect $ begin directory)
    (\output -> withContext ("close Java output " <> directory) $ liftEffect $ close output)
    (\output -> do
      action output
      Metrics.measure "publish Java" \_ ->
        withContext ("publish Java to " <> directory) $ liftEffect $ commit output)
  liftEffect $ reportWritten directory
