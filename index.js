const player = require('play-sound')(opts = {player: 'mpg123'});
const tmi = require('tmi.js');
const dotenv = require('dotenv');
const huejay = require('huejay');
const tplink = require('tplink-smarthome-api');
const wemo = require('wemo-client');
const WebSocket = require('ws');
const OBSWebSocket = require('obs-websocket-js');
const NodeMediaServer = require('node-media-server');

dotenv.config();

const hueColor = {
	deeppurple: 49316,
	lightpurple: 56228,
	red: 65535,
	blue: 46920,
	green: 25500,
	orange: 9992
};

const vipUsers = {
	abbyfabby: ['./sounds/hello-abbyfabby.mp3', 11000],
	antivigames: ['./sounds/hello-antivigames.mp3', 6000],
	bjwhite211: ['./sounds/hello-bjwhite211.mp3', 9000],
	brandan_f: ['./sounds/hello-brandan-f.mp3', 10000],
	bungalowglow: ['./sounds/hello-bungalowglow.mp3', 12000],
	casinoduck: ['./sounds/hello-casinoduckling.mp3', 8000],
	danhalen_: ['./sounds/hello-danhalen-us.mp3', 9000],
	dragonflytru_1: ['./sounds/hello-dragonflythru-1.mp3', 11000],
	hiccupingboots: ['./sounds/hello-hiccupingboots.mp3', 9000],
	instafluff: ['./sounds/hello-instafluff.mp3', 10000],
	itmeharu: ['./sounds/hello-itmeharu.mp3', 11000],
	itsayu: ['./sounds/hello-its-ayu.mp3', 12000],
	jellydance: ['./sounds/hello-jellydance.mp3', 6000],
	julieee22: ['./sounds/hello-julieee22.mp3', 11000],
	lenabotse: ['./sounds/hello-lenabotse.mp3', 10000],
	macabreman: ['./sounds/hello-macabreman.mp3', 7000],
	malfunct: ['./sounds/hello-malfunct.mp3', 7000],
	moddedorange23: ['./sounds/hello-moddedorange23.mp3', 11000],
	moriarty24: ['./sounds/hello-moriarty24.mp3', 14000],
	nitecrawla: ['./sounds/hello-nitecrawla.mp3', 9000],
	royoushi: ['./sounds/hello-royoushi.mp3', 8000],
	sourbeers: ['./sounds/hello-sourbeers.mp3', 15000],
	sparky_pugwash: ['./sounds/hello-sparky-pugwash.mp3', 10000],
	swolemaz: ['./sounds/hello-swolemaz.mp3', 10000],
	that_ms_gamer: ['./sounds/hello-that-ms-gamer.mp3', 12000],
	trueblue77_42: ['./sounds/hello-trueblue77-42.mp3', 12000],
	yoadriennexd: ['./sounds/hello-yoadriennexd.mp3', 17000]
}

// Configure and initialize the RTMP server
const nmsConfig = {
	rtmp: {
	  port: 1935,
	  chunk_size: 60000,
	  gop_cache: true,
	  ping: 60,
	  ping_timeout: 30
	},
	http: {
	  port: 8000,
	  allow_origin: '*'
	}
  };
   
  let nms = new NodeMediaServer(nmsConfig);
  nms.run();

// On RTMP connection to server
nms.on('postConnect', (id, args) => {
    console.log('[NodeEvent on postConnect]', `id=${id} args=${JSON.stringify(args)}`);
});

// On RTMP disconnect from server
nms.on('doneConnect', (id, args) => {
    console.log('[NodeEvent on doneConnect]', `id=${id} args=${JSON.stringify(args)}`);
});

// Configure OBS websocket
const obs = new OBSWebSocket();
let currentScene = 'Starting Soon';

obs.connect({
    address: 'localhost:4444',
    password: process.env.OBS_WS_PASS
}).then(() => {
    console.log(`Connected to OBS via Websocket`);
}).catch(err => {
    console.log('Error on OBS Websocket connect: ' + err);
});

