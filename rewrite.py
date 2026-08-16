import re

with open('src/Javapurs/CodeGen.purs.bak', 'r') as f:
    content = f.read()

# Replace imports
content = content.replace("import Javapurs.Printer (printExpr)", "import Javapurs.Printer (printExpr)\nimport Javapurs.JavaAst (JavaExpr(..), JavaFile)\n\ntype TransRes = { stmts :: Array JavaExpr, expr :: JavaExpr }\n\npureExpr :: JavaExpr -> TransRes\npureExpr e = { stmts: [], expr: e }\n\nwrapInBlock :: TransRes -> JavaExpr\nwrapInBlock res =\n  if Array.length res.stmts == 0 then res.expr\n  else JavaBlock res.stmts res.expr\n")
content = content.replace("import Javapurs.JavaAst (JavaExpr(..), JavaFile)\n", "")

# Update signature
content = content.replace("translateExpr :: String -> Array LoopCtx -> Boolean -> TcoExpr -> JavaExpr", "translateExpr :: String -> Array LoopCtx -> Boolean -> TcoExpr -> TransRes")

# Now, we need to wrap all returns of translateExpr.
# This is tricky because some branches like Let and App need custom logic.
# Since the file is 380 lines, I will just output the fully rewritten CodeGen.purs.
