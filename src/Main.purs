module Main where

import Prelude
import Effect (Effect)
import Effect.Aff (launchAff_, attempt)
import Effect.Console (log)
import Effect.Class (liftEffect)
import Node.FS.Aff as FS
import Node.Encoding (Encoding(..))
import PureScript.Backend.Optimizer.App (coreFnModulesFromOutput, loadDirectives)
import PureScript.Backend.Optimizer.Builder (buildModules)
import PureScript.Backend.Optimizer.CoreFn (Ident(..), Module(..), ModuleName(..))
import PureScript.Backend.Optimizer.Semantics.Foreign (coreForeignSemantics)
import PureScript.Backend.Optimizer.FfiSupport (findFfiFile)
import Data.Map as Map
import Data.Set as Set
import Data.Maybe (Maybe(..), fromMaybe)
import Data.List as List
import Data.Array as Array
import Data.Newtype (unwrap)
import Data.String as String
import Javapurs.CodeGen (translate)
import Node.Process (argv)
import Javapurs.Printer (printFile, printExpr)
import Javapurs.CodeGen (sanitizeName)

main :: Effect Unit
main = launchAff_ do
  args <- liftEffect argv
  let mainModule = case Array.findIndex (_ == "--main") args of
        Just i -> case Array.index args (i + 1) of
          Just m -> m
          Nothing -> "Main"
        Nothing -> "Main"

  liftEffect $ log "Loading corefn.json files..."
  modules <- coreFnModulesFromOutput "output"
  let count = List.length modules
  liftEffect $ log $ "Successfully loaded " <> show count <> " modules."

  directives <- loadDirectives
  
  buildModules
    { directives
    , analyzeCustom: \_ _ -> Nothing
    , foreignSemantics: coreForeignSemantics
    , traceIdents: Set.empty
    , onPrepareModule: \_ m -> pure m
    , onSkipModule: \_ _ -> pure Nothing
    , onCodegenModule: \_ (Module coreFnMod) backendMod _ -> do
        let modNameStr = unwrap coreFnMod.name
        let safeModName = String.replaceAll (String.Pattern ".") (String.Replacement "_") modNameStr
        liftEffect $ log $ "Building module " <> modNameStr
        
        ffiPathMb <- liftEffect $ findFfiFile ".java" [] Nothing modNameStr (Just coreFnMod.path)
        ffiContent <- case ffiPathMb of
          Nothing -> pure ""
          Just p -> FS.readTextFile UTF8 p
        
        let javaAst = translate backendMod
        let foreignIdents = Map.keys backendMod.foreign
        let ffiStubs =
              if String.length ffiContent > 0 then
                "    // FFI provided by " <> fromMaybe "" ffiPathMb <> "\n" <> ffiContent
              else
                String.joinWith "\n" (map (\(Ident name) -> "    public static Object " <> sanitizeName name <> " = FFI_STUB;\n    public static Object " <> sanitizeName name <> "(Object... args) { return null; }") (Array.fromFoldable foreignIdents))
        
        let
          classContent =
            "public class " <> safeModName <> " {\n" <>
            "    public static final Object FFI_STUB = new java.util.function.Function<Object, Object>() {\n" <>
            "        public Object apply(Object arg) { return this; }\n" <>
            "    };\n" <>
            ffiStubs <> "\n\n" <>
            String.joinWith "\n" (map printExpr javaAst.decls) <>
            "\n}\n"
            
        FS.writeTextFile UTF8 ("java_output/" <> safeModName <> ".java") classContent
        
        let
          tcoLoopCode =
            "public class TcoLoop extends RuntimeException {\n" <>
            "    public String loopId;\n" <>
            "    public Object[] args;\n" <>
            "    public TcoLoop(String loopId, Object[] args) {\n" <>
            "        this.loopId = loopId;\n" <>
            "        this.args = args;\n" <>
            "    }\n" <>
            "    @Override\n" <>
            "    public synchronized Throwable fillInStackTrace() { return this; }\n" <>
            "}\n"
        FS.writeTextFile UTF8 "java_output/TcoLoop.java" tcoLoopCode
        
        if modNameStr == mainModule then
          let
            mainRunCode =
              "public class MainRun {\n" <>
              "    public static void main(String[] args) {\n" <>
              "        ((java.util.function.Supplier<Void>) " <> safeModName <> ".main).get();\n" <>
              "    }\n" <>
              "}\n"
          in
            FS.writeTextFile UTF8 "java_output/MainRun.java" mainRunCode
        else pure unit
    } (List.toUnfoldable modules)
