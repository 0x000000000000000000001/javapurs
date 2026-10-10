module Javapurs.Input (readModules) where

import Prelude

import Control.Parallel (parTraverse)
import Data.Argonaut.Core (toArray, toObject)
import Data.Argonaut.Decode.Error (printJsonDecodeError)
import Data.Argonaut.Parser (jsonParser)
import Data.Array as Array
import Data.Bifunctor (lmap)
import Data.Either (Either(..), either)
import Data.Foldable (foldM, for_)
import Data.List (List)
import Data.List as List
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Newtype (unwrap)
import Data.Traversable (traverse)
import Effect (Effect)
import Effect.Aff (Aff, throwError)
import Effect.Class (liftEffect)
import Effect.Exception (error)
import Foreign.Object as Object
import Javapurs.Diagnostics (withContext)
import Node.Encoding (Encoding(..))
import Node.FS.Aff as FS
import Node.FS.Stats as Stats
import PureScript.Backend.Optimizer.CoreFn (Ann, Module(..), ModuleName(..), importName, isPrimModule, moduleName)
import PureScript.Backend.Optimizer.CoreFn.Json (decodeModule)
import PureScript.Backend.Optimizer.CoreFn.Sort (sortModules)

type Loaded = { file :: String, tast :: Module Ann }

-- Parse once, then use the same validated decoder as PBO's parseModule. These
-- three arrays are optional for generic CoreFn, but required at the Java boundary.
parseTast :: String -> Either String (Module Ann)
parseTast contents = do
  json <- jsonParser contents
  case toObject json of
    Nothing -> Left "Expected a TAST JSON object"
    Just object -> for_ [ "dataDecls", "classDecls", "typeTable" ] \field ->
      case Object.lookup field object >>= toArray of
        Nothing -> Left $ "Incompatible TAST: " <> field <> " must be an array; select the TAST-capable PureScript fork and rebuild in a fresh output directory"
        Just _ -> Right unit
  lmap printJsonDecodeError (decodeModule json)

readEntry :: String -> String -> Aff (Maybe Loaded)
readEntry parent entry = do
  let directory = parent <> "/" <> entry
  stat <- withContext ("inspect TAST entry " <> directory) $ FS.stat directory
  if not (Stats.isDirectory stat) then pure Nothing
  else do
    let file = directory <> "/corefn.json"
    withContext ("read TAST " <> file) do
      -- --codegen docs also writes Prim*/docs.json without any CoreFn. Exempt
      -- only absent primitive inputs; a present file still gets fully decoded.
      hasCoreFn <- if isPrimModule (ModuleName entry) then
        Array.elem "corefn.json" <$> FS.readdir directory
        else pure true
      if not hasCoreFn then pure Nothing
      else do
        fileStat <- FS.stat file
        unless (Stats.isFile fileStat) $ throwError $ error "Expected a regular corefn.json file"
        contents <- FS.readTextFile UTF8 file
        tast <- either (throwError <<< error) pure (parseTast contents)
        pure $ Just { file, tast }

-- sortModules indexes by module name and tolerates missing imports. Validate
-- first so it cannot silently discard a duplicate or a missing dependency.
validateModules :: Array Loaded -> Aff Unit
validateModules loaded = do
  index <- foldM
    (\index { file, tast } ->
      let name = moduleName tast
      in case Map.lookup name index of
        Just previous -> throwError $ error $ "Duplicate TAST module " <> unwrap name <> ": " <> previous <> " and " <> file
        Nothing -> pure $ Map.insert name file index
    ) Map.empty loaded
  for_ loaded \{ file, tast: Module source } ->
    for_ source.imports \import_ -> do
      let name = importName import_
      unless (isPrimModule name || Map.member name index) $ throwError $ error $
        "Missing TAST dependency " <> unwrap name <> " required by " <> unwrap source.name <> " in " <> file

readModules :: String -> Aff (List (Module Ann))
readModules directory = do
  jobs <- liftEffect readConcurrency
  -- Lowercase java is reserved for backend artifacts, never a PureScript module.
  entries <- Array.filter (_ /= "java") <$> FS.readdir directory
  let
    read = readEntry directory
    batches remaining
      | Array.null remaining = pure List.Nil
      | otherwise = do
          let { before, after } = Array.splitAt jobs remaining
          batch <- parTraverse read before
          rest <- batches after
          pure (List.Cons batch rest)
  results <- if jobs == 1 then traverse read entries
    else Array.concat <<< Array.fromFoldable <$> batches entries
  let loaded = Array.catMaybes results
  validateModules loaded
  pure $ sortModules (map _.tast loaded)

foreign import readConcurrency :: Effect Int
