module Javapurs.Ffi
  ( ForeignSource, SourceLocation, ForeignBinding, ForeignReport
  , loadForeign, describeForeign, renderForeign
  ) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..))
import Data.Newtype (unwrap)
import Data.Nullable (Nullable, toNullable)
import Data.String as String
import Effect (Effect)
import Effect.Aff (Aff)
import Effect.Class (liftEffect)
import Javapurs.Diagnostics (withContext)
import Javapurs.Naming (sanitizeName)
import Javapurs.Printer.Syntax (quote)
import Node.Encoding (Encoding(..))
import Node.FS.Aff as FS
import PureScript.Backend.Optimizer.CoreFn (Ident(..), ModuleName)
import PureScript.Backend.Optimizer.FfiSupport (findFfiFile)

type ForeignSource = { path :: String, source :: String }

type SourceLocation = { path :: String, realPath :: Nullable String, origin :: String }
type ForeignBinding = { name :: String, javaName :: String, retained :: Boolean }
type ForeignReport =
  { moduleName :: String
  , moduleSource :: SourceLocation
  , adjacentJava :: String
  , selectedJava :: Nullable SourceLocation
  , fragmentSha256 :: Nullable String
  , resolution :: String
  , status :: String
  , bindings :: Array ForeignBinding
  , verification :: String
  }

foreign import describeImpl :: String -> String -> Array ForeignBinding -> String -> Nullable String -> Nullable String -> Effect ForeignReport

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

-- Preserve both the declared inventory and the subset retained by PBO. A
-- provided fragment is not proof that its members exist or have been executed.
describeForeign :: ModuleName -> String -> Array Ident -> Array Ident -> Maybe ForeignSource -> Aff ForeignReport
describeForeign moduleName modulePath declared emitted implementation =
  withContext ("describe Java FFI for " <> unwrap moduleName) $ liftEffect $
    describeImpl (unwrap moduleName) modulePath bindings status
      (toNullable (map _.path implementation)) (toNullable (map _.source implementation))
  where
  bindings = map (\ident -> { name: unwrap ident, javaName: sanitizeName (unwrap ident), retained: Array.elem ident emitted })
    (Array.sort (Array.nub (declared <> emitted)))
  status = case implementation of
    Just ffi | String.length ffi.source > 0 -> "provided"
    Just _ -> "empty"
    Nothing | Array.null bindings -> "not-required"
    Nothing -> "missing"

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
    _ | Array.null idents -> ""
    _ -> missingClass <> String.joinWith "\n" (map stub idents)
  missingClass = """
    private static final class __MissingFFI implements java.util.function.Function<Object, Object>, java.util.function.Supplier<Object> {
        private final String binding;
        private __MissingFFI(String binding) { this.binding = binding; }
        public Object apply(Object arg) { throw new UnsupportedOperationException(binding); }
        public Object get() { throw new UnsupportedOperationException(binding); }
    }
"""
  stub (Ident ident) =
    let message = quote ("Missing Java FFI: " <> name <> "." <> ident)
    in "    public static Object " <> sanitizeName ident <> " = new __MissingFFI(" <> message <> ");\n    public static Object " <>
      sanitizeName ident <> "(Object... args) { throw new UnsupportedOperationException(" <> message <> "); }"
