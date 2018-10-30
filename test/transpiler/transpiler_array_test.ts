import {expect} from 'chai';
import Transpiler from '../../src/transpiler';

describe('Transpiler', () => {
    describe('#transpile()', () => {
        it('should handle array access', () => {
            const exports = Transpiler.transpile('function array(arr) { return arr[0]; }');
            expect(exports('array', [1, 2, 3])).to.equal(1);
        });

        it('should handle array access using variable', () => {
            const exports = Transpiler.transpile('function array(arr, i) { return arr[i]; }');
            expect(exports('array', [11, 12, 13], 0)).to.equal(11);
            expect(exports('array', [14, 15, 16], 1)).to.equal(15);
            expect(exports('array', [17, 18, 19], 2)).to.equal(19);
        });

        it('should handle array access using expression', () => {
            const exports = Transpiler.transpile('function array(arr) { return arr[1 + 2]; }');
            expect(exports('array', [101, 102, 103, 104, 105])).to.equal(104);
        });

        it('should handle multiple arrays', () => {
            const exports = Transpiler.transpile('function array(arr, arr2) { return arr2[2]; }');
            expect(exports('array', [111, 112], [114, 115, 116])).to.equal(116);
        });

        it('should handle array size', () => {
            const exports = Transpiler.transpile('function array(arr) { return arr[-1]; }');
            expect(exports('array', [1, 2, 4, 8])).to.equal(4);
        });

        it('should handle indexoutofbounds', () => {
            const exports = Transpiler.transpile('function array(arr, i) { return arr[i]; }');
            expect(exports('array', [1, 2], 2)).to.equal(0);
            expect(() => exports('array', [1, 2], -2)).to.throw();
        });

        it('should not modify array', () => {
            const exports = Transpiler.transpile('function array(arr) { return arr[0]; }');
            const array = [100, 200, 300];
            exports('array', array);
            expect(array[0]).to.equal(100);
            expect(array[1]).to.equal(200);
            expect(array[2]).to.equal(300);
        });

        it('should handle length property', () => {
            const exports = Transpiler.transpile('function length(arr) { return arr.length; }');

            expect(exports('length', [0, 1, 2])).to.equal(3);
            expect(exports('length', [])).to.equal(0);
            expect(exports('length', [1])).to.equal(1);
        });

        it('shouldn\'t handle other properties', () => {
            expect(() => Transpiler.transpile('function something(arr) { return arr.something; }')).to.throw();
        });

        it('should handle writes to array elements', () => {
            const exports = Transpiler.transpile('function setFirst(arr) { arr[0] = 42; return arr[0]; }');

            expect(exports('setFirst', [0, 1, 2])).to.equal(42);
            expect(exports('setFirst', [1])).to.equal(42);
        });

        it('should handle shorthand assignment to array elements', () => {
            const exports = Transpiler.transpile('function setFirst(arr) { arr[0] += 42; return arr[0]; }');

            expect(exports('setFirst', [5, 6, 7])).to.equal(47);
            expect(exports('setFirst', [4])).to.equal(46);
        });
    });
});