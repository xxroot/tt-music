"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rendererOffAll = exports.rendererOff = void 0;
exports.rendererSend = rendererSend;
exports.rendererSendSync = rendererSendSync;
exports.rendererInvoke = rendererInvoke;
exports.rendererOn = rendererOn;
exports.rendererOnce = rendererOnce;
function rendererSend(name, params) { }
function rendererSendSync(name, params) { }
async function rendererInvoke(name, params) { return null; }
function rendererOn(name, listener) { }
function rendererOnce(name, listener) { }
const rendererOff = (name, listener) => { };
exports.rendererOff = rendererOff;
const rendererOffAll = (name) => { };
exports.rendererOffAll = rendererOffAll;
