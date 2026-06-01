"use strict";

const { analyzePayroll } = require("../sync_lark_payroll");
const { handlePayrollRequest } = require("./_shared");

module.exports = async function handler(request, response) {
  await handlePayrollRequest(request, response, analyzePayroll);
};