obs.on('ConnectionOpened', () => {
	obs.send('GetCurrentScene').then((data) => {
		console.log(`OBS Websocket: Setting current scene to ${data.name}`);
		currentScene = data.name;
	}).catch(err => {
		console.log('OBS Websocket Error: ' + err);
	});
});
  
obs.on('SwitchScenes', data => {
	console.log(`OBS Websocket: Setting current scene to ${data['scene-name']}`);
	currentScene = data['scene-name'];
});

// Source: https://www.thepolyglotdeveloper.com/2015/03/create-a-random-nonce-string-using-javascript/
function nonce(length) {
    let text = "";
    let possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

// Configure WebSocket for Twitch PubSub
let ws;

function wsHeartbeat() {
    message = {
        type: 'PING'
    };
    console.log('WebSocket PING Sent');
    ws.send(JSON.stringify(message));
}

function wsListen(topic) {
    message = {
        type: 'LISTEN',
        nonce: nonce(15),
        data: {
            topics: [topic],
            auth_token: process.env.TWITCH_APP_OAUTH
        }
	};
	let stringified = JSON.stringify(message);
    console.log('Websocket Sent: ' + stringified);
    ws.send(stringified);
}

function wsConnect() {
    let heartbeatInterval = 60000;
    let reconnectInterval = 3000;
    let heartbeatHandle;

    ws = new WebSocket('wss://pubsub-edge.twitch.tv');

    ws.on('open', function() {
        console.log('WebSocket Opened');
        wsHeartbeat();
		heartbeatHandle = setInterval(wsHeartbeat, heartbeatInterval);
		wsListen(`channel-points-channel-v1.${process.env.TWITCH_CHANNEL_ID}`);
    });

    ws.on('error', function(error) {
        console.log('Websocket Error: ' + error);
    });

    ws.on('message', function(data) {
        message = JSON.parse(data);
        console.log('WebSocket Received: ' + data);
        if (message.type == 'RECONNECT') {
            console.log('WebSocket Reconnecting...');
            setTimeout(connect, reconnectInterval);
		}
		else if (message.type == 'MESSAGE' && message.data && message.data.message) {
			let messageParsed = JSON.parse(message.data.message);
			if (messageParsed.type && messageParsed.data && messageParsed.type == 'reward-redeemed') {
				redeemReward(messageParsed.data);
			}
		}
    });

    ws.on('close', function(code, reason) {
        console.log('WebSocket Closed: ' + reason);
        clearInterval(heartbeatHandle);
        console.log('WebSocket Reconnecting...');
        setTimeout(connect, reconnectInterval);
    });
}

wsConnect();

// Connect to the Philips Hue bridge
const hueClient = new huejay.Client({
	host:     '192.168.1.2',
	username: 'CEnnQq8TDPSVcl8SbpptgSnD4aKAdVuooPjlElEF'
});

// Uncomment and run the following method to get the IDs of all connected lights
// hueClient.lights.getAll()
//   .then(lights => {
//     for (let light of lights) {
//       console.log(`Light [${light.id}]: ${light.name}`);
//     }
//   });

// Connect to the Wemo Mini Smart Plug
const wemoClient = new wemo();
let wemoConnection;

wemoClient.load('http://192.168.1.21:49153/setup.xml', function(err, deviceInfo) {
  console.log('Wemo PLUG FOUND');
  wemoConnection = wemoClient.client(deviceInfo);

  wemoConnection.on('error', function(err) {
    console.log('WEMO PLUG ERROR: %s', err.code);
  });

  wemoConnection.on('binaryState', function(value) {
    console.log('WEMO PLUG: Binary State changed to: %s', value);
  });
});


// Connect to TP-Link Wifi Power Strip (HS300) and save the plugs
const tplinkClient = new tplink.Client();
let childPlugs = [null, null, null, null, null, null];

(async () => {
	const device = await tplinkClient.getDevice({ host: '192.168.1.20' });
  
	if (!device.children) {
	  console.log('TP LINK PLUG: Device has no children');
	  return;
	} else {
		console.log(`TP LINK PLUG: Detected device with ${device.children.keys().length} children`);
	}
  
	await Promise.all(Array.from(device.children.keys(), async (childId) => {
	  let childPlug = await tplinkClient.getDevice({ host: '192.168.1.20', childId });
	  let index = childId.charAt(childId.length - 1);
	  childPlugs[parseInt(index)] = childPlug;
	  console.log(`TP LINK PLUG: Plug with ID ${childId} stored at index ${index}`)
	}));
})();

// Connect to Twitch chat
const tmiClient = new tmi.Client({
	options: { debug: true },
	connection: {
		reconnect: true,
		secure: true
	},
	identity: {
		username: process.env.TWITCH_USER,
		password: process.env.TWITCH_OAUTH
	},
	channels: [ process.env.TWITCH_CHANNEL ]
});

tmiClient.connect();

// Pulse the specified light for 15 seconds, then turn it off
function strobeLight(lightID, color, timeout, stop = true) {
	hueClient.lights.getById(lightID)
		.then(light => {
			console.log('Hue: ' + light.hue);
			console.log(`HUE LIGHT: Strobing light ${light.id} with hue of ${color}`);
			light.on = true;
			light.brightness = 254;
			light.hue = color;
			light.alert = 'lselect'

			return hueClient.lights.save(light);
		})
		.then(light => {
			// If the timeout is over 15000, then renew the strobing at 15 sec intervals
			if (timeout >= 16000) {
				let intervals = 1;
				for (let timeRemaining = timeout - 15000; timeRemaining >= 1000; timeRemaining -= 15000) {
					let nextTimeout = timeRemaining > 15000 ? 15000 : timeRemaining;
					setTimeout(function() {strobeLight(lightID, color, nextTimeout, false);}, 15000 * intervals);
					intervals++;
				}
			}
			if (stop)
				setTimeout(function() {stopLight(lightID);}, timeout);
		})
		.catch(error => {
			console.log('HUE LIGHT: Error modifying light state');
			console.log(error.stack);
		});
}

// Pulses two lights in an alternating pattern
// Ex. alternateStrobing(3, 8, hueColor.red, hueColor.blue, 15000);
function alternateStrobing(light1, light2, color1, color2, timeout) {
	console.log('HUE LIGHT: Alternate strobing');
	strobeLight(light1, color1, timeout);
	setTimeout(function() {strobeLight(light2, color2, timeout);}, 500);
}

// Turn off the specified light
function stopLight(lightID) {
	hueClient.lights.getById(lightID)
		.then(light => {
			console.log(`HUE LIGHT: Turning off light ${light.id}`);
			light.alert = 'none';
			light.on = false;
			return hueClient.lights.save(light);
		})
		.catch(error => {
			console.log('HUE LIGHT: Error modifying light state');
			console.log(error.stack);
		});
}

// Toggle the power switches for a given duration
// wemoState: The state to set the wemo plugs to
// tpState: The state to set the given TP Link plugs to
// tpPlugs: An array of the plug indices for the TP Link power strip
// timeout: The duration to wait before toggling the switches back
function changePowerSwitches(wemoState, tpState, tpPlugs, timeout) {
	if (!wemoState) {
		wemoConnection.setBinaryState(wemoState);
	}
	for (let plug of tpPlugs) {
		childPlugs[plug].setPowerState(tpState).then((powerState, err) => {
			console.log(`Child plug set to power state ${powerState}`);
		});
	}

	// If a timeout is given, toggle the switches back after the timeout expires
	if (timeout > 0) {
		setTimeout(function() {
			// changePowerSwitches(1, tpState ? 0 : 1, tpPlugs, 0);
			if (!wemoState) {
				wemoConnection.setBinaryState(1);
			}
			flipState = tpState ? 0 : 1;
			for (let plug of tpPlugs) {
				childPlugs[plug].setPowerState(flipState).then((powerState, err) => {
					console.log(`Child plug set to power state ${powerState}`);
				});
			}
		}, timeout);
	}
}

let alerts = {
	demo: {
		timeout: 10000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 0,
		tpState: 1,
		tpPlugs: [0, 1, 2, 3, 4, 5],
		sound: './sounds/soundofdapolice.mp3',
		goBig: true
	},
	hello: {
		timeout: 3000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello.mp3',
		goBig: false
	},
	hellovip: {
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		goBig: false
	},
	senpai: {
		timeout: 6000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4, 5],
		sound: './sounds/noticemesenpai.mp3',
		goBig: false
	},
	ban: {
		timeout: 8000,
		strobe1: hueColor.blue,
		strobe2: hueColor.red,
		wemoState: 0,
		tpState: 1,
		tpPlugs: [0, 1],
		sound: './sounds/soundofdapolice.mp3',
		goBig: true
	},
	raid: {
		timeout: 21000,
		strobe1: hueColor.red,
		strobe2: hueColor.orange,
		wemoState: 0,
		tpState: 1,
		tpPlugs: [0, 2],
		sound: './sounds/redalert.mp3',
		goBig: true
	},
	subbomb: {
		timeout: 21000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 0,
		tpState: 1,
		tpPlugs: [0, 1, 2, 3, 4, 5],
		sound: './sounds/boom.mp3',
		goBig: true
	},
	tubeman: {
		timeout: 7000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.blue,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [4, 5],
		sound: './sounds/tubeman.mp3',
		goBig: false
	},
	boogie: {
		timeout: 16000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 0,
		tpState: 1,
		tpPlugs: [0, 1, 2, 3, 4, 5],
		sound: './sounds/boogie.mp3',
		goBig: true
	},
	silence: {
		timeout: 31000,
		strobe1: null,
		strobe2: null,
		wemoState: null,
		tpState: null,
		tpPlugs: null,
		sound: './sounds/countdown.mp3',
		goBig: false
	}
}

