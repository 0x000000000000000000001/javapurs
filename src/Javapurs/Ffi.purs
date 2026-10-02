module Javapurs.Ffi (ForeignSource, loadForeign, renderForeign) where

import Prelude

import Data.Maybe (Maybe(..))
import Data.Newtype (unwrap)
import Data.String as String
import Effect.Aff (Aff)
import Effect.Class (liftEffect)
import Javapurs.Diagnostics (withContext)
import Javapurs.Naming (sanitizeName)
import Node.Encoding (Encoding(..))
import Node.FS.Aff as FS
import PureScript.Backend.Optimizer.CoreFn (Ident(..), ModuleName)
import PureScript.Backend.Optimizer.FfiSupport (findFfiFile)

type ForeignSource = { path :: String, source :: String }

-- PBO owns discovery (adjacent .java first, then package/local roots). This
-- boundary reads the selected fragment and distinguishes absence from errors.
loadForeign :: ModuleName -> String -> Aff (Maybe ForeignSource)
loadForeign moduleName modulePath = do
  path <- withContext ("resolve Java FFI for " <> unwrap moduleName) $
    liftEffect $ findFfiFile ".java" [] Nothing (unwrap moduleName) (Just modulePath)
  case path of
    Nothing -> pure Nothing
    Just file -> do
      source <- withContext ("read Java FFI " <> file) $ FS.readTextFile UTF8 file
      pure (Just { path: file, source })

-- Every class carries FFI_STUB, even with a provided fragment. Empty files
-- follow the missing-FFI path; nonempty fragments are inserted verbatim.
renderForeign :: ModuleName -> Array Ident -> Maybe ForeignSource -> String
renderForeign moduleName idents implementation =
  "    public static final Object FFI_STUB = new java.util.function.Function<Object, Object>() {\n" <>
  "        public Object apply(Object arg) { throw new UnsupportedOperationException(\"Missing Java FFI in " <> name <> "\"); }\n" <>
  "    };\n" <>
  members <> "\n\n"
  where
  name = unwrap moduleName
  members = case implementation of
    Just ffi | String.length ffi.source > 0 ->
      "    // FFI provided by " <> ffi.path <> "\n" <> ffi.source
    _ -> String.joinWith "\n" (map stub idents)
  stub (Ident ident) =
    "    public static Object " <> sanitizeName ident <> " = FFI_STUB;\n    public static Object " <>
    sanitizeName ident <> "(Object... args) { throw new UnsupportedOperationException(\"Missing Java FFI: " <>
    name <> "." <> ident <> "\"); }"
