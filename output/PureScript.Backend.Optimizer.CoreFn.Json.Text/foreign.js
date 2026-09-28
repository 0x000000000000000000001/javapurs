// JavaScript retains the ordinary parser and validated PureScript decoder.
export const parseModuleTextImpl = fallback => validate => printError => text =>
  fallback(text);
