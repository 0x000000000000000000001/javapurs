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
import Data.Map as Map
import Data.Set as Set
import Data.Maybe (Maybe(..))
import Data.List as List
import Data.Array as Array
import Data.Newtype (unwrap)
import Data.String as String
import Javapurs.CodeGen (translate)
import Javapurs.Printer (printFile, printExpr)

main :: Effect Unit
main = launchAff_ do
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
        
        let javaAst = translate backendMod
        let foreignIdents = Map.keys backendMod.foreign
        let ffiStubs = String.joinWith "\n" (map (\(Ident name) -> "    public static Object " <> String.replaceAll (String.Pattern "'") (String.Replacement "_") name <> " = FFI_STUB;") (Array.fromFoldable foreignIdents))
        
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
        
        if modNameStr == "Main" then
          let
            mainRunCode =
              "public class MainRun {\n" <>
              "    public static void main(String[] args) {\n" <>
              "        Effect_Console.log = (java.util.function.Function<Object, Object>) (s) -> (java.util.function.Supplier<Object>) () -> { System.out.println(s); return null; };\n" <>
              "        Effect.bindE = (java.util.function.Function<Object, Object>) (a) -> (java.util.function.Function<Object, Object>) (f) -> (java.util.function.Supplier<Object>) () -> {\n" <>
              "            return ((java.util.function.Supplier<Object>) ((java.util.function.Function<Object, Object>) f).apply(((java.util.function.Supplier<Object>) a).get())).get();\n" <>
              "        };\n" <>
              "        Effect.pureE = (java.util.function.Function<Object, Object>) (a) -> (java.util.function.Supplier<Object>) () -> a;\n" <>
              "        Data_Semigroup.concatString = (java.util.function.Function<Object, Object>) (a) -> (java.util.function.Function<Object, Object>) (b) -> a.toString() + b.toString();\n" <>
              "        ((java.util.function.Supplier<Void>) Main.main).get();\n" <>
              "    }\n" <>
              "}\n"
          in
            FS.writeTextFile UTF8 "java_output/MainRun.java" mainRunCode
        else pure unit
    } (List.toUnfoldable modules)
