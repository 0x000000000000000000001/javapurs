module Main where

import Prelude
import Effect (Effect)
import Effect.Console (logShow)
import Effect.Ref as Ref

-- Select the Java implementations used transitively by refs and console, too.
main :: Effect Unit
main = do
  ref <- Ref.new 40
  Ref.modify_ (_ + 2) ref
  value <- Ref.read ref
  logShow value