let isPaused = false;
let isExecuting = false;
let eventQueue = [];

function triggerLightAndNoise(type) {
	if (isPaused || isExecuting) {
		eventQueue.push(type);
	} else if (type) {
		let alert;

		if (!alerts.hasOwnProperty(type) && !vipUsers.hasOwnProperty(type)) {
			return;
		}
		else if (vipUsers.hasOwnProperty(type)) {
			alert = alerts['hellovip'];
			alert.timeout = vipUsers[type][1];
			alert.sound = vipUsers[type][0];
		}
		else {
			alert = alerts[type];
		}

		isExecuting = true;

		if (alert.goBig && currentScene.startsWith('Shop') && currentScene != 'Shop - Starting Soon') {
			obs.send('SetCurrentScene', {'scene-name' : 'Shop - Big Cam'}).then(() => {
				console.log('OBS Websocket: Changing scene to Shop - Big Cam');
            }).catch(err => {
				console.log('OBS Websocket Error: ' + err);
            });
		}

		if (alert.wemoState != null && alert.tpState != null && alert.tpPlugs != null) {
			changePowerSwitches(alert.wemoState, alert.tpState, alert.tpPlugs, alert.timeout);
		}
		
		if (alert.strobe1 && alert.strobe2) {
			alternateStrobing(3, 8, alert.strobe1, alert.strobe2, alert.timeout);
			alternateStrobing(9, 10, alert.strobe1, alert.strobe2, alert.timeout);
		}
		
		if (alert.sound) {
			player.play(alert.sound, function(err){
				if (err) throw err
			});
		}
		setTimeout(function() {
			isExecuting = false;
			triggerLightAndNoise(eventQueue.shift());
		}, alert.timeout + 3000);
	}
}

