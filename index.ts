import { Project } from "ts-morph";

const project = new Project({
    tsConfigFilePath: "/home/jabaile/work/TypeScript/src/compiler/tsconfig.json",
});

console.log(project.getSourceFiles().map(sf => sf.getFilePath()));
