module Main (main) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Effect (Effect)
import Effect.Aff (attempt, launchAff_)
import Effect.Class (liftEffect)
import Effect.Console as Console
import Effect.Exception (message)
import Javapurs.Config (Command(..), help, parseArgs)
import Javapurs.Driver (compile)
import Javapurs.Metrics as Metrics
import Node.Process (argv, setExitCode)

main :: Effect Unit
main = do
  args <- argv
  case parseArgs (Array.drop 2 args) of
    Left problem -> do
      Console.error ("javapurs: " <> problem <> "\nRun javapurs --help for usage.")
      setExitCode 2
    Right Help -> Console.log help
    Right (Compile config) -> launchAff_ do
      result <- attempt $ Metrics.measure "backend total" \_ -> compile config
      case result of
        Right _ -> pure unit
        Left problem -> liftEffect do
          Console.error ("javapurs: " <> message problem)
          setExitCode 1
