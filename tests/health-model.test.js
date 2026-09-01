import test from "node:test";
import assert from "node:assert/strict";
import {statusFromHealth,aggregate} from "../backend/health-model.js";
test("health thresholds",()=>{assert.equal(statusFromHealth(95),"ok");assert.equal(statusFromHealth(75),"warn");assert.equal(statusFromHealth(20),"bad");});
test("aggregate",()=>{assert.equal(aggregate([{health:100},{health:80}]).health,90);});
