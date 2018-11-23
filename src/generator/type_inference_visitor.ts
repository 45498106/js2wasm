import {
    AssignmentExpression, Expression,
    FunctionDeclaration, isArrayExpression,
    isBinaryExpression, isBooleanLiteral, isCallExpression,
    isIdentifier, isLogicalExpression, isMemberExpression,
    isNumericLiteral, isUnaryExpression, ReturnStatement,
    VariableDeclarator,
} from '@babel/types';
import Visitor from '../visitor';
import {FunctionSignature, FunctionSignatures} from './generator';
import {WebAssemblyType} from './wasm_type';

class TypeInferenceVisitor extends Visitor {

    private signatures: FunctionSignatures;
    private variableTypes = new Map<string, WebAssemblyType>();

    public run(tree: FunctionDeclaration,
               signature: FunctionSignature,
               signatures: FunctionSignatures) {

        this.signatures = signatures;
        this.initializeTypes(tree, signature);

        this.visit(tree.body);

        return this.variableTypes;
    }

    protected visitVariableDeclarator(node: VariableDeclarator): void {
        super.visitVariableDeclarator(node);

        if (node.init !== null) {
            if (!isIdentifier(node.id)) {
                throw new Error('Variable declarator contains non-identifier');
            }

            const type = this.getTypeOfExpression(node.init);
            const name = node.id.name;

            if (type === undefined) {
                throw new Error(`Type of variable ${name} could not be inferred`);
            }

            this.variableTypes.set(name, type);
        }
    }

    protected visitAssignmentExpression(node: AssignmentExpression): void {
        super.visitAssignmentExpression(node);

        if (isIdentifier(node.left)) {

            // Only infer type if this assignment determines the type
            if (!this.variableTypes.has(node.left.name)) {
                const type = this.getTypeOfExpression(node.right);

                if (type === undefined) {
                    throw new Error(`Type of variable ${node.left.name} could not be inferred`);
                }

                this.variableTypes.set(node.left.name, type);
            }
        }
    }

    private getTypeOfExpression(expression: Expression) {
        if (isNumericLiteral(expression)) {
            return WebAssemblyType.INT_32;
        } else if (isBinaryExpression(expression)) {
            const operator = expression.operator;

            if (['+', '-', '/', '%', '*'].includes(operator)) {
                return WebAssemblyType.INT_32;
            } else if (['<', '<=', '==', '!=', '>=', '>'].includes(operator)) {
                return WebAssemblyType.BOOLEAN;
            }
        } else if (isLogicalExpression(expression)) {
            return WebAssemblyType.BOOLEAN;
        } else if (isIdentifier(expression)) {
            return this.variableTypes.get(expression.name);
        } else if (isBooleanLiteral(expression)) {
            return WebAssemblyType.BOOLEAN;
        } else if (isUnaryExpression(expression)) {
            if (expression.operator === '!') {
                return WebAssemblyType.BOOLEAN;
            } else if (['+', '-'].includes(expression.operator)) {
                return WebAssemblyType.INT_32;
            }
        } else if (isCallExpression(expression)) {
            if (isIdentifier(expression.callee)) {
                const signature = this.signatures.get(expression.callee.name);

                if (signature === undefined) {
                    throw new Error(`Couldn\'t find signature of function ${expression.callee.name}`);
                }

                return signature.returnType;
            }
            // TODO: Build DAG of function calls and determine the inference order
        } else if (isMemberExpression(expression)) {
            if (expression.computed) {
                return WebAssemblyType.INT_32_ARRAY;
            } else if (isIdentifier(expression.property) && expression.property.name === 'length') {
                return WebAssemblyType.INT_32;
            }
        } else if (isArrayExpression(expression)) {
            return WebAssemblyType.INT_32_ARRAY;
        }
    }

    private initializeTypes(tree: FunctionDeclaration, signature: FunctionSignature) {
        tree.params.forEach((parameter, index) => {
            if (!isIdentifier(parameter)) {
                throw new Error('Parameter is not of type identifier');
            }

            this.variableTypes.set(parameter.name, signature.parameterTypes[index]);
        });
    }
}

export {TypeInferenceVisitor};
