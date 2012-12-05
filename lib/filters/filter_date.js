var base_filter = require('../lib/base_filter'),
    util = require('util'),
    logger = require('log4node'),
    moment = require('moment');

function FilterDate() {
  base_filter.BaseFilter.call(this);
  this.config = {
    name: 'Date',
    required_params: ['field','format'],
    default_values: {
        'field': 'timestamp',
        'format': 'YYYY-MM-DDTHH:mm:ss:SSSZ'
    }
  }
}

util.inherits(FilterDate, base_filter.BaseFilter);

FilterDate.prototype.afterLoadConfig = function(callback) {
  logger.info('Initialized date filter' );
  callback();
}

FilterDate.prototype.process = function(data) {
  var time = data.data["@fields"][this.field];
  if(time){
    var parsed = moment( time, this.format );
    if ( parsed.isValid() ) {
      var dateString = parsed.toDate().toISOString();
      data.data["@timestamp"] = dateString; 
      logger.debug( "Updated timestamp of entry to " + dateString );
    } else {
      logger.error( time + " is not a valid timestamp." );
    }

  }
  return data;
}

exports.create = function() {
  return new FilterDate();
}
