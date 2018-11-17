import {File, FunctionDeclaration, isFunctionDeclaration} from '@babel/types';
import {i32, Module} from 'binaryen';
import {ArrayLiteralVisitor} from './array_literal_visitor';
import {DeclarationVisitor, VariableMapping} from './declaration_visitor';
import GeneratorVisitor from './generator_visitor';
import {MemoryAccessVisitor} from './memory_access_visitor';

class Generator {

    public static generate(file: File): Module {
        const module = new Module();

        const isMemoryDependent = file.program.body.some((statement) => {
            return isFunctionDeclaration(statement) && new MemoryAccessVisitor().run(statement);
        });

        if (isMemoryDependent) {
            module.addMemoryImport('0', 'transpilerImports', 'memory');
        }

        const arrayLiteralVisitor = new ArrayLiteralVisitor();

        file.program.body.forEach((statement) => {
            if (!isFunctionDeclaration(statement)) {
                throw new Error('File can only contain function declarations');
            }

            this.generateFunction(module, statement, arrayLiteralVisitor);
        });

        if (isMemoryDependent) {
            module.addMemoryExport('0', 'memory');
        }

        return module;
    }

    public static generateFunction(module: Module,
                                   tree: FunctionDeclaration,
                                   arrayLiteralVisiotr: ArrayLiteralVisitor) {

        if (tree.id === null) {
            throw new Error('Function expression has to have a name in order to be translated');
        }

        const functionName = tree.id.name;

        const [parameterMapping, variableMapping] = new DeclarationVisitor().run(tree);
        const localArrayPointers = arrayLiteralVisiotr.run(tree, variableMapping);

        const totalMapping = Generator.mergeMappings(parameterMapping, variableMapping);
        const variables = new Array(variableMapping.size).fill(i32);
        const parameters = new Array(parameterMapping.size).fill(i32);

        const generatorVisitor = new GeneratorVisitor(module, totalMapping, localArrayPointers);
        const body = generatorVisitor.run(tree);

        const functionType = module.addFunctionType(functionName, i32, parameters);
        module.addFunction(functionName, functionType, variables, body);
        module.addFunctionExport(functionName, functionName);
    }

    private static mergeMappings(first: VariableMapping,
                                 second: VariableMapping): VariableMapping {
        return new Map([...first, ...second]);
    }

}

export default Generator;
