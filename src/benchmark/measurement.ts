import {Timing, Transpiler} from '../transpiler';

// noinspection TsLint
type Algorithm = {
    // noinspection TsLint
    func: Function[],
    arguments: any[],
    expectedResult: any,
};

class Measurement {

    public static measure(algorithm: Algorithm,
                          warmupRounds: number,
                          measureRounds: number): [Timing[], Timing[]] {
        const func = algorithm.func;
        const args = algorithm.arguments;
        const expectedResult = algorithm.expectedResult;

        Measurement.executeJS(func[0], args, expectedResult, warmupRounds);
        const jsTimes = Measurement.executeJS(func[0], args, expectedResult, measureRounds);

        const wasmArgs = args.slice();
        wasmArgs.unshift(func[0].name);

        const wasmAlgorithm = Transpiler.transpile(func.join(''));
        Measurement.executeWasm(wasmAlgorithm, wasmArgs, expectedResult, warmupRounds);
        const wasmTimes = Measurement.executeWasm(wasmAlgorithm, wasmArgs, expectedResult, measureRounds);

        return [jsTimes, wasmTimes];
    }

    // noinspection TsLint
    private static executeJS(algorithm: Function,
                             args: any[],
                             expectedResult: any,
                             rounds: number): Timing[] {
        const times: Timing[] = [];

        for (let i = 0; i < rounds; i++) {
            const start = performance.now();
            const result = algorithm(...args);
            const executionTime = performance.now() - start;

            Measurement.assert(result, expectedResult);

            times.push({
                compilationTime: 0,
                executionTime,
                importTime: 0,
            });
        }

        return times;
    }

    // noinspection TsLint
    private static executeWasm(algorithm: Function,
                             args: any[],
                             expectedResult: any,
                             rounds: number): Timing[] {
        const times: Timing[] = [];

        for (let i = 0; i < rounds; i++) {
            const result = algorithm(...args);
            Measurement.assert(result, expectedResult);

            times.push(Transpiler.getTiming());
        }

        return times;
    }

    private static assert(result: any, expected: any) {
        if (typeof result === 'number' && typeof expected === 'boolean') {
            switch (result) {
                case 0:
                    Measurement.assert(false, expected);
                    break;
                case 1:
                    Measurement.assert(true, expected);
                    break;
                default:
                    console.error(`Assertion failed, expected=${expected}, actual=${result}`);
                    break;
            }
        } else if (result !== expected) {
            console.error(`Assertion failed, expected=${expected}, actual=${result}`);
        }
    }
}

export {Measurement, Algorithm};
