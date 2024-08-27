import assert from "assert";
import CodeBlockWriter from "code-block-writer";
import { execa } from "execa";
import path from "path";
import {
    ArrowFunction,
    Block,
    Expression,
    ExpressionStatement,
    FunctionDeclaration,
    IfStatement,
    Node,
    Project,
    Statement,
    ts,
    Type,
    TypeNode,
} from "ts-morph";

process.stdout.write("\x1B[2J\x1B[3J\x1B[H");

const root = "/home/jabaile/work/TypeScript/src/compiler";
function pathFor(s: string) {
    return path.join(root, s);
}

const project = new Project({
    tsConfigFilePath: pathFor("tsconfig.json"),
});

const sourceFile = project.getSourceFileOrThrow(pathFor("checker.ts"));

const writer = new CodeBlockWriter({
    useTabs: true,
});

writer.writeLine("package output");
writer.newLine();

type Printable = { getKindName?(): string; getText(): string; };

function todo(node: Printable): string {
    // const currentLine = " " + new Error().stack?.split("\n")[2].trim();
    const currentLine = "";

    let text = node.getText();
    text = text.replaceAll("*/", "* /");
    text = text.replace(/\r?\n/g, " ");
    return `/* TODO(${node.getKindName?.()}${currentLine}): ${text} */`;
}

function writeType(node: Type): void {
    writer.write(`${todo(node)} TODO`);
}

function visitTypeNode(type: TypeNode): void {
    // In Go, there's never a reason to parenthesize a type.
    while (Node.isParenthesizedTypeNode(type)) {
        type = type.getTypeNode();
    }

    if (Node.isFunctionTypeNode(type)) {
        writer.write("func(");
        const params = type.getParameters();
        for (let i = 0; i < params.length; i++) {
            const param = params[i];
            writer.write(getNameOfNamed(param));
            writer.write(" ");
            visitTypeNode(param.getTypeNodeOrThrow());
            writer.conditionalWrite(i < params.length - 1, ", ");
        }
        writer.write(") ");
        const ret = type.getReturnTypeNodeOrThrow();
        visitTypeNode(ret);
    }
    else if (Node.isBooleanKeyword(type)) {
        writer.write("bool");
    }
    else if (Node.isStringKeyword(type)) {
        writer.write("string");
    }
    else if (Node.isNumberKeyword(type)) {
        writer.write("number");
    }
    else if (type.getText() === "void") {
        const parent = type.getParentIfKind(ts.SyntaxKind.FunctionType);
        if (parent?.getReturnTypeNode() !== type) {
            writer.write("void");
        }
    }
    else if (Node.isArrayTypeNode(type)) {
        writer.write("[]");
        visitTypeNode(type.getElementTypeNode());
    }
    else if (Node.isTypeOperatorTypeNode(type)) {
        visitTypeNode(type.getTypeNode());
    }
    else if (Node.isTypeReference(type)) {
        const name = type.getTypeName();
        if (Node.isIdentifier(name)) {
            writer.write(sanitizeName(name.getText()));
        }
        else {
            writer.write(`${todo(name)} TODO`);
        }
        const typeArguments = type.getTypeArguments();
        if (typeArguments.length > 0) {
            writer.write("[");
            for (let i = 0; i < typeArguments.length; i++) {
                visitTypeNode(typeArguments[i]);
                writer.conditionalWrite(i < typeArguments.length - 1, ", ");
            }
            writer.write("]");
        }
    }
    else if (Node.isUnionTypeNode(type)) {
        if (type.getTypeNodes().length === 2) {
            let [a, b] = type.getTypeNodes();
            if (Node.isUndefinedKeyword(a)) {
                [a, b] = [b, a];
            }
            if (Node.isUndefinedKeyword(b)) {
                if (Node.isTypeReference(a)) {
                    switch (a.getText()) {
                        case "Node":
                        case "Declaration":
                            break;
                        default:
                            writer.write("*");
                    }
                    visitTypeNode(a);
                }
                else {
                    writer.write(`${todo(a)} any`);
                }
            }
            else {
                writer.write(`${todo(type)} any`);
            }
        }
        else {
            writer.write(`${todo(type)} any`);
        }
    }
    else {
        writer.write(`${todo(type)} TODO`);
    }
}

