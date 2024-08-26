import assert from "assert";
import path from "path";
import { Node, Project, ts } from "ts-morph";

const root = "/home/jabaile/work/TypeScript/src/compiler";
function pathFor(s: string) {
    return path.join(root, s);
}

const project = new Project({
    tsConfigFilePath: pathFor("tsconfig.json"),
});

const sourceFile = project.getSourceFileOrThrow(pathFor("scanner.ts"));

sourceFile.forEachDescendant((node, traversal) => {
    if (Node.isImportDeclaration(node)) {
        traversal.skip();
        return;
    }

    if (Node.isTypeAliasDeclaration(node)) {
        let str = `type ${node.getName()}`;

        const typeParameters = node.getTypeParameters();
        if (typeParameters.length > 0) {
            str += "[";

            for (let i = 0; i < typeParameters.length; i++) {
                const typeParameter = typeParameters[i];
                str += typeParameter.getName();

                if (typeParameter.getConstraint() !== undefined) {
                    str += ` ${typeParameter.getConstraint()}`;
                }

                if (i < typeParameters.length - 1) {
                    str += ", ";
                }
            }

            str += "]";
        }

        str += " ";

        const type = node.getType();
        const props = type.getProperties();
        const sigs = type.getCallSignatures();
        if (sigs.length > 0) {
            assert(props.length === 0);
            if (sigs.length !== 1) {
                str += "any // TODO";
            }
            else {
                const sig = sigs[0];
                str += "func(";
                const params = sig.getParameters();
                for (let i = 0; i < params.length; i++) {
                    const param = params[i];
                    const decl = param.getValueDeclarationOrThrow();
                    assert(Node.isParameterDeclaration(decl));
                    str += `${param.getName()}: ${convertType(decl.getTypeNodeOrThrow().getText())}`;
                    if (i < params.length - 1) {
                        str += ", ";
                    }
                }
                str += ")";
                const ret = sig.getReturnType();
                if (!ret.isVoid()) {
                    str += ` => ${convertType(ret.getText())}`;
                }
            }
        }
        else if (props.length > 0) {
            assert(sigs.length === 0);
        }

        console.log(str);
        traversal.skip();
        return;
    }
    else if (Node.isFunctionDeclaration(node)) {
        let str = `func ${node.getName()}(`;
        const params = node.getParameters();
        for (let i = 0; i < params.length; i++) {
            const param = params[i];
            str += `${param.getName()}: ${convertType(param.getTypeNodeOrThrow().getText())}`;
            if (i < params.length - 1) {
                str += ", ";
            }
        }
        str += ")";
        const ret = node.getReturnType();
        if (!ret.isVoid()) {
            str += ` => ${convertType(ret.getText())}`;
        }
        console.log(str);
        traversal.skip();
        return;
    }
    else if (Node.isInterfaceDeclaration(node)) {
        let str = `type ${node.getName()}`;

        const typeParameters = node.getTypeParameters();
        if (typeParameters.length > 0) {
            str += "[";

            for (let i = 0; i < typeParameters.length; i++) {
                const typeParameter = typeParameters[i];
                str += typeParameter.getName();

                if (typeParameter.getConstraint() !== undefined) {
                    str += ` ${typeParameter.getConstraint()}`;
                }

                if (i < typeParameters.length - 1) {
                    str += ", ";
                }
            }

            str += "]";
        }

        str += " {\n";
        const members = node.getMembers();
        for (let i = 0; i < members.length; i++) {
            const member = members[i];
            // console.log(member.getKindName());
            // str += `    ${member.getName()}: ${convertType(member.getTypeNodeOrThrow().getText())};\n`;
        }
        str += "\n";
        str += "}";
        console.log(str);
        traversal.skip();
    }

    throw new Error(`Unhandled node kind: ${node.getKindName()}`);
    traversal.skip();
});

function convertType(type: string) {
    switch (type) {
        case "number":
            return "int";
        case "boolean":
            return "bool";
        default:
            return type;
    }
}
