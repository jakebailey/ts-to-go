import assert from "assert";
import CodeBlockWriter from "code-block-writer";
import { execa } from "execa";
import path from "path";
import { Expression, type ForEachDescendantTraversalControl, Node, Project, ts, Type, TypeNode } from "ts-morph";

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

function todo(node: { getText(): string; }): string {
    let text = node.getText();
    text = text.replaceAll("*/", "* /");
    return `/* TODO: ${text} */`;
}

function writeType(node: Type) {
    return `TODO ${todo(node)}`;
}

function writeTypeNode(type: TypeNode) {
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
        writer.write("void");
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
            writer.write(`TODO ${todo(name)}`);
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
    else {
        writer.write(`TODO ${todo(type)}`);
    }
}

function writeExpression(node: Expression) {
    if (Node.isRegularExpressionLiteral(node)) {
        const re = node.getLiteralValue();
        let source = re.source.replaceAll("`", "\\`");

        for (const flag of re.flags.split("")) {
            switch (flag) {
                case "i":
                    source = `(?i:${source})`;
                    break;
                default:
                    writer.write(`TODO ${todo(node)}`);
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
        writer.write(` /* as ${node.getTypeNodeOrThrow().getText()} */`);
    }
    else {
        writer.write(`TODO ${todo(node)}`);
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
    return sanitizeName(node.getName());
}

function visitor(node: Node, traversal: ForEachDescendantTraversalControl) {
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
        writer.conditionalWrite(!node.hasBody(), "// OVERLOAD: ");
        writer.write(`func ${getNameOfNamed(node)}(`);
        const params = node.getParameters();
        for (let i = 0; i < params.length; i++) {
            const param = params[i];
            writer.write(getNameOfNamed(param));
            writer.write(" ");
            writeTypeNode(param.getTypeNodeOrThrow());
            writer.conditionalWrite(i < params.length - 1, ", ");
        }
        writer.write(")");
        const ret = node.getReturnType();
        if (!ret.isVoid()) {
            const retNode = node.getReturnTypeNode();
            if (retNode) {
                writer.write(` `);
                writeTypeNode(retNode);
            }
            else {
                writeType(ret);
            }
        }
        if (node.hasBody()) {
            writer.block(() => {
                writer.writeLine(todo(node.getBodyOrThrow()));
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
        writer.newLine();
        traversal.skip();
        return;
    }

    if (Node.isVariableStatement(node)) {
        const isGlobal = node.getParentIf((p): p is Node => Node.isSourceFile(p)) !== undefined;

        const declarations = node.getDeclarations();

        for (const declaration of declarations) {
            const typeNode = declaration.getTypeNode();
            if (typeNode) {
                writer.write(`var ${getNameOfNamed(declaration)}`);
                writer.write(" ");
                writeTypeNode(typeNode);
            }
            else {
                if (isGlobal) {
                    writer.write(`var ${getNameOfNamed(declaration)}`);
                }
                else {
                    writer.write(`${getNameOfNamed(declaration)}`);
                }
            }

            const initializer = declaration.getInitializer();
            if (initializer) {
                writer.write(` ${isGlobal ? "=" : ":="} `);
                writeExpression(initializer);
            }
        }

        if (declarations.length > 1) {
            writer.writeLine(")");
        }

        writer.newLineIfLastNot();
        writer.newLine();
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
        writer.newLine();
        traversal.skip();
        return;
    }

    if (Node.isModuleDeclaration(node)) {
        // TODO
        writer.writeLine(todo(node));

        writer.newLineIfLastNot();
        writer.newLine();
        traversal.skip();
        return;
    }

    if (Node.isClassDeclaration(node)) {
        writer.write(`type ${getNameOfNamed(node)} struct`);

        writer.block(() => {
            writer.writeLine(todo(node));
        });

        writer.newLineIfLastNot();
        writer.newLine();
        traversal.skip();
        return;
    }

    if (node.getKindName() === "EndOfFileToken") {
        return;
    }

    traversal.stop();
    return `Unhandled node kind: ${node.getKindName()}`;
}

const result = sourceFile.forEachDescendant(visitor);

if (result) {
    console.error(result);
}

const output = Bun.file("output.go.txt");

await Bun.write(output, writer.toString());

const goResult = await execa("go", ["run", "check.go"], { stdio: "inherit" });
if (goResult.exitCode === 0) {
    console.log("All good!");
}
