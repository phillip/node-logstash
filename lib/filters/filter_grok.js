var base_filter = require('../lib/base_filter'),
    util = require('util'),
    logger = require('log4node'),
    sysPath = require("path"),
    fs = require('fs'),
    Grok = require('node-grok');

function FilterGrok() {
  base_filter.BaseFilter.call(this);
  this.config = {
    name: 'Grok',
    required_params: ['pattern'],
    optional_params: ['patterns_dir', 'break_on_match', 'named_captures_only', 'keep_empty_captures', 'singles', 'match'],
    default_values: {
      'patterns_dir': [],
      'break_on_match': 'true',
      'named_captures_only': 'true',
      'keep_empty_captures': 'false',
      'singles': 'false',
      'match': {}
    }
  }
}
var RESERVED = ["type", "tags", "add_tag", "remove_tag", "add_field", "exclude_tags",
                "name", "required_params", "optional_params", "default_values"];

util.inherits(FilterGrok, base_filter.BaseFilter);

FilterGrok.prototype.afterLoadConfig = function(callback) {
  if(typeof this.match["@message"] === 'undefined') {
    this.match["@message"] = [];
  }
  if(Array.isArray(this.pattern)) {
    this.pattern = [this.pattern];
  }
  if(this.pattern) {
    this.match["@message"] = this.match["@message"].concat(this.pattern);
  }
      
  this.patternfiles = []
  
  this.base_patterns_path = [sysPath.join(__dirname,"../../patterns/")];

  if(this.patterns_dir.length > 0) {
    for(var valIdx in this.config.patterns_dir) {
      //@logger.info("Adding patterns path: #{val}")
      this.base_patterns_path += this.config.patterns_dir[valIdx].split(":");
    }
  }

  // Have this.base_patterns_path show first. Last-in pattern definitions win; this
  // will let folks redefine built-in patterns at runtime.
  this.patterns_dir = this.base_patterns_path.concat(this.patterns_dir);
  logger.info("Grok patterns path", {patterns_dir: this.patterns_dir});
  for(var pathIdx in this.patterns_dir) {
    var path = this.patterns_dir[pathIdx];
    // if(fs.existsSync(path) && fs.statSync(path).isDirectory()) {
    //   path = sysPath.join(path, "*");
    // }
    
    var files = fs.readdirSync(path);
    for(var fileIdx in files) {
      var file = sysPath.join(path, files[fileIdx]);
      logger.info("Grok loading patterns from file", {path: file});
      this.patternfiles.push(file);
    }
  }

  //@patterns = Hash.new { |h,k| h[k] = [] }
  this.patterns = {};

  logger.info("Match data", {match: this.match});

  // TODO(sissel): Hash.merge  actually overrides, not merges arrays.
  // Work around it by implementing our own?
  // TODO(sissel): Check if 'match' is empty?
  if(typeof this.config !== 'undefined'){
    for (var i in this.config) {
      this.match[i] = this.config[i];
    }
  }  
  for(var field in this.match) {
    var patterns = this.match[field];
    // Skip known config names
    if( (RESERVED + ["match", "patterns_dir",
             "drop_if_match", "named_captures_only", "pattern",
             "keep_empty_captures", "break_on_match", "singles"]).indexOf(field) != -1) {
      continue;
    }
    if(typeof patterns === 'string') {
      patterns = [patterns];
    }

    if(!this.patterns[field]) {
      this.patterns[field] = Grok.createPile();
      //this.patterns[field].logger = logger;

      this.addPatternsFromFiles(this.patternfiles, this.patterns[field]);
    }
    logger.info("Grok compile", {field: field, patterns: patterns});
    for(var patternIdx in patterns) {
      var pattern = patterns[patternIdx];
      logger.debug("grok: "+this.only_type+"/"+field, {pattern: pattern});
      this.patterns[field].compile(pattern);
    }
  } // this.config.each
  
  
  // this.regex = new RegExp(this.regex);
  // this.invert = this.invert == 'true';
  logger.info('Initialized grok filter on pattern: ' + this.pattern + ', patterns_dir: ' + this.patterns_dir);
  callback();
}

