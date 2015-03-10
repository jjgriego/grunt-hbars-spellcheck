check = require("./check.js")
fs = require("fs")

console.log(check.extractText(check.parse(fs.readFileSync("PostfileDashboard.handlebars").toString())));
