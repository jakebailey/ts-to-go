import assert, { rejects } from "assert";
import CodeBlockWriter from "code-block-writer";
import { write } from "console";
import { execa } from "execa";
import { WriteStream } from "fs";
import path, { format } from "path";
import { Expression, type ForEachDescendantTraversalControl, IfStatement, Node, Project, ts, Type, TypeNode } from "ts-morph";

process.stdout.write("\x1B[2J\x1B[3J\x1B[H");

const root = "/home/jabaile/work/TypeScript/src/compiler";
function pathFor(s: string) {
    return path.join(root, s);
}

const project = new Project({
    tsConfigFilePath: pathFor("tsconfig.json"),
});

const sourceFile = project.getSourceFileOrThrow(pathFor("checker.ts"));

const writer = new CodeBlockWriter();

writer.writeLine("package output");
writer.newLine();

type Printable = { getKindName?(): string; getText(): string; };

function todo(node: Printable): string {
    let text = node.getText();
    text = text.replaceAll("*/", "* /");
    text = text.replace(/\r?\n/g, " ");
    return `/* TODO(${node.getKindName?.()}): ${text} */`;
}

function writeType(node: Type): void {
    writer.write(`${todo(node)} TODO`);
}

function writeTypeNode(type: TypeNode): void {
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
            writeTypeNode(param.getTypeNodeOrThrow());
            writer.conditionalWrite(i < params.length - 1, ", ");
        }
        writer.write(") ");
        const ret = type.getReturnTypeNodeOrThrow();
        writeTypeNode(ret);
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
        writeTypeNode(type.getElementTypeNode());
    }
    else if (Node.isTypeOperatorTypeNode(type)) {
        writeTypeNode(type.getTypeNode());
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
                writeTypeNode(typeArguments[i]);
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
                    writeTypeNode(a);
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

function writeExpression(node: Expression): void {
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
        writeExpression(node.getExpression());
        writer.write(` /* as */ ${todo(node.getTypeNodeOrThrow())}`);
    }
    else if (Node.isIdentifier(node)) {
        if (node.getText() === "undefined") {
            writer.write("nil");
        }
        else {
            writer.write(sanitizeName(node.getText()));
        }
    }
    else if (Node.isCallExpression(node)) {
        const expression = node.getExpression();
        writeExpression(expression);
        writer.write("(");
        const args = node.getArguments();
        for (let i = 0; i < args.length; i++) {
            const expr = args[i];
            assert(Node.isExpression(expr));
            writeExpression(expr);
            writer.conditionalWrite(i < args.length - 1, ", ");
        }
        writer.write(")");
    }
    else if (Node.isPrefixUnaryExpression(node)) {
        switch (node.getOperatorToken()) {
            case ts.SyntaxKind.ExclamationToken:
                writer.write("!");
                break;

            default:
                writer.write(`${todo(node)} TODO`);
                return;
        }

        writeExpression(node.getOperand());
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

function writeIfStatement(node: IfStatement) {
    writer.write("if ");
    writeExpression(node.getExpression());
    writer.write(" {");
    writer.indent(() => {
        const thenStatement = node.getThenStatement();
        if (thenStatement) {
            thenStatement.forEachDescendant(visitor);
        }
        writer.newLineIfLastNot();
    });

    const elseStatement = node.getElseStatement();
    if (elseStatement) {
        writer.write("} else ");
        if (Node.isIfStatement(elseStatement)) {
            writeIfStatement(elseStatement);
        }
        else {
            writer.write("{");
            writer.indent(() => {
                elseStatement.forEachDescendant(visitor);
            });
            writer.write("}");
        }
    }
    else {
        writer.write("}");
    }
}

function visitor(node: Node, traversal: ForEachDescendantTraversalControl) {
    if (node.getKindName() === "EndOfFileToken") {
        return;
    }

    writer.newLineIfLastNot();

    if (Node.isImportDeclaration(node)) {
        traversal.skip();
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
                    writeTypeNode(constraint);
                }
                writer.conditionalWrite(i < typeParameters.length - 1, ", ");
            }

            writer.write("]");
        }

        writer.write(" ");
        writeTypeNode(node.getTypeNodeOrThrow());

        writer.newLineIfLastNot();
        traversal.skip();
        return;
    }

    if (Node.isFunctionDeclaration(node)) {
        const isGlobal = node.getParentIf((p): p is Node => Node.isSourceFile(p)) !== undefined;

        writer.conditionalWrite(!node.hasBody(), "// OVERLOAD: ");

        if (!isGlobal) {
            writer.write(`${getNameOfNamed(node)} := func(`);
        }
        else {
            writer.write(`func ${getNameOfNamed(node)}(`);
        }

        const params = node.getParameters();
        for (let i = 0; i < params.length; i++) {
            const param = params[i];
            writer.write(getNameOfNamed(param));
            writer.write(" ");
            const paramType = param.getTypeNode();
            if (paramType) {
                writeTypeNode(paramType);
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
                writeTypeNode(retNode);
            }
            else {
                writeType(ret);
            }
        }
        if (node.hasBody()) {
            writer.block(() => {
                const body = node.getBodyOrThrow();
                body.forEachDescendant(visitor);
            });
        }

        writer.newLineIfLastNot();
        traversal.skip();
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
                    writeTypeNode(constraint);
                }
                writer.conditionalWrite(i < typeParameters.length - 1, ", ");
            }

            writer.write("]");
        }

        writer.block(() => {
            const members = node.getMembers();
            for (const member of members) {
                if (Node.isMethodSignature(member)) {
                    assert.fail("oops");
                }
                else if (Node.isPropertySignature(member)) {
                    writer.write(`${getNameOfNamed(member)} `);
                    writeTypeNode(member.getTypeNodeOrThrow());
                    writer.newLine();
                }
                else {
                    writer.writeLine(todo(member));
                }
            }
        });

        writer.newLineIfLastNot();
        traversal.skip();
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
                    writeTypeNode(typeNode);
                }
                if (initializer) {
                    writer.write(" = ");
                    writeExpression(initializer);
                }
            }
            else {
                if (typeNode) {
                    writer.write(`var ${getNameOfNamed(declaration)} `);
                    writeTypeNode(typeNode);
                    if (initializer) {
                        writer.write(" = ");
                        writeExpression(initializer);
                    }
                }
                else if (initializer) {
                    writer.write(`${getNameOfNamed(declaration)} := `);
                    writeExpression(initializer);
                }
                else {
                    // No annotation or inferred type, comes from something later...
                    writer.write(`var ${getNameOfNamed(declaration)} TODO`);
                }
            }
            writer.newLineIfLastNot();
        }

        writer.newLineIfLastNot();
        traversal.skip();
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
        traversal.skip();
        return;
    }

    if (Node.isModuleDeclaration(node)) {
        // TODO
        writer.writeLine(todo(node));

        writer.newLineIfLastNot();
        traversal.skip();
        return;
    }

    if (Node.isClassDeclaration(node)) {
        writer.write(`type ${getNameOfNamed(node)} struct`);

        writer.block(() => {
            writer.writeLine(todo(node));
        });

        writer.newLineIfLastNot();
        traversal.skip();
        return;
    }

    // if (Node.isExpressionStatement(node)) {
    //     writeExpression(node.getExpression());
    //     writer.newLine();
    //     traversal.skip();
    //     return;
    // }

    if (Node.isReturnStatement(node)) {
        writer.newLineIfLastNot();
        writer.write("return");
        const expression = node.getExpression();
        if (expression) {
            writer.write(" ");
            writeExpression(expression);
        }
        writer.newLine();
        traversal.skip();
        return;
    }

    if (Node.isIfStatement(node)) {
        writeIfStatement(node);
        traversal.skip();
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
        writeExpression(node.getExpression());
        writer.block(() => {
            node.getStatement().forEachDescendant(visitor);
        });
        writer.newLineIfLastNot();
        traversal.skip();
        return;
    }

    if (Node.isForStatement(node)) {
        const initializer = node.getInitializer();
    }

    writer.writeLine(todo(node));
    traversal.skip();
    // console.error(`Unhandled node kind: ${node.getKindName()}`);
}

const result = sourceFile.forEachDescendant(visitor);

if (result) {
    console.error(result);
}

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