function visitExpression(node: Expression): void {
    if (Node.isRegularExpressionLiteral(node)) {
        const re = node.getLiteralValue();
        let source = re.source.replaceAll("`", "\\`");

        for (const flag of re.flags.split("")) {
            switch (flag) {
                case "i":
                    source = `(?i:${source})`;
                    break;
                default:
                    writer.write(`${todo(node)} TODO`);
                    return;
            }
        }

        writer.write(`regexp.MustParse(\`${source}\`)`);
    }
    else if (Node.isLiteralExpression(node)) {
        writer.write(node.getText());
    }
    else if (Node.isAsExpression(node)) {
        visitExpression(node.getExpression());
        writer.write(` /* as */ ${todo(node.getTypeNodeOrThrow())}`);
    }
    else if (Node.isNonNullExpression(node)) {
        visitExpression(node.getExpression());
        writer.write(`/*!*/`);
    }
    else if (Node.isIdentifier(node) || node.getText() === "this") {
        if (node.getText() === "undefined") {
            writer.write("nil");
        }
        else {
            writer.write(sanitizeName(node.getText()));
        }
    }
    else if (Node.isCallExpression(node)) {
        const expression = node.getExpression();
        visitExpression(expression);
        writer.write("(");
        const args = node.getArguments();
        for (let i = 0; i < args.length; i++) {
            const expr = args[i];
            assert(Node.isExpression(expr));
            visitExpression(expr);
            writer.conditionalWrite(i < args.length - 1, ", ");
        }
        writer.write(")");
    }
    else if (Node.isPrefixUnaryExpression(node)) {
        writer.write(ts.tokenToString(node.getOperatorToken())!);
        visitExpression(node.getOperand());
    }
    else if (Node.isParenthesizedExpression(node)) {
        writer.write("(");
        visitExpression(node.getExpression());
        writer.write(")");
    }
    else if (Node.isBinaryExpression(node)) {
        const op = node.getOperatorToken();
        let tok;
        switch (op.getKind()) {
            case ts.SyntaxKind.AmpersandAmpersandToken:
            case ts.SyntaxKind.BarBarToken:
            case ts.SyntaxKind.LessThanEqualsToken:
            case ts.SyntaxKind.LessThanToken:
            case ts.SyntaxKind.GreaterThanEqualsToken:
            case ts.SyntaxKind.GreaterThanToken:
            case ts.SyntaxKind.AmpersandToken:
            case ts.SyntaxKind.BarToken:
                tok = ts.tokenToString(op.getKind());
                break;
            case ts.SyntaxKind.EqualsEqualsEqualsToken:
                tok = "==";
                break;
            case ts.SyntaxKind.ExclamationEqualsEqualsToken:
                tok = "!=";
                break;
            default:
                writer.write(`${todo(op)} ${todo(node)} TODO`);
                return;
        }

        visitExpression(node.getLeft());
        writer.write(` ${tok} `);
        visitExpression(node.getRight());
    }
    else if (Node.isTrueLiteral(node)) {
        writer.write("true");
    }
    else if (Node.isFalseLiteral(node)) {
        writer.write("false");
    }
    else if (Node.isPropertyAccessExpression(node)) {
        // Check for enum accesses first
        const expression = node.getExpression();
        if (Node.isIdentifier(expression)) {
            const type = expression.getType();
            if (type.isEnum()) {
                const enumName = expression.getText();
                const enumMember = node.getNameNode();
                writer.write(`${enumName}${enumMember.getText()}`);
                return;
            }
        }

        visitExpression(node.getExpression());
        writer.write(`.${sanitizeName(node.getName())}`);
    }
    else if (Node.isArrowFunction(node)) {
        writer.write("func");
        writeFunctionParametersAndReturn(node);
        writer.write(" {");
        writer.indent(() => {
            const body = node.getBody();
            if (Node.isBlock(body)) {
                visitBlock(body);
            }
            else {
                assert(Node.isExpression(body));
                writer.write("return ");
                visitExpression(body);
            }
        });
        writer.write("}");
    }
    else if (Node.isNewExpression(node)) {
        const expression = node.getExpression();
        if (Node.isIdentifier(expression) && node.getArguments().length === 0) {
            const typeArguments = node.getTypeArguments();
            const name = expression.getText();
            if (name === "Map") {
                if (typeArguments.length === 2) {
                    writer.write("make(map[");
                    visitTypeNode(typeArguments[0]);
                    writer.write("]");
                    visitTypeNode(typeArguments[1]);
                    writer.write(")");
                }
                else {
                    writer.write(`${todo(node)} make(map[any]any)`);
                }
                return;
            }
            else if (name === "Set") {
                if (typeArguments.length === 1) {
                    writer.write("make(map[");
                    visitTypeNode(typeArguments[0]);
                    writer.write("]struct{})");
                }
                else {
                    writer.write(`${todo(node)} make(map[any]struct{})`);
                }
                return;
            }
        }
        writer.write(`${todo(node)} TODO`);
    }
    // else if (Node.isObjectLiteralExpression(node)) {
    //     writer.write("map[any]any{");
    //     writer.indent(() => {
    //         const properties = node.getProperties();
    //         for (const prop of properties) {
    //             if (Node.isShorthandPropertyAssignment(prop)) {
    //                 writer.write(`${getNameOfNamed(prop)}: ${getNameOfNamed(prop)}`);
    //             }
    //             else if (Node.isPropertyAssignment(prop)) {
    //                 writer.write(`${getNameOfNamed(prop)}: `);
    //                 writeExpression(prop.getInitializerOrThrow());
    //                 writer.write(",");
    //             }
    //             else {
    //                 writer.write(todo(prop));
    //             }
    //             writer.write(",");
    //             writer.newLine();
    //         }
    //     });
    //     writer.write("}");
    // }
    else {
        writer.write(`${todo(node)} TODO`);
    }
}

