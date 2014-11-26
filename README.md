node-multiredis
===============

Client library for working with distributed redis servers.
It allows you to use redis servers more effectively and suitable for high-load projects with thousands requests per second.
Use this lib if you need a common data on several servers (nodes of your system). Ex. cache, counters, sets..
If you use only one instance of the redis-server you use only one core!
Server does not use all of its resources. And sometimes you need use cache on the several servers. Multiredis will help you to do it.

Install with 
----

npm install multiredis

Usage
----

It's so simple! You must use only one method 'exec'!
Everything else multiredis will do for you.

```js
var multiredis = require('multiredis');
var mredisConfig = {
	debug: true,
	hosts: {
		'localhost': {
			ports: {
				6380: ['6381:6382'],
			},
			pass : 'pass',
			dbname: 1,
			params: {
				'max_attempts': 5
			}
		},
	},
	// I want to cache results from redis in memcahed!
	memcached: {
		enable: true,
		// Keep redis results in memcached 2-6 sec.
		expireInterval: [2, 6],
		host: 'localhost',
		port: 11211,
	}
}

multiredis = new multiredis(mredisConfig);
multiredis.on('error', function (err) {
	console.log('Ups! Something wrong.. Details: ' + err);
});

multiredis.exec('set', ['key1', 'Write in the maser redis!'], function (err, result) {
	multiredis.exec('get', ['key1'], function (err, result) {
		console.log(result + ' I read it from one of the slaves!');
	})
});

```

Config
----

```js
var multiredisConfig = {
	// Logging extended multiredis info in stdout when debug is enabled
	debug: true,
	// Redis hosts declaration
	hosts: {
		// Master-slave declaration
		// 6380 - master redis port
		// 6381:6382 - slave ports range
		// You can specify ports set [6381, 6382, 6383 ....6388]
		// or ports range ['6381:6388']
		// multiredis write data in master in this mode
		// and read data from slaves which binded with master
		'localhost': {
			ports: {
				6380: ['6381:6382'],
			},
			// Don't declare this param if you don't need in redis authorization
			// @optional
			pass : 'pass',
			// @optional
			dbname: 1,
			// @optional
			params: {
				'max_attempts': 5
			}
		},
		// Simple declaration with redis-server params
		'localhost': {
		 	ports: [6380, 6381, 6382],
		 	// @optional
		 	dbname: 8,
		 	// @optional
		 	pass : 'pass',
		 	// @optional
		 	params : {
		 		'max_attempts': 5
		 	},
		// Simple declaration (host and set of the ports)
		'localhost': [6380, 6381, 6382],
	},
	//
	// Global redis settings
	// 
	// @optional
	pass : 'pass',
	// @optional
	params: {
		'max_attempts': 1
	},
	// @optional
	dbName: 0,

	// Memcached layer settings
	// @optional
	memcached: {
		// Use memcached for save intermediate information from redis
		enable: true,
		// Keep redis data in memcached for [N1, N2] sec.
		// @optional
		expireInterval: [2, 6],
		host: 'localhost',
		port: 11211,
		// Memcached ext params
		// @optional
		params: {
			timeout: 500,
			retry: 500,
			retries: 1,
			failures: 1,
			failuresTimeout: 500,
		}
	},
};
```

Error handling
----

Multiredis returns error information in user callback ('err' param), 
also multiredis emits event 'error', when it recieve event 'error' from redis 
or memcached library.

Multiredis throws Error exception in the constructor if you make a mistake in the config.

Additional information
----

Don't forget to configure your OS for high-load.
If you use Ubuntu I recommend that you change sysctl.conf params like:

- fs.file-max = 512000
- net.ipv4.tcp_fin_timeout = 20
- net.ipv4.tcp_tw_recycle = 1 
- net.ipv4.tcp_tw_reuse = 1
- vm.overcommit_memory = 1

Read this article to get more information: 
[tweak sysctl.conf](https://rtcamp.com/tutorials/linux/sysctl-conf/ "tweak sysctl.conf") 

License
----

MIT

P.S.
----
Sorry for my English language. But I try to learn it as quickly as possible!))