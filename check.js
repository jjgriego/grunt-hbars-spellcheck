/* hbars-spellcheck/check.js
 *
 * Performs spell-checking of Handlebars templates.
 *
 * Author : Joseph Griego
 * Original date : 2015 Jan 09
 */

var Handlebars = require("handlebars");
var util       = require("util");
var _          = require("underscore");
var SpellCheck = require("spellcheck");

var spell = new SpellCheck(__dirname + "/en_US/en_US.aff", __dirname + "/en_US/en_US.dic");

var check = {};

/**
 * extractText : HandlebarsAST -> [String]
 *
 * Given a AST from a Handlebars template, extract all plain text blocks.
 * Note that this will leave all HTML tags intact. If a handlebars template
 * block intercedes an HTML tag, then that tag will be split.
 *
 * Roughly equivalent to removing everything between {{}} from the original file
 */
var extractText = function(ast) {
  var queue = ast.statements.reverse();
  var text = [];

  while (queue.length > 0) {
    var ast0 = queue.pop();
    if (ast0.type === 'content') {
      text.push({ line: ast0.firstLine
                , column: ast0.firstColumn});
      text = text.concat(ast0.original.split(''));
    }
    else if (ast0.type === 'block') {
      if (ast0.inverse) {
        ast0.inverse.statements.reverse().forEach(function(item) {
          queue.push(item);
        });
      }
      if (ast0.program) {
        ast0.program.statements.reverse().forEach(function(item) {
          queue.push(item);
        });
      }
    }
  }
  return text;
}

/* yankWords : [Either Char LocationInfo] String -> [TemplateWord]
 *
 * TemplateWord := { word   : String
 *                 , line   : Int
 *                 , column : Int
 *                 , source : String
 *                 }
 *
 * Pulls words out of a de-handlebar'd template and annotates them with
 * source/location information
 */
var yankWords = function(text, source) {

  // Rough outline:
  // We get a list of characters in the template with source information.
  //
  // We'll use a FSM to walk this list and keep track of where the words are
  // that we care about; tracking source information as we go

  var textIdx = 0;

  var line = 1;
  var col  = 0;

  /* nextChar : IO Char
   * Get the next char from text */
  var nextChar = function() {
    var c         = text[textIdx];
    textIdx += 1;
    if (c.line) {
      emptyPushback();
      line = c.line;
      col  = c.column;
      return nextChar();
    }
    else {
      return c;
    }
  };

  var words = []; // : [String]
  var pushback = []; // : [Char]

  var getPushback = function () {
    if (pushback.length === 0) {
      return "";
    }
    var s = "";
    pushback.forEach(function(char) {
      s = s.concat(char);
    });
    return s;
  }


  /* emptyPushback : IO ()
   * Clear pushed back chars and dump them in words */
  var emptyPushback = function() {
    var s = getPushback();
    words.push({ word: s
               , line: line
               , column: col - s.length
               , source: source });
    pushback = [];
  };

  var checkSkipTag = function() {
    switch ( getPushback() ) {
      case "script":
      case "style": return true;
      default:      return false;
    }
  }

  /* pushAlpha : Char -> IO ()
   * Pushes a char onto pushback
   */
  var pushAlpha = function(char) {
    pushback.push(char);
  }

  /* State/transitions to drive the FSM */
  var transitions = {
    "outside-tags": function(char, kind) {
      switch (kind) {
        case ">":        /* error? */
                         return "outside-tags"
                         break;

        case "<":        emptyPushback();
                         return "tag-open";
                         break;

        case "alphanum": pushAlpha(char);
                         return "outside-tags";
                         break;

        case "other":    emptyPushback();
                         if (char === "&")
                           return "entity-outside";
                         else
                           return "outside-tags";
                         break;
      }
    },

    "tag-open": function(char, kind) {
      switch(kind) {
        case "alphanum": pushAlpha(char);
                         return "tag-open";
        case ">":
          if (checkSkipTag()) {
            pushback = [];
            return "skipped-body";
          }
          else {
            pushback = [];
            return "outside-tags";
          }
        default:
          if (checkSkipTag()) {
            pushback = [];
            return "inside-skipped-tag";
          }
          else {
            pushback = [];
            return "inside-tags";
          }
      }
    },

    "skipped-body": function(char, kind) {
      if (char === "<")
        return "skipped-body2";
      else
        return "skipped-body";
    },

    "skipped-body2": function(char,kind) {
      if (char === "/")
        return "inside-tags";
      else
        return "skipped-body";
    },

    "inside-skipped-tag": function(char, kind) {
      switch (kind) {
        case ">": return "skipped-body";
        default:  return "inside-skipped-tag";
      }
    },

    "inside-tags": function(char, kind) {
      switch (kind) {
        case ">":        return "outside-tags"
                         break;

        case "<":        /* error? */
                         return "inside-tags"
                         break;
        case "alphanum":
        case "other":
                         if (char === "&")
                           return "entity-inside";
                         else
                           return "inside-tags";
      }
    },

    "entity-inside": function(char, kind) {
      if (char === ";") 
        return "inside-tags";
      else
        return "entity-inside";
    },

    "entity-outside": function(char, kind) {
      if (char === ";")
        return "outside-tags";
      else
        return "entity-outside";
    }
  };

  var state = "outside-tags";

  // This is our hot loop.
  // Walk through the input and pass characters into our transition function.
  while (textIdx < text.length) {
    var c = nextChar();
    var type = "other";

    if (c.match(/\n/)) {
      emptyPushback();
      line += 1;
      col = 0;
    } else {
      col += 1;

    }

    if (c.match(/['’a-zA-Z0-9]/)) {
      if (c === "’") // apostrophe ’ U+2019
        c = "'"      // needs to be single-quote for spellchecker
      type = "alphanum";
    }

    if (c === "<" || c === ">") {
      type = c;
    }

    state = transitions[state](c, type);
  }
  return words;
}

/* findCorrections : [TemplateWord] (Correction -> IO ()) -> IO ()
 *
 * Finds spelling errors in the given word list, reporting spelling corrections
 * as 
 *
 * Correction := { original : String
 *               , suggestions : [String]
 *               , line : Int
 *               , column : Int }
 *
 * to a callback function that can then report the spelling error to the console
 */
var findCorrections = function (words, onCorrection, done) {
  var whenDone = _.after(words.length, done);
  words.forEach(function(word) {
    spell.check(word.word, function(err, correct, suggestions) {
      if (err) {
        console.log(err);
        throw err;
      }
      if (!correct) {
        onCorrection({ original: word.word
                     , suggestions: suggestions
                     , line: word.line
                     , source: word.source
                     , column: word.column});
      }
      whenDone();
    })
  });
}

/* checkTemplate : String String (Correction -> IO ()) -> IO ()
 *
 * Check a template, passing spelling corrections to the given callback
 * `onCorrection'
 */
var checkTemplate = function(template, sourceName, onCorrection, done) {
  findCorrections( yankWords( extractText( Handlebars.parse(template) )
                            , sourceName )
                 , onCorrection
                 , done);
}

var allWords = function(template, source) {
  return yankWords( extractText( Handlebars.parse(template) ), source);
}

//checkTemplate(sampleTemplate, "sample", console.log);

module.exports = {
  parse: Handlebars.parse,
  extractText: extractText,
  checkTemplate: checkTemplate,
  allWords: allWords
}