function sanitizeName(name: string | undefined) {
    switch (name) {
        case "break":
        case "case":
        case "chan":
        case "const":
        case "continue":
        case "default":
        case "defer":
        case "else":
        case "fallthrough":
        case "for":
        case "func":
        case "go":
        case "goto":
        case "if":
        case "import":
        case "interface":
        case "map":
        case "package":
        case "range":
        case "return":
        case "select":
        case "struct":
        case "switch":
        case "type":
        case "var":
            return `${name}_`;
        default:
            return name || "TODO";
    }
}

function getNameOfNamed(node: { getName(): string | undefined; }) {
    const name = sanitizeName(node.getName());
    if (/^[a-zA-Z0-9_]+$/.test(name)) {
        return name;
    }
    return `TODO_IDENTIFIER`;
}

function visitIfStatement(node: IfStatement) {
    writer.write("if ");
    visitExpression(node.getExpression());
    writer.write(" {");
    writer.indent(() => {
        const thenStatement = node.getThenStatement();
        if (thenStatement) {
            if (Node.isBlock(thenStatement)) {
                visitBlock(thenStatement);
            }
            else {
                writer.write(todo(thenStatement));
            }
        }
        writer.newLineIfLastNot();
    });

    const elseStatement = node.getElseStatement();
    if (elseStatement) {
        writer.write("} else ");
        if (Node.isIfStatement(elseStatement)) {
            return visitIfStatement(elseStatement);
        }
        writer.write("{");
        writer.indent(() => {
            if (Node.isBlock(elseStatement)) {
                visitBlock(elseStatement);
            }
            else {
                writer.write(todo(elseStatement));
            }
        });
        writer.write("}");
    }
    else {
        writer.write("}");
    }
}

function visitExpressionStatement(node: ExpressionStatement) {
    // Handling expressions separately so we _don't_ handle side effect expressions in writeExpression
    const expression = node.getExpression();
    if (Node.isCallExpression(expression)) {
        visitExpression(expression);
        writer.newLine();
        return;
    }
    if (Node.isBinaryExpression(expression)) {
        const op = expression.getOperatorToken();
        const tokenStr = ts.tokenToString(op.getKind());
        if (tokenStr?.endsWith("=") && !tokenStr.startsWith("?") && tokenStr !== "||=") {
            const left = expression.getLeft();
            const right = expression.getRight();
            visitExpression(left);
            writer.write(` ${tokenStr} `);
            visitExpression(right);
            writer.newLine();
            return;
        }
    }
    if (Node.isPostfixUnaryExpression(expression)) {
        const tokenStr = ts.tokenToString(expression.getOperatorToken());
        if (tokenStr) {
            visitExpression(expression.getOperand());
            writer.write(tokenStr);
            writer.newLine();
            return;
        }
    }

    writer.writeLine(todo(node));
}