let welcomedUsers = new Set();
let noticedUsers = new Set();

// Chat message or whisper
tmiClient.on("chat", (channel, userstate, message, self) => {
	let isMod = (userstate['mod'] || userstate['username'] == 'banzaibaby') ? true : false;
	let isSub = userstate['subscriber'] ? userstate['subscriber'] : false;
	let isVip = userstate['badges-raw'] ? userstate['badges-raw'].includes('vip') : false;

	// Create a set with all the emotes in the mssage
	let emotes = userstate['emotes'] ? Object.keys(userstate['emotes']) : [];
	let emoteSet = new Set(emotes);

	message = message.toLowerCase();

	// Allow mods to toggle safemode on or off
	if (isMod && message.startsWith("!safemode")) {
		let words = message.split(' ');
		if (words.length == 1) {
			tmiClient.say(process.env.TWITCH_CHANNEL, `Safe Mode is currently ${isPaused ? 'ON' : 'OFF'}`);
		}
		else if (words[1] == 'on') {
			console.log('SAFE MODE ON');
			isPaused = true;
			tmiClient.say(process.env.TWITCH_CHANNEL, "Safe Mode changed to ON");
		}
		else if (words[1] == 'off') {
			console.log('SAFE MODE OFF');
			isPaused = false;
			tmiClient.say(process.env.TWITCH_CHANNEL, "Safe Mode changed to OFF");
			triggerLightAndNoise(eventQueue.shift());
		}
	}
	// Allow mods to trigger a demo
	else if (isMod && message.startsWith("!demo")) {
		triggerLightAndNoise("demo");
	}
	// Allow mods to trigger any sound/light combo
	else if (isMod && message.startsWith("!trigger")) {
		let words = message.split(' ');
		if (words[1] in alerts) {
			triggerLightAndNoise(words[1]);
		}
	}
	// If a Mod/Sub/VIP says HeyGuys for the first time that day or anyone uses bzbHey
	else if ((((isMod || isSub || isVip) && (emoteSet.has('30259') || emoteSet.has('160400'))) || emoteSet.has('emotesv2_ec3052867f44421896453a73728dfdb6')) && !welcomedUsers.has(userstate['username'])) {
		if (vipUsers.hasOwnProperty(userstate['username'])) {
			triggerLightAndNoise(userstate['username']);
		}
		else {
			triggerLightAndNoise("hello");
		}
		welcomedUsers.add(userstate['username']);
	}
	// If someone uses bzbNoticeMe
	else if (emoteSet.has('emotesv2_461c6588d71e43c6b95dea6052d15701') && !noticedUsers.has(userstate['username'])) {
		triggerLightAndNoise("senpai");
		noticedUsers.add(userstate['username']);
	}
});

