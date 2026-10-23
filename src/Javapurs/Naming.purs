module Javapurs.Naming
  ( sanitizeName, modulePrefix, safeCtorName, constructorClassName
  , renamedLocal, lazyGetterName, singletonHolderName
  , loopSnapshotName, loopStorageName, loopNextName, snapshotBaseName
  ) where

import Prelude

import Data.Array as Array
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
sanitizeName sourceName =
  let
    escapedOperators = foldl (\name (Tuple pattern replacement) ->
      String.replaceAll (Pattern pattern) (Replacement replacement) name
      ) sourceName operatorEscapes
    escapedPrimes = String.replaceAll (Pattern "'") (Replacement "$prime") escapedOperators
    withoutDollars = String.replaceAll (Pattern "$") (Replacement "") escapedPrimes
    identifier = case String.take 1 withoutDollars of
      "0" -> "X_" <> withoutDollars
      "1" -> "X_" <> withoutDollars
      "2" -> "X_" <> withoutDollars
      "3" -> "X_" <> withoutDollars
      "4" -> "X_" <> withoutDollars
      "5" -> "X_" <> withoutDollars
      "6" -> "X_" <> withoutDollars
      "7" -> "X_" <> withoutDollars
      "8" -> "X_" <> withoutDollars
      "9" -> "X_" <> withoutDollars
      _ -> withoutDollars
  in
    if identifier == "" then "X_empty"
    else if Array.elem identifier javaKeywords then "$" <> identifier else identifier

javaKeywords :: Array String
javaKeywords =
  [ "void", "class", "return", "const", "new", "throw", "catch", "try"
  , "finally", "if", "else", "while", "for", "do", "switch", "case"
  , "default", "break", "continue", "boolean", "byte", "char", "short", "int"
  , "long", "float", "double", "true", "false", "null", "this", "super"
  , "instanceof", "public", "protected", "private", "static", "final", "abstract"
  , "interface", "implements", "extends", "package", "import", "throws", "enum"
  , "assert", "strictfp", "native", "synchronized", "transient", "volatile"
  ]

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
