import {
    AssignmentExpression,
    BinaryExpression,
    BlockStatement,
    BooleanLiteral,
    CallExpression,
    Expression as BabelExpression,
    ExpressionStatement,
    ForStatement,
    FunctionDeclaration,
    Identifier,
    IfStatement,
    isAssignmentExpression,
    isIdentifier,
    isMemberExpression,
    isUpdateExpression,
    LogicalExpression,
    LVal,
    MemberExpression,
    NumericLiteral,
    ReturnStatement,
    UnaryExpression,
    UpdateExpression,
    VariableDeclarator,
    WhileStatement,
} from '@babel/types';
import {Expression, i32, Module, Statement} from 'binaryen';
import Visitor from '../visitor';
import {VariableMapping} from './declaration_visitor';
import {ExpressionTypes} from './type_inference_visitor';
import {toBinaryenType, WebAssemblyType} from './wasm_type';

class GeneratorVisitor extends Visitor {

    private readonly module: Module;
    private readonly variableMapping: VariableMapping;
    private readonly expressionTypes: ExpressionTypes;

    private statements: Statement[] = [];
    private expressions: Expression[] = [];

    private labelCounter: number = 0;

    constructor(module: Module,
                variableMapping: VariableMapping,
                expressionType: ExpressionTypes) {

        super();
        this.module = module;
        this.variableMapping = variableMapping;
        this.expressionTypes = expressionType;
    }

    public run(tree: FunctionDeclaration): Statement {
        this.visit(tree.body);
        return this.popStatement();
    }

    protected visitIdentifier(node: Identifier) {
        const index = this.getVariableIndex(node.name);

        this.expressions.push(this.module.getLocal(index, toBinaryenType(this.getExpressionType(node))));
    }

    protected visitNumericLiteral(node: NumericLiteral) {
        this.expressions.push(this.getOperationsInstance(node).const(node.value));
    }

    protected visitBooleanLiteral(node: BooleanLiteral) {
        this.expressions.push(this.module.i32.const(node.value ? 1 : 0));
    }

    protected visitReturnStatement(node: ReturnStatement) {
        super.visitReturnStatement(node);

        const returnStatement = this.module.return(this.expressions.pop());
        this.statements.push(returnStatement);
    }

    protected visitUnaryExpression(node: UnaryExpression) {
        super.visitUnaryExpression(node);

        const operand = this.popExpression();

        switch (node.operator) {
            case '+':
                this.expressions.push(operand);
                break;
            case '-':
                this.expressions.push(this.module.i32.sub(this.module.i32.const(0), operand));
                break;
            case '!':
                this.expressions.push(this.module.i32.eqz(operand));
                break;
            default:
                throw new Error(`Unhandled operator ${node.operator}`);
        }
    }

    protected visitBinaryExpression(node: BinaryExpression) {
        super.visitBinaryExpression(node);

        const right = this.popExpression();
        const left = this.popExpression();

        switch (node.operator) {
            case '+':
                this.expressions.push(this.module.i32.add(left, right));
                break;
            case '-':
                this.expressions.push(this.module.i32.sub(left, right));
                break;
            case '*':
                this.expressions.push(this.module.i32.mul(left, right));
                break;
            case '/':
                this.expressions.push(this.module.i32.div_s(left, right));
                break;
            case '%':
                this.expressions.push(this.module.i32.rem_s(left, right));
                break;
            case '==':
                this.expressions.push(this.module.i32.eq(left, right));
                break;
            case '!=':
                this.expressions.push(this.module.i32.ne(left, right));
                break;
            case '<':
                this.expressions.push(this.module.i32.lt_s(left, right));
                break;
            case '<=':
                this.expressions.push(this.module.i32.le_s(left, right));
                break;
            case '>':
                this.expressions.push(this.module.i32.gt_s(left, right));
                break;
            case '>=':
                this.expressions.push(this.module.i32.ge_s(left, right));
                break;
            default:
                throw new Error(`Unhandled operator ${node.operator}`);
        }
    }

    protected visitLogicalExpression(node: LogicalExpression) {
        super.visitLogicalExpression(node);

        const right = this.popExpression();
        const left = this.popExpression();

        switch (node.operator) {
            case '&&':
                this.expressions.push(this.module.select(left, right, this.module.i32.const(0)));
                break;
            case '||':
                this.expressions.push(this.module.select(left, this.module.i32.const(1), right));
                break;
            default:
                throw new Error(`Unhandled operator ${node.operator}`);
        }
    }

