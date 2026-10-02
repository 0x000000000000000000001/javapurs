module Javapurs.Naming
  ( sanitizeName, modulePrefix, safeCtorName, constructorClassName
  , renamedLocal, lazyGetterName, singletonHolderName
  , loopSnapshotName, loopStorageName, loopNextName, snapshotBaseName
  ) where

import Prelude

import Data.Foldable (foldl)
import Data.Maybe (Maybe)
import Data.String as String
import Data.String.Pattern (Pattern(..), Replacement(..))
import Data.Tuple (Tuple(..))
import PureScript.Backend.Optimizer.CoreFn (ModuleName(..))

-- Source `$` characters are removed; keyword escaping may add a leading `$`.
-- Embedded suffixes such as `$rN` and `__singleton$` remain backend-only.
-- Operator characters that appear in
-- generated names (class instances named after symbol literals, for example)
-- become words, and a leading digit gets a prefix, so every name is a valid
-- identifier.
sanitizeName :: String -> String
sanitizeName n =
  let
    escaped = foldl (\name (Tuple pattern replacement) ->
      String.replaceAll (Pattern pattern) (Replacement replacement) name
      ) n operatorEscapes
    n' = String.replaceAll (Pattern "$") (Replacement "") (String.replaceAll (Pattern "'") (Replacement "$prime") escaped)
    withLeading = case String.take 1 n' of
      "0" -> "X_" <> n'
      "1" -> "X_" <> n'
      "2" -> "X_" <> n'
      "3" -> "X_" <> n'
      "4" -> "X_" <> n'
      "5" -> "X_" <> n'
      "6" -> "X_" <> n'
      "7" -> "X_" <> n'
      "8" -> "X_" <> n'
      "9" -> "X_" <> n'
      _ -> n'
    isKeyword x = x == "void" || x == "class" || x == "return" || x == "const" || x == "new" || x == "throw" || x == "catch" || x == "try" || x == "finally" || x == "if" || x == "else" || x == "while" || x == "for" || x == "do" || x == "switch" || x == "case" || x == "default" || x == "break" || x == "continue" || x == "boolean" || x == "byte" || x == "char" || x == "short" || x == "int" || x == "long" || x == "float" || x == "double" || x == "true" || x == "false" || x == "null" || x == "this" || x == "super" || x == "instanceof" || x == "public" || x == "protected" || x == "private" || x == "static" || x == "final" || x == "abstract" || x == "interface" || x == "implements" || x == "extends" || x == "package" || x == "import" || x == "throws" || x == "enum" || x == "assert" || x == "strictfp" || x == "native" || x == "synchronized" || x == "transient" || x == "volatile"
  in
    if withLeading == "" then "X_empty"
    else if isKeyword withLeading then "$" <> withLeading else withLeading

operatorEscapes :: Array (Tuple String String)
operatorEscapes =
  [ Tuple "/" "_slash_"
  , Tuple "\\" "_bslash_"
  , Tuple "<" "_less_"
  , Tuple ">" "_greater_"
  , Tuple "=" "_eq_"
  , Tuple "+" "_plus_"
  , Tuple "-" "_minus_"
  , Tuple "*" "_times_"
  , Tuple ":" "_colon_"
  , Tuple "|" "_bar_"
  , Tuple "&" "_amp_"
  , Tuple "^" "_caret_"
  , Tuple "~" "_tilde_"
  , Tuple "?" "_qmark_"
  , Tuple "!" "_bang_"
  , Tuple "@" "_at_"
  , Tuple "#" "_hash_"
  , Tuple "%" "_percent_"
  , Tuple "\"" "_quote_"
  , Tuple "." "_dot_"
  ]

modulePrefix :: ModuleName -> String
modulePrefix (ModuleName name) = "__M$" <> String.replaceAll (String.Pattern ".") (String.Replacement "_") name

safeCtorName :: String -> String
safeCtorName = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_")

constructorClassName :: String -> String -> String
constructorClassName modPart ctorName = modPart <> "." <> safeCtorName ctorName

-- Generated names take already-escaped binding names; never sanitize them a
-- second time. Rename owns the freshness counter, independently of scope exit.
renamedLocal :: String -> Int -> String
renamedLocal name counter = name <> "$r" <> show counter

lazyGetterName :: String -> String
lazyGetterName name = "__lazy_get_" <> name

singletonHolderName :: String -> String
singletonHolderName name = "__singleton$" <> name

-- Loop storage is mutable; snapshots are final values captured by closures.
-- The three prefixes must agree between CodeGen, Rename, Chunk and Printer.
loopSnapshotName :: String -> String
loopSnapshotName name = "__final_" <> name

loopStorageName :: String -> String
loopStorageName name = "__tco_" <> name

loopNextName :: String -> String
loopNextName name = "__next_" <> name

snapshotBaseName :: String -> Maybe String
snapshotBaseName = String.stripPrefix (Pattern "__final_")