// User has been banned
tmiClient.on("ban", (channel, username, reason, userstate) => {
	triggerLightAndNoise("ban");
});

// User has been timed out
tmiClient.on("timeout", (channel, username, reason, duration, userstate) => {
    if (duration >= 300) {
		triggerLightAndNoise("ban");
	}
});

// Channel has been raided
tmiClient.on("raided", (channel, username, viewers) => {
	if (viewers >= 5) {
		triggerLightAndNoise("raid");
	}
});

// Sub bomb triggered
tmiClient.on("submysterygift", (channel, username, numbOfSubs, methods, userstate) => {
    if (numbOfSubs >= 5) {
		triggerLightAndNoise('subbomb');
	}
});

function redeemReward(data) {
	if (data && data.redemption && data.redemption.reward && data.redemption.reward.title) {
		if(data.redemption.reward.title == 'Tube Man') {
			triggerLightAndNoise('tubeman');
		}
		else if(data.redemption.reward.title == 'Boogie') {
			triggerLightAndNoise('boogie');
		}
		else if(data.redemption.reward.title == 'Choose Any' && data.redemption.user_input) {
			let userInputWords = data.redemption.user_input.toLowerCase().split(' ');
			let triggerFound = false;
			for (let word of userInputWords) {
				if (alerts[word]) {
					triggerLightAndNoise(word);
					triggerFound = true;
					break;
				}
			}
			if (!triggerFound) {
				tmiClient.say(process.env.TWITCH_CHANNEL, "The Choose Any reward was redeemed, but no trigger word was found.");
			}
		}
		else if(data.redemption.reward.title == 'SILENCE') {
			triggerLightAndNoise('silence');
			
            obs.send('SetMute', {'source' : 'Mic/Aux', 'mute': true}).then(() => {
				console.log('OBS Websocket: Mic muted');
				setTimeout(function() {
					obs.send('SetMute', {'source' : 'Mic/Aux', 'mute': false}).then(() => {
						console.log('OBS Websocket: Mic unmuted');
					}).catch(err => {
						console.log('OBS Websocket Error: ' + err);
					});
				}, 30000);
            }).catch(err => {
				console.log('OBS Websocket Error: ' + err);
            });
		}
	}
}