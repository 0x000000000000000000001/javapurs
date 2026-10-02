module Javapurs.Diagnostics (withContext) where

import Prelude

import Effect.Aff (Aff, catchError, throwError)
import Effect.Exception (error, message)

-- Annotate failures at the boundary that knows the module, operation or path.
-- Metrics reports failed phases; this supplies the actionable error underneath.
withContext :: forall a. String -> Aff a -> Aff a
withContext context action =
  catchError action \cause -> throwError (error (context <> ": " <> message cause))
