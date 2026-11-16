"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("./utils");
const ignoreErrorMessage = [
    'Possible side-effect in debug-evaluate',
    'Unexpected end of input',
];
process.on('uncaughtException', err => {
    if (ignoreErrorMessage.includes(err?.message))
        return;
    console.error('An uncaught error occurred!');
    console.error(err);
    utils_1.log.error(err);
});
process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at: Promise ', p);
    console.error(' reason: ', reason);
    utils_1.log.error(reason);
});
