-- | The escape-hatch contract for JavaRaw. Production open expressions belong
-- | in JavaAst; text does not declare structural children, binders or mutations.
module Javapurs.Raw (isClosedValue, renameIdentifiers) where

import Prelude

import Data.Array as Array
import Data.List (List(..))
import Data.List as List
import Data.Maybe (Maybe(..), fromMaybe)
import Data.String as String
import Data.String.CodeUnits as CodeUnits
import Data.String.Regex as Regex
import Data.String.Regex.Flags (noFlags)
import Data.String.Regex.Unsafe (unsafeRegex)

-- | A deliberately small whitelist, used by capture analysis. Unknown text is
-- | a barrier even if a caller knows it happens to be closed. Method selectors
-- | use JavaStaticMethodRef/JavaInstanceMethodRef, not a string-prefix heuristic.
isClosedValue :: String -> Boolean
isClosedValue code
  | Array.elem code [ "true", "false", "null", "Double.NaN", "Double.POSITIVE_INFINITY", "Double.NEGATIVE_INFINITY" ] = true
  | numeric code = true
  | Just comment <- String.stripPrefix (String.Pattern "null /* TODO:") code
  , [ _, "" ] <- String.split (String.Pattern "*/") comment = true
  | String.take 1 code == "'" && String.take 1 (String.drop (String.length code - 1) code) == "'" && String.length code <= 4 = true
  | String.take 11 code == "new Object[" && String.drop (String.length code - 1) code == "]" && numeric (String.take (String.length code - 12) (String.drop 11 code)) = true
  | otherwise = false

numeric :: String -> Boolean
numeric = Regex.test (unsafeRegex "^[+-]?[0-9]+(?:\\.[0-9]*)?(?:[eE][+-]?[0-9]+)?$" noFlags)

-- | Compatibility for hand-written AST fixtures with raw local reads. Protect
-- | quoted text, comments and qualified member names. This is token substitution,
-- | not Java parsing: raw declarations and hidden scopes are unsupported. The
-- | chunker still treats such open text as opaque, regardless of this rename.
renameIdentifiers :: (String -> String) -> String -> String
renameIdentifiers rename code = String.joinWith "" (Array.fromFoldable (List.reverse (scan 0 ' ' Nil)))
  where
  length = CodeUnits.length code
  charAt index = fromMaybe ' ' (CodeUnits.charAt index code)
  slice start end = CodeUnits.take (end - start) (CodeUnits.drop start code)
  identifier char = (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z')
    || (char >= '0' && char <= '9') || char == '_' || char == '$'
  whitespace char = Array.elem char [ ' ', '\t', '\r', '\n' ]

  advanceWhile predicate index
    | index < length && predicate (charAt index) = advanceWhile predicate (index + 1)
    | otherwise = index

  quotedEnd quote index
    | index >= length = length
    | charAt index == '\\' = quotedEnd quote (index + 2)
    | charAt index == quote = index + 1
    | otherwise = quotedEnd quote (index + 1)

  commentEnd index
    | index >= length = length
    | charAt index == '*' && charAt (index + 1) == '/' = index + 2
    | otherwise = commentEnd (index + 1)

  scan index previous parts
    | index >= length = parts
    | otherwise =
        let char = charAt index
        in if char == '"' || char == '\'' then
          let end = quotedEnd char (index + 1)
          in scan end char (Cons (slice index end) parts)
        else if char == '/' && charAt (index + 1) == '/' then
          let end = advanceWhile (_ /= '\n') (index + 2)
          in scan end previous (Cons (slice index end) parts)
        else if char == '/' && charAt (index + 1) == '*' then
          let end = commentEnd (index + 2)
          in scan end previous (Cons (slice index end) parts)
        else if identifier char then
          let
            end = advanceWhile identifier (index + 1)
            token = slice index end
          in scan end char (Cons (if previous == '.' then token else rename token) parts)
        else
          scan (index + 1) (if whitespace char then previous else char) (Cons (CodeUnits.singleton char) parts)
