/*
 * grunt-hbars-spellcheck
 * https://github.com/jgriego/hbars-spellcheck
 *
 * Copyright (c) 2015 Joseph Griego
 * Licensed under the MIT license.
 */

var check = require("../check.js");
var util = require("util");
var _ = require("underscore");
var colors = require("colors");

//'use strict';


module.exports = function(grunt) {
  var reportSpellingError = function (correction) {
    //grunt.log.writeln(util.inspect(correction))
    //grunt.log.writeln(grunt.file.read(correction.source))
    grunt.log.warn("File ".concat(correction.source).concat(":").concat(correction.line));
    grunt.log.warn(correction.original);
    var line = grunt.file.read(correction.source).split('\n')[correction.line - 1].replace(/\t/g, " ")
    grunt.log.warn("> ".concat(line));
    var underline = Array(correction.original.length + 1).join('^')
    grunt.log.warn(Array(correction.column).join(' ').concat("  ").concat(underline).red);

    grunt.log.warn("Suggestions: ".concat(correction.suggestions));
    grunt.log.writeln("");



  }

  grunt.registerMultiTask('hbars_spellcheck', 'Spellchecking for Handlebars templates', function() {
    // Merge task-specific and/or target-specific options with these defaults.
    var options = this.options({
      punctuation: '.',
      separator: ', '
    });

    var done = this.async();
    var fileSuccess = _.after(this.filesSrc.length, done);
    // Iterate over all specified file groups.
    this.filesSrc.forEach(function(filepath) {
      if (!grunt.file.exists(filepath)) {
        grunt.log.warn('Source file "' + filepath + '" not found.');
        return;
      } 
      check.checkTemplate( grunt.file.read(filepath), filepath, reportSpellingError, fileSuccess);
      grunt.log.writeln('File "' + filepath + '" checked.');
    });
  });

};
