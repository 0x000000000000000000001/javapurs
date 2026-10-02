module Main (main) where

import Prelude

import Effect (Effect)
import Effect.Aff (launchAff_)
import Effect.Class (liftEffect)
import Javapurs.Config (parseArgs)
import Javapurs.Driver (compile)
import Javapurs.Metrics as Metrics
import Node.Process (argv)

main :: Effect Unit
main = launchAff_ $ Metrics.measure "backend total" \_ -> do
  args <- liftEffect argv
  compile (parseArgs args)