FilterGrok.prototype.process = function(data) {
  // parse it with grok
  var matched = false

  logger.debug("Running grok filter", {data: data});
  var done = false;
  for(var field in this.patterns) { 
    var pile = this.patterns[field];
    if(done) { return; }
    if(!data.getField(field)) {
      logger.debug("Skipping match object, field not present", 
                    {field: field, data: data});
      return;
    }

    logger.debug("Trying pattern", {pile: pile, field: field} );
    var dataArr = (Array.isArray(data.getField(field)) ? data.getField(field) : [data.getField(field)]);
    for(var fieldvalueIdx in dataArr) {
      var fieldvalue = dataArr[fieldvalueIdx];
      try {
        var response = pile.match(fieldvalue);
        var grok = response[0], match = response[1];
      } catch(e) {
        var fieldvalue_bytes = [] 
        for(var i = 0; i < fieldvalue.length; i++) { fieldvalue_bytes.push(fieldvalue.charCodeAt(i)); };
        logger.warning("Grok regexp threw exception", {exception: e.message,
                     field: field, grok_pile: pile,
                     fieldvalue_bytes: fieldvalue_bytes});
      }
      if(!match) { continue; }
      matched = true;
      if(this.break_on_match === 'true') { done = true; }

      var captures = match.eachCapture();
      for(var idx in captures) {
        var key = captures[idx][0], value = captures[idx][1];
        var type_coerce = null;
        var is_named = false;
        if(key.indexOf(":") != -1)  {
          var keyArr = key.split(":");
          var name = keyArr[0], key = keyArr[1], type_coerce = keyArr[2];
          is_named = true;
        }
        
        // http://code.google.com/p/logstash/issues/detail?id=45
        // Permit typing of captures by giving an additional colon and a type,
        // like: %{FOO:name:int} for int coercion.
        if(type_coerce) {
          logger.info("Match type coerce:", type_coerce);
          logger.info("Patt:", grok.pattern());
        }

        switch(type_coerce) {
          case "int":
            value = Integer(value);
            break;
          case "float":
            value = Float(value);
            break;
        }
        
        // Special casing to skip captures that represent the entire log message.
        if(fieldvalue == value && field == "@message") {
          // Skip patterns that match the entire message
          logger.debug("Skipping capture since it matches the whole line.", {field: key});
          continue;
        }

        if(this.named_captures_only === 'true' && !is_named) {
          logger.debug("Skipping capture since it is not a named ",
                        "capture and named_captures_only is true.", {field: key});
          continue;
        }

        if(typeof data.getField(key) === 'string') {
          data.setField(key, [data.getField(key)]);
        }

        if(this.keep_empty_captures === 'true' && (typeof data.getField(key) === 'undefined')) {
          data.setField(key, []);
        }

        // If value is not nil, or responds to empty and is not empty, add the
        // value to the event.
        var valueEmpty = ((typeof value === 'string') ? value.length < 1 : false);
        if( (typeof value !== 'undefined') && !valueEmpty) {
          // Store fields as an array unless otherwise instructed with the
          // 'singles' config option
          if((typeof data.getField(key) === 'undefined') && this.singles === 'true') {
            data.setField(key, value);
          } else {
            var arr = data.getField(key);
            if(typeof arr === 'undefined') {
              arr = [];
            }
            arr.push(value)
            data.setField(key, arr);
          }
        }
      } // match.each_capture

      //filter_matched(data);
    }
  }

  if(!matched) {
    // Tag this event if we can't parse it. We can use this later to
    // reparse+reindex logs if we improve the patterns given .
    var arr = data.getTags();
    arr.push("_grokparsefailure");
    data.setTags(arr);
  }

  logger.debug("Event now: ", {data: data});
  
  
  // var match = data.getMessage().match(this.regex);
  // console.log(data.getMessage(), this.regex, match, this.invert);
  // if (this.invert) {
  //   match = ! match;
  // }
  // return match ? data : undefined;
  return matched ? data : undefined;
}

FilterGrok.prototype.addPatternsFromFiles = function(paths, pile) {
  for(var pathIdx in paths) { this.addPatternsFromFile(paths[pathIdx], pile); }
}

FilterGrok.prototype.addPatternsFromFile = function(path, pile) {
  pile.addPatternsFromFile(path);
}

exports.create = function() {
  return new FilterGrok();
}
