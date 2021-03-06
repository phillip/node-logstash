var vows = require('vows'),
    assert = require('assert'),
    fs = require('fs'),
    agent = require('agent'),
    net = require('net'),
    http = require('http'),
    dgram = require('dgram'),
    os = require('os'),
    zlib = require('zlib'),
    monitor_file = require('../lib/lib/monitor_file'),
    logstash_event = require('../lib/lib/logstash_event');

function checkResult(line, target) {
  var parsed = JSON.parse(line);
  parsed['@timestamp'] = '2012-01-01T01:00:00.000Z';
  target_event = logstash_event.create(target);
  if(target['@source'].substring(0,7)=='file://') {
    target_event.setSource(target['@source'].replace('file://', 'file://'+os.hostname()));
  } else {
    target_event.setSource(target['@source']);
  }
  target_event.setTimestamp('2012-01-01T01:00:00.000Z');
  assert.deepEqual(parsed, target_event.toJSON());
}

function createAgent(urls, callback, error_callback) {
  var a = agent.create();
  error_callback = error_callback || function(error) {
    assert.ifError(error);
  }
  a.on('init_error', function(module_name, error) {
    console.log("Init error agent detected, " + module_name + " : " + error);
    error_callback(error);
  });
  a.on('error', function(module_name, error) {
    console.log("Error agent detected, " + module_name + " : " + error);
    error_callback(error);
  });
  a.loadUrls(urls, function(error) {
    assert.ifError(error);
    callback(a);
  }, 200);
}

function file2x2x2file(config1, config2, clean_callback) {
  return {
    topic: function() {
      monitor_file.setFileStatus({});
      var callback = this.callback;
      createAgent(['input://file:///tmp/main_input.txt?type=test'].concat(config1), function(a1) {
        createAgent(config2.concat(['output://file:///tmp/main_output.txt?output_type=json']), function(a2) {
          setTimeout(function() {
            fs.appendFileSync('/tmp/main_input.txt', '234 tgerhe grgh\n');
            setTimeout(function() {
              a1.close(function() {
                a2.close(function() {
                  callback(null);
                });
              });
            }, 200);
          }, 200);
        });
      });
    },

    check: function(err) {
      assert.ifError(err);

      var c = fs.readFileSync('/tmp/main_output.txt').toString();
      fs.unlinkSync('/tmp/main_input.txt');
      fs.unlinkSync('/tmp/main_output.txt');

      var splitted = c.split('\n');
      assert.equal(splitted.length, 2);
      assert.equal("", splitted[splitted.length - 1]);
      checkResult(splitted[0], {'@source': 'file:///tmp/main_input.txt', '@message': '234 tgerhe grgh', '@type': 'test'});
      if (clean_callback) {
        clean_callback();
      }
    }
  }
}

function check_error_init(urls, expected_message_pattern) {
  return {
    topic: function() {
      var callback = this.callback;
      var a = agent.create();
      a.on('error', function(module_name, error) {
        assert.ifError(error);
      });
      a.on('init_error', function(module_name, error) {
        assert.ifError(error);
      });
      a.loadUrls(urls, function(err) {
        if (err) {
          return callback(null, err.toString());
        }
        asser.fail("Init success, should not");
      }, 200);
    },

    check: function(error, message) {
      assert.ifError(error);
      assert.ok(message.match(expected_message_pattern), 'Message does not match pattern : ' + expected_message_pattern + ' : ' + message);
    }
  }
}

function check_error_module(urls, type, expected_message_pattern, expected_module_name) {
  return {
    topic: function() {
      var callback = this.callback;
      var a = agent.create();
      a.on(type, function(module_name, error) {
        console.log("Error detected, " + module_name + " : " + error);
        callback(null, error.toString(), module_name);
      });
      a.on(type == 'error' ? 'init_error' : 'error', function(module_name, err) {
        assert.ifError(err);
      });
      a.loadUrls(urls, function(err) {
        assert.ifError(err);
      }, 200);
    },

    check: function(err, message, module_name) {
      assert.ifError(err);
      assert.ok(message.match(expected_message_pattern), 'Message does not match pattern : ' + expected_message_pattern + ' : ' + message);
      assert.equal(module_name, expected_module_name);
    }
  }
}