function writeFunctionParametersAndReturn(node: FunctionDeclaration | ArrowFunction) {
    writer.write("(");
    const params = node.getParameters();
    for (let i = 0; i < params.length; i++) {
        const param = params[i];
        writer.write(getNameOfNamed(param));
        writer.write(" ");
        const paramType = param.getTypeNode();
        if (paramType) {
            visitTypeNode(paramType);
        }
        else {
            writeType(param.getType());
        }
        const initializer = param.getInitializer();
        if (initializer) {
            writer.write(` /* = */ ${todo(initializer)}`);
        }
        writer.conditionalWrite(i < params.length - 1, ", ");
    }
    writer.write(")");
    const ret = node.getReturnType();
    if (!ret.isVoid()) {
        writer.write(" ");
        const retNode = node.getReturnTypeNode();
        if (retNode) {
            visitTypeNode(retNode);
        }
        else {
            writeType(ret);
        }
    }
}

function visitBlock(node: Block) {
    node.forEachChild(node => {
        if (Node.isStatement(node)) {
            return visitStatement(node);
        }
        writer.writeLine(todo(node));
    });
}

function visitStatement(node: Statement) {
    if (node.getKindName() === "EndOfFileToken") {
        return;
    }

    writer.newLineIfLastNot();

    if (Node.isImportDeclaration(node)) {
        return;
    }

    if (Node.isTypeAliasDeclaration(node)) {
        writer.write(`type ${getNameOfNamed(node)}`);

        const typeParameters = node.getTypeParameters();
        if (typeParameters.length > 0) {
            writer.write("[");

            for (let i = 0; i < typeParameters.length; i++) {
                const typeParameter = typeParameters[i];
                writer.write(getNameOfNamed(typeParameter));
                const constraint = typeParameter.getConstraint();
                if (constraint) {
                    writer.write(" ");
                    visitTypeNode(constraint);
                }
                writer.conditionalWrite(i < typeParameters.length - 1, ", ");
            }

            writer.write("]");
        }

        writer.write(" ");
        visitTypeNode(node.getTypeNodeOrThrow());

        writer.newLineIfLastNot();
        return;
    }

    if (Node.isFunctionDeclaration(node)) {
        const isGlobal = node.getParentIf((p): p is Node => Node.isSourceFile(p)) !== undefined;

        writer.conditionalWrite(!node.hasBody(), "// OVERLOAD: ");

        if (!isGlobal) {
            writer.write(`${getNameOfNamed(node)} := func`);
        }
        else {
            writer.write(`func ${getNameOfNamed(node)}`);
        }

        writeFunctionParametersAndReturn(node);

        if (node.hasBody()) {
            writer.write(" {");
            writer.indent(() => {
                const body = node.getBodyOrThrow();
                assert(Node.isBlock(body));
                visitBlock(body);
            });
            writer.write("}");
        }

        writer.newLineIfLastNot();
        return;
    }

    if (Node.isInterfaceDeclaration(node)) {
        writer.write(`type ${getNameOfNamed(node)} struct`);

        const typeParameters = node.getTypeParameters();
        if (typeParameters.length > 0) {
            writer.write("[");

            for (let i = 0; i < typeParameters.length; i++) {
                const typeParameter = typeParameters[i];
                writer.write(getNameOfNamed(typeParameter));
                const constraint = typeParameter.getConstraint();
                if (constraint) {
                    writer.write(" ");
                    visitTypeNode(constraint);
                }
                writer.conditionalWrite(i < typeParameters.length - 1, ", ");
            }

            writer.write("]");
        }

        writer.write(" {");
        writer.indent(() => {
            const members = node.getMembers();
            for (const member of members) {
                if (Node.isMethodSignature(member)) {
                    assert.fail("oops");
                }
                else if (Node.isPropertySignature(member)) {
                    writer.write(`${getNameOfNamed(member)} `);
                    visitTypeNode(member.getTypeNodeOrThrow());
                    writer.newLine();
                }
                else {
                    writer.writeLine(todo(member));
                }
            }
        });
        writer.write("}");

        writer.newLineIfLastNot();
        return;
    }

    if (Node.isVariableStatement(node)) {
        const isGlobal = node.getParentIf((p): p is Node => Node.isSourceFile(p)) !== undefined;

        const declarations = node.getDeclarations();

        for (const declaration of declarations) {
            const typeNode = declaration.getTypeNode();
            const initializer = declaration.getInitializer();

            if (isGlobal) {
                writer.write(`var ${getNameOfNamed(declaration)}`);
                if (typeNode) {
                    writer.write(" ");
                    visitTypeNode(typeNode);
                }
                if (initializer) {
                    writer.write(" = ");
                    visitExpression(initializer);
                }
            }
            else {
                if (typeNode) {
                    writer.write(`var ${getNameOfNamed(declaration)} `);
                    visitTypeNode(typeNode);
                    if (initializer) {
                        writer.write(" = ");
                        visitExpression(initializer);
                    }
                }
                else if (initializer) {
                    writer.write(`${getNameOfNamed(declaration)} := `);
                    visitExpression(initializer);
                }
                else {
                    // No annotation or inferred type, comes from something later...
                    writer.write(`var ${getNameOfNamed(declaration)} TODO`);
                }
            }
            writer.newLineIfLastNot();
        }

        writer.newLineIfLastNot();
        return;
    }

    if (Node.isEnumDeclaration(node)) {
        const enumName = getNameOfNamed(node);

        writer.write(`type ${enumName}`);
        if (node.getMembers()[0].getInitializer()?.getKindName() === "StringLiteral") {
            writer.write(` string`);
        }
        else {
            writer.write(` int32`);
        }

        writer.writeLine(`const (`);
        writer.indent(() => {
            const members = node.getMembers();
            const nameMapping = new Map<string, string>();
            for (const member of members) {
                const memberName = getNameOfNamed(member);
                nameMapping.set(memberName, `${enumName}${memberName}`);
            }
            const replacements = [...nameMapping.entries()].sort((a, b) => b[0].length - a[0].length);

            for (let i = 0; i < members.length; i++) {
                const member = members[i];
                const memberName = nameMapping.get(getNameOfNamed(member))!;
                writer.write(`${memberName} `);
                const initializer = member.getInitializer();
                if (i === 0 && !initializer) {
                    writer.write(`${enumName} = iota`);
                }
                else if (initializer) {
                    let initializerText = initializer.getText();

                    for (const [name, value] of replacements) {
                        initializerText = initializerText.replaceAll(name, value);
                    }

                    writer.write(`${enumName} = ${initializerText}`);
                }
                writer.newLine();
            }
        });
        writer.writeLine(")");

        writer.newLineIfLastNot();
        return;
    }

    if (Node.isModuleDeclaration(node)) {
        writer.writeLine(todo(node));

        writer.newLineIfLastNot();
        return;
    }

    if (Node.isExpressionStatement(node)) {
        // Handling expressions separately so we _don't_ handle side effect expressions in writeExpression
        visitExpressionStatement(node);
        return;
    }

    if (Node.isReturnStatement(node)) {
        writer.newLineIfLastNot();
        writer.write("return");
        const expression = node.getExpression();
        if (expression) {
            writer.write(" ");
            visitExpression(expression);
        }
        writer.newLine();
        return;
    }

    if (Node.isContinueStatement(node)) {
        writer.write("continue");
        writer.newLine();
        return;
    }

    if (Node.isIfStatement(node)) {
        visitIfStatement(node);
        return;
    }

    if (Node.isForOfStatement(node)) {
        writer.write("for _, ");
        const initializer = node.getInitializer();
        if (Node.isVariableDeclarationList(initializer)) {
            writer.write(getNameOfNamed(initializer.getDeclarations()[0]));
        }
        else {
            writer.write(todo(initializer));
        }
        writer.write(" := range ");
        visitExpression(node.getExpression());
        writer.write(" {");
        writer.indent(() => {
            visitStatement(node.getStatement());
        });
        writer.write("}");
        writer.newLineIfLastNot();
        return;
    }

    if (Node.isForStatement(node)) {
        const initializer = node.getInitializer();
    }

    if (Node.isBlock(node)) {
        visitBlock(node);
        return;
    }

    writer.writeLine(todo(node));
    // console.error(`Unhandled node kind: ${node.getKindName()}`);
}

sourceFile.forEachChild(node => {
    if (Node.isStatement(node)) {
        return visitStatement(node);
    }
    writer.writeLine(todo(node));
});

const outFile = Bun.file("output.go.txt");

await Bun.write(outFile, writer.toString());

const formatted = await execa("gofmt", ["output.go.txt"], { reject: false });
if (formatted.exitCode === 0) {
    await Bun.write(outFile, formatted.stdout);
    console.log("All good!");
}
else {
    console.log(formatted.stderr);
}