    protected visitUpdateExpression(node: UpdateExpression) {
        super.visitUpdateExpression(node);

        const currentValue = this.popExpression();
        let updatedValue;

        switch (node.operator) {
            case '++':
                updatedValue = this.module.i32.add(currentValue, this.module.i32.const(1));
                break;
            case '--':
                updatedValue = this.module.i32.sub(currentValue, this.module.i32.const(1));
                break;
            default:
                throw new Error(`Unhandled operator ${node.operator}`);
        }

        if (isIdentifier(node.argument)) {
            this.statements.push(this.setLocal(node.argument, updatedValue));
        } else if (isMemberExpression(node.argument)) {
            this.statements.push(this.setArrayElement(node.argument, updatedValue));
        } else {
            throw new Error('An update is only allowed on an identifier or a member access');
        }
    }

    protected visitIfStatement(node: IfStatement) {
        this.visit(node.test);
        const condition = this.popExpression();

        this.visit(node.consequent);

        const ifPart = this.popStatement();
        let elsePart;

        if (node.alternate !== null) {
            const previousStatements = this.statements;
            this.statements = [];

            this.visit(node.alternate);
            elsePart = this.popStatement();

            this.statements = previousStatements;
        }

        const ifStatement = this.module.if(condition, ifPart, elsePart);

        this.statements.push(ifStatement);
    }

    protected visitBlockStatement(node: BlockStatement) {
        const previousStatements = this.statements;
        this.statements = [];

        super.visitBlockStatement(node);

        const block = this.module.block('', this.statements);
        this.statements = previousStatements;
        this.statements.push(block);
    }

    protected visitVariableDeclarator(node: VariableDeclarator) {
        if (node.init !== null) {
            this.visit(node.init);
            this.handleAssignment(node.id);
        }
    }

    protected visitAssignmentExpression(node: AssignmentExpression) {
        this.visit(node.right);

        if (node.operator !== '=') {
            this.handleShorthandAssignment(node);
        }

        this.handleAssignment(node.left);
    }

    protected visitWhileStatement(node: WhileStatement) {
        super.visitWhileStatement(node);
        this.statements.push(this.createLoopStatement(this.popExpression()));
    }

    protected visitForStatement(node: ForStatement) {
        super.visitForStatement(node);

        let updateStatement;

        if (node.update !== null) {
            updateStatement = this.popStatement();
        }

        let condition = this.module.i32.const(1);

        if (node.test !== null) {
            condition = this.popExpression();
        }

        this.statements.push(this.createLoopStatement(condition, updateStatement));
    }

    protected visitCallExpression(node: CallExpression): void {
        if (!isIdentifier(node.callee)) {
            throw new Error('Callee is not an identifier');
        }

        const parameterExpressions = [];

        for (const argument of node.arguments) {
            this.visit(argument);
            parameterExpressions.push(this.popExpression());
        }

        this.expressions.push(this.module.call(node.callee.name, parameterExpressions, i32));
    }

    protected visitExpressionStatement(node: ExpressionStatement) {
        super.visitExpressionStatement(node);

        // Update and assignment expressions already generate a complete statement
        if (!isUpdateExpression(node.expression) && !isAssignmentExpression((node.expression))) {
            this.statements.push(this.module.drop(this.popExpression()));
        }
    }

    protected visitMemberExpression(node: MemberExpression) {
        if (node.computed) {
            this.expressions.push(this.getArrayElement(node));
        } else {
            const identifier = node.property;

            if (identifier.name === 'length') {
                this.expressions.push(this.getArrayLength(node));
            } else {
                throw new Error(`Unknown property ${identifier}`);
            }
        }
    }

    private popExpression() {
        const expression = this.expressions.pop();

        if (expression === undefined) {
            throw new Error('Expression is undefined');
        }

        return expression;
    }

    private popStatement() {
        const statement = this.statements.pop();

        if (statement === undefined) {
            throw new Error('Statement is undefined');
        }

        return statement;
    }

