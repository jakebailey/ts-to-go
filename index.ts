import assert from "assert";
import CodeBlockWriter from "code-block-writer";
import path from "path";
import { type ForEachDescendantTraversalControl, Node, Project, ts, TypeNode } from "ts-morph";

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

function visitor(node: Node, traversal: ForEachDescendantTraversalControl) {
    if (Node.isImportDeclaration(node)) {
        traversal.skip();
        return;
    }

    if (Node.isTypeAliasDeclaration(node)) {
        writer.write(`type ${node.getName()}`);

        const typeParameters = node.getTypeParameters();
        if (typeParameters.length > 0) {
            writer.write("[");

            for (let i = 0; i < typeParameters.length; i++) {
                const typeParameter = typeParameters[i];
                writer.write(typeParameter.getName());
                writer.conditionalWrite(typeParameter.getConstraint() !== undefined, () => ` ${typeParameter.getConstraintOrThrow().getText()}`);
                writer.conditionalWrite(i < typeParameters.length - 1, ", ");
            }

            writer.write("]");
        }

        writer.write(" ");

        const type = node.getType();
        const props = type.getProperties();
        const sigs = type.getCallSignatures();
        if (sigs.length > 0) {
            assert(props.length === 0);
            if (sigs.length !== 1) {
                writer.write(todo(type));
            }
            else {
                const sig = sigs[0];
                const decl = sig.getDeclaration();
                assert(Node.isFunctionTypeNode(decl));

                writer.write("func(");
                const params = decl.getParameters();
                for (let i = 0; i < params.length; i++) {
                    const param = params[i];
                    writer.write(`${param.getName()} ${param.getTypeNodeOrThrow().getText()}`);
                    writer.conditionalWrite(i < params.length - 1, ", ");
                }
                writer.write(")");
                const ret = sig.getReturnType();
                if (!ret.isVoid()) {
                    writer.write(` ${decl.getReturnTypeNodeOrThrow().getText()}`);
                }
            }
        }
        else if (props.length > 0) {
            assert(sigs.length === 0);
        }

        writer.newLineIfLastNot();
        traversal.skip();
        return;
    }

    if (Node.isFunctionDeclaration(node)) {
        writer.conditionalWrite(!node.hasBody(), "// OVERLOAD: ");
        writer.write(`func ${node.getName()}(`);
        const params = node.getParameters();
        for (let i = 0; i < params.length; i++) {
            const param = params[i];
            writer.write(`${param.getName()} ${param.getTypeNodeOrThrow().getText()}`);
            writer.conditionalWrite(i < params.length - 1, ", ");
        }
        writer.write(")");
        const ret = node.getReturnType();
        if (!ret.isVoid()) {
            const retNode = node.getReturnTypeNode();
            if (retNode) {
                writer.write(` ${retNode.getText()}`);
            }
            else {
                writer.write(` /* TODO: inferred */ ${ret.getText()}`);
            }
        }
        if (node.hasBody()) {
            writer.block(() => {
                // TODO
            });
        }

        writer.newLineIfLastNot();
        traversal.skip();
        return;
    }

    if (Node.isInterfaceDeclaration(node)) {
        writer.write(`type ${node.getName()}`);

        const typeParameters = node.getTypeParameters();
        if (typeParameters.length > 0) {
            writer.write("[");

            for (let i = 0; i < typeParameters.length; i++) {
                const typeParameter = typeParameters[i];
                writer.write(typeParameter.getName());
                writer.conditionalWrite(typeParameter.getConstraint() !== undefined, () => ` ${typeParameter.getConstraintOrThrow().getText()}`);
                writer.conditionalWrite(i < typeParameters.length - 1, ", ");
            }

            writer.write("]");
        }

        writer.block(() => {
            const members = node.getMembers();
            for (const member of members) {
                // writer.write(`${member.getName()}: ${member.getTypeNodeOrThrow().getText()};`);
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
                writer.write(`var ${declaration.getName()} ${typeNode.getText()}`);
            }
            else {
                if (isGlobal) {
                    writer.write(`var ${declaration.getName()}`);
                }
                else {
                    writer.write(`${declaration.getName()}`);
                }
            }

            const initializer = declaration.getInitializer();
            if (initializer) {
                writer.write(` ${isGlobal ? "=" : ":="} ${todo(initializer)}`);
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
        const enumName = node.getName();

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
                const memberName = member.getName();
                nameMapping.set(memberName, `${enumName}${memberName}`);
            }
            const replacements = [...nameMapping.entries()].sort((a, b) => b[0].length - a[0].length);

            let canOmitType = false;

            for (let i = 0; i < members.length; i++) {
                const member = members[i];
                const memberName = nameMapping.get(member.getName())!;
                writer.write(`${memberName} `);
                const initializer = member.getInitializer();
                if (i === 0 && !initializer) {
                    writer.write(`${enumName} = iota`);
                    canOmitType = true;
                }
                else if (initializer) {
                    let initializerText = initializer.getText();

                    for (const [name, value] of replacements) {
                        initializerText = initializerText.replaceAll(name, value);
                    }

                    writer.write(`${enumName} = ${initializerText}`);
                    canOmitType = false;
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
        writer.write(`// namespace ${node.getName()}`);

        writer.newLineIfLastNot();
        writer.newLine();
        traversal.skip();
        return;
    }

    if (Node.isClassDeclaration(node)) {
        writer.write(`type ${node.getName()} struct`);

        writer.block(() => {
            const members = node.getMembers();
            for (const member of members) {
                // writer.write(`${member.getName()}: ${member.getTypeNodeOrThrow().getText()};`);
            }
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