vows.describe('Integration :').addBatch({
  'file2file': {
    topic: function() {
      monitor_file.setFileStatus({});
      var callback = this.callback;
      createAgent([
        'input://file:///tmp/input1.txt',
        'input://file:///tmp/input2.txt?type=input2',
        'output://file:///tmp/output1.txt?output_type=json',
        'output://file:///tmp/output2.txt?output_type=json',
        ], function(agent) {
        fs.appendFileSync('/tmp/input1.txt', 'line1\n');
        setTimeout(function() {
          fs.appendFileSync('/tmp/input2.txt', 'line2\n');
          setTimeout(function() {
            fs.appendFileSync('/tmp/input1.txt', 'line3\n');
            setTimeout(function() {
              agent.close(function() {
                callback(null);
              });
            }, 200);
          }, 200);
        }, 200);
      });
    },

    check: function(err) {
      assert.ifError(err);
      var c1 = fs.readFileSync('/tmp/output1.txt').toString();
      var c2 = fs.readFileSync('/tmp/output2.txt').toString();
      fs.unlinkSync('/tmp/input1.txt');
      fs.unlinkSync('/tmp/input2.txt');
      fs.unlinkSync('/tmp/output1.txt');
      fs.unlinkSync('/tmp/output2.txt');

      assert.equal(c1, c2);
      var splitted = c1.split('\n');
      assert.equal(splitted.length, 4);
      assert.equal("", splitted[splitted.length - 1]);
      checkResult(splitted[0], {'@source': 'file:///tmp/input1.txt', '@message': 'line1'});
      checkResult(splitted[1], {'@source': 'file:///tmp/input2.txt', '@message': 'line2', '@type': 'input2'});
      checkResult(splitted[2], {'@source': 'file:///tmp/input1.txt', '@message': 'line3'});
    }
  },
}).addBatch({
  'elastic_search test': {
    topic: function() {
      var callback = this.callback;
      var reqs = [];
      var agent = createAgent([
        'input://tcp://0.0.0.0:17874?type=nginx',
        'input://tcp://0.0.0.0:17875',
        'output://elasticsearch://localhost:17876',
        ], function(agent) {
        var es_server = http.createServer(function(req, res) {
          var body = "";
          req.on('data', function(chunk) {
            body += chunk;
          })
          req.on('end', function() {
            reqs.push({req: req, body: body});
            res.writeHead(201);
            res.end();
            if (reqs.length == 2) {
              es_server.close(function() {
                agent.close(function() {
                  callback(null, reqs);
                });
              });
            }
          })
        }).listen(17876);
        var c1 = net.createConnection({port: 17874}, function() {
          c1.write("toto");
          c1.end();
        });
        setTimeout(function() {
          var c2 = net.createConnection({port: 17875}, function() {
            c2.write("titi");
            c2.end();
          });
        }, 200);
      });
    },

    check: function(err, reqs) {
      assert.ifError(err);
      assert.equal(reqs.length, 2);

      assert.equal(reqs[0].req.method, 'POST');
      assert(reqs[0].req.url.match('^\/logstash-' + (new Date()).getFullYear() + '\\.\\d\\d\\.\\d\\d\/data'), reqs[0].req.url + ' does not match regex');
      checkResult(reqs[0].body, {'@message': 'toto', '@source': 'tcp://0.0.0.0:17874', '@type': 'nginx'});

      assert.equal(reqs[1].req.method, 'POST');
      assert(reqs[1].req.url.match('^\/logstash-' + (new Date()).getFullYear() + '\\.\\d\\d\\.\\d\\d\/data'), reqs[1].req.url + ' does not match regex');
      checkResult(reqs[1].body, {'@message': 'titi', '@source': 'tcp://0.0.0.0:17875'});
    }
 },
}).addBatch({
  'net2file': {
    topic: function() {
      var callback = this.callback;
      createAgent([
        'input://tcp://localhost:17873?type=2',
        'output://file:///tmp/output.txt?output_type=json',
        ], function(agent) {
        var c = net.createConnection({port: 17873}, function() {
          c.write("toto");
          c.end();
        });
        c.on('end', function() {
          setTimeout(function() {
            agent.close(function() {
              callback(null);
            });
          }, 100);
        });
      });
    },

    check: function(err) {
      assert.ifError(err);
      var c1 = fs.readFileSync('/tmp/output.txt').toString();
      fs.unlinkSync('/tmp/output.txt');

      var splitted = c1.split('\n');
      assert.equal(splitted.length, 2);
      assert.equal("", splitted[splitted.length - 1]);
      checkResult(splitted[0], {'@source': 'tcp://localhost:17873', '@message': 'toto', '@type': '2'});
    }
 },
}).addBatch({
  'file2statsd': {
    topic: function() {
      monitor_file.setFileStatus({});
      var callback = this.callback;
      var received = [];
      var statsd = dgram.createSocket('udp4');
      statsd.on('message', function(d) {
        received.push(d.toString());
      });
      statsd.bind(17877);
      createAgent([
        'input://file:///tmp/input1.txt',
        'input://file:///tmp/input2.txt?type=titi',
        'input://file:///tmp/input3.txt?type=tata',
        'input://file:///tmp/input4.txt?type=tete',
        'input://file:///tmp/input5.txt?type=toto',
        'filter://regex://?regex=^45_(.*)$&fields=my_field',
        'output://statsd://127.0.0.1:17877?metric_type=increment&metric_key=toto.bouh',
        'output://statsd://127.0.0.1:17877?metric_type=decrement&metric_key=toto.#{@message}&only_type=titi',
        'output://statsd://127.0.0.1:17877?metric_type=counter&metric_key=toto.counter&metric_value=#{@message}&only_type=tata',
        'output://statsd://127.0.0.1:17877?metric_type=timer&metric_key=toto.#{my_field}.#{my_field}&metric_value=20&only_type=tete',
        'output://statsd://127.0.0.1:17877?metric_type=gauge&metric_key=toto.gauge&metric_value=45&only_type=toto',
        ], function(agent) {
        setTimeout(function() {
          fs.appendFileSync('/tmp/input1.txt', 'line1\n');
          setTimeout(function() {
            fs.appendFileSync('/tmp/input2.txt', 'line2\n');
            setTimeout(function() {
              fs.appendFileSync('/tmp/input3.txt', '10\n');
              setTimeout(function() {
                fs.appendFileSync('/tmp/input4.txt', '45_123\n');
                setTimeout(function() {
                  fs.appendFileSync('/tmp/input5.txt', 'line3\n');
                  setTimeout(function() {
                    agent.close(function() {
                      statsd.close();
                      callback(undefined, received);
                    });
                  }, 200);
                }, 200);
              }, 200);
            }, 200);
          }, 200);
        }, 200);
      });
    },

    check: function(err, data) {
      fs.unlinkSync('/tmp/input1.txt');
      fs.unlinkSync('/tmp/input2.txt');
      fs.unlinkSync('/tmp/input3.txt');
      fs.unlinkSync('/tmp/input4.txt');
      fs.unlinkSync('/tmp/input5.txt');
      assert.ifError(err);
      assert.deepEqual(data.sort(), [
        'toto.bouh:1|c',
        'toto.line2:-1|c',
        'toto.bouh:1|c',
        'toto.counter:10|c',
        'toto.bouh:1|c',
        'toto.123.123:20|ms',
        'toto.bouh:1|c',
        'toto.bouh:1|c',
        'toto.gauge:45|g',
      ].sort());
    }
 },
 }).addBatch({
  'file2statsd_missing_field': {
    topic: function() {
      monitor_file.setFileStatus({});
      var callback = this.callback;
      var received = [];
      var errors = [];
      var statsd = dgram.createSocket('udp4');
      statsd.on('message', function(d) {
        received.push(d.toString());
      });
      statsd.bind(17878);
      createAgent([
        'input://file:///tmp/input1.txt',
        'filter://regex://?regex=(line2)&fields=unknown_field',
        'output://statsd://127.0.0.1:17878?metric_type=increment&metric_key=toto.bouh.#{unknown_field}',
        ], function(agent) {
        setTimeout(function() {
          fs.appendFileSync('/tmp/input1.txt', 'line1\n');
          fs.appendFileSync('/tmp/input1.txt', 'line2\n');
          setTimeout(function() {
            agent.close(function() {
              statsd.close();
              callback(errors, received);
            });
          }, 200);
        }, 200);
      }, function(error) {
        errors.push(error);
      });
    },

    check: function(errors, data) {
      fs.unlinkSync('/tmp/input1.txt');
      assert.deepEqual(data.sort(), ['toto.bouh.line2:1|c'].sort());
      assert.equal(errors.length, 0);
    }
 },
}).addBatch({
  'filegelf': {
    topic: function() {
      monitor_file.setFileStatus({});
      var callback = this.callback;
      var received = [];
      var gelf = dgram.createSocket('udp4');
      gelf.on('message', function(d) {
        zlib.inflate(d, function(err, data) {
          assert.ifError(err);
          data = JSON.parse(data);
          received.push(data);
        });
      });
      gelf.bind(17879);
      createAgent([
        'input://file:///tmp/input1.txt?type=toto',
        'input://file:///tmp/input2.txt',
        'filter://regex://?regex=^\\[(.*)\\]&fields=timestamp&date_format=DD/MMMM/YYYY:HH:mm:ss ZZ',
        'output://gelf://localhost:17879'
        ], function(agent) {
        setTimeout(function() {
          fs.appendFileSync('/tmp/input1.txt', '[31/Jul/2012:18:02:28 +0200] line1\n');
          setTimeout(function() {
            fs.appendFileSync('/tmp/input2.txt', '[31/Jul/2012:20:02:28 +0200] line2\n');
            setTimeout(function() {
              agent.close(function() {
                gelf.close();
                callback(undefined, received);
              });
            }, 200);
          }, 200);
        }, 200);
      });
    },

    check: function(err, data) {
      fs.unlinkSync('/tmp/input1.txt');
      assert.ifError(err);
      assert.deepEqual(data.sort(), [
       {
        version: '1.0',
        short_message: '[31/Jul/2012:18:02:28 +0200] line1',
        timestamp: (new Date('2012-07-31T16:02:28+00:00')).getTime() / 1000,
        host: os.hostname().toLowerCase(),
        facility: 'toto',
        level: '6'
       },
       {
        version: '1.0',
        short_message: '[31/Jul/2012:20:02:28 +0200] line2',
        timestamp: (new Date('2012-07-31T18:02:28+00:00')).getTime() / 1000,
        host: os.hostname().toLowerCase(),
        facility: 'no_facility',
        level: '6'
       }
      ].sort());
    }
 },
}).addBatch({
  'non_existent_module': check_error_init([
    'input://non_existent_module://'
    ], 'Cannot find module'),
  'wrong url': check_error_init([
    'input://non_existent_module'
    ], 'Unable to extract plugin name'),
  'wrong url init': check_error_init([
    'toto://non_existent_module://'
    ], 'Unknown protocol'),
  'wrong port in tcp module': check_error_init([
    'input://tcp://0.0.0.0:abcd'
    ], 'Unable to extract port'),
}).addBatch({
 'input_file_error': check_error_module([
   'input://file:///path_which_does_not_exist/input1.txt',
   'output://stdout://'
   ], 'init_error', 'Error: watch ENOENT', 'input_file'),
}).addBatch({
  'wrong_output_file_module': check_error_module([
    'output://file:///path_which_does_not_exist/titi.txt'
  ], 'error', 'ENOENT', 'output_file'),
}).addBatch({
  'file transport': file2x2x2file(['output://file:///tmp/main_middle.txt?output_type=json'], ['input://file:///tmp/main_middle.txt?format=json_event'], function() { fs.unlinkSync('/tmp/main_middle.txt'); }),
}).addBatch({
  'tcp transport': file2x2x2file(['output://tcp://localhost:17879'], ['input://tcp://0.0.0.0:17879?format=json_event']),
}).addBatch({
  'zeromq transport': file2x2x2file(['output://zeromq://tcp://localhost:5567'], ['input://zeromq://tcp://*:5567']),
}).addBatch({
  'unix socket transport': file2x2x2file(['output://unix:///tmp/test_socket'], ['input://unix:///tmp/test_socket?format=json_event']),
}).addBatch({
  'udp transport': file2x2x2file(['output://udp://localhost:17880'], ['input://udp://127.0.0.1:17880?format=json_event']),
}).export(module);