    private handleShorthandAssignment(node: AssignmentExpression) {
        this.visit(node.left);
        const currentValue = this.popExpression();
        const assignedValue = this.popExpression();

        switch (node.operator) {
            case '+=':
                this.expressions.push(this.module.i32.add(currentValue, assignedValue));
                break;
            case '-=':
                this.expressions.push(this.module.i32.sub(currentValue, assignedValue));
                break;
            case '*=':
                this.expressions.push(this.module.i32.mul(currentValue, assignedValue));
                break;
            case '/=':
                this.expressions.push(this.module.i32.div_s(currentValue, assignedValue));
                break;
            default:
                throw new Error(`Unhandled operator ${node.operator}`);
        }
    }

    private handleAssignment(val: LVal) {
        const value = this.popExpression();

        if (isIdentifier(val)) {
            this.statements.push(this.setLocal(val, value));
        } else if (isMemberExpression(val)) {
            this.statements.push(this.setArrayElement(val, value));
        } else {
            throw new Error('Assignment to non-identifier or member expression');
        }
    }

    private createLoopStatement(condition: Expression, update?: Statement) {
        const endLabel = this.generateLabel();
        const beginLabel = this.generateLabel();

        const conditionBranch = this.module.br_if(endLabel, this.module.i32.eqz(condition));
        const loopBranch = this.module.br(beginLabel);
        const loopBody = this.popStatement();

        const children: Statement[] = [conditionBranch, loopBody];

        if (update !== undefined) {
            children.push(update);
        }

        children.push(loopBranch);

        const loopBlock = this.module.block(endLabel, children);
        return this.module.loop(beginLabel, loopBlock);
    }

    private setLocal(val: Identifier, value: Expression) {
        return this.module.set_local(this.getVariableIndex(val.name), value);
    }

    private getArrayElement(node: MemberExpression) {
        super.visitMemberExpression(node);

        const type = this.getExpressionType(node);

        switch (type) {
            case WebAssemblyType.INT_32:
                return this.module.i32.load(0, 4, this.getPointer(4));
            case WebAssemblyType.FLOAT_64:
                return this.module.f64.load(0, 8, this.getPointer(8));
            default:
                throw new Error(`Unknown type of member expression: ${type}`);
        }
    }

    private getArrayLength(node: MemberExpression) {
        this.visit(node.object);

        const type = this.getExpressionType(node.object);

        switch (type) {
            case WebAssemblyType.INT_32_ARRAY:
                const address = this.module.i32.sub(this.popExpression(), this.module.i32.const(4));
                return this.module.i32.load(0, 4, address);
            case WebAssemblyType.FLOAT_64_ARRAY:
                const address2 = this.module.i32.sub(this.popExpression(), this.module.i32.const(8));
                return this.module.i32.load(0, 4, address2);
            default:
                throw new Error(`Can\'t access length property of unknown type: ${type}`);
        }
    }

    private setArrayElement(memberExpression: MemberExpression, value: Expression): Statement {
        this.visit(memberExpression.object);
        this.visit(memberExpression.property);

        const type = this.getExpressionType(memberExpression.object);

        switch (type) {
            case WebAssemblyType.INT_32_ARRAY:
                // @ts-ignore
                return this.module.i32.store(0, 4, this.getPointer(4), value);
            case WebAssemblyType.FLOAT_64_ARRAY:
                // @ts-ignore
                return this.module.f64.store(0, 8, this.getPointer(8), value);
            default:
                throw new Error(`Can\'t write to array with type: ${type}`);
        }
    }

    private getVariableIndex(name: string) {
        const index = this.variableMapping.get(name);

        if (index === undefined) {
            throw new Error(`Unknown identifier ${name}`);
        }

        return index;
    }

    private getPointer(factor: number) {
        const index = this.popExpression();
        const basePointer = this.popExpression();

        return this.module.i32.add(basePointer, this.module.i32.mul(index, this.module.i32.const(factor)));
    }

    private generateLabel() {
        return 'label_' + this.labelCounter++;
    }

    private getOperationsInstance(expression: BabelExpression) {
        const type = this.getExpressionType(expression);

        if (type === WebAssemblyType.FLOAT_64) {
            return this.module.f64;
        } else {
            return this.module.i32;
        }
    }

    private getExpressionType(expression: BabelExpression) {
        const type = this.expressionTypes.get(expression);

        if (type === undefined) {
            throw new Error(`Expression type of ${expression.type} not defined`);
        }

        return type;
    }
}

export default GeneratorVisitor;
