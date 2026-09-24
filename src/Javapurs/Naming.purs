module Javapurs.Naming (sanitizeName, modulePrefix, safeCtorName, constructorClassName) where

import Prelude

import Data.String as String
import PureScript.Backend.Optimizer.CoreFn (ModuleName(..))

-- Java identifiers keep `$` out of source names; the backend reserves it for
-- generated prefixes such as `__singleton$`. Constructor primes become a word
-- so the name stays a valid identifier.
sanitizeName :: String -> String
sanitizeName n =
  let
    n' = String.replaceAll (String.Pattern "$") (String.Replacement "") (String.replaceAll (String.Pattern "'") (String.Replacement "$prime") n)
    isKeyword x = x == "void" || x == "class" || x == "return" || x == "const" || x == "new" || x == "throw" || x == "catch" || x == "try" || x == "finally" || x == "if" || x == "else" || x == "while" || x == "for" || x == "do" || x == "switch" || x == "case" || x == "default" || x == "break" || x == "continue" || x == "boolean" || x == "byte" || x == "char" || x == "short" || x == "int" || x == "long" || x == "float" || x == "double" || x == "true" || x == "false" || x == "null" || x == "this" || x == "super" || x == "instanceof" || x == "public" || x == "protected" || x == "private" || x == "static" || x == "final" || x == "abstract" || x == "interface" || x == "implements" || x == "extends" || x == "package" || x == "import" || x == "throws" || x == "enum" || x == "assert" || x == "strictfp" || x == "native" || x == "synchronized" || x == "transient" || x == "volatile"
  in
    if isKeyword n' then "$" <> n' else n'

modulePrefix :: ModuleName -> String
modulePrefix (ModuleName name) = String.replaceAll (String.Pattern ".") (String.Replacement "_") name

safeCtorName :: String -> String
safeCtorName = String.replaceAll (String.Pattern "'") (String.Replacement "_prime_")

constructorClassName :: String -> String -> String
constructorClassName modPart ctorName = modPart <> "." <> safeCtorName ctorName
