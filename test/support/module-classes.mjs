import { modulePrefix } from "../../output/Javapurs.Naming/index.js";

// Generated code names a module class with a reserved prefix that no source
// identifier can produce, because `sanitizeName` strips `$` from source names.
export const moduleClass = name => modulePrefix(name);

// Prefixes bare module class names in handwritten Java fixtures. Names that
// already carry the prefix and anonymous classes (`Outer$1`) are left alone.
export const moduleText = (source, names) =>
  names.reduce(
    (text, name) =>
      text.replace(new RegExp(`(?<!__M\\$)\\b${name}\\b(?!\\$)`, "g"), () => moduleClass(name)),
    source,
  );
