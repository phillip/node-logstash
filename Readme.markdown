node-logstash
====

What is it ?
---

It's a [NodeJS](http://nodejs.org) implementation of [Logstash](http://logstash.net/).


What to do with node-logstash ?
---

node-logstash is a tool to collect logs on servers. It allow to send its to a central server and to [elastic search](http://www.elasticsearch.org/) for indexing.

In top of elastic search, you can use a specialized interface like [kibana](http://rashidkpc.github.com/Kibana/) to dive into your logs.

![Archi](https://raw.github.com/bpaquet/node-logstash/master/docs/archi.jpg)

Why a new implementation ?
---

When I tried logstash, I had some problems. This version should have:

* lower memory footprint
* lower cpu footprint
* faster startup delay

Moreover it's written in NodeJS, which is a perfect language for programs with many IO.

node-logstash is compatible with logstash. You can replace a node-logstash node by a logstash one. The data are formatted in the same way to be compatible with logstash UIs.

How it's work ?
===

The architecture is identical to logstash architecture. You have to instanciates plugins with the node-logstash core. There are three type of modules:

* [inputs plugin](https://github.com/bpaquet/node-logstash/tree/master/lib/inputs): where datas come into node-logstash. Examples: file, zeromq transport layer
* [filter plugin](https://github.com/bpaquet/node-logstash/tree/master/lib/filters): extract fields from logs, like timestamps. Example: regex plugin
* [outputs plugins](https://github.com/bpaquet/node-logstash/tree/master/lib/outputs): where datas leave from node-logstash: Examples: elastic search , zeromq transport layer.


A typical node-logstash deployement contains agents to crawl logs and a log server.

On agent, node-logstash is configured whith inputs plugins to get logs from your software stack, and one output plugin to send logs to log server (eg. zeromq output plugin).

On log server, logs come trough a zeromq input plugin, are processed (fields and timestamps extraction), and send to elastic search.

How to use it ?
===

Installation
---

* Install NodeJS, version > 0.8.
* Install zmq dev libraries: `apt-get install libzmq1`. This is required to build the [node zeromq module](https://github.com/JustinTulloss/zeromq.node).
* Install node-logstash: `npm install node-logstash`

The executable is in ``node_modules/node-logstash/bin/node-logstash-agent``

You have scripts in ``dists`` folder to build packages. Actually, only debian is supported.

Configuration
---

Configuration is done by url. A plugin is instanciated by an url. Example: ``input://file:///tmp/toto.log``. This url
instanciate an input file plugin which monitor the file ``/tmp/toto.log`.

The urls can be specified:

* directly on the command line
* in a file (use the ``--config_file`` switch)
* in all files in a directory (use the ``--config_dir`` switch)

Others params:

* ``--log_level`` to change the log level (emergency, alert, critical, error, warning, notice, info, debug)
* ``--log_file`` to redirect log to a log file
* ``--patterns_directories`` to add some directories (separated by ,), for loading config for regex plugin
* ``--db_file`` to specify the file to use as database for file inputs (see below)

Examples
---

Config file for an agent:

    input://file:///var/log/nginx/access.log
    output://zeromq://tcp://log_server:5555

Config file for log server:

    input://zeromq://tcp://0.0.0.0:5555
    filter://regex://?load_config=http_combined
    output://elasticsearch://localhost:9001

Inputs plugins
===

File
---

This plugin monitor log files. It's compatible with logrotate. If a db file is specified, this plugin store where the last line were read when node-logstash stop. This value is used when node-logstash restart to read lines written node-logstash downtime.

Example: ``input://file:///tmp/toto.log``, to monitor ``/tmp/toto.log``.

Params:

* ``start_index``: add ``?start_index=0`` to reread files from begining. Without this params, only new lines are read.
* ``type``: to specify the log type, to faciliate crawling in kibana. Example: ``type=nginx_error_log`

ZeroMQ
---

This plugin is used on log server to receive logs from agents.

Example: ``input://zeromq://tcp://0.0.0.0:5555``, to open a zeromq socket on port 5555.

Outputs and filter, commons parameters
===

* ``only_type``: execute the filter / output plugin only on lines with specified type. Example: ``only_type=nginx``
* ``only_field_exist_toto``: execute the filter / output plugin only on lines with a field ``toto``. You can specify it multiple times, all fields have to exist.
* ``only_field_equal_toto=aaa``: execute the filter / output plugin only on lines with a field ``toto``, with value ``aaa``. You can specify it multiple times, all fields have to exist and have the specified value.

Access to line log properties
===

Some params are string, which can reference line log properties:

* ``#{@message}`` will contain the full log line
* ``#{@type}`` will contain the type of log line
* ``#{toto}`` will contain the value of the field ``toto``, which have to be extracted with a regex filter
* ``2#{toto}`` will contain ``2`` followed by the value of the field ``toto``.

Ouputs plugins
===

ZeroMQ
---

This plugin is used on agents to send logs to logs servers.

Example: ``output://zeromq://tcp://192.168.1.1:5555``, to send logs to 192.168.1.1 port 5555.

Elastic search
---

This plugin is used on log server to send logs to elastic search, using HTTP REST interface.

Example: ``output://elasticsearch://localhost:9001`` to send to the HTTP interface of an elastic search server listening on port 9001.

Elastic search ZeroMQ
---

This plugin is used on log server to send logs to elastic search, using ZeroMQ transport.
You can find the ZeroMQ transport here: https://github.com/bpaquet/transport-zeromq.

Example: ``output://elasticsearch_zeromq://tcp://localhost:9700`` to send to the zeromq transport of an elastic search server listening on port 9700.

Statsd
---

This plugin is used send data to statsd.

Example: ``output://statsd://localhost:8125?only_type=nginx&metric_type=increment&metric_key=nginx.request``, to send, for each line of nginx log, a counter with value 1, key ``nginx.request``, on a statsd instance located on port 8125.

Params:

* ``metric_type``: one of ``increment``, ``decrement``, ``counter``, ``timer``, ``gauge``. Type of value to send to statsd.
* ``metric_key``: key to send to statsd.
* ``metric_value``: metric value to send to statsd. Mandatory for ``timer``, ``counter`` and ``gauge`` type

``metric_key`` and ``metric_value`` can reference log line properties (see above).

Example: ``metric_key=nginx.response.#{status}``

Gelf
---

This plugin is used to send data to a GELF enabled server, eg [Graylog2](http://graylog2.org/). Documentation of GELF messages is [here](https://github.com/Graylog2/graylog2-docs/wiki/GELF).

Example: ``output://gelf://192.168.1.1:12201``, to send logs to 192.168.1.1 port 1221.

Params:

* ``message``: ``short_message`` field. Default value: ``#{@message}``, the line of log. Can reference log line properties (see above).
* ``facility``: ``facility`` field. Default value: ``#{@type}``, the line type. ``no_facility`` if no value. Can reference log line properties (see above).
* ``level``: ``level`` field. Default value: ``6``. Can reference log line properties (see above).
* ``version``: ``version`` field. Default value: ``1.0``.

Filters
===

Regex
---

The regex filter is used to extract data from lines of logs. The lines of logs are not modified by this filter.

Example 1: ``filter://regex://?regex=^(\S)+ &fields=toto``, to extract the first word of a line of logs, and place it into the ``toto`` field.

Example 2: ``filter://regex://http_combined?only_type=nginx``, to extract fields following configuration into the http_combined pattern. node-logstash is bundled with [some configurations](https://github.com/bpaquet/node-logstash/tree/master/lib/patterns). You can add your custom patterns directories, see options ``--patterns_directories``.

Params:

* regex: the regex to apply
* fields: the name of fields which wil receive the pattern extracted (see below for the special field timestamp)
* type: if this field is set, only the lines of logs with the same type will be processed by this filter.
* date\_format: if date_format is specified and a ``timestamp`` field is extracted, the plugin will process the data extracted with the date\_format, using [moment](http://momentjs.com/docs/#/parsing/string-format/). The result will replace the original timestamp of the log line.

Grok
---

The grok filter is used to extract data from lines of logs with node-grok. The lines of logs are not modified by this filter.

Example: ``filter://grok://?only_type=syslog&pattern=%{SYSLOGLINE}``, to extract fields from a syslog file.

Params:

* pattern: the grok pattern to apply
* patterns_dir: directory for additional patterns
* break_on_match: break after a single pattern matches, default is true
* named_captures_only: only capture named grok patterns, default is true
* keep_empty_captures: keep defined groups that do not match anything, default is false
* singles: make single-value fields simply that value, not an array containing that one value, default is false

Mutate replace
---

The mutate replace filter is used to run regex on specified field.

Example: ``filter://mutate_replace?toto&from=\\.&to=-`` replace all ``.`` in ``toto`` field by ``-``

Params:

* from: the regex to find pattern which will be replaced. You have to escape special characters.
* to: the replacement string

Grep
---

The grep filter can remove lines which match or do not match a given regex.

Example 1: ``filter://grep://?regex=abc`` remove all lines which do not contain ``abc``. Equivalent to ``grep`

Example 2: ``filter://grep://?regex=abc&invert=true`` remove all lines which contain ``abc``. Equivalent to ``grep -v``

Example 3: ``filter://grep://?type=nginx&regex=abc`` remove all lines with type ``nginx`` which do not contain ``abc`` and

Params:

* regex: the regex to be matched
* invert: if ``true``, remove lines which match. Default value: false

Compute field
---

The compute field filter is used to add a new field to a line, with a fixed value, or with a value computed from other fields.

Example 1: ``filter://compute_field?toto&value=abc`` add a field named ``toto`` with value ``abc``

Example 2: ``filter://compute_field?toto&value=abc#{titi}`` add a field named ``toto`` with value ``abcef``, if line contain a field ``titi`` with value ``ef``

Params:

* value: the value to place in the given field

License
===

Copyright 2012 Bertrand Paquet

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.